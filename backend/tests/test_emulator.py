import asyncio,json,struct,zlib,shutil,subprocess
from pathlib import Path
from uuid import UUID
import pytest
from fastapi.testclient import TestClient
from mission_control.api import create_app
from mission_control.emulator_protocol import encode,decode,SIZE
from mission_control.emulator_sender import schedule
from mission_control.emulator import Emulator
from mission_control.store import Store

STREAM=bytes(range(16))
def packet(seq=0,boot=0,stream=STREAM):return encode(stream,boot,seq,seq*200,41.0082,28.9784,20.25,5.5,12.6)
def test_wire_codec_flags_and_crc():
    data=packet(17,2);assert len(data)==SIZE==62
    frame=decode(data);assert frame['boot_id']==2 and frame['sequence']==17
    assert frame['latitude']==pytest.approx(41.0082) and frame['relative_altitude_m']==20.25
    assert frame['battery_voltage_v']==pytest.approx(12.6)
    missing=decode(encode(STREAM,0,0,0,None,None,None,None,None))
    assert all(missing[k] is None for k in ('latitude','longitude','relative_altitude_m','ground_speed_ms','battery_voltage_v'))
    for malformed in [data[:-1],bytes([0])+data[1:],data+b'0']:
        with pytest.raises(ValueError):decode(malformed)
    invalid=bytearray(data);invalid[5]=255;invalid[-4:]=struct.pack('<I',zlib.crc32(invalid[:-4]))
    with pytest.raises(ValueError):decode(invalid)

def test_seeded_fault_schedule_and_sensor_gap():
    assert schedule(42,'mixed',50,STREAM)==schedule(42,'mixed',50,STREAM)
    assert schedule(42,'mixed',50,STREAM)!=schedule(43,'mixed',50,STREAM)
    gap=[decode(p) for _,p in schedule(42,'sensor_gap',30,STREAM)]
    assert sum(p['latitude'] is None for p in gap)==10
    assert len(schedule(42,'loss',100,STREAM))<100

def test_receiver_does_not_promote_corrupt_duplicate_or_old_boot_packets():
    store=Store(':memory:');emulator=Emulator(store)
    flight=store.start_recording('Separate SITL recording')
    emulator.run=dict(id=str(UUID(bytes=STREAM)),status='running',profile='restart',expected_packets=100,packets=[],counters=dict(received=0,accepted=0,duplicates=0,out_of_order=0,corrupt=0,foreign=0,sequence_missing=0,boots=0))
    emulator.started=0;emulator.seen=set();emulator.maxima={};emulator.current_boot=-1
    for data in [packet(0),packet(2),packet(1),packet(1),packet(0,1),packet(3),packet(0,stream=bytes(16)),packet()[:-1]]:emulator.receive(data,('127.0.0.1',12345))
    counts=emulator.run['counters']
    assert counts['accepted']==3 and counts['out_of_order']==2 and counts['duplicates']==1
    assert counts['foreign']==1 and counts['corrupt']==1 and counts['boots']==2
    latest=next(e['frame'] for e in reversed(emulator.run['packets']) if e['classification']=='accepted')
    assert latest['boot_id']==1 and latest['sequence']==0
    assert store.session(flight)['events']==[]
    store.close()

def test_cpp_decoder_matches_python_and_rejects_crc_errors(tmp_path):
    compiler=shutil.which('g++')
    if not compiler:pytest.skip('C++ compiler unavailable')
    root=Path(__file__).resolve().parents[2];executable=tmp_path/'verify'
    subprocess.run([compiler,'-std=c++17','-Wall','-Wextra','-Werror',str(root/'prototype/verify.cpp'),'-o',str(executable)],check=True)
    good=packet(17,2);bad=bytearray(good);bad[48]^=1
    result=subprocess.run([str(executable)],input='\n'.join([good.hex(),bytes(bad).hex()]),text=True,capture_output=True,check=True).stdout.splitlines()
    fields=result[0].split(',');assert fields[:4]==['15','2','17','3400']
    assert float(fields[6])==20.25 and float(fields[8])==pytest.approx(decode(good)['battery_voltage_v'])
    assert result[1]=='invalid'

def test_interrupted_emulator_is_closed_after_restart(tmp_path):
    path=tmp_path/'db';store=Store(path);store.save_emulator(dict(id='old',status='running'));store.close();store=Store(path)
    assert store.emulator_run('old')['status']=='interrupted'
    store.close()

def test_api_ownership_bounds_and_sitl_control_isolation(monkeypatch):
    monkeypatch.setattr(Emulator,'start',lambda self,owner,profile,seed,duration:dict(source='emulator',profile=profile,seed=seed,duration_s=duration))
    app=create_app(':memory:')
    with TestClient(app) as client:
        headers={'X-Control-Session':'emulator-owner'}
        assert client.post('/api/v1/emulator',headers=headers,json={'profile':'mixed','seed':42,'duration_s':5}).status_code==200
        assert app.state.manager.controller is None
        assert client.post('/api/v1/emulator/stop',headers={'X-Control-Session':'other'}).status_code==409
        for body in [{'profile':'raw_command'},{'duration_s':61},{'seed':True},{'host':'remote-host'}]:
            assert client.post('/api/v1/emulator',headers=headers,json=body).status_code==422
        assert client.post('/api/v1/emulator',json={}).status_code==422
        assert client.post('/api/v1/emulator',headers={**headers,'Origin':'https://example.com'},json={}).status_code==403

def test_generated_golden_vector_is_stable():
    path=Path(__file__).resolve().parents[2]/'prototype/golden-vectors.json'
    vector=json.loads(path.read_text())
    assert packet(17,2).hex()==vector['packet_hex']
