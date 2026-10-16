"""Immutable experiment definitions and single-owner, evidence-based SITL runs."""

import asyncio
import copy
from typing import Literal
from uuid import uuid4
from pydantic import Field
from .models import StrictModel, Mission, Waypoint, utc_now
from .planning import require_valid
from .simulator import HOME, REVISION
from .scenarios import CATALOG
from .preflight import mission_fingerprint
from .build_info import source_info, VERSION


class ExperimentRequest(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    kind: Literal["normal", "heartbeat_loss", "low_battery", "gps_loss"]
    mission: Mission | None = None
    speedup: Literal[1, 4] = 4
    timeout_s: int = Field(default=300, ge=90, le=600, strict=True)
    parent_id: str | None = Field(default=None, max_length=80)


class ExperimentStart(StrictModel):
    definition_id: str = Field(min_length=1, max_length=80)


class ExperimentRun(StrictModel):
    schema_version: Literal[1]
    id: str
    definition: "ExperimentDefinition"
    status: Literal["queued", "running", "passed", "failed", "cancelled", "interrupted"]
    created_utc: str
    started_utc: str | None
    ended_utc: str | None
    source: Literal["sitl"]
    software_revision: str | None
    software_version: str | None = None
    software_dirty: bool | None = None
    firmware: str
    firmware_revision: str
    speedup: Literal[1, 4]
    seed: None
    recording_ids: list[str]
    checks: list[dict]
    scenario_id: str | None
    error: str | None


class ExperimentDefinition(StrictModel):
    schema_version: Literal[1] = 1
    id: str
    parent_id: str | None
    version: int
    name: str
    source: Literal["sitl"] = "sitl"
    kind: Literal["normal", "heartbeat_loss", "low_battery", "gps_loss"]
    mission: Mission
    mission_fingerprint: str
    speedup: Literal[1, 4]
    seed: None = None
    timeout_s: int
    expected: str
    created_utc: str


def create_definition(store, body):
    parent = store.experiment(body.parent_id) if body.parent_id else None
    if body.kind != "normal" and body.mission is not None:
        raise ValueError(
            "Fault experiments use a fixed flight snapshot; arbitrary fault missions are not supported."
        )
    mission = body.mission or Mission(
        name=body.name,
        takeoff_altitude_m=10,
        waypoints=[
            Waypoint(
                latitude=HOME[0] + (0.0003 if body.kind == "normal" else 0.005),
                longitude=HOME[1],
                altitude_m=10,
            )
        ],
    )
    require_valid(mission)
    result = ExperimentDefinition(
        id=str(uuid4()),
        parent_id=body.parent_id,
        version=parent["version"] + 1 if parent else 1,
        name=body.name,
        kind=body.kind,
        mission=mission,
        mission_fingerprint=mission_fingerprint(mission),
        speedup=body.speedup,
        timeout_s=body.timeout_s,
        expected=CATALOG.get(
            body.kind,
            "Final waypoint, landing and contiguous disarm observations establish completed mission.",
        ),
        created_utc=utc_now(),
    )
    store.add_experiment(result.model_dump())
    return result


class ExperimentRunner:
    def __init__(self, scenarios, store):
        self.scenarios = scenarios
        self.store = store
        self.task = None
        self.current = None
        self.owner = None
        self.stop_lock = asyncio.Lock()
        self.cancelled = False

    @property
    def active(self):
        return self.task is not None and not self.task.done()

    def start(self, identifier, owner):
        if self.active or self.scenarios.active:
            raise RuntimeError("Another SITL experiment owns control.")
        manager = self.scenarios.manager
        if manager.state != "closed" or manager.simulator.running or self.store.active:
            raise RuntimeError(
                "Close the vehicle connection and recording before starting an experiment."
            )
        definition = ExperimentDefinition.model_validate(
            self.store.experiment(identifier)
        )
        self.owner = owner
        self.cancelled = False
        self.current = dict(
            schema_version=1,
            id=str(uuid4()),
            definition=definition.model_dump(),
            status="queued",
            created_utc=utc_now(),
            started_utc=None,
            ended_utc=None,
            source="sitl",
            **source_info(),
            software_version=VERSION,
            firmware="Copter-4.6.3",
            firmware_revision=REVISION,
            speedup=definition.speedup,
            seed=None,
            recording_ids=[],
            checks=[],
            scenario_id=None,
            error=None,
        )
        self.store.save_experiment_run(self.current)
        self.task = asyncio.create_task(
            self.run(definition), name="owned-sitl-experiment"
        )
        return copy.deepcopy(self.current)

    async def close(self, owner=None):
        if owner is not None and owner != self.owner:
            raise PermissionError("Another session owns this experiment.")
        async with self.stop_lock:
            if self.active:
                self.cancelled = owner is not None
                await asyncio.sleep(0)
                if not self.task.done() and self.current["status"] in (
                    "queued",
                    "running",
                ):
                    self.task.cancel()
                try:
                    await asyncio.shield(self.task)
                except asyncio.CancelledError:
                    pass

    async def run(self, definition):
        run = self.current
        try:
            run.update(status="running", started_utc=utc_now())
            self.store.save_experiment_run(run)
            scenario = self.scenarios.start(
                definition.kind,
                mission=definition.mission,
                speedup=definition.speedup,
                experiment=dict(
                    definition_id=definition.id,
                    kind=definition.kind,
                    seed=None,
                    timeout_s=definition.timeout_s,
                ),
            )
            run["scenario_id"] = scenario["id"]
            self.store.save_experiment_run(run)
            await asyncio.wait_for(
                asyncio.shield(self.scenarios.task), definition.timeout_s
            )
            observed = self.scenarios.current
            if (
                observed["status"] != "passed"
                or not observed["checks"]
                or any(c["status"] != "passed" for c in observed["checks"])
            ):
                raise RuntimeError(
                    observed.get("error") or "Required observations did not pass."
                )
            run["status"] = "passed"
        except asyncio.TimeoutError:
            run.update(
                status="failed",
                error=f"Experiment exceeded {definition.timeout_s} wall seconds.",
            )
        except asyncio.CancelledError:
            run.update(
                status="cancelled" if self.cancelled else "interrupted",
                error="Owned experiment cancelled."
                if self.cancelled
                else "Application stopped before acceptance.",
            )
        except Exception as exc:
            run.update(status="failed", error=str(exc))
        finally:
            try:
                if run["scenario_id"] is not None:
                    await self.scenarios.close()
            except Exception as exc:
                run.update(status="failed", error=f"Owned cleanup failed: {exc}")
            observed = self.scenarios.current
            if observed and observed.get("id") == run["scenario_id"]:
                run["checks"] = copy.deepcopy(observed["checks"])
                run["recording_ids"] = (
                    [observed["session_id"]] if observed.get("session_id") else []
                )
                if observed["status"] == "failed":
                    run.update(status="failed", error=observed["error"])
            run["ended_utc"] = utc_now()
            self.store.save_experiment_run(run)
