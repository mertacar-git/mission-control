import json,math
from pathlib import Path
import pytest
from mission_control.execution import execution_report
from mission_control.planning import SCALE,COS
from mission_control.simulator import HOME

def point(x,y):return dict(latitude=HOME[0]+y/SCALE,longitude=HOME[1]+x/SCALE/COS,altitude_m=20)
def test_index_attribution_missing_measurements_and_stale_provenance():
    waypoints=[point(0,10),point(0,30),point(2,30),point(2,10)]
    mission=dict(id='x',waypoints=waypoints,takeoff_altitude_m=20,generation=dict(waypoints=[dict(w) for w in waypoints],takeoff_altitude_m=20,survey_leg_indices=[1,3]))
    rows=[dict(**point(1.9,y),source='sitl',connection='connected',position_fresh=True,armed=True,flight_mode='AUTO',mission_index=3,elapsed_s=t,ground_speed_ms=5) for t,y in [(0,12),(1,20),(2,12),(8,28)]]
    recording=dict(session=dict(source='sitl',mission=mission),events=[dict(type='telemetry',payload=r) for r in rows])
    report=execution_report(recording,2)
    assert report['legs'][1]['max_deviation_m']==pytest.approx(1.9)
    assert report['legs'][1]['observed_s']==2
    assert report['legs'][1]['observed_corridor_m']==pytest.approx(8)
    assert report['legs'][3]['samples']==0
    assert report['observed_survey_fraction']==pytest.approx(.2)
    mission['waypoints'][0]['altitude_m']=21
    assert execution_report(recording)['observed_survey_fraction'] is None
    rows[0]['mission_index']=None;rows[1]['position_fresh']=False
    assert execution_report(recording)['legs'][1]['observed_s'] is None
    with pytest.raises(ValueError):execution_report(recording,float('nan'))

def test_actual_frozen_records_reproduce_execution_reports():
    root=Path(__file__).resolve().parents[2]/'docs/verification/comparison'
    for heading in [0,90]:
        recording=json.loads((root/f'flight-{heading}.json').read_text())
        expected=json.loads((root/f'execution-{heading}.json').read_text())
        assert execution_report(recording)==expected
