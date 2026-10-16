"""Actual pinned SITL acceptance of immutable experiment execution and reruns."""

import asyncio
import json
from pathlib import Path
from mission_control.experiments import (
    ExperimentRunner,
    ExperimentRequest,
    create_definition,
)
from mission_control.mavlink import MAVLinkManager
from mission_control.scenarios import ScenarioRunner
from mission_control.simulator import Simulator
from mission_control.store import Store


async def main():
    root = Path(__file__).resolve().parents[2]
    output = root / "docs/verification/phases/phase-5"
    output.mkdir(parents=True, exist_ok=True)
    store = Store(":memory:")
    manager = MAVLinkManager(
        store, Simulator(state_directory=root / "backend/.runtime/experiments")
    )
    runner = ExperimentRunner(ScenarioRunner(manager, store), store)
    definitions = {
        kind: create_definition(
            store, ExperimentRequest(name="Acceptance " + kind, kind=kind)
        )
        for kind in ("normal", "heartbeat_loss", "low_battery", "gps_loss")
    }
    results = []
    try:
        for kind in ("normal", "normal", "heartbeat_loss", "low_battery", "gps_loss"):
            run = runner.start(definitions[kind].id, "acceptance")
            await runner.task
            result = store.experiment_run(run["id"])
            results.append(result)
            (output / "experiment-runs.json").write_text(json.dumps(results, indent=2))
            for identifier in result["recording_ids"]:
                recording = store.session(identifier)
                environment = next(
                    e["payload"]
                    for e in recording["events"]
                    if e["type"] == "environment"
                )
                assert (
                    environment["experiment"]["definition_id"] == definitions[kind].id
                )
                (output / f"{identifier}.json").write_text(
                    json.dumps(recording, indent=2)
                )
            print(f"{kind}: {result['status']} {result['error']}", flush=True)
            assert result["status"] == "passed", result["error"]
        assert results[0]["id"] != results[1]["id"]
    finally:
        await runner.close()
        await manager.disconnect()
        store.close()


if __name__ == "__main__":
    asyncio.run(main())
