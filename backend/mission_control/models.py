from datetime import datetime, timezone
from enum import StrEnum
from typing import Literal
from uuid import uuid4
from pydantic import BaseModel, ConfigDict, Field, model_validator

def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()

class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)

class Coordinate(StrictModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)

class Planning(StrictModel):
    allowed_area: list[Coordinate] = Field(max_length=60)
    survey_area: list[Coordinate] = Field(max_length=60)
    spacing_m: float = Field(default=20,ge=5,le=200)
    heading_deg: float = Field(default=0,ge=0,lt=180)
    altitude_m: float = Field(default=20,ge=5,le=120)
    max_distance_m: float = Field(default=2000,ge=1,le=100000)
    max_altitude_m: float = Field(default=80,ge=5,le=120)

class Waypoint(Coordinate):
    altitude_m: float = Field(ge=5, le=120)

class Mission(StrictModel):
    generation: 'Generation | None' = None
    schema_version: Literal[1,2] = 2
    planning: Planning | None = None
    id: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=100)
    takeoff_altitude_m: float = Field(default=20, ge=5, le=120)
    waypoints: list[Waypoint] = Field(min_length=1, max_length=50)

    @model_validator(mode='after')
    def migrate(self):
        if self.schema_version==1 and (self.planning is not None or self.generation is not None):
            raise ValueError('Version 1 cannot contain planning metadata.')
        self.schema_version=2
        return self

class Generation(StrictModel):
    waypoints: list[Waypoint] = Field(min_length=1,max_length=50)
    takeoff_altitude_m: float = Field(ge=5,le=120)
    survey_leg_indices: list[int] = Field(max_length=50)

    @model_validator(mode='after')
    def indices(self):
        if len(set(self.survey_leg_indices))!=len(self.survey_leg_indices) or any(i<1 or i>=len(self.waypoints) for i in self.survey_leg_indices):
            raise ValueError('Survey legs must be unique waypoint-to-waypoint segment indices.')
        return self

Mission.model_rebuild()

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
    gps_fix_type: int | None = None
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
