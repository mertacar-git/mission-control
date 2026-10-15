import asyncio
from types import SimpleNamespace
import pytest
from unittest.mock import AsyncMock
from fastapi.testclient import TestClient
from mission_control.api import create_app
from mission_control.store import Store
from mission_control.scenarios import ScenarioRunner

def test_requires_idle_transport():
    store=Store(':memory:')
    manager=SimpleNamespace(state='connected',simulator=SimpleNamespace(running=False))
    runner=ScenarioRunner(manager,store)
    with pytest.raises(ValueError): runner.start('arbitrary_parameter')
    with pytest.raises(RuntimeError): runner.start('gps_loss')
    manager.state='closed';manager.simulator.running=True
    with pytest.raises(RuntimeError): runner.start('gps_loss')
    manager.simulator.running=False;store.start_recording('Existing')
    with pytest.raises(RuntimeError): runner.start('gps_loss')
    store.close()

def test_interrupted_runs_survive_restart(tmp_path):
    path=tmp_path/'runs.sqlite3';store=Store(path)
    store.save_scenario(dict(id='unfinished',status='running'))
    store.save_scenario(dict(id='complete',status='passed'))
    store.close();store=Store(path)
    runs={r['id']:r for r in store.scenario_runs()}
    assert runs['unfinished']['status']=='interrupted' and runs['unfinished']['ended_utc']
    assert runs['complete']['status']=='passed'
    store.close()

def test_wait_requires_observation():
    async def exercise():
        store=Store(':memory:')
        manager=SimpleNamespace(snapshot=lambda:dict(flight_mode='AUTO'))
        runner=ScenarioRunner(manager,store);runner.current=dict(id='x',checks=[])
        with pytest.raises(RuntimeError):
            await runner.wait('Must observe LAND',lambda s:s['flight_mode']=='LAND',0)
        assert runner.current['checks'][0]['status']=='failed'
        store.close()
    asyncio.run(exercise())

def test_failure_records_reason_and_always_cleans_up():
    async def exercise():
        store=Store(':memory:')
        manager=SimpleNamespace(state='closed',simulator=SimpleNamespace(running=False),
            connect=AsyncMock(side_effect=RuntimeError('Missing pinned firmware')),
            emit=AsyncMock(),disconnect=AsyncMock())
        runner=ScenarioRunner(manager,store)
        runner.start('low_battery')
        with pytest.raises(RuntimeError): runner.start('gps_loss')
        await runner.task
        result=store.scenario_runs()[0]
        assert result['status']=='failed' and 'Missing pinned firmware' in result['error']
        assert result['ended_utc'] and result['checks']==[]
        manager.disconnect.assert_awaited_once()
        store.close()
    asyncio.run(exercise())

def test_immediate_cancellation_is_persisted_and_cleanup_runs_once():
    async def exercise():
        store=Store(':memory:')
        async def connecting(**kwargs): await asyncio.sleep(60)
        manager=SimpleNamespace(state='closed',simulator=SimpleNamespace(running=False),
            connect=connecting,emit=AsyncMock(),disconnect=AsyncMock())
        runner=ScenarioRunner(manager,store);runner.start('gps_loss')
        await asyncio.gather(runner.close(),runner.close())
        assert store.scenario_runs()[0]['status']=='interrupted'
        assert not runner.active
        manager.disconnect.assert_awaited_once()
        store.close()
    asyncio.run(exercise())

def test_api_blocks_manual_control_but_renews_owner_during_experiment(monkeypatch):
    monkeypatch.setattr(ScenarioRunner,'active',property(lambda self:True))
    monkeypatch.setattr(ScenarioRunner,'close',AsyncMock())
    app=create_app(':memory:');app.state.manager.claim('owner')
    headers={'X-Control-Session':'owner'}
    with TestClient(app) as client:
        assert client.post('/api/v1/control/renew',headers=headers).status_code==200
        assert client.post('/api/v1/control/renew',headers={'X-Control-Session':'other'}).status_code==409
        for path,body in [('/connection',{}),('/commands',{'action':'land'}),('/scenarios',{'kind':'gps_loss'}),('/recordings',{})]:
            assert client.post('/api/v1'+path,headers=headers,json=body).status_code==409
        assert client.get('/api/v1/vehicle/mission').status_code==409
        assert client.post('/api/v1/scenarios',headers=headers,json={'kind':'raw_parameter'}).status_code==422
        assert client.get('/api/v1/status').json()['scenario_active'] is True

def test_cleanup_survives_event_failure_and_late_cancel():
    async def exercise():
        store=Store(':memory:')
        cleanup_entered=asyncio.Event();release=asyncio.Event()
        async def disconnect():
            cleanup_entered.set();await release.wait()
        manager=SimpleNamespace(state='closed',simulator=SimpleNamespace(running=False),
            connect=AsyncMock(side_effect=RuntimeError('Startup failed')),
            emit=AsyncMock(side_effect=RuntimeError('Event persistence failed')),disconnect=disconnect)
        runner=ScenarioRunner(manager,store);runner.start('gps_loss')
        await cleanup_entered.wait()
        closing=asyncio.create_task(runner.close())
        await asyncio.sleep(0)
        assert not runner.task.cancelled()
        release.set();await closing
        assert store.scenario_runs()[0]['status']=='failed'
        assert 'Event persistence failed' in store.scenario_runs()[0]['error']
        assert not runner.active
        store.close()
    asyncio.run(exercise())
