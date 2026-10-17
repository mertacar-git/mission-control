import pytest
import socket, threading, time, subprocess, sys
import httpx, uvicorn
from pathlib import Path
from fastapi.testclient import TestClient
from mission_control.fleet_service import create_fleet_app, Registry, Device, Measurement
import sqlite3
from mission_control.fleet_station import endpoint

KEYS={name:name+'-'+'x'*32 for name in ('center','station-a','station-b')}
def headers(name): return {'Authorization':'Bearer '+KEYS[name]}
def device(serial='SIM-001',station='station-a'):
    return dict(serial=serial,name='Civilian equipment',model='Bench prototype',station=station,firmware='SIM 1',equipment=['Temperature sensor'])
def frame(sequence=0,boot=1,source_time_ms=0):
    return dict(source='synthetic',boot=boot,sequence=sequence,source_time_ms=source_time_ms,temperature_c=23.5)


def test_auth_enrolment_and_station_scopes(tmp_path):
    target=tmp_path/'registry.db'
    app=create_fleet_app(target,KEYS)
    assert not target.exists()
    with TestClient(app,base_url='http://127.0.0.1:8770') as client:
        assert client.get('/api/v1/fleet/snapshot').status_code==401
        assert client.post('/api/v1/fleet/devices',json=device(),headers=headers('station-a')).status_code==403
        assert client.post('/api/v1/fleet/devices',json=device(),headers=headers('center')).status_code==201
        assert client.post('/api/v1/fleet/devices',json=device(),headers=headers('center')).status_code==409
        assert client.get('/api/v1/fleet/snapshot',headers=headers('station-b')).json()['devices']==[]
        path='/api/v1/fleet/devices/SIM-001/measurements'
        assert client.post(path,json=frame(),headers=headers('station-b')).status_code==403
        assert client.post(path,json=frame(),headers=headers('center')).status_code==403
        assert client.post(path,json=frame(),headers=headers('station-a')).status_code==202
        assert client.get('/api/v1/fleet/audit',headers=headers('station-a')).status_code==403
        assert len(client.get('/api/v1/fleet/audit',headers=headers('center')).json())==2
        assert client.post('/api/v1/fleet/commands',json={},headers=headers('center')).status_code==404


def test_freshness_restart_and_clock_sequence_checks(tmp_path):
    now=[0.0]
    target=tmp_path/'registry.db'
    with TestClient(create_fleet_app(target,KEYS,lambda:now[0]),base_url='http://localhost') as client:
        client.post('/api/v1/fleet/devices',json=device(),headers=headers('center'))
        path='/api/v1/fleet/devices/SIM-001/measurements'
        client.post(path,json=frame(source_time_ms=9007199254740993),headers=headers('station-a'))
        def row(): return client.get('/api/v1/fleet/snapshot',headers=headers('center')).json()['devices'][0]
        assert row()['measurement']['source_time_ms']=='9007199254740993'
        assert row()['measurement']['battery_percent'] is None
        for payload in (frame(),frame(sequence=1,source_time_ms=1)):
            assert client.post(path,json=payload,headers=headers('station-a')).status_code==409
        now[0]=3
        assert row()['state']=='stale' and row()['measurement'] is None
        now[0]=10
        assert row()['state']=='disconnected'
        assert client.post(path,json=frame(boot=2),headers=headers('station-a')).status_code==202
    with TestClient(create_fleet_app(target,KEYS),base_url='http://localhost') as client:
        row=client.get('/api/v1/fleet/snapshot',headers=headers('center')).json()['devices'][0]
        assert row['state']=='unknown' and row['measurement'] is None
        assert client.post(path,json=frame(boot=1,sequence=9),headers=headers('station-a')).status_code==409


def test_no_extra_fields_no_plaintext_remote_transport(tmp_path):
    with TestClient(create_fleet_app(tmp_path/'db',KEYS),base_url='http://localhost') as client:
        client.post('/api/v1/fleet/devices',json=device(),headers=headers('center'))
        path='/api/v1/fleet/devices/SIM-001/measurements'
        assert client.post(path,json=dict(frame(),command='arm'),headers=headers('station-a')).status_code==422
        assert client.post(path,json=dict(frame(),battery_percent=101),headers=headers('station-a')).status_code==422
    assert endpoint('https://center.example')=='https://center.example'
    for value in ('http://center.example','https://token@center.example','https://center.example/?token=x'):
        with pytest.raises(ValueError): endpoint(value)


def test_two_station_processes_report_three_enrolled_devices_over_http(tmp_path):
    bound=socket.socket();bound.bind(('127.0.0.1',0));bound.listen(128)
    port=bound.getsockname()[1]
    server=uvicorn.Server(uvicorn.Config(create_fleet_app(tmp_path/'db',KEYS),log_level='error',access_log=False))
    thread=threading.Thread(target=lambda:server.run(sockets=[bound]),daemon=True)
    thread.start();children=[]
    try:
        deadline=time.monotonic()+5
        while not server.started and time.monotonic()<deadline:time.sleep(0.02)
        assert server.started
        base=f'http://127.0.0.1:{port}'
        with httpx.Client(base_url=base,headers=headers('center')) as client:
            for serial,station in [('SIM-001','station-a'),('SIM-002','station-a'),('SIM-003','station-b')]:
                assert client.post('/api/v1/fleet/devices',json=device(serial,station)).status_code==201
            for station in ('station-a','station-b'):
                code=f"from mission_control.fleet_station import publish; publish({base!r},{KEYS[station]!r},1,1,0.05)"
                children.append(subprocess.Popen([sys.executable,'-c',code],cwd=Path(__file__).resolve().parents[1],stdout=subprocess.PIPE,stderr=subprocess.PIPE))
            for child in children:
                _,error=child.communicate(timeout=10)
                assert child.returncode==0,error.decode()
            rows=client.get('/api/v1/fleet/snapshot').json()['devices']
            assert len(rows)==3
            assert all(row['state']=='fresh' and row['measurement']['source']=='synthetic' for row in rows)
            assert all(row['measurement']['battery_percent'] is None for row in rows)
    finally:
        for child in children:
            if child.poll() is None:child.kill();child.wait()
        server.should_exit=True;thread.join(timeout=5);bound.close()
        assert not thread.is_alive()


def test_failed_audit_transaction_does_not_refresh_or_replace_measurement(tmp_path):
    now=[0.0]
    registry=Registry(tmp_path/'db',lambda:now[0])
    try:
        registry.register(Device(**device()),'center')
        registry.receive('SIM-001',Measurement(**frame()),'station-a')
        registry.db.execute("CREATE TRIGGER fail_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'test write failure'); END")
        registry.db.commit()
        now[0]=5
        with pytest.raises(sqlite3.IntegrityError):
            registry.receive('SIM-001',Measurement(**frame(sequence=1,source_time_ms=100)),'station-a')
        assert registry.snapshot('center')['devices'][0]['state']=='stale'
        assert registry.db.execute('SELECT sequence FROM reports').fetchone()[0]==0
    finally:
        registry.db.close()
