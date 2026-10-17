"""Loopback-only Windows serial receiver. No MAVLink, SQLite flight store or writes to ports."""

import argparse, asyncio, json, secrets, threading, time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4
from datetime import datetime, timezone
from fastapi import (
    FastAPI,
    Header,
    HTTPException,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, field_serializer
from .serial_bench import capture, replay
from .emulator_sender import schedule
from .serial_experiments import SerialExperiments,SerialExperimentRequest
from .build_info import VERSION

ORIGINS = [
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
]


class ConnectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    port: str = Field(min_length=1, max_length=200)
    baud: Literal[9600, 57600, 115200, 230400] = 115200
    experiment: str = Field(min_length=1, max_length=200)
    duration_s: int = Field(default=300, ge=1, le=3600, strict=True)
    test_profile: Literal["nominal", "mixed", "sensor_gap"] | None = None


class SerialMeasurement(BaseModel):
    protocol: Literal["MCT1", "MCS1"] = "MCT1"
    firmware_code: int | None = None
    acceleration_x_ms2: float | None = None
    acceleration_y_ms2: float | None = None
    acceleration_z_ms2: float | None = None
    angular_velocity_x_rads: float | None = None
    angular_velocity_y_rads: float | None = None
    angular_velocity_z_rads: float | None = None
    temperature_c: float | None = None
    pressure_pa: float | None = None
    humidity_percent: float | None = None
    source: Literal["serial"]
    stream_id: str
    boot_id: int
    sequence: int
    source_time_ms: int | str
    latitude: float | None
    longitude: float | None
    relative_altitude_m: float | None
    ground_speed_ms: float | None
    battery_voltage_v: float | None

    @field_serializer("source_time_ms")
    def json_clock(self, value):
        return (
            value if isinstance(value, str) or value <= 9007199254740991 else str(value)
        )


class PortInfo(BaseModel):
    port: str
    description: str
    serial_number: str | None


class RunMetadata(BaseModel):
    id: str
    port: str
    baud: int
    experiment: str
    status: Literal["running", "completed", "failed", "interrupted"]
    source: Literal["serial"]
    transport: Literal["synthetic", "pyserial"]
    started_utc: str
    ended_utc: str | None = None
    test_profile: str | None = None
    seed: int | None = None
    error: str | None = None
    summary: dict | None = None


class SerialStatus(BaseModel):
    source: Literal["serial"] = "serial"
    transport: Literal["synthetic", "pyserial"]
    control_owned: bool
    run: RunMetadata | None
    state: Literal["fresh", "stale", "unknown"]
    connection: Literal["connecting", "connected", "disconnected", "closed"]
    age_s: float | None
    telemetry: SerialMeasurement | None
    counts: dict[str, int]
    discarded_bytes: int
    invalid_candidates: int


class SyntheticPort:
    """Explicitly opt-in software byte source, not an OS port or sensor."""

    def __init__(self, profile="mixed", count=300, **kwargs):
        self.started = time.monotonic()
        self.closed = False
        self.pending = b""
        self.packets = iter(
            schedule(
                42, profile, count, bytes.fromhex("00112233445566778899aabbccddeeff")
            )
        )
        self.next = next(self.packets, None)

    def read(self, size):
        if self.closed:
            raise OSError("Closed synthetic stream")
        if self.pending:
            value = self.pending
            self.pending = b""
            return value
        if self.next and time.monotonic() - self.started >= self.next[0]:
            packet = self.next[1]
            self.next = next(self.packets, None)
            # Exercise partial stream reads rather than datagram boundaries.
            self.pending = packet[17:]
            return packet[:17]
        time.sleep(0.03)
        return b""

    def close(self):
        self.closed = True


def local_ports():
    from serial.tools.list_ports import comports

    return [
        dict(port=p.device, description=p.description, serial_number=p.serial_number)
        for p in comports()
    ]


class SerialService:
    def __init__(
        self, directory, synthetic=False, ports_provider=None, serial_factory=None
    ):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.synthetic = synthetic
        self.ports_provider = ports_provider or (
            lambda: [
                dict(
                    port="TEST:MCT1",
                    description="Sentetik bilgisayar testi; seri sürücüsü kullanılmaz",
                    serial_number=None,
                )
            ]
            if synthetic
            else local_ports()
        )
        self.serial_factory = serial_factory or (SyntheticPort if synthetic else None)
        self.lock = threading.RLock()
        self.thread = None
        self.stop_event = threading.Event()
        self.owner = None
        self.owner_seen = 0.0
        self.current = None
        self.live = dict(
            state="unknown",
            connection="closed",
            age_s=None,
            telemetry=None,
            counts={},
            discarded_bytes=0,
            invalid_candidates=0,
        )
        for path in self.directory.glob("*.json"):
            try:
                metadata = json.loads(path.read_text(encoding="utf-8"))
                if metadata.get("status") == "running":
                    metadata.update(
                        status="interrupted",
                        error="Receiver restarted; not an acceptance pass.",
                    )
                    self.save(metadata)
            except (ValueError, OSError):
                continue

    def save(self, metadata):
        identifier = str(UUID(metadata["id"]))
        path = self.directory / f"{identifier}.json"
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(metadata, allow_nan=False), encoding="utf-8")
        temporary.replace(path)

    def claim(self, owner):
        if not owner or len(owner) > 100:
            raise ValueError("Invalid control session.")
        with self.lock:
            if (
                self.owner
                and self.owner != owner
                and time.monotonic() - self.owner_seen < 15
            ):
                raise RuntimeError("Another browser owns the serial receiver.")
            self.owner = owner
            self.owner_seen = time.monotonic()

    def require_owner(self, owner):
        with self.lock:
            if self.owner != owner or time.monotonic() - self.owner_seen >= 15:
                raise RuntimeError("Serial control expired; claim control again.")
            self.owner_seen = time.monotonic()

    def status(self, owner=None):
        with self.lock:
            return dict(
                source="serial",
                transport="synthetic" if self.synthetic else "pyserial",
                control_owned=self.owner == owner
                and time.monotonic() - self.owner_seen < 15,
                run=dict(self.current) if self.current else None,
                **self.live,
            )

    def start(self, body, owner):
        with self.lock:
            self.claim(owner)
            if self.thread and self.thread.is_alive():
                raise RuntimeError("A serial capture is already active.")
            if body.port not in [p["port"] for p in self.ports_provider()]:
                raise ValueError("Select a listed local serial port.")
            if body.test_profile and not self.synthetic:
                raise ValueError(
                    "Test profiles apply only to the synthetic test service."
                )
            if self.synthetic and body.duration_s > 60:
                raise ValueError("Synthetic test captures are limited to 60 seconds.")
            identifier = str(uuid4())
            self.stop_event = threading.Event()
            description = (
                "SENTETİK TEST; seri sürücüsü ve fiziksel sensör kullanılmadı · "
                if self.synthetic
                else ""
            ) + body.experiment
            self.current = dict(
                id=identifier,
                port=body.port,
                baud=body.baud,
                experiment=description,
                status="running",
                source="serial",
                transport="synthetic" if self.synthetic else "pyserial",
                error=None,
                started_utc=datetime.now(timezone.utc).isoformat(),
                ended_utc=None,
                test_profile=(body.test_profile or "mixed") if self.synthetic else None,
                seed=42 if self.synthetic else None,
            )
            self.save(self.current)
            self.live.update(
                state="unknown",
                connection="connecting",
                telemetry=None,
                age_s=None,
                counts={},
                discarded_bytes=0,
                invalid_candidates=0,
            )
            self.thread = threading.Thread(
                target=self.run,
                args=(identifier, body, description),
                name="single-serial-reader",
                daemon=True,
            )
            self.thread.start()
            return self.status(owner)

    def run(self, identifier, body, description):
        def update(snapshot):
            with self.lock:
                self.live = snapshot

        try:
            summary = capture(
                body.port,
                body.baud,
                self.directory / f"{identifier}.jsonl",
                body.duration_s,
                self.stop_event,
                (
                    lambda **kwargs: SyntheticPort(
                        profile=body.test_profile or "mixed",
                        count=body.duration_s * 5,
                        **kwargs,
                    )
                )
                if self.synthetic
                else self.serial_factory,
                experiment=description,
                on_update=update,
                quiet=True,
            )
            with self.lock:
                self.current.update(status="completed", summary=summary)
        except BaseException as error:
            with self.lock:
                self.current.update(status="failed", error=str(error))
        finally:
            with self.lock:
                self.live.update(
                    state="unknown", connection="closed", telemetry=None, age_s=None
                )
                self.current["ended_utc"] = datetime.now(timezone.utc).isoformat()
                self.save(self.current)

    def stop(self):
        with self.lock:
            thread = self.thread
            self.stop_event.set()
        if thread and thread.is_alive():
            thread.join(timeout=3)
        if thread and thread.is_alive():
            raise RuntimeError(
                "Serial reader has not stopped; another capture cannot start."
            )

    def recordings(self):
        rows = []
        for path in self.directory.glob("*.json"):
            try:
                rows.append(json.loads(path.read_text(encoding="utf-8")))
            except (ValueError, OSError):
                continue
        return sorted(rows, key=lambda row: row.get("started_utc", ""), reverse=True)

    def recording(self, identifier):
        identifier = str(UUID(identifier))
        path = self.directory / f"{identifier}.jsonl"
        if not (self.directory / f"{identifier}.json").is_file() or not path.is_file():
            raise FileNotFoundError("Serial recording not found.")
        if (
            self.current
            and self.current["id"] == identifier
            and self.current["status"] == "running"
        ):
            raise RuntimeError("Stop capture before opening its frozen recording.")
        if path.stat().st_size > 64 * 1024 * 1024:
            raise ValueError(
                "Recording exceeds the 64 MB viewer limit; use the local raw file."
            )
        return path.read_text(encoding="utf-8")


def create_serial_app(
    directory=None,
    token=None,
    synthetic=False,
    ports_provider=None,
    serial_factory=None,
):
    secret = token or secrets.token_urlsafe(32)
    service = SerialService(
        directory or Path(__file__).resolve().parents[2] / ".runtime/serial",
        synthetic,
        ports_provider,
        serial_factory,
    )
    experiments=SerialExperiments(service)

    @asynccontextmanager
    async def lifespan(app):
        try:
            yield
        finally:
            await experiments.close()
            await asyncio.to_thread(service.stop)

    app = FastAPI(title="Mission Control Serial Receiver",version=VERSION, lifespan=lifespan)
    app.state.service = service
    app.state.experiments=experiments
    app.state.access_token = secret
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ORIGINS,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Content-Type", "Authorization", "X-Control-Session"],
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])

    @app.middleware("http")
    async def guard(request: Request, call_next):
        origin = request.headers.get("origin")
        if origin and origin not in ORIGINS:
            return Response("Origin not allowed", 403)
        if request.method != "OPTIONS" and not secrets.compare_digest(
            request.headers.get("authorization", ""), "Bearer " + secret
        ):
            return Response("Invalid receiver token", 401)
        return await call_next(request)

    def translate(error):
        return HTTPException(
            404
            if isinstance(error, FileNotFoundError)
            else 409
            if isinstance(error, RuntimeError)
            else 422,
            str(error),
        )

    @app.get("/api/v1/serial/ports", response_model=list[PortInfo])
    def ports():
        return service.ports_provider()

    @app.get("/api/v1/serial/status", response_model=SerialStatus)
    def status(x_control_session: str | None = Header(default=None)):
        return service.status(x_control_session)

    @app.post("/api/v1/serial/control/claim", response_model=SerialStatus)
    def claim(x_control_session: str = Header(...)):
        try:
            if experiments.active:raise RuntimeError('An experiment owns this receiver.')
            service.claim(x_control_session)
            return service.status(x_control_session)
        except (RuntimeError, ValueError) as error:
            raise translate(error)

    @app.post("/api/v1/serial/control/renew")
    def renew(x_control_session: str = Header(...)):
        try:
            service.require_owner(x_control_session)
            return dict(status="renewed")
        except RuntimeError as error:
            raise translate(error)

    @app.post("/api/v1/serial/connection", response_model=SerialStatus)
    def connect(body: ConnectionRequest, x_control_session: str = Header(...)):
        try:
            if experiments.active:raise RuntimeError('An experiment owns this receiver.')
            return service.start(body, x_control_session)
        except (RuntimeError, ValueError) as error:
            raise translate(error)

    @app.delete("/api/v1/serial/connection", response_model=SerialStatus)
    async def disconnect(x_control_session: str = Header(...)):
        try:
            if experiments.active:raise RuntimeError('Cancel the owning experiment instead.')
            service.require_owner(x_control_session)
            await asyncio.to_thread(service.stop)
            return service.status(x_control_session)
        except RuntimeError as error:
            raise translate(error)

    @app.get('/api/v1/serial/experiments')
    def experiment_definitions():return experiments.list('definition')

    @app.post('/api/v1/serial/experiments')
    def define_experiment(body:SerialExperimentRequest):
        try:return experiments.define(body)
        except (FileNotFoundError,ValueError) as error:raise translate(error)

    @app.get('/api/v1/serial/experiment-runs')
    def experiment_runs():return experiments.list('run')

    @app.post('/api/v1/serial/experiment-runs/{identifier}')
    async def start_experiment(identifier:UUID,x_control_session:str=Header(...)):
        try:return experiments.start(identifier,x_control_session)
        except (FileNotFoundError,ValueError,RuntimeError) as error:raise translate(error)

    @app.post('/api/v1/serial/experiment-runs/{identifier}/cancel')
    async def cancel_experiment(identifier:UUID,x_control_session:str=Header(...)):
        try:
            if not experiments.active or experiments.current['id']!=str(identifier):raise RuntimeError('Experiment is not active.')
            await experiments.close(x_control_session)
            return experiments.get('run',identifier)
        except RuntimeError as error:raise translate(error)

    @app.get("/api/v1/serial/recordings", response_model=list[RunMetadata])
    def recordings():
        return service.recordings()

    @app.get("/api/v1/serial/recordings/{identifier}")
    def recording(identifier: UUID):
        try:
            return Response(
                service.recording(str(identifier)), media_type="application/x-ndjson"
            )
        except (FileNotFoundError, RuntimeError, ValueError) as error:
            raise translate(error)

    @app.websocket("/ws/serial")
    async def websocket(ws: WebSocket):
        if ws.headers.get("origin") not in ORIGINS or ws.headers.get("host") not in (
            "127.0.0.1:8767",
            "localhost:8767",
        ):
            await ws.close(code=1008)
            return
        await ws.accept()
        try:
            auth = await asyncio.wait_for(ws.receive_text(), 3)
            if len(auth) > 512:
                await ws.close(code=1008)
                return
            body = json.loads(auth)
            if not isinstance(body, dict):
                await ws.close(code=1008)
                return
            if not isinstance(body.get("token"), str) or not secrets.compare_digest(
                body["token"], secret
            ):
                await ws.close(code=1008)
                return
            owner = body.get("session")
            if not isinstance(owner, str) or not 1 <= len(owner) <= 100:
                await ws.close(code=1008)
                return
            while True:
                await ws.send_json(
                    dict(
                        type="serial_snapshot",
                        payload=SerialStatus.model_validate(
                            service.status(owner)
                        ).model_dump(),
                    )
                )
                await asyncio.sleep(0.5)
        except (WebSocketDisconnect, RuntimeError, asyncio.TimeoutError, ValueError):
            pass

    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--synthetic",
        action="store_true",
        help="Expose only a labelled software test source; no OS port is opened",
    )
    args = parser.parse_args()
    app = create_serial_app(synthetic=args.synthetic)
    print(
        "Local receiver token (paste only into the local Serial device page): "
        + app.state.access_token,
        flush=True,
    )
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8767, ws_max_size=4096)


if __name__ == "__main__":
    main()
