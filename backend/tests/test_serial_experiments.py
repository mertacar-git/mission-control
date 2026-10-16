import asyncio
import pytest
from fastapi.testclient import TestClient
from mission_control.serial_service import SerialService, create_serial_app
from mission_control.serial_experiments import (
    SerialExperiments,
    SerialExperimentRequest,
)


@pytest.mark.parametrize("profile", ["nominal", "mixed", "sensor_gap"])
def test_serial_profiles_require_observed_bytes_not_capture_completion(
    tmp_path, profile
):
    async def exercise():
        service = SerialService(tmp_path, synthetic=True)
        runner = SerialExperiments(service)
        definition = runner.define(
            SerialExperimentRequest(name=profile, profile=profile, duration_s=5)
        )
        first = runner.start(definition["id"], "owner")
        await runner.task
        result = runner.get("run", first["id"])
        assert result["status"] == "passed", result
        assert result["checks"] and all(
            c["status"] == "passed" for c in result["checks"]
        )
        assert len(result["recording_ids"]) == 1
        assert not service.thread.is_alive()
        assert service.status()["telemetry"] is None

    asyncio.run(exercise())


def test_serial_experiment_owner_lock_cancel_and_recovery(tmp_path):
    headers = {
        "Authorization": "Bearer test",
        "X-Control-Session": "owner",
        "Origin": "http://127.0.0.1:8000",
    }
    app = create_serial_app(tmp_path, token="test", synthetic=True)
    with TestClient(app, base_url="http://127.0.0.1:8767") as client:
        d = client.post(
            "/api/v1/serial/experiments",
            headers=headers,
            json={"name": "Cancel", "duration_s": 10},
        ).json()
        r = client.post(
            "/api/v1/serial/experiment-runs/" + d["id"], headers=headers
        ).json()
        for path, body in [
            ("/connection", {"port": "TEST:MCT1", "experiment": "Steal"}),
            ("/control/claim", {}),
        ]:
            assert (
                client.post(
                    "/api/v1/serial" + path, headers=headers, json=body
                ).status_code
                == 409
            )
        assert (
            client.delete("/api/v1/serial/connection", headers=headers).status_code
            == 409
        )
        path = "/api/v1/serial/experiment-runs/" + r["id"] + "/cancel"
        assert (
            client.post(
                path, headers={**headers, "X-Control-Session": "other"}
            ).status_code
            == 409
        )
        assert client.post(path, headers=headers).json()["status"] == "cancelled"
    registry = SerialExperiments(SerialService(tmp_path, synthetic=True))
    assert registry.get("definition", d["id"])["seed"] == 42
    assert registry.get("run", r["id"])["status"] == "cancelled"
    registry.save(
        "run", dict(id=r["id"], created_utc=r["created_utc"], status="running")
    )
    registry = SerialExperiments(SerialService(tmp_path, synthetic=True))
    assert registry.get("run", r["id"])["status"] == "interrupted"


def test_non_synthetic_receiver_cannot_inject_packets(tmp_path):
    registry = SerialExperiments(SerialService(tmp_path))
    d = registry.define(SerialExperimentRequest(name="Not a device test"))
    with pytest.raises(ValueError, match="synthetic"):
        registry.start(d["id"], "owner")
