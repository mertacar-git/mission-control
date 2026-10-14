from datetime import datetime, timezone
from enum import StrEnum
from typing import Literal
from uuid import uuid4
from pydantic import BaseModel, ConfigDict, Field

def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()

class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)

class Waypoint(StrictModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    altitude_m: float = Field(ge=5, le=120)

class Mission(StrictModel):
    schema_version: Literal[1] = 1
    id: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=100)
    takeoff_altitude_m: float = Field(default=20, ge=5, le=120)
    waypoints: list[Waypoint] = Field(min_length=1, max_length=50)

class ConnectionState(StrEnum):
    CLOSED = 'closed'
    CONNECTING = 'connecting'
    CONNECTED = 'connected'
    STALE = 'stale'
    DISCONNECTED = 'disconnected'

class Telemetry(StrictModel):
    source: Literal['sitl', 'demo'] = 'sitl'
    received_utc: str = Field(default_factory=utc_now)
    elapsed_s: float = 0
    vehicle_time_ms: int | None = None
    latitude: float | None = None
    longitude: float | None = None
    relative_altitude_m: float | None = None
    ground_speed_ms: float | None = None
    battery_pct: float | None = None
    battery_voltage_v: float | None = None
    flight_mode: str | None = None
    armed: bool | None = None
    mission_index: int | None = None
    position_fresh: bool = False
    navigation_ready: bool = False
    heartbeat_age_s: float | None = None
    connection: ConnectionState = ConnectionState.CLOSED

class CommandRequest(StrictModel):
    action: Literal['arm', 'start', 'hold', 'resume', 'return', 'land']

class ConnectionRequest(StrictModel):
    speedup: float = Field(default=1, ge=1, le=10)

class Event(StrictModel):
    type: str
    received_utc: str = Field(default_factory=utc_now)
    payload: dict
