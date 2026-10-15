"""Fixed, reproducible experiments. Each run owns a fresh disposable SITL instance."""
import asyncio
import os
import signal
import time
from uuid import uuid4
from .models import Mission, Waypoint, utc_now
from .simulator import HOME, REVISION

CATALOG = {
    'heartbeat_loss': 'Process pause → stale ≥3 s → disconnected ≥10 s → command rejected → recovery',
    'low_battery': '11.0 V injection, configured 11.5 V / 2 s threshold → RTL → landed/disarmed',
    'gps_loss': 'SIM_GPS_DISABLE=1, FS_EKF_ACTION=1 → no 3D fix → LAND → disarmed',
}

class ScenarioRunner:
    def __init__(self, manager, store):
        self.manager=manager;self.store=store;self.task=None;self.current=None
        self.stop_lock=asyncio.Lock()

    @property
    def active(self): return self.task is not None and not self.task.done()

    def start(self, kind):
        if kind not in CATALOG: raise ValueError('Unknown scenario.')
        m=self.manager
        if self.active or m.state!='closed' or m.simulator.running or self.store.active:
            raise RuntimeError('Close the existing connection and recording before starting a scenario.')
        self.current=dict(schema_version=1,id=str(uuid4()),kind=kind,status='running',
            started_utc=utc_now(),ended_utc=None,session_id=None,checks=[],error=None,
            expected=CATALOG[kind],firmware='Copter-4.6.3',revision=REVISION,speedup=4,
            clock='backend monotonic wall seconds',parameters={})
        self.store.save_scenario(self.current)
        self.task=asyncio.create_task(self.run(),name='owned-sitl-scenario')
        return dict(self.current)

    async def close(self):
        async with self.stop_lock:
            if self.active:
                # Let the coroutine establish its cleanup block even on immediate cancellation.
                await asyncio.sleep(0)
                if not self.task.done() and self.current['status']=='running': self.task.cancel()
                try: await asyncio.shield(self.task)
                except asyncio.CancelledError: pass

    async def wait(self, label, predicate, timeout):
        began=time.monotonic()
        while time.monotonic()-began<timeout:
            snapshot=self.manager.snapshot()
            if predicate(snapshot):
                check=dict(label=label,status='passed',observed_utc=utc_now(),
                    latency_s=round(time.monotonic()-began,3),snapshot=snapshot)
                self.current['checks'].append(check);self.store.save_scenario(self.current)
                await self.manager.emit('telemetry',snapshot)
                await self.manager.emit('scenario',dict(run_id=self.current['id'],**check))
                return snapshot
            await asyncio.sleep(.1)
        self.current['checks'].append(dict(label=label,status='failed',timeout_s=timeout,
            observed_utc=utc_now(),snapshot=self.manager.snapshot()))
        raise RuntimeError(f'Expected observation timed out: {label} ({timeout} wall seconds).')

    async def parameter(self,name,value):
        await self.manager.set_parameter(name,value)
        self.current['parameters'][name]=value
        self.store.save_scenario(self.current)
        await self.manager.emit('scenario',dict(run_id=self.current['id'],status='parameter_verified',name=name,value=value))

    async def run(self):
        m=self.manager;run=self.current;paused=False
        try:
            await m.connect(speedup=4)
            mission=Mission(name='Acceptance · '+run['kind'],takeoff_altitude_m=10,
                waypoints=[Waypoint(latitude=HOME[0]+.005,longitude=HOME[1],altitude_m=10)])
            run['session_id']=self.store.start_recording(mission.name,mission.model_dump())
            self.store.save_scenario(run)
            await m.emit('scenario',dict(run_id=run['id'],status='started',kind=run['kind'],expected=run['expected']))
            await self.wait('Navigation ready',lambda s:s['connection']=='connected' and s['position_fresh'] and s['navigation_ready'],60)
            await asyncio.sleep(5)
            if run['kind']=='heartbeat_loss':
                # This freezes the vehicle clock too: it tests receiver freshness, not an RF outage.
                paused=True;os.kill(m.simulator.process.pid,signal.SIGSTOP)
                await m.emit('scenario',dict(run_id=run['id'],status='injected',fault='process_pause'))
                await self.wait('Stale telemetry',lambda s:s['connection']=='stale',6)
                await self.wait('Disconnected telemetry',lambda s:s['connection']=='disconnected',12)
                try: await m.command('arm')
                except RuntimeError:
                    run['checks'].append(dict(label='Command rejected while disconnected',status='passed',observed_utc=utc_now()))
                else: raise RuntimeError('Command unexpectedly accepted during outage.')
                os.kill(m.simulator.process.pid,signal.SIGCONT);paused=False
                await self.wait('Fresh telemetry recovered',lambda s:s['connection']=='connected' and s['position_fresh'],15)
            else:
                if run['kind']=='low_battery':
                    for name,value in [('BATT_FS_LOW_ACT',2),('BATT_LOW_VOLT',11.5),('BATT_CRT_VOLT',10),('BATT_LOW_TIMER',2)]:
                        await self.parameter(name,value)
                else:
                    await self.parameter('FS_EKF_ACTION',1)
                    await self.parameter('FS_DR_ENABLE',0)
                await m.upload(mission)
                # No force-arm and no automatic start retry. Prearm failure is a failed experiment.
                await m.command('arm');await self.wait('Armed',lambda s:s['armed'] is True,10)
                await m.command('start')
                await self.wait('Airborne above 7 m',lambda s:(s['relative_altitude_m'] or 0)>7,40)
                if run['kind']=='low_battery':
                    await self.parameter('SIM_BATT_VOLTAGE',11)
                    await m.emit('scenario',dict(run_id=run['id'],status='injected',fault='low_battery'))
                    await self.wait('Measured battery below threshold',lambda s:s['battery_voltage_v'] is not None and s['battery_voltage_v']<11.5,15)
                    await self.wait('Autopilot RTL',lambda s:s['flight_mode']=='RTL',30)
                else:
                    await self.parameter('SIM_GPS_DISABLE',1)
                    await m.emit('scenario',dict(run_id=run['id'],status='injected',fault='gps_loss'))
                    await self.wait('GPS has no 3D fix',lambda s:s['gps_fix_type'] is not None and s['gps_fix_type']<3,20)
                    await self.wait('Autopilot LAND',lambda s:s['flight_mode']=='LAND',60)
                await self.wait('Disarmed after failsafe',lambda s:s['armed'] is False,100)
            run['status']='passed'
        except asyncio.CancelledError:
            run.update(status='interrupted',error='Run cancelled; owned simulator cleanup requested.')
        except Exception as exc:
            run.update(status='failed',error=str(exc))
        finally:
            if paused and m.simulator.running:
                try: os.kill(m.simulator.process.pid,signal.SIGCONT)
                except ProcessLookupError: pass
            # No parameter leakage: the entire owned simulator and its isolated EEPROM end here.
            try:
                try:
                    await m.emit('scenario',dict(run_id=run['id'],status=run['status'],error=run['error']))
                finally:
                    await m.disconnect()
            except Exception as exc:
                run.update(status='failed',error=f'Cleanup failed: {exc}')
            run['ended_utc']=utc_now();self.store.save_scenario(run)
