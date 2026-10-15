import time
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from fastapi.testclient import TestClient
from mission_control.api import create_app
from mission_control.preflight import evaluate, mission_fingerprint
from mission_control.mavlink import MAVLinkManager
from mission_control.models import Telemetry, ConnectionState
from mission_control.store import Store
from tests.test_core import mission

def ready_manager(store=None):
    manager=MAVLinkManager(store or Store(':memory:'),SimpleNamespace(running=True,stop=AsyncMock()))
    manager.state=ConnectionState.CONNECTED;manager.link=SimpleNamespace(close=lambda:None)
    manager.telemetry=Telemetry(latitude=41,longitude=29,armed=False,navigation_ready=True,gps_fix_type=3,battery_pct=20)
    manager.field_times={k:time.monotonic() for k in ('position','gps','ekf','battery')}
    manager.claim('owner')
    return manager

def test_action_specific_checks_unknowns_and_content_identity():
    m=ready_manager()
    assert evaluate(m,'arm','owner').ready
    assert not evaluate(m,'start','owner').ready
    m.active_mission=mission();m.upload_verified=True;m.telemetry.armed=True
    assert evaluate(m,'start','owner').ready
    assert not evaluate(m,'start','other').ready
    original=mission_fingerprint(m.active_mission)
    m.active_mission.id='another';m.active_mission.name='renamed'
    assert mission_fingerprint(m.active_mission)==original
    m.telemetry.battery_pct=19.99
    assert next(c for c in evaluate(m,'resume').checks if c.id=='battery').state=='blocked'
    m.field_times['battery']-=5
    assert next(c for c in evaluate(m,'resume').checks if c.id=='battery').state=='unknown'
    m.store.close()

async def test_preflight_enforced_on_direct_command_and_land_not_battery_gated():
    m=ready_manager();m.telemetry.battery_pct=None;sent=[]
    async def mode(value):sent.append(value)
    m.set_mode=mode
    with pytest.raises(RuntimeError,match='battery'):await m.command('arm')
    assert not sent and m.events[-1]['type']=='preflight'
    await m.command('land')
    assert sent==['LAND'];m.store.close()


async def test_other_operation_blocks_readiness_but_own_command_lock_is_excluded():
    m=ready_manager()
    async with m.operation:
        assert not evaluate(m,'arm').ready
        assert evaluate(m,'arm',ignore_busy=True).ready
    m.store.close()

def test_api_reports_unknown_battery_and_busy_operation():
    app=create_app(':memory:')
    with TestClient(app) as client:
        response=client.get('/api/v1/preflight?action=arm').json()
        assert response['ready'] is False
        assert next(c for c in response['checks'] if c['id']=='battery')['state']=='unknown'
        assert client.get('/api/v1/preflight?action=land').status_code==422


def test_direct_api_rejects_battery_and_foreign_owner_without_wire_commands():
    app=create_app(':memory:',manager_factory=ready_manager)
    with TestClient(app) as client:
        app.state.manager.telemetry.battery_pct=19
        response=client.post('/api/v1/commands',json={'action':'arm'},headers={'X-Control-Session':'owner'})
        assert response.status_code==409 and 'battery' in response.json()['detail']
        response=client.post('/api/v1/commands',json={'action':'arm'},headers={'X-Control-Session':'foreign'})
        assert response.status_code==409
        assert not any(e['type']=='command' for e in app.state.manager.events)


@pytest.mark.parametrize('field,age,check',[('position',3,'position'),('gps',3,'gps'),('ekf',3,'ekf'),('battery',5,'battery')])
def test_stale_field_is_never_ready(field,age,check):
    m=ready_manager();m.field_times[field]-=age
    assert next(c for c in evaluate(m,'arm').checks if c.id==check).state!='ready'
    m.store.close()
