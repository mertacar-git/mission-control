import json, os, socket, subprocess, sys, time
from datetime import datetime, timedelta, timezone
from pathlib import Path
import httpx, pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from mission_control.prototype import setup, preflight, PORTS, ROOT
from mission_control.key_custody import write_secret, read_secret
from mission_control.serial_bench import replay
from tests.test_fleet_tls import context
from tests.test_operator_accounts import PASSWORD


def fixture_dist(tmp_path):
    dist=tmp_path/'dist';(dist/'assets').mkdir(parents=True,exist_ok=True)
    (dist/'index.html').write_text('<!doctype html><title>FLW VECTOR</title>')
    (dist/'assets/app.js').write_text('// test-only asset')
    return dist

def test_protected_exchange_is_exclusive_and_private(tmp_path):
    path=tmp_path/'secret'
    write_secret(path,'test-only-private-token')
    assert read_secret(path)=='test-only-private-token'
    if os.name=='nt':assert b'test-only-private-token' not in path.read_bytes()
    else:
        assert path.stat().st_mode&0o077==0
        path.chmod(0o644)
        with pytest.raises(PermissionError):read_secret(path)
    with pytest.raises(FileExistsError):write_secret(path,'replacement')


def test_preflight_occupied_port_and_invalid_cert_do_not_mutate_accounts(tmp_path):
    directory=tmp_path/'prototype';setup(directory,'admin',PASSWORD)
    database=directory/'operators/accounts.sqlite3';before=database.read_bytes()
    with socket.socket() as occupied:
        occupied.bind(('127.0.0.1',0));port=occupied.getsockname()[1]
        with pytest.raises(ValueError,match='occupied'):preflight(directory,dist=fixture_dist(tmp_path),ports=(port,))
        assert occupied.getsockname()[1]==port
    assert database.read_bytes()==before
    with pytest.raises(FileExistsError):setup(directory,'admin',PASSWORD)
    certificate=directory/'tls/server.crt';certificate.write_text('malformed certificate')
    with pytest.raises(ValueError):preflight(directory,dist=fixture_dist(tmp_path),ports=())
    assert database.read_bytes()==before


def test_expired_certificate_is_diagnosed_before_launch(tmp_path):
    directory=tmp_path/'prototype';setup(directory,'admin',PASSWORD)
    key=ec.generate_private_key(ec.SECP256R1());name=x509.Name([x509.NameAttribute(x509.NameOID.COMMON_NAME,'localhost')]);now=datetime.now(timezone.utc)
    cert=x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(1).not_valid_before(now-timedelta(days=2)).not_valid_after(now-timedelta(days=1)).sign(key,hashes.SHA256())
    (directory/'tls/server.crt').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    with pytest.raises(ValueError,match='server certificate is expired'):preflight(directory,dist=fixture_dist(tmp_path),ports=())


def test_single_launcher_verified_https_operator_capture_bridge_cut_and_replay(tmp_path):
    directory=tmp_path/'prototype';setup(directory,'admin',PASSWORD)
    dist=fixture_dist(tmp_path);preflight(directory,dist=dist)
    output=tmp_path/'launcher.log'
    with output.open('w') as log:
        process=subprocess.Popen([sys.executable,'-m','mission_control.prototype','--directory',str(directory),'start','--no-browser','--seconds','12','--dist',str(dist)],cwd=ROOT/'backend',stdout=log,stderr=subprocess.STDOUT,text=True)
    try:
        deadline=time.monotonic()+20
        while time.monotonic()<deadline and 'READY SYNTHETIC' not in output.read_text():
            assert process.poll() is None,output.read_text()
            time.sleep(.1)
        assert 'READY SYNTHETIC' in output.read_text()
        with httpx.Client(base_url='https://127.0.0.1:8772',verify=context(directory/'tls'),trust_env=False,timeout=3) as client:
            page=client.get('/');assert page.status_code==200 and 'FLW VECTOR' in page.text
            assert client.get('/api/v1/operators/serial/status').status_code==401
            login=client.post('/api/v1/operators/login',json=dict(username='admin',password=PASSWORD));login.raise_for_status()
            headers={'Authorization':'Bearer '+login.json()['token'],'X-Control-Session':'test-ui'}
            prototype=client.get('/api/v1/operators/prototype',headers=headers).json()
            assert prototype['profile']=='synthetic' and prototype['device_id']=='MCS-BENCH-01'
            device=dict(serial='MCS-BENCH-01',name='Bench',model='MCS1',station='station-a',firmware='SIM',equipment=['Synthetic IMU'])
            assert client.post('/api/v1/operators/devices',headers=headers,json=device).status_code==201
            assert client.post('/api/v1/operators/devices',headers=headers,json=device).json()['code']=='duplicate_device'
            assert client.post('/api/v1/operators/serial/control/claim',headers=headers).status_code==200
            response=client.post('/api/v1/operators/serial/connection',headers=headers,json=dict(port='TEST:MCS1',baud=115200,experiment='launcher software acceptance',duration_s=6,test_profile='sensor_gap'))
            response.raise_for_status()
            recording=response.json()['run']['id']
            deadline=time.monotonic()+4
            while time.monotonic()<deadline:
                rows=client.get('/api/v1/operators/registry',headers=headers).json()['registry']['devices']
                if rows[0]['state']=='fresh':break
                time.sleep(.15)
            assert rows[0]['measurement']['source']=='synthetic'
            assert rows[0]['measurement']['sensor_protocol']=='MCS1'
            assert client.delete('/api/v1/operators/serial/connection',headers=headers).status_code==200
            time.sleep(3.2)
            row=client.get('/api/v1/operators/registry',headers=headers).json()['registry']['devices'][0]
            assert row['state']=='stale' and row['measurement'] is None
            raw=client.get('/api/v1/operators/serial/recordings/'+recording,headers=headers);raw.raise_for_status()
            path=tmp_path/'replay.jsonl';path.write_text(raw.text)
            assert replay(path)['counts']['accepted']>0
            assert client.post('/api/v1/operators/serial/control/claim/extra',headers=headers).status_code==404
        assert process.wait(timeout=20)==0,output.read_text()
        assert not (directory/'launcher.lock').exists()
        assert not list(directory.glob('run-*/serial.token'))
        for port in PORTS:
            with socket.socket() as probe:
                if os.name!='nt':probe.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
                probe.bind(('127.0.0.1',port))
        for log in directory.glob('run-*/*.log'):
            assert PASSWORD not in log.read_text() and 'Bearer ' not in log.read_text()
    finally:
        if process.poll() is None:process.terminate();process.wait(timeout=15)

def test_partial_startup_cleans_only_owned_children(tmp_path,monkeypatch):
    import mission_control.prototype as prototype
    directory=tmp_path/'prototype';setup(directory,'admin',PASSWORD)
    def fail(*args,**kwargs):raise RuntimeError('injected readiness failure')
    monkeypatch.setattr(prototype,'wait_ready',fail)
    with pytest.raises(RuntimeError,match='injected readiness failure'):
        prototype.launch(directory,dist=fixture_dist(tmp_path),open_browser=False)
    assert not (directory/'launcher.lock').exists()
    assert not list(directory.glob('run-*/serial.token'))
    for port in PORTS:
        with socket.socket() as probe:
            if os.name!='nt':probe.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
            probe.bind(('127.0.0.1',port))
