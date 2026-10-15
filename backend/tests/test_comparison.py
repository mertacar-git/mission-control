import json
from pathlib import Path
import pytest
from mission_control.models import Mission
from mission_control.planning import validate_planning

def test_independent_validation_of_every_browser_candidate():
    data=json.loads((Path(__file__).resolve().parents[2]/'docs/verification/comparison/candidates.json').read_text())
    assert len(data['candidates'])==12
    for row in data['candidates']:
        if row['mission']:
            mission=Mission.model_validate(row['mission'])
            result=validate_planning(mission)
            assert result['valid'],result
            assert result['distance_m']==pytest.approx(row['preview']['distance_m'],abs=1e-6)
            assert len(mission.generation.survey_leg_indices)==row['preview']['segment_count']
