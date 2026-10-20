import json, time, socket, threading
from pathlib import Path
import httpx, pytest, uvicorn
from mission_control.station_bridge import BridgeConfig, StationBridge, BridgeError, sensor_payload
from mission_control.serial_service import create_serial_app, SerialStatus, ConnectionRequest
from mission_control.sensor_protocol import FIELDS
from tests.test_fsl import running
from tests.test_fleet_tls import context
from mission_control.fleet_tls import initialize

CONFIG=BridgeConfig(station_id='station-a',device_id='SENSOR-A',stream_id='000102030405060708090a0b0c0d0e0f')
def source():
    frame=json.loads((Path(__file__).resolve().parents[2]/'prototype/sensor-vector.json').read_text())['decoded']
    return dict(source='serial',transport='synthetic',control_owned=False,
        run=dict(id='run-1',port='TEST:MCS1',baud=115200,experiment='Synthetic',status='running',source='serial',transport='synthetic',started_utc='2026-10-19T00:00:00Z'),
        state='fresh',connection='connected',age_s=0,telemetry=frame,counts={},discarded_bytes=0,invalid_candidates=0)
def harness(status,clock=lambda:1,ack='accepted-new'):
    reports=[]
    def center(request):
        if request.url.path.endswith('/snapshot'): return httpx.Response(200,json=dict(actor='station-a',devices=[dict(device=dict(serial='SENSOR-A',station='station-a'))]))
        if request.url.path.endswith('/sessions'): return httpx.Response(201,json=dict(protocol='FSL',version=1,session_id='x'*32))
        data=json.loads(request.content);reports.append(data)
        return httpx.Response(200,json=dict(protocol='FSL',version=1,status=ack,message_id=data['message_id']))
    bridge=StationBridge(CONFIG,httpx.Client(base_url=CONFIG.receiver,transport=httpx.MockTransport(lambda request:httpx.Response(200,json=status))),httpx.Client(base_url=CONFIG.center,transport=httpx.MockTransport(center)),clock)
    bridge.initialize()
    return bridge,reports

def test_shared_vector_units_large_clock_nulls_and_provenance():
    status=source();payload=sensor_payload(SerialStatus.model_validate(status),CONFIG)
    assert payload.source=='synthetic' and payload.model_dump(mode='json')['source_time_ms']=='9007199254740993'
    assert payload.battery_percent is None
    for field in FIELDS: assert getattr(payload,field)==status['telemetry'][field]
    for field in FIELDS[:6]: status['telemetry'][field]=None
    assert sensor_payload(SerialStatus.model_validate(status),CONFIG).acceleration_z_ms2 is None
    status['transport']=status['run']['transport']='pyserial'
    assert sensor_payload(SerialStatus.model_validate(status),CONFIG).source=='serial'

def test_cache_duplicate_rate_limit_reboot_and_loss():
    status=source();now=[0.0];bridge,reports=harness(status,lambda:now[0])
    assert not bridge.step() and not bridge.step()
    status['telemetry']['sequence']+=1
    assert bridge.step()
    status['telemetry']['sequence']+=1;now[0]=.1
    assert not bridge.step()
    now[0]=.21
    assert bridge.step() and not bridge.step() and len(reports)==2
    status['state']='stale';status['age_s']=4
    assert not bridge.step() and bridge.state=='waiting'
    status['state']='fresh';status['age_s']=0;status['telemetry'].update(boot_id=3,sequence=0,source_time_ms=0);now[0]=.5
    assert bridge.step() and reports[-1]['payload']['boot']==3
    status['telemetry']['source_time_ms']=1
    with pytest.raises(BridgeError,match='regression'):bridge.step()
    with pytest.raises(BridgeError,match='requires_restart'):bridge.step()

@pytest.mark.parametrize('mutation,code',[({'stream_id':'f'*32},'stream_mismatch'),({'protocol':'MCT1'},'protocol_mismatch')])
def test_wrong_source(mutation,code):
    status=source();status['telemetry'].update(mutation);bridge,reports=harness(status)
    with pytest.raises(BridgeError,match=code):bridge.step()
    assert reports==[] and bridge.state=='error'

def test_ambiguous_ack_and_transport_stop_without_retry():
    status=source();bridge,reports=harness(status,ack='duplicate-known');bridge.step();status['telemetry']['sequence']+=1
    with pytest.raises(BridgeError,match='ack_unknown'):bridge.step()
    with pytest.raises(BridgeError,match='requires_restart'):bridge.step()
    assert len(reports)==1
    bridge,reports=harness(status);bridge.step();status['telemetry']['sequence']+=1
    bridge.center=httpx.Client(base_url=CONFIG.center,transport=httpx.MockTransport(lambda request:(_ for _ in ()).throw(httpx.ReadTimeout('secret must not escape'))))
    with pytest.raises(BridgeError,match='communication_or_ack_unknown'):bridge.step()
    assert 'secret' not in json.dumps(bridge.status())

def test_real_receiver_mtls_cut_and_separate_replay(tmp_path):
    directory=tmp_path/'tls';initialize(directory)
    app=create_serial_app(tmp_path/'serial',synthetic=True,token='test-only-token')
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    service=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=port,log_level='error'));thread=threading.Thread(target=service.run,daemon=True);thread.start()
    try:
        deadline=time.monotonic()+10
        while not service.started and time.monotonic()<deadline:time.sleep(.02)
        assert service.started
        app.state.service.start(ConnectionRequest(port='TEST:MCS1',experiment='bridge acceptance',duration_s=4,test_profile='sensor_gap'),'test-owner')
        with running(directory) as origin,httpx.Client(base_url=f'http://127.0.0.1:{port}',headers={'Authorization':'Bearer test-only-token'},trust_env=False) as receiver,httpx.Client(base_url=origin,verify=context(directory,'center'),trust_env=False) as center:
            center.post('/api/v1/fleet/devices',json=dict(serial='SENSOR-A',name='Bench',model='MCS1',station='station-a',firmware='SIM',equipment=[])).raise_for_status()
            with httpx.Client(base_url=origin,verify=context(directory,'station-a'),trust_env=False) as station:
                bridge=StationBridge(CONFIG.model_copy(update={'stream_id':'00112233445566778899aabbccddeeff'}),receiver,station);bridge.initialize()
                deadline=time.monotonic()+2
                while time.monotonic()<deadline:bridge.step();time.sleep(.21)
                assert bridge.forwarded>1
                row=center.get('/api/v1/fleet/snapshot').json()['devices'][0]
                assert row['measurement']['source']=='synthetic' and row['measurement']['sensor_protocol']=='MCS1' and row['measurement']['battery_percent'] is None
                before=bridge.forwarded;app.state.service.stop()
                assert not bridge.step() and bridge.forwarded==before
                time.sleep(3.1)
                row=center.get('/api/v1/fleet/snapshot').json()['devices'][0]
                assert row['state']=='stale' and row['measurement'] is None
                assert app.state.service.recording(app.state.service.current['id']) is not None
                assert bridge.forwarded==before
    finally:
        service.should_exit=True;thread.join(10)
        assert not thread.is_alive()

def test_two_station_processes_real_tls_and_revocation(tmp_path):
    import subprocess, sys, os
    directory=tmp_path/'tls';initialize(directory)
    app=create_serial_app(tmp_path/'serial',synthetic=True,token='test-only-process-token')
    service=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=8767,log_level='error'));thread=threading.Thread(target=service.run,daemon=True);thread.start()
    processes=[]
    try:
        deadline=time.monotonic()+10
        while not service.started and thread.is_alive() and time.monotonic()<deadline:time.sleep(.02)
        assert service.started
        app.state.service.start(ConnectionRequest(port='TEST:MCS1',experiment='two station processes',duration_s=10,test_profile='nominal'),'test-owner')
        with running(directory) as origin,httpx.Client(base_url=origin,verify=context(directory,'center'),trust_env=False) as center:
            for actor,serial in [('station-a','SENSOR-A'),('station-b','SENSOR-B')]:
                center.post('/api/v1/fleet/devices',json=dict(serial=serial,name=serial,model='MCS1',station=actor,firmware='SIM',equipment=[])).raise_for_status()
                config=tmp_path/f'{actor}.json';config.write_text(BridgeConfig(station_id=actor,device_id=serial,stream_id='00112233445566778899aabbccddeeff',center=origin).model_dump_json())
                token=tmp_path/f'{actor}.token'
                from mission_control.key_custody import write_secret
                write_secret(token,'test-only-process-token')
                processes.append(subprocess.Popen([sys.executable,'-m','mission_control.station_bridge','--config',str(config),'--tls-directory',str(directory),'--serial-token-file',str(token),'--seconds','3'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True))
            deadline=time.monotonic()+8
            while time.monotonic()<deadline:
                rows=center.get('/api/v1/fleet/snapshot').json()['devices']
                if all(row['state']=='fresh' for row in rows):break
                time.sleep(.1)
            assert all(row['measurement']['source']=='synthetic' for row in rows)
            identities=json.loads((directory/'identities.json').read_text())
            (directory/'revoked.json').write_text(json.dumps([key for key,actor in identities.items() if actor=='station-a']))
            outputs=[process.communicate(timeout=15) for process in processes]
            assert processes[0].returncode==1 and 'identity_rejected' in outputs[0][0]
            assert processes[1].returncode==0 and json.loads(outputs[1][0])['forwarded']>0
            assert all('test-only-process-token' not in stdout+stderr for stdout,stderr in outputs)
    finally:
        for process in processes:
            if process.poll() is None:process.terminate();process.wait(timeout=10)
        service.should_exit=True;thread.join(10)
        assert not thread.is_alive()
