import json
import socket
import ssl
import threading
import time
import subprocess
import sys
from pathlib import Path
import httpx
import pytest
from mission_control.fleet_tls import initialize, server
from mission_control.key_custody import key_password


def context(directory, identity=None):
    ctx = ssl.create_default_context(cafile=str(directory/'ca.crt'))
    ctx.minimum_version = ssl.TLSVersion.TLSv1_3
    if identity:
        key = directory/f'{identity}.key'
        ctx.load_cert_chain(str(directory/f'{identity}.crt'), str(key), password=key_password(key))
    return ctx


def test_real_tls_identity_revocation_and_negative_certificates(tmp_path):
    directory = tmp_path/'tls'
    initialize(directory)
    with pytest.raises(FileExistsError):
        initialize(directory)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    service = server(directory, port)
    thread = threading.Thread(target=service.run, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic()+10
        while not service.started and thread.is_alive() and time.monotonic()<deadline:
            time.sleep(.02)
        assert service.started
        url = f'https://127.0.0.1:{port}'
        with httpx.Client(base_url=url, verify=context(directory, 'center'), trust_env=False) as center:
            for station in ('station-a', 'station-b'):
                device = dict(serial=station, name=station, model='Synthetic bench', station=station, firmware='SIM', equipment=[])
                assert center.post('/api/v1/fleet/devices', json=device).status_code == 201
            assert len(center.get('/api/v1/fleet/snapshot').json()['devices']) == 2
        children = []
        try:
            for station in ('station-a', 'station-b'):
                children.append(subprocess.Popen([sys.executable, '-m', 'mission_control.fleet_station',
                    '--center', url, '--tls-directory', str(directory), '--identity', station,
                    '--seconds', '1', '--boot', '0'], cwd=Path(__file__).resolve().parents[1],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE))
            for child in children:
                output, error = child.communicate(timeout=10)
                assert child.returncode == 0, error.decode()
                assert json.loads(output)['cycles'] > 0
        finally:
            for child in children:
                if child.poll() is None:
                    child.kill()
                    child.wait()
        for station in ('station-a', 'station-b'):
            with httpx.Client(base_url=url, verify=context(directory, station), trust_env=False) as client:
                snapshot = client.get('/api/v1/fleet/snapshot', headers={'Authorization': 'Bearer spoof-center', 'X-Station': 'center'}).json()
                assert snapshot['actor'] == station
                assert len(snapshot['devices']) == 1
                assert client.post(f'/api/v1/fleet/devices/{station}/measurements', json=dict(source='synthetic', boot=1, sequence=0, source_time_ms=0, temperature_c=22)).status_code == 202
                other = 'station-b' if station == 'station-a' else 'station-a'
                assert client.post(f'/api/v1/fleet/devices/{other}/measurements', json=dict(source='synthetic', boot=1, sequence=1, source_time_ms=1)).status_code == 403
        with httpx.Client(base_url=url, verify=context(directory, 'station-a'), trust_env=False) as client:
            assert client.get('/api/v1/fleet/snapshot').status_code == 200
            identities = json.loads((directory/'identities.json').read_text())
            fingerprint = next(key for key, value in identities.items() if value == 'station-a')
            (directory/'revoked.json').write_text(json.dumps([fingerprint]))
            # Same keep-alive connection must stop working without a server restart.
            assert client.get('/api/v1/fleet/snapshot').status_code == 403
            (directory/'revoked.json').write_text('broken')
            assert client.get('/api/v1/fleet/snapshot').status_code == 403
            (directory/'revoked.json').write_text('[]')
        with httpx.Client(base_url=url, verify=context(directory, 'unenrolled'), trust_env=False) as client:
            assert client.get('/api/v1/fleet/snapshot').status_code == 403
        for identity in (None, 'expired'):
            with httpx.Client(base_url=url, verify=context(directory, identity), trust_env=False) as client:
                with pytest.raises(httpx.TransportError):
                    client.get('/api/v1/fleet/snapshot')
        foreign = tmp_path/'foreign-ca'
        initialize(foreign)
        foreign_client = context(directory)
        foreign_client.load_cert_chain(str(foreign/'station-a.crt'), str(foreign/'station-a.key'), password=key_password(foreign/'station-a.key'))
        with httpx.Client(base_url=url, verify=foreign_client, trust_env=False) as client:
            with pytest.raises(httpx.TransportError):
                client.get('/api/v1/fleet/snapshot')
        untrusted = ssl.create_default_context()
        untrusted.load_cert_chain(str(directory/'center.crt'), str(directory/'center.key'), password=key_password(directory/'center.key'))
        with httpx.Client(base_url=url, verify=untrusted, trust_env=False) as client:
            with pytest.raises(httpx.TransportError):
                client.get('/api/v1/fleet/snapshot')
        old_tls = context(directory, 'center')
        old_tls.minimum_version = ssl.TLSVersion.TLSv1_2
        old_tls.maximum_version = ssl.TLSVersion.TLSv1_2
        with httpx.Client(base_url=url, verify=old_tls, trust_env=False) as client:
            with pytest.raises(httpx.TransportError):
                client.get('/api/v1/fleet/snapshot')
        with socket.create_connection(('127.0.0.1', port)) as sock:
            with context(directory, 'center').wrap_socket(sock, server_hostname='localhost') as tls:
                assert tls.version() == 'TLSv1.3'
        with socket.create_connection(('127.0.0.1', port)) as sock:
            with pytest.raises(ssl.SSLCertVerificationError):
                context(directory, 'center').wrap_socket(sock, server_hostname='wrong.example')
    finally:
        service.should_exit = True
        thread.join(10)
        assert not thread.is_alive()
