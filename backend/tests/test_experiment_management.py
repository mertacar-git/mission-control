import asyncio
import sqlite3
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from fastapi.testclient import TestClient
from mission_control.api import create_app
from mission_control.experiments import (
    ExperimentRequest,
    ExperimentRunner,
    create_definition,
)
from mission_control.scenarios import ScenarioRunner
from mission_control.store import Store


def test_api_contract_and_lock_before_scenario_task_has_started(monkeypatch):
    app = create_app(":memory:")
    with TestClient(app) as client:
        definition = client.post(
            "/api/v1/experiments", json=dict(name="API snapshot", kind="normal")
        ).json()
        assert (
            definition["schema_version"] == 1
            and definition["mission"]["schema_version"] == 2
        )
        assert (
            client.post(
                "/api/v1/experiments",
                json=dict(name="Bad", kind="shell", command="whoami"),
            ).status_code
            == 422
        )
        monkeypatch.setattr(ExperimentRunner, "active", property(lambda self: True))
        monkeypatch.setattr(ExperimentRunner, "close", AsyncMock())
        headers = {"X-Control-Session": "owner"}
        for path, body in [
            ("/connection", {}),
            ("/commands", {"action": "arm"}),
            ("/control/claim", {}),
            ("/scenarios", {"kind": "gps_loss"}),
            ("/experiment-runs", {"definition_id": definition["id"]}),
        ]:
            assert (
                client.post("/api/v1" + path, headers=headers, json=body).status_code
                == 409
            )
        assert client.get("/api/v1/status").json()["scenario_active"] is True


def test_definitions_are_snapshots_with_append_only_revisions(tmp_path):
    store = Store(tmp_path / "experiments.sqlite3")
    first = create_definition(store, ExperimentRequest(name="Baseline", kind="normal"))
    second = create_definition(
        store,
        ExperimentRequest(name="Slower", kind="normal", parent_id=first.id, speedup=1),
    )
    assert first.id != second.id and second.version == 2
    assert store.experiment(first.id)["speedup"] == 4
    assert (
        first.seed is None and first.mission_fingerprint == second.mission_fingerprint
    )
    with pytest.raises(sqlite3.IntegrityError):
        store.add_experiment(first.model_dump())
    with pytest.raises(ValueError):
        create_definition(
            store,
            ExperimentRequest(
                name="Unsafe custom fault", kind="gps_loss", mission=first.mission
            ),
        )
    store.save_experiment_run(dict(id="queued", status="queued"))
    store.save_experiment_run(dict(id="pass", status="passed"))
    store.close()
    store = Store(tmp_path / "experiments.sqlite3")
    assert store.experiment_run("queued")["status"] == "interrupted"
    assert store.experiment_run("pass")["status"] == "passed"
    assert len(store.experiments()) == 2
    store.close()


def test_startup_failure_is_not_a_pass_and_reruns_never_overwrite():
    async def exercise():
        store = Store(":memory:")
        manager = SimpleNamespace(
            state="closed",
            simulator=SimpleNamespace(running=False),
            connect=AsyncMock(side_effect=RuntimeError("Pinned firmware absent")),
            emit=AsyncMock(),
            disconnect=AsyncMock(),
        )
        scenarios = ScenarioRunner(manager, store)
        runner = ExperimentRunner(scenarios, store)
        definition = create_definition(
            store, ExperimentRequest(name="Failure proof", kind="normal")
        )
        first = runner.start(definition.id, "owner")
        await runner.task
        assert store.experiment_run(first["id"])["status"] == "failed"
        assert "Pinned firmware absent" in store.experiment_run(first["id"])["error"]
        second = runner.start(definition.id, "owner")
        await runner.task
        assert first["id"] != second["id"] and len(store.experiment_runs()) == 2
        assert manager.disconnect.await_count == 2
        store.close()

    asyncio.run(exercise())


def test_cancel_is_owner_bound_independent_of_expiring_control_lease():
    async def exercise():
        store = Store(":memory:")

        async def connect(**kwargs):
            await asyncio.sleep(60)

        manager = SimpleNamespace(
            state="closed",
            simulator=SimpleNamespace(running=False),
            connect=connect,
            emit=AsyncMock(),
            disconnect=AsyncMock(),
        )
        runner = ExperimentRunner(ScenarioRunner(manager, store), store)
        definition = create_definition(
            store, ExperimentRequest(name="Cancel", kind="gps_loss")
        )
        result = runner.start(definition.id, "owner")
        with pytest.raises(RuntimeError):
            runner.start(definition.id, "other")
        with pytest.raises(PermissionError):
            await runner.close("other")
        await runner.close("owner")
        assert store.experiment_run(result["id"])["status"] == "cancelled"
        manager.disconnect.assert_awaited_once()
        assert not runner.active
        store.close()

    asyncio.run(exercise())


def test_timeout_does_not_leave_owned_process_or_report_success():
    async def exercise():
        store = Store(":memory:")

        async def connect(**kwargs):
            await asyncio.sleep(60)

        manager = SimpleNamespace(
            state="closed",
            simulator=SimpleNamespace(running=False),
            connect=connect,
            emit=AsyncMock(),
            disconnect=AsyncMock(),
        )
        runner = ExperimentRunner(ScenarioRunner(manager, store), store)
        definition = create_definition(
            store, ExperimentRequest(name="Timeout", kind="normal")
        )
        # Persisted definitions are validated on read; shorten only the runner's test clock.
        from unittest.mock import patch

        original = asyncio.wait_for

        async def short(awaitable, timeout):
            return await original(awaitable, 0.01)

        with patch("mission_control.experiments.asyncio.wait_for", short):
            result = runner.start(definition.id, "owner")
            await runner.task
        assert store.experiment_run(result["id"])["status"] == "failed"
        assert "exceeded" in store.experiment_run(result["id"])["error"]
        manager.disconnect.assert_awaited_once()
        store.close()

    asyncio.run(exercise())
