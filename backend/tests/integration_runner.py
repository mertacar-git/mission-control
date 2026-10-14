"""Real SITL acceptance scenarios. Run from backend with the simulator installed."""
import asyncio
import json
import os
from pathlib import Path
import signal
import time
from mission_control.models import Mission,Waypoint
from mission_control.mavlink import MAVLinkManager,M
from mission_control.simulator import Simulator,HOME
from mission_control.store import Store
from mission_control.analysis import report

OUTPUT=Path(__file__).resolve().parents[2]/'docs/verification'

async def wait_for(manager,predicate,timeout=60,label='condition'):
    started=time.monotonic()
    while time.monotonic()-started<timeout:
        snapshot=manager.snapshot()
        if predicate(snapshot): return snapshot
        await asyncio.sleep(.2)
    raise AssertionError(f'Timed out waiting for {label}: {manager.status()}')

async def ready(manager):
    await manager.connect(speedup=4)
    await wait_for(manager,lambda s:s['connection']=='connected' and s['position_fresh'] and s['latitude']!=0 and s['navigation_ready'],60,'GPS/heartbeat/EKF navigation readiness')
    # Give estimator initialization time, and use pre-arm feedback rather than force-arm.
    await asyncio.sleep(5)

async def arm(manager):
    for attempt in range(15):
        try:
            await manager.command('arm')
            await wait_for(manager,lambda s:s['armed'] is True,10,'armed heartbeat');return
        except RuntimeError:
            if attempt==14: raise
            await asyncio.sleep(2)

def test_mission(name='Golden mission'):
    return Mission(name=name,takeoff_altitude_m=10,waypoints=[Waypoint(latitude=HOME[0]+.0002,longitude=HOME[1],altitude_m=10),Waypoint(latitude=HOME[0]+.0002,longitude=HOME[1]+.0002,altitude_m=10)])

async def main():
    OUTPUT.mkdir(parents=True,exist_ok=True)
    store=Store(':memory:');manager=MAVLinkManager(store,Simulator(state_directory=Path(__file__).resolve().parents[1]/'.runtime/integration'))
    results=[]
    async def scenario(name,fn):
        started=time.monotonic()
        try:
            await fn();results.append(dict(scenario=name,status='passed',duration_s=round(time.monotonic()-started,2)))
        except Exception as exc:
            results.append(dict(scenario=name,status='failed',error=str(exc),duration_s=round(time.monotonic()-started,2)))
            (OUTPUT/'failure-context.json').write_text(json.dumps(manager.status(),indent=2))
            raise
        finally:
            (OUTPUT/'sitl-results.json').write_text(json.dumps(dict(simulator='Copter-4.6.3',revision='92b0cd788ec29406f26c6f9c31d5ceedbd1cc538',results=results),indent=2))
    try:
        await ready(manager)
        async def upload_and_rejection():
            result=await manager.upload(test_mission());assert result['status']=='verified'
            readback=await manager.download();assert len(readback)==5
            try: await manager.command('start')
            except RuntimeError: pass
            else: raise AssertionError('Disarmed start was accepted.')
            # The actual autopilot must reject an unsupported mode request.
            try: await manager.command_long(M.MAV_CMD_DO_SET_MODE,[M.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,999,0,0,0,0,0])
            except RuntimeError: pass
            else: raise AssertionError('Autopilot accepted unsupported mode 999.')
        await scenario('mission upload/readback and rejected commands',upload_and_rejection)
        async def golden():
            identifier=store.start_recording('Golden SITL mission',test_mission().model_dump())
            await arm(manager);await manager.command('start')
            await wait_for(manager,lambda s:(s['relative_altitude_m'] or 0)>7,40,'takeoff')
            await wait_for(manager,lambda s:s['armed'] is False,100,'mission landing/disarm')
            await asyncio.sleep(1);store.stop_recording();recording=store.session(identifier)
            analysis=report(recording)
            assert analysis['samples']>10 and analysis['peak_relative_altitude_m']>7
            assert any(e['type']=='mission_progress' for e in recording['events'])
            assert len(store.csv(identifier).splitlines())>10
            (OUTPUT/'golden-session.json').write_text(json.dumps(recording,indent=2))
            (OUTPUT/'golden-report.json').write_text(json.dumps(analysis,indent=2))
        await scenario('mission execution, recording, replay data and report',golden)
        async def loss():
            os.kill(manager.simulator.process.pid,signal.SIGSTOP)
            try:
                await wait_for(manager,lambda s:s['connection']=='stale',6,'stale state')
                try: await manager.command('arm')
                except RuntimeError: pass
                else: raise AssertionError('Command accepted while stale.')
                await wait_for(manager,lambda s:s['connection']=='disconnected',12,'disconnected state')
            finally: os.kill(manager.simulator.process.pid,signal.SIGCONT)
            await wait_for(manager,lambda s:s['connection']=='connected' and s['position_fresh'],15,'recovery')
            await manager.disconnect();await ready(manager)
            assert manager.active_mission is None and not manager.upload_verified
        await scenario('heartbeat loss, recovery and reconnect',loss)
        async def hold_return():
            await manager.upload(test_mission('Hold/return'));await arm(manager);await manager.command('start')
            await wait_for(manager,lambda s:(s['relative_altitude_m'] or 0)>7,40,'takeoff')
            await manager.command('hold');await wait_for(manager,lambda s:s['flight_mode']=='LOITER',10,'hold')
            await manager.command('resume');await wait_for(manager,lambda s:s['flight_mode']=='AUTO',10,'resume')
            await manager.command('return');await wait_for(manager,lambda s:s['flight_mode']=='RTL',10,'return')
            await wait_for(manager,lambda s:s['armed'] is False,100,'return landing')
        await scenario('hold, resume and return-to-home',hold_return)
        async def battery():
            await manager.disconnect();await ready(manager)
            await manager.upload(test_mission('Low battery'));await manager.set_parameter('BATT_FS_LOW_ACT',2)
            await manager.set_parameter('BATT_LOW_VOLT',11.5)
            await manager.set_parameter('BATT_CRT_VOLT',10.0)
            await manager.set_parameter('BATT_LOW_TIMER',2)
            await arm(manager);await manager.command('start')
            await wait_for(manager,lambda s:(s['relative_altitude_m'] or 0)>7,40,'battery scenario takeoff')
            await manager.set_parameter('SIM_BATT_VOLTAGE',11.0)
            await wait_for(manager,lambda s:s['flight_mode']=='RTL',30,'configured battery RTL')
            await wait_for(manager,lambda s:s['armed'] is False,100,'battery failsafe landing')
        await scenario('configured low-battery RTL and landing',battery)
    finally:
        await manager.disconnect();store.close()
    print(json.dumps(results,indent=2))

if __name__=='__main__': asyncio.run(main())
