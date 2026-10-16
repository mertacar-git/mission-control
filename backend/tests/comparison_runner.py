"""Fly two headings over the same polygon at 1× and preserve independent execution reports."""
import asyncio,json,os
from pathlib import Path
from mission_control.models import Mission
from mission_control.store import Store
from mission_control.mavlink import MAVLinkManager
from mission_control.simulator import Simulator,REVISION
from mission_control.execution import execution_report
from .integration_runner import wait_for,arm

async def main():
    root=Path(__file__).resolve().parents[2];output=Path(os.environ.get('MISSION_EVIDENCE_DIR',root/'docs/verification/comparison'));output.mkdir(parents=True,exist_ok=True)
    public=root/'frontend/public/comparison';public.mkdir(parents=True,exist_ok=True)
    candidates=json.loads((root/'docs/verification/comparison/candidates.json').read_text());results=[]
    store=Store(':memory:');manager=MAVLinkManager(store,Simulator(state_directory=root/'backend/.runtime/comparison'))
    try:
        for heading in [0,90]:
            await manager.connect(speedup=1)
            await wait_for(manager,lambda s:s['connection']=='connected' and s['position_fresh'] and s['navigation_ready'],90,'navigation readiness')
            await asyncio.sleep(5)
            await manager.set_parameter('WPNAV_SPEED',500)
            mission=Mission.model_validate(next(c['mission'] for c in candidates['candidates'] if c['heading_deg']==heading))
            await manager.upload(mission)
            identifier=store.start_recording(mission.name,mission.model_dump())
            await arm(manager);await manager.command('start')
            await wait_for(manager,lambda s:(s['relative_altitude_m'] or 0)>7,45,'takeoff')
            await wait_for(manager,lambda s:s['armed'] is False,180,'landing')
            await asyncio.sleep(1);store.stop_recording();recording=store.session(identifier);report=execution_report(recording)
            assert report['provenance_valid'] and report['observed_survey_fraction'] is not None
            assert any(l['samples'] for l in report['legs'] if l['kind']=='survey')
            for folder in (output,) if 'MISSION_EVIDENCE_DIR' in os.environ else (output,public):
                (folder/f'flight-{heading}.json').write_text(json.dumps(recording,indent=2))
                (folder/f'execution-{heading}.json').write_text(json.dumps(report,indent=2))
            results.append(dict(heading_deg=heading,status='passed',session_id=identifier,speedup=1,wpnav_speed_cms=500,firmware_revision=REVISION))
            (output/'sitl-results.json').write_text(json.dumps(results,indent=2))
            print(f'Heading {heading}: passed; sampled corridor fraction {report["observed_survey_fraction"]:.3f}',flush=True)
            await manager.disconnect()
    finally:await manager.disconnect();store.close()

if __name__=='__main__':asyncio.run(main())
