"""Produce replayable public evidence from actual pinned SITL; exits nonzero on failure."""
import asyncio
import json
import os
from pathlib import Path
from mission_control.mavlink import MAVLinkManager
from mission_control.simulator import Simulator
from mission_control.store import Store
from mission_control.scenarios import ScenarioRunner, CATALOG

async def main():
    root=Path(__file__).resolve().parents[2]
    output=Path(os.environ.get('MISSION_EVIDENCE_DIR',root/'docs/verification/scenarios'));output.mkdir(parents=True,exist_ok=True)
    public=root/'frontend/public/verification';public.mkdir(parents=True,exist_ok=True)
    store=Store(':memory:')
    manager=MAVLinkManager(store,Simulator(state_directory=root/'backend/.runtime/scenarios'))
    runner=ScenarioRunner(manager,store);results=[]
    try:
        for kind in CATALOG:
            runner.start(kind);await runner.task
            run=runner.current;results.append(run)
            for directory in (output,) if 'MISSION_EVIDENCE_DIR' in os.environ else (output,public):
                (directory/'scenario-runs.json').write_text(json.dumps(results,indent=2))
                if run['session_id']:
                    (directory/f'{kind}.json').write_text(json.dumps(store.session(run['session_id']),indent=2))
            print(f'{kind}: {run["status"]} {run["error"]}',flush=True)
            if run['status']!='passed': raise AssertionError(run['error'])
    finally:
        await runner.close();await manager.disconnect();store.close()

if __name__=='__main__': asyncio.run(main())
