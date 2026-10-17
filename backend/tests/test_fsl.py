import json
import os
import socket
import sqlite3
import threading
import time
import subprocess
import sys
from pathlib import Path
from contextlib import contextmanager
from uuid import uuid4
import httpx
import pytest
from mission_control.fleet_tls import initialize, renew, server
from mission_control.key_custody import key_password, dpapi
from tests.test_fleet_tls import context


@contextmanager
def running(directory):
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
        yield f'https://127.0.0.1:{port}'
    finally:
        service.should_exit = True
        thread.join(10)
        assert not thread.is_alive()


def enrol(directory, url):
    with httpx.Client(base_url=url, verify=context(directory, 'center'), trust_env=False) as center:
        assert center.post('/api/v1/fleet/devices', json=dict(serial='SENSOR-A', name='Bench', model='Synthetic', station='station-a', firmware='SIM', equipment=[])).status_code == 201


def envelope(session):
    return dict(protocol='FSL', version=1, message_id=str(uuid4()), session_id=session,
        station_id='station-a', device_id='SENSOR-A', sequence='0', type='equipment.report',
        payload=dict(source='synthetic', boot=1, sequence=0, source_time_ms=0, temperature_c=23))


def test_durable_replay_restart_renewal_and_atomic_failure(tmp_path):
    directory = tmp_path/'tls'
    initialize(directory)
    with running(directory) as url:
        enrol(directory, url)
        with httpx.Client(base_url=url, verify=context(directory, 'station-a'), trust_env=False) as station:
            session = station.post('/api/v1/fsl/sessions').json()['session_id']
            message = envelope(session)
            first = station.post('/api/v1/fsl/reports', json=message)
            assert first.status_code == 200 and first.json()['status'] == 'accepted-new'
            retry = station.post('/api/v1/fsl/reports', json=message).json()
            assert retry['status'] == 'duplicate-known'
            assert retry['received_utc_ms'] == first.json()['received_utc_ms']
            changed = dict(message, payload=dict(message['payload'], temperature_c=24))
            assert station.post('/api/v1/fsl/reports', json=changed).status_code == 409
            assert station.post('/api/v1/fsl/reports', json=dict(message, message_id=str(uuid4()))).status_code == 409
            # Fail after the report/audit writes, during insertion of replay evidence.
            with sqlite3.connect(directory/'registry.sqlite3') as db:
                db.execute("CREATE TRIGGER fail_fsl BEFORE INSERT ON fsl_messages BEGIN SELECT RAISE(ABORT,'test failure'); END")
            second = dict(message, message_id=str(uuid4()), sequence='1', payload=dict(message['payload'], sequence=1, source_time_ms=1))
            assert station.post('/api/v1/fsl/reports', json=second).status_code == 500
            with sqlite3.connect(directory/'registry.sqlite3') as db:
                assert db.execute('SELECT sequence FROM reports').fetchone()[0] == 0
                assert db.execute('SELECT COUNT(*) FROM audit WHERE kind="measurement"').fetchone()[0] == 1
                assert db.execute('SELECT COUNT(*) FROM fsl_messages').fetchone()[0] == 1
                db.execute('DROP TRIGGER fail_fsl')
    # Restart preserves replay evidence but never promotes old samples to live.
    with running(directory) as url:
        with httpx.Client(base_url=url, verify=context(directory, 'station-a'), trust_env=False) as old:
            assert old.get('/api/v1/fleet/snapshot').json()['devices'][0]['state'] == 'unknown'
            assert old.post('/api/v1/fsl/reports', json=message).json()['status'] == 'duplicate-known'
            assert old.get('/api/v1/fleet/snapshot').json()['devices'][0]['state'] == 'unknown'
            renewed = tmp_path/'renewed'
            renew(directory, 'station-a', tmp_path/'tls-authority', renewed)
            assert old.get('/api/v1/fleet/snapshot').status_code == 403
            assert old.post('/api/v1/fsl/reports', json=message).status_code == 403
            with httpx.Client(base_url=url, verify=context(renewed, 'station-a'), trust_env=False) as new:
                assert new.post('/api/v1/fsl/reports', json=message).status_code == 403
                new_session = new.post('/api/v1/fsl/sessions').json()['session_id']
                assert new.post('/api/v1/fsl/reports', json=dict(second, session_id=new_session)).json()['status'] == 'accepted-new'
    with pytest.raises(FileExistsError):
        renew(directory, 'station-a', tmp_path/'tls-authority', renewed)
    assert not (directory/'identity-update.lock').exists()


def test_fsl_parser_scopes_expiry_and_session_limit(tmp_path):
    directory = tmp_path/'tls'
    initialize(directory)
    with running(directory) as url:
        enrol(directory, url)
        with httpx.Client(base_url=url, verify=context(directory, 'station-a'), trust_env=False) as a, httpx.Client(base_url=url, verify=context(directory, 'station-b'), trust_env=False) as b:
            session = a.post('/api/v1/fsl/sessions').json()['session_id']
            message = envelope(session)
            assert b.post('/api/v1/fsl/reports', json=message).status_code == 403
            assert a.post('/api/v1/fsl/reports', json=dict(message, device_id='OTHER')).status_code == 403
            for bad in (dict(message, version=2), dict(message, version=True), dict(message, extra=True), dict(message, sequence='18446744073709551616'), dict(message, sequence='01'), dict(message, type='flight.command')):
                assert a.post('/api/v1/fsl/reports', json=bad).status_code == 422
            assert a.post('/api/v1/fsl/reports', content='{"protocol":"FSL","protocol":"FSL"}').status_code == 422
            assert a.post('/api/v1/fsl/reports', content=json.dumps(message).replace('23', 'NaN')).status_code == 422
            assert a.post('/api/v1/fsl/reports', content=b'x'*16385).status_code == 413
            with sqlite3.connect(directory/'registry.sqlite3') as db:
                db.execute('UPDATE fsl_sessions SET expires=0')
            assert a.post('/api/v1/fsl/reports', json=message).status_code == 403
            for _ in range(8):
                assert a.post('/api/v1/fsl/sessions').status_code == 201
            assert a.post('/api/v1/fsl/sessions').status_code == 429


def test_two_fsl_publishers_over_real_https(tmp_path):
    directory = tmp_path/'tls'
    initialize(directory)
    with running(directory) as url:
        with httpx.Client(base_url=url, verify=context(directory, 'center'), trust_env=False) as center:
            for station in ('station-a', 'station-b'):
                assert center.post('/api/v1/fleet/devices', json=dict(serial=station, name=station, model='Bench', station=station, firmware='SIM', equipment=[])).status_code == 201
            children = []
            try:
                for station in ('station-a', 'station-b'):
                    children.append(subprocess.Popen([sys.executable, '-m', 'mission_control.fleet_station', '--center', url,
                        '--tls-directory', str(directory), '--identity', station, '--fsl', '--seconds', '1', '--boot', '1'],
                        cwd=Path(__file__).resolve().parents[1], stdout=subprocess.PIPE, stderr=subprocess.PIPE))
                for child in children:
                    output, error = child.communicate(timeout=10)
                    assert child.returncode == 0, error.decode()
                    assert json.loads(output)['cycles'] > 0
            finally:
                for child in children:
                    if child.poll() is None:
                        child.kill()
                        child.wait()
            assert all(row['state'] == 'fresh' for row in center.get('/api/v1/fleet/snapshot').json()['devices'])
            with sqlite3.connect(directory/'registry.sqlite3') as db:
                assert db.execute('SELECT COUNT(DISTINCT actor) FROM fsl_sessions').fetchone()[0] == 2
                assert db.execute('SELECT COUNT(*) FROM fsl_messages').fetchone()[0] >= 2


def test_private_key_custody(tmp_path):
    directory = tmp_path/'tls'
    initialize(directory)
    key = directory/'station-a.key'
    if os.name == 'nt':
        assert b'ENCRYPTED PRIVATE KEY' in key.read_bytes()
        password = key_password(key)
        assert len(password) == 32
        assert dpapi(dpapi(b'test-only'), decrypt=True) == b'test-only'
        with pytest.raises(OSError):
            dpapi(b'corrupted', decrypt=True)
        assert not (directory/'ca.key').exists()
    else:
        assert key.stat().st_mode & 0o777 == 0o600
        key.chmod(0o644)
        with pytest.raises(PermissionError):
            key_password(key)
