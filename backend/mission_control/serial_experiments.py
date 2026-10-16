"""Synthetic serial acceptance registry; independent of WSL and flight control."""

import asyncio
import copy
import json
from datetime import datetime, timezone
from uuid import UUID, uuid4
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field
from .build_info import source_info


def now():
    return datetime.now(timezone.utc).isoformat()


class SerialExperimentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=100)
    profile: Literal["nominal", "mixed", "sensor_gap"] = "mixed"
    duration_s: int = Field(default=10, ge=5, le=60, strict=True)
    parent_id: UUID | None = None


class SerialExperiments:
    def __init__(self, service):
        self.service = service
        self.directory = service.directory / "experiments"
        self.directory.mkdir(exist_ok=True)
        self.task = None
        self.owner = None
        self.current = None
        self.stop_lock = asyncio.Lock()
        self.cancelled = False
        for run in self.list("run"):
            if run["status"] in ("queued", "running"):
                run.update(
                    status="interrupted",
                    ended_utc=now(),
                    error="Receiver restarted; not an acceptance pass.",
                )
                self.save("run", run)

    @property
    def active(self):
        return self.task is not None and not self.task.done()

    def list(self, kind):
        return sorted(
            [
                json.loads(p.read_text(encoding="utf-8"))
                for p in self.directory.glob(kind + "-*.json")
            ],
            key=lambda x: x["created_utc"],
            reverse=True,
        )

    def get(self, kind, identifier):
        return json.loads(
            (self.directory / f"{kind}-{UUID(str(identifier))}.json").read_text(
                encoding="utf-8"
            )
        )

    def save(self, kind, value):
        path = self.directory / f"{kind}-{UUID(value['id'])}.json"
        if kind == "definition":
            with path.open("x", encoding="utf-8") as f:
                json.dump(value, f, allow_nan=False)
        else:
            temporary = path.with_suffix(".tmp")
            temporary.write_text(json.dumps(value, allow_nan=False), encoding="utf-8")
            temporary.replace(path)

    def define(self, body):
        parent = self.get("definition", body.parent_id) if body.parent_id else None
        definition = dict(
            schema_version=1,
            id=str(uuid4()),
            parent_id=str(body.parent_id) if body.parent_id else None,
            version=parent["version"] + 1 if parent else 1,
            name=body.name,
            source="synthetic_serial",
            profile=body.profile,
            duration_s=body.duration_s,
            timeout_s=body.duration_s + 10,
            seed=42,
            created_utc=now(),
            expected=["Accepted frames observed", "Capture completed naturally"]
            + (
                [
                    "CRC corruption rejected",
                    "Late packets rejected",
                    "Sequence gaps observed",
                ]
                if body.profile == "mixed"
                else ["Null position/altitude observed with valid speed/voltage"]
                if body.profile == "sensor_gap"
                else ["No corrupt candidates or sequence gaps"]
            ),
        )
        self.save("definition", definition)
        return definition

    def start(self, identifier, owner):
        if not self.service.synthetic:
            raise ValueError(
                "Serial fault experiments require explicit synthetic service mode; no device writes are supported."
            )
        if self.active or self.service.thread and self.service.thread.is_alive():
            raise RuntimeError("Serial reader is already owned.")
        self.service.claim(owner)
        definition = self.get("definition", identifier)
        self.owner = owner
        self.cancelled = False
        self.current = dict(
            **source_info(),
            schema_version=1,
            id=str(uuid4()),
            definition=definition,
            status="queued",
            created_utc=now(),
            started_utc=None,
            ended_utc=None,
            recording_ids=[],
            checks=[],
            error=None,
            source="synthetic_serial",
            seed=42,
            software_version="MCT1/v1",
            firmware=None,
        )
        self.save("run", self.current)
        self.task = asyncio.create_task(self.run(), name="synthetic-serial-experiment")
        return copy.deepcopy(self.current)

    async def close(self, owner=None):
        if owner is not None and owner != self.owner:
            raise RuntimeError("Another session owns this experiment.")
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

    async def run(self):
        # Local import avoids circular service creation, without flight dependencies.
        from .serial_service import ConnectionRequest

        run = self.current
        d = run["definition"]
        started = False
        try:
            run.update(status="running", started_utc=now())
            self.save("run", run)
            status = self.service.start(
                ConnectionRequest(
                    port="TEST:MCT1",
                    experiment=d["name"],
                    duration_s=d["duration_s"],
                    test_profile=d["profile"],
                ),
                self.owner,
            )
            started = True
            identifier = status["run"]["id"]
            run["recording_ids"] = [identifier]
            self.save("run", run)
            await asyncio.wait_for(
                asyncio.to_thread(self.service.thread.join), d["timeout_s"]
            )
            metadata = self.service.current
            summary = metadata.get("summary") or {}
            counts = summary.get("counts", {})
            checks = [
                ("Accepted frames observed", counts.get("accepted", 0) > 0),
                (
                    "Capture completed naturally",
                    metadata["status"] == "completed"
                    and not self.service.stop_event.is_set(),
                ),
            ]
            if d["profile"] == "mixed":
                checks += [
                    (
                        "CRC corruption rejected",
                        summary.get("invalid_candidates", 0) > 0,
                    ),
                    ("Late packets rejected", counts.get("late_or_duplicate", 0) > 0),
                    ("Sequence gaps observed", counts.get("sequence_gaps", 0) > 0),
                ]
            elif d["profile"] == "nominal":
                checks += [
                    (
                        "No corrupt candidates or sequence gaps",
                        summary.get("invalid_candidates", 0) == 0
                        and counts.get("sequence_gaps", 0) == 0,
                    )
                ]
            else:
                # Re-decode raw bytes, rather than trusting previously saved classifications.
                from .serial_bench import replay

                timeline = []
                replay(self.service.directory / f"{identifier}.jsonl", timeline)
                found = any(
                    t["telemetry"]
                    and t["telemetry"]["latitude"] is None
                    and t["telemetry"]["relative_altitude_m"] is None
                    and t["telemetry"]["ground_speed_ms"] is not None
                    and t["telemetry"]["battery_voltage_v"] is not None
                    for t in timeline
                )
                checks += [
                    ("Null position/altitude observed with valid speed/voltage", found)
                ]
            run["checks"] = [
                dict(
                    label=label,
                    status="passed" if passed else "failed",
                    observed_utc=now(),
                )
                for label, passed in checks
            ]
            run["status"] = (
                "passed" if all(passed for _, passed in checks) else "failed"
            )
            if run["status"] == "failed":
                run["error"] = "Required observations did not pass."
        except asyncio.CancelledError:
            run.update(
                status="cancelled" if self.cancelled else "interrupted",
                error="Run stopped before acceptance.",
            )
        except Exception as exc:
            run.update(status="failed", error=str(exc))
        finally:
            if started:
                try:
                    await asyncio.to_thread(self.service.stop)
                except Exception as exc:
                    run.update(status="failed", error=f"Cleanup failed: {exc}")
            run["ended_utc"] = now()
            self.save("run", run)
