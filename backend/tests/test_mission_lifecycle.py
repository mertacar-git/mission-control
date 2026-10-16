import asyncio
import pytest
from mission_control.lifecycle import MissionLifecycle
from tests.test_preflight import ready_manager

def telemetry(**updates):
    return dict(connection='connected',position_fresh=True,armed=True,flight_mode='AUTO',mission_index=2,relative_altitude_m=10,**updates)

def test_completion_requires_waypoint_landing_and_observed_disarm():
    life=MissionLifecycle(2);t=telemetry()
    assert life.observe(t,True)['state']=='executing'
    life.reached(3);t['mission_index']=4
    assert life.observe(t,True)['state']=='landing'
    t['armed']=False;t['relative_altitude_m']=0
    assert life.observe(t,True)['state']=='completed'
    t['connection']='disconnected'
    assert life.observe(t,True)['state']=='completed' # Established evidence is retained.

def test_gap_and_return_never_fabricate_completion():
    life=MissionLifecycle(2);t=telemetry();life.observe(t,True);life.reached(3)
    t['mission_index']=4;life.observe(t,True)
    t['connection']='disconnected';assert life.observe(t,True)['state']=='unknown'
    t.update(connection='connected',armed=False,relative_altitude_m=0)
    assert life.observe(t,True)['state']=='unknown'
    life=MissionLifecycle(2);t.update(armed=True,flight_mode='RTL');life.reached(3)
    assert life.observe(t,True)['state']=='returning'
    t.update(armed=False,flight_mode='LAND');assert life.observe(t,True)['state']=='unknown'

async def test_command_request_id_deduplicates_success_failure_and_pending():
    m=ready_manager();sent=[];gate=asyncio.Event()
    async def mode(value):sent.append(value);await gate.wait()
    m.set_mode=mode
    task=asyncio.create_task(m.command('land','same'));await asyncio.sleep(0)
    with pytest.raises(RuntimeError,match='pending'):await m.command('land','same')
    gate.set();first=await task
    assert await m.command('land','same')==first and sent==['LAND']
    with pytest.raises(ValueError):await m.command('return','same')
    async def failed(value):sent.append(value);raise asyncio.TimeoutError
    m.set_mode=failed
    for _ in range(2):
        with pytest.raises(RuntimeError,match='timed out'):await m.command('land','failure')
    assert sent==['LAND','LAND'];m.store.close()
