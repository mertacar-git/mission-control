import copy,json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from mission_control.api import create_app
from mission_control.comparison import compare_recordings,flight_summary
from mission_control.preflight import mission_fingerprint

ROOT=Path(__file__).resolve().parents[2]

def fixtures():
    return [json.loads((ROOT/f'frontend/public/comparison/{name}.json').read_text()) for name in ('flight-0','flight-90','baseline-0','baseline-1','baseline-2')]

def test_five_recordings_and_backend_frontend_contract():
    result=compare_recordings(fixtures())
    expected=json.loads((ROOT/'docs/verification/phases/phase-3/comparison.json').read_text())
    assert result==expected
    assert len(result['items'])==5 and result['warnings']

def test_missing_endpoints_gaps_and_content_identity():
    r=fixtures()[0];original=mission_fingerprint(r['session']['mission'])
    renamed=copy.deepcopy(r['session']['mission']);renamed['name']='Renamed';renamed['id']='different'
    assert mission_fingerprint(renamed)==original
    # Deliberately keep only one armed measurement; it is not a complete flight.
    r['events']=[e for e in r['events'] if e['type']=='telemetry' and e['payload']['armed'] is True][:1]
    result=flight_summary(r)
    assert result['observed_flight_s'] is None and result['completion']=='unknown'
    assert result['metrics']['battery_used_percentage_points'] is None
    assert result['speedup'] is None
    with pytest.raises(ValueError):compare_recordings([r,r])

def test_http_comparison_validation_and_lookup():
    app=create_app(':memory:')
    with TestClient(app) as client:
        assert client.post('/api/v1/recordings/compare',json={'identifiers':['only']}).status_code==422
        assert client.post('/api/v1/recordings/compare',json={'identifiers':['a','b']}).status_code==404
        identifiers=[]
        for recording in fixtures():
            identifiers.append(app.state.store.start_recording(recording['session']['name'],recording['session']['mission']))
            for event in recording['events']:app.state.store.append(event)
            app.state.store.stop_recording()
        response=client.post('/api/v1/recordings/compare',json={'identifiers':identifiers})
        assert response.status_code==200 and len(response.json()['items'])==5
