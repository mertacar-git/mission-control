import asyncio
import math
import time
from types import SimpleNamespace
import pytest
from pydantic import ValidationError
from fastapi.testclient import TestClient
from mission_control.models import Mission,Waypoint,Telemetry,ConnectionState,Event
from mission_control.store import Store
from mission_control.analysis import report,distance_m,route_deviation_m
from mission_control.mavlink import MAVLinkManager,heartbeat_state,mission_items,M
from mission_control.api import create_app

def mission(): return Mission(name='Test',waypoints=[Waypoint(latitude=41.0085,longitude=28.9784,altitude_m=20)])

def test_mission_validation():
    for kwargs in [dict(latitude=91,longitude=0,altitude_m=20),dict(latitude=0,longitude=0,altitude_m=float('nan')),dict(latitude=0,longitude=0,altitude_m=121)]:
        with pytest.raises(ValidationError): Waypoint(**kwargs)
    with pytest.raises(ValidationError): Mission(name='x',waypoints=[])
    with pytest.raises(ValidationError): Mission(name='x',waypoints=[Waypoint(latitude=0,longitude=0,altitude_m=20)],raw_command=123)

def test_wire_items_include_home_takeoff_and_landing():
    items=mission_items(mission())
    assert len(items)==4
    assert items[0]['command']==M.MAV_CMD_NAV_WAYPOINT
    assert items[1]['command']==M.MAV_CMD_NAV_TAKEOFF
    assert items[-1]['command']==M.MAV_CMD_NAV_LAND
    assert items[2]['x']==410085000

def test_heartbeat_thresholds():
    assert heartbeat_state(None)==ConnectionState.CONNECTING
    assert heartbeat_state(2.9)==ConnectionState.CONNECTED
    assert heartbeat_state(3)==ConnectionState.STALE
    assert heartbeat_state(10)==ConnectionState.DISCONNECTED
    assert heartbeat_state(0,False)==ConnectionState.DISCONNECTED

def test_recording_retains_nulls_and_event_order():
    store=Store(':memory:');identifier=store.start_recording('Test',mission().model_dump())
    store.append(Event(type='telemetry',payload=Telemetry(elapsed_s=1).model_dump()).model_dump())
    store.append(Event(type='command',payload=dict(status='failed')).model_dump())
    store.stop_recording();result=store.session(identifier)
    assert result['events'][0]['payload']['battery_pct'] is None
    assert [e['type'] for e in result['events']]==['telemetry','command']
    assert 'None' not in store.csv(identifier)
    assert result['session']['ended_utc'] is not None
    store.close()

def test_recording_exclusivity():
    store=Store(':memory:');store.start_recording('first')
    with pytest.raises(ValueError): store.start_recording('second')
    store.close()

def test_restart_closes_interrupted_session(tmp_path):
    path=tmp_path/'db.sqlite3';store=Store(path);identifier=store.start_recording('Interrupted')
    store.db.close();reopened=Store(path)
    assert reopened.session(identifier)['session']['ended_utc'] is not None
    reopened.close()

def test_analysis_excludes_stale_positions_and_gaps():
    rows=[Telemetry(elapsed_s=0,latitude=41,longitude=29,relative_altitude_m=10,battery_pct=90,position_fresh=True),Telemetry(elapsed_s=1,latitude=41.0001,longitude=29,relative_altitude_m=30,battery_pct=89,position_fresh=True),Telemetry(elapsed_s=8,latitude=42,longitude=30,position_fresh=False)]
    recording=dict(session={'mission':mission().model_dump()},events=[dict(type='telemetry',payload=r.model_dump()) for r in rows])
    result=report(recording,max_altitude=20)
    assert result['recording_gaps']==1
    assert 10<result['observed_ground_distance_m']<12
    assert result['altitude_alert_samples']==1
    assert result['battery_used_percentage_points']==1
    with pytest.raises(ValueError): report(recording,min_battery=101)

def test_empty_analysis_and_route_metric():
    result=report(dict(session={},events=[]))
    assert result['peak_ground_speed_ms'] is None
    assert result['max_route_deviation_m'] is None
    assert distance_m((0,0),(0,0))==0
    assert route_deviation_m((0,0),[dict(latitude=0,longitude=-.001),dict(latitude=0,longitude=.001)])==0

def test_single_controller_lease():
    store=Store(':memory:');manager=MAVLinkManager(store);manager.claim('first')
    with pytest.raises(PermissionError): manager.claim('second')
    manager.controller_seen-=16;manager.claim('second')
    with pytest.raises(PermissionError): manager.require_control('first')
    manager.require_control('second');store.close()

def test_stale_snapshot_blanks_measurements():
    store=Store(':memory:');manager=MAVLinkManager(store)
    manager.telemetry=Telemetry(latitude=41,longitude=29,relative_altitude_m=20,battery_pct=50,ground_speed_ms=3)
    manager.state=ConnectionState.STALE
    result=manager.snapshot()
    assert result['latitude'] is None and result['relative_altitude_m'] is None and result['ground_speed_ms'] is None
    assert result['battery_pct'] is None;store.close()

async def test_response_registers_before_send_and_cleans_up():
    store=Store(':memory:');manager=MAVLinkManager(store)
    def send():
        assert len(manager.pending)==1
        manager.pending[0][1].set_result('ack')
    assert await manager.response(lambda _:True,send)=='ack'
    assert not manager.pending
    with pytest.raises(asyncio.TimeoutError): await manager.response(lambda _:True,lambda:None,.01)
    assert not manager.pending;store.close()

async def test_no_automatic_retry_of_command():
    store=Store(':memory:');manager=MAVLinkManager(store);calls=[]
    manager.link=SimpleNamespace(mav=SimpleNamespace(command_long_send=lambda *args:calls.append(args)))
    with pytest.raises(asyncio.TimeoutError): await manager.command_long(400,[1,0,0,0,0,0,0],.01)
    assert len(calls)==1;store.close()

def test_api_validation_and_exports(tmp_path):
    app=create_app(tmp_path/'test.sqlite3')
    with TestClient(app) as client:
        assert client.get('/api/v1/health').status_code==200
        saved=client.post('/api/v1/missions',json=mission().model_dump()).json()
        assert saved['name']=='Test'
        assert len(client.get('/api/v1/missions').json())==1
        assert client.post('/api/v1/commands',json={'action':'raw_command'},headers={'X-Control-Session':'x'}).status_code==422
        assert client.post('/api/v1/commands',json={'action':'start'},headers={'X-Control-Session':'x'}).status_code==409
        assert client.get('/api/v1/recordings/missing').status_code==404
        assert client.post('/api/v1/missions',json=mission().model_dump(),headers={'Origin':'https://example.com'}).status_code==403
        assert client.post('/api/v1/missions',json={'name':'bad','waypoints':[]}).status_code==422
        with client.websocket_connect('/ws') as ws: assert ws.receive_json()['type']=='snapshot'

async def test_command_overlap_rejected():
    store=Store(':memory:');manager=MAVLinkManager(store,SimpleNamespace(running=True))
    manager.state=ConnectionState.CONNECTED;manager.link=object()
    async with manager.operation:
        with pytest.raises(RuntimeError,match='pending'): await manager.command('hold')
    store.close()
