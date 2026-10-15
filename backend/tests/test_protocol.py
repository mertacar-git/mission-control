import asyncio
import time
from types import SimpleNamespace
import pytest
from mission_control.mavlink import MAVLinkManager, M, mission_items
from mission_control.models import ConnectionState
from mission_control.store import Store
from tests.test_core import mission

def message(kind, **values):
    return SimpleNamespace(get_type=lambda:kind, **values)

def manager():
    result=MAVLinkManager(Store(':memory:'),SimpleNamespace(running=True))
    result.state=ConnectionState.CONNECTED
    result.link=SimpleNamespace(mav=SimpleNamespace(mission_count_send=lambda *args:None))
    return result

def test_initial_position_is_not_presented_before_navigation_readiness():
    client=manager();client.field_times['position']=time.monotonic()
    client.telemetry.latitude=0;client.telemetry.longitude=0
    assert client.snapshot()['latitude'] is None
    client.telemetry.navigation_ready=True
    assert client.snapshot()['latitude']==0
    client.store.close()

def test_connection_loss_blanks_even_recent_measurements():
    client=manager();client.state=ConnectionState.DISCONNECTED
    client.field_times={'position':time.monotonic(),'speed':time.monotonic(),'battery':time.monotonic()}
    client.telemetry.battery_pct=90;client.telemetry.ground_speed_ms=4
    result=client.snapshot()
    assert result['ground_speed_ms'] is None and result['battery_pct'] is None
    client.store.close()

async def test_duplicate_and_out_of_order_requests_are_idempotent():
    client=manager(); plan=mission(); items=mission_items(plan)
    replies=iter([message('MISSION_REQUEST_INT',seq=i) for i in [0,1,1,3,2]]+[message('MISSION_ACK',type=M.MAV_MISSION_ACCEPTED)])
    sent=[]
    client.send_item=lambda index,item:sent.append(index)
    async def response(predicate,send,timeout):
        send();reply=next(replies);assert predicate(reply);return reply
    async def download():return items
    client.response=response;client._download=download
    result=await client.upload(plan)
    assert sent==[0,1,1,3,2] and result['status']=='verified'
    client.store.close()

@pytest.mark.parametrize('reply',[message('MISSION_ACK',type=M.MAV_MISSION_ACCEPTED),message('MISSION_ACK',type=M.MAV_MISSION_DENIED),message('MISSION_REQUEST_INT',seq=999)])
async def test_incomplete_rejected_and_invalid_transfers(reply):
    client=manager()
    async def response(*args):return reply
    client.response=response
    with pytest.raises(RuntimeError):await client.upload(mission())
    assert not client.upload_verified
    client.store.close()

async def test_transfer_timeout_has_bounded_retries():
    client=manager();attempts=[]
    async def response(predicate,send,timeout):
        attempts.append(timeout);send();raise asyncio.TimeoutError
    client.response=response
    with pytest.raises(RuntimeError,match='timed out'):await client.upload(mission())
    assert attempts==[3]*4 and not client.operation.locked()
    client.store.close()

async def test_acknowledgment_is_distinct_from_observation_and_expires():
    client=manager();client.telemetry.flight_mode='AUTO'
    client.observations={'one':dict(action='hold',deadline=time.monotonic()+15)}
    await client.observe_commands();assert client.observations and not client.events
    client.telemetry.flight_mode='BRAKE';await client.observe_commands()
    assert client.events[-1]['payload']['status']=='observed' and not client.observations
    client.observations={'two':dict(action='land',deadline=0)}
    await client.observe_commands()
    assert client.events[-1]['payload']['status']=='not_observed'
    client.store.close()
