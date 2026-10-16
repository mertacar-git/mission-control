# API v1

Local base: `http://127.0.0.1:8000/api/v1`. Swagger: `/docs`. WebSocket: `/ws`.

Versioned experiment definitions/runs and independent Windows serial experiments
are documented in [VERSIONED_EXPERIMENTS.md](VERSIONED_EXPERIMENTS.md).

| Method | Path | Purpose |
|---|---|---|
| GET | `/health`, `/status` | Backend health, connection/telemetry/mission/recording state |
| POST / DELETE | `/connection` | Start owned SITL (`{"speedup":1}`), stop it |
| POST | `/control/renew` | Claim/renew single browser lease |
| GET / POST | `/missions` | List/save validated mission |
| DELETE | `/missions/{id}` | Remove stored mission |
| POST | `/missions/{id}/upload` | Upload and verify by readback |
| GET | `/vehicle/mission` | Download current autopilot mission |
| POST | `/commands` | Send a supported action |
| GET / POST | `/recordings` | List/start a recording (`{"name":"Flight"}`) |
| POST | `/recordings/stop` | Close current recording |
| GET | `/recordings/{id}` | Versioned recording JSON |
| GET | `/recordings/{id}/csv` | Telemetry CSV, empty unknown cells |
| GET | `/recordings/{id}/report` | Report (`max_altitude=80&min_battery=20`) |

Connection, upload and command/control calls use `X-Control-Session: <browser-generated-uuid>`. Claims conflict with an existing unexpired owner. Write requests with foreign browser origins are rejected; command transport is local HTTP, never replay/WS.

Mission example (5–120 m altitudes, 1–50 waypoints, finite bounded coordinates):

```json
{"id":"example","name":"Example","takeoff_altitude_m":20,"waypoints":[{"latitude":41.0085,"longitude":28.9784,"altitude_m":20}]}
```

Command body: `{"action":"arm"}`. Supported actions: `arm`, `start`, `hold`, `resume`, `return`, `land`. Arbitrary MAVLink commands/endpoints/parameters are not accepted.

WebSocket events have `type`, `received_utc`, `payload`, and live `sequence`. Initial `snapshot` contains full status. Events include `telemetry`, `connection`, `mission_transfer`, `mission_progress`, `command` and `vehicle_message`. Sequence gaps indicate missed live notifications; recording data is separately persisted. `keepalive` carries no measurement.

Recording JSON uses `schema_version: 1`, `session` metadata including source (`demo` or `sitl`) and the mission, plus an ordered `events` array. Telemetry includes source, reception time, vehicle boot time, elapsed wall time, latitude/longitude, relative altitude (m), ground speed (m/s), battery percent/voltage, mode, armed state, mission index, heartbeat age, freshness and connection. Unknown values are null. New schema versions must be explicitly handled on import.

Errors use HTTP 422 for schema violations, 403 for ownership/origin problems, 409 for invalid current state/operation conflicts, and 404 for missing records. Runtime error details distinguish autopilot rejection, timeout and failed readback. A successful command response is acknowledgment, not mission completion.
