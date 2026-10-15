import json
import math
from pathlib import Path
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from mission_control.models import Mission,Telemetry
from mission_control.planning import validate_planning,require_valid,fence_state,fence_metrics,SCALE,COS
from mission_control.simulator import HOME
from mission_control.store import Store
from mission_control.mavlink import MAVLinkManager
from mission_control.api import create_app

FIXTURES=json.loads((Path(__file__).resolve().parents[2]/'tests/fixtures/planning.json').read_text())
def coordinate(p): return dict(latitude=HOME[0]+p[1]/SCALE,longitude=HOME[1]+p[0]/SCALE/COS)
def mission(f=None):
    f=f or FIXTURES[0]
    return Mission(name=f['name'],waypoints=[dict(**coordinate(p),altitude_m=20) for p in f['route']],planning=dict(allowed_area=[coordinate(p) for p in f['allowed']],survey_area=[coordinate(p) for p in f['survey']],max_distance_m=f.get('max_distance_m',2000),max_altitude_m=f.get('max_altitude_m',80)))

@pytest.mark.parametrize('fixture',FIXTURES,ids=lambda f:f['name'])
def test_shared_geometry_contract(fixture):
    result=validate_planning(mission(fixture))
    assert result['valid']==fixture['valid']
    if fixture.get('code'): assert fixture['code'] in [i['code'] for i in result['issues']]

def test_validate_api_and_legacy_store_roundtrip():
    with TestClient(create_app(':memory:')) as client:
        m=mission().model_dump()
        assert client.post('/api/v1/missions/validate',json=m).json()['valid']
        invalid=mission(FIXTURES[1]).model_dump()
        response=client.post('/api/v1/missions/validate',json=invalid)
        assert response.status_code==200 and not response.json()['valid']
        assert client.post('/api/v1/missions',json=m).json()['planning']==m['planning']
        old={**m,'schema_version':1};old.pop('planning')
        normalized=client.post('/api/v1/missions',json=old).json()
        assert normalized['schema_version']==2 and normalized['planning'] is None
        old['planning']=m['planning'];assert client.post('/api/v1/missions',json=old).status_code==422

@pytest.mark.asyncio
async def test_backend_rejects_invalid_geometry_before_wire_upload_and_start_resume():
    store=Store(':memory:');manager=MAVLinkManager(store,SimpleNamespace(running=True));manager.state='connected';manager.link=object()
    invalid=mission(FIXTURES[1])
    with pytest.raises(ValueError): await manager.upload(invalid)
    manager.telemetry.armed=True;manager.active_mission=invalid;manager.upload_verified=True
    for action in ['start','resume']:
        with pytest.raises(ValueError): await manager.command(action)
    store.close()

def test_fence_measurements_and_duration_do_not_bridge_unknowns():
    m=mission();fresh=Telemetry(**coordinate([200,200]),relative_altitude_m=20,position_fresh=True,connection='connected').model_dump()
    assert fence_state(m,fresh)=='outside'
    assert fence_state(m,{**fresh,'relative_altitude_m':None})=='unknown'
    rows=[dict(fresh,elapsed_s=0),dict(fresh,elapsed_s=1),dict(fresh,elapsed_s=2,position_fresh=False),dict(fresh,elapsed_s=20),dict(fresh,elapsed_s=21)]
    assert fence_metrics(m,rows)==dict(fence_violation_count=2,fence_observed_violation_s=2)

def test_typescript_generated_survey_passes_independent_backend_geometry():
    source=Path(__file__).resolve().parents[2]/'docs/verification/survey-mission.json'
    m=Mission.model_validate_json(source.read_text())
    result=validate_planning(m)
    assert result['valid'],result
    assert len(m.waypoints)==7
    assert result['distance_m']==pytest.approx(138.462912,abs=.001)
