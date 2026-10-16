"""Capture a real full arm/disarm interval and its environment for report acceptance."""
import asyncio,json
from pathlib import Path
from mission_control.mavlink import MAVLinkManager
from mission_control.simulator import Simulator
from mission_control.store import Store
from mission_control.comparison import flight_summary
from tests.integration_runner import ready,arm,wait_for,test_mission

async def main():
    root=Path(__file__).resolve().parents[2]
    output=root/'docs/verification/phases/phase-3';output.mkdir(parents=True,exist_ok=True)
    store=Store(':memory:');manager=MAVLinkManager(store,Simulator(state_directory=root/'backend/.runtime/multi-report'))
    try:
        await ready(manager)
        mission=test_mission('Full observed report acceptance')
        await manager.upload(mission)
        identifier=store.start_recording('Full observed SITL mission',mission.model_dump())
        await manager.emit('telemetry',manager.snapshot())
        await arm(manager);await manager.command('start')
        await wait_for(manager,lambda t:(t['relative_altitude_m'] or 0)>7,40,'takeoff')
        await wait_for(manager,lambda t:t['armed'] is False,100,'disarm')
        await asyncio.sleep(1);store.stop_recording()
        recording=store.session(identifier);summary=flight_summary(recording)
        assert summary['completion']=='completed' and summary['observed_flight_s']>0,summary
        assert summary['speedup']==4 and summary['firmware']=='Copter-4.6.3'
        for path in (output/'full-flight.json',root/'frontend/public/comparison/baseline-0.json'):
            path.write_text(json.dumps(recording,indent=2)+'\n',encoding='utf-8')
        (output/'full-flight-summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(summary,indent=2),flush=True)
    finally:await manager.disconnect();store.close()

if __name__=='__main__':asyncio.run(main())
