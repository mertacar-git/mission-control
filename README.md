# Mission Control

Plan a mission, fly one virtual UAV, watch telemetry, record the flight, replay it and export a report.

**[Browser demo](https://mertacar-git.github.io/mission-control/)** · **[Portfolio](https://mertacar-git.github.io/portfolio/)** · [Engineering case study](docs/CASE_STUDY.md) · [Verification evidence](docs/verification/README.md)

React + TypeScript + Leaflet + Recharts frontend, FastAPI + SQLite backend, and an app-owned ArduCopter SITL process speaking MAVLink. The interface is Turkish; code and documentation are English.

![Survey workspace and boundary layers](docs/media/survey-planner-v13.png)

[Watch the captioned walkthrough](https://github.com/mertacar-git/mission-control/raw/refs/heads/main/docs/media/walkthrough.mp4) · [Chapters and recording method](docs/media/walkthrough.md).


## Fault experiments and incident investigation · UI 1.4

![Owned SITL experiment laboratory](docs/media/scenario-lab-v14.png)

[v1.4 captioned walkthrough](docs/media/experiments-v14.md).

Run fixed telemetry interruption, low-battery and GPS-loss experiments against a fresh owned SITL. Each produces a persistent acceptance report with expected behavior, verified parameters, observed telemetry and failure/timeout reasons. Manual control is reserved during execution; cancellation awaits simulator cleanup. The public laboratory replays actual checked-in SITL evidence, with execution disabled. [Experiment definitions, reproducibility and API](docs/EXPERIMENTS.md).

Select an incident in any replay to synchronize the map, telemetry cards and chart cursor. Inspect the preceding command and ±10 s event context without assuming causality. Recording gaps remain unknown and break plotted lines; they do not inherit old battery or mode readings. Optional GPS fix data preserves old recording compatibility.

Current local validation: **64 frontend tests, 48 backend tests, seven existing real SITL acceptance scenarios plus three new fault experiments**. The laboratory fixtures include successful GPS-loss LAND and low-battery RTL followed by disarm. Pausing SITL tests receiver freshness and recovery, not an airborne RF/GCS outage. [Evidence](docs/verification/scenarios/scenario-runs.json).

## Survey planning · UI 1.3

Draw an **allowed area** and a separate **survey area**, including concave L/U shapes. Generate a deterministic serpentine preview with interior connectors, review its length/area/point count, then explicitly apply it. Map layers keep waypoint and polygon editing distinct; area coordinates, settings and route replacement participate in undo/redo. Tiles are optional.

Backend Shapely validation independently checks the entire route, including home transit and concave crossings; checking only waypoint endpoints is insufficient. Invalid geometry, distance or altitude limits block upload and start/resume. Schema 1 missions and existing recordings remain readable; schema 2 adds optional planning metadata. [Geometry, API and compatibility contract](docs/SURVEY_PLANNING.md).

The boundary is a **planning control, not an autopilot geofence**. Fresh measured violations are displayed and recorded; no automatic return/landing command is sent. Reports count observed outside episodes and sum only measurable outside intervals. The narrow-boundary SITL recording demonstrates that actual turns can leave a valid planned centreline.

Defaults: 20 m line spacing, 0° heading from north, 20 m relative altitude, 2,000 m route limit and 80 m altitude ceiling. Planning stays within 2 km of simulation home and retains the 50-waypoint limit. Polygon holes, terrain and camera coverage are outside scope.

## Operator workspace

Move complete waypoints up/down, select the same point on the map and in the editor, and undo/redo the last 100 changes. Upload opens an explicit review of a fixed snapshot, showing source, coordinates, takeoff altitude and final landing. Invalid missions or an unavailable connection block confirmation. Upload still requires full backend readback verification.

The evening review also caught an actual flight-control defect: LOITER obeyed the simulator's low throttle input and descended. Hold now uses **BRAKE**, which does not accept pilot input. The real SITL acceptance test checks sustained altitude retention as well as the observed mode. See the [workflow review](docs/PRODUCT_REVIEW.md) and [case study](docs/CASE_STUDY.md).

The interface uses a map-first workspace with a focused coordinate editor, route distance and explicit preflight readiness. Disconnected planning displays **planned** values; connected operation displays **measured** telemetry. An unavailable reading is never replaced by a planned value. Mission stages account for the different SITL/browser mission indices and never declare successful completion from a disarmed heartbeat alone.

Flight archives support name search and demo/SITL source filtering. Playback shows command and vehicle events without flooding the visible log with telemetry rows; the complete telemetry still remains in the recording. Repeated start actions are disabled while AUTO is observed. Map controls include metric scale and route fitting, including grid-only mode.

Presentation code is separated into survey planner, editor, review, archive, readiness, experiment laboratory, incident inspector, event-log and chart components. The chart library loads on demand; the initial JavaScript bundle is about 403 kB (126 kB gzip), with a separate chart chunk. Verification includes shared TypeScript/Python geometry fixtures, model/history/replay tests, TypeScript compilation and browser checks. Seven existing real SITL scenarios cover flight controls and generated concave survey missions; three additional fault experiments produce replayable acceptance reports.

## Two distinct modes

The public GitHub Pages **Demo** runs entirely in your browser with a deterministic kinematic vehicle model. It does **not** connect to MAVLink, a backend or a physical aircraft. Missions and demo recordings use local browser storage. An example recording is available immediately.

**Local SITL** runs the real ArduCopter software in Ubuntu/WSL. The backend starts and controls only its own process, using a fixed loopback endpoint. There is no physical-aircraft connection setting. Demo results are not evidence of autopilot behavior. Real SITL acceptance results are saved separately in `docs/verification`.

## Local installation: Windows + Ubuntu WSL

Requirements: Ubuntu 24.04 / Python 3.12 inside WSL, Git, Node.js 22 and npm on Windows. The firmware build needs several GB of disk space and network access. Keep ports UDP 14550, HTTP 8000 and development HTTP 5173 free.

Clone this repository in Windows, then open an Ubuntu terminal at its WSL path:

```bash
git clone https://github.com/mertacar-git/mission-control.git
cd mission-control
# In Ubuntu/WSL, at the same checkout:
sudo bash simulator/setup.sh
bash simulator/setup.sh
bash simulator/run-backend.sh
```

The first setup invocation installs Ubuntu build dependencies. The second builds firmware as the normal user. Runtime files live in `/opt/mission-control`; the source checkout remains separate. The launcher pins **Copter-4.6.3**, commit `92b0cd788ec29406f26c6f9c31d5ceedbd1cc538`, and rejects another revision. SITL is launched on demand by the UI; do not start a second simulator manually on the same port.

In a Windows terminal at the repository:

```powershell
cd frontend
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**, select **Yerel SITL**, then **SITL başlat & bağlan**. Wait until heartbeat, position and EKF navigation are ready. Save/upload the mission, arm, then start it. Startup estimator initialization can take around a minute. Pre-arm rejections are shown in the event log; wait for readiness and explicitly try again. Start/takeoff commands are never automatically retried.

Mission altitudes are **metres relative to home**, not MSL. The example home is an arbitrary simulation location near Istanbul (`41.0082, 28.9784`, MSL 30 m), not the user's location. A mission contains takeoff, ordered waypoints and landing. ArduPilot's internal home item occupies index 0, followed by takeoff at index 1; UI mission indices are autopilot indices.

To serve the built frontend from the backend instead of Vite:

```powershell
cd frontend
npm run build
```

Leave the WSL backend running and open **http://127.0.0.1:8000**. The local frontend uses same-origin HTTP/WebSocket; the Vite development server proxies `/api` and `/ws`. GitHub Pages intentionally does not reach a local backend.

## Workflow

1. Edit coordinates numerically or add/drag route points on the map. For a survey, choose **Örnek içbükey alan** below the map, or draw both polygons using the map layer buttons. Set parameters, generate the gold preview, and explicitly apply the route. Reorder points, undo/redo edits, save missions or import/export mission JSON.
2. Connect, review the upload snapshot, then confirm and read back the full mission. Editing and upload are locked while armed.
3. Arm and start. Recording opens automatically on start; stop/save it after landing. Hold uses BRAKE, resume uses AUTO, return uses RTL, and landing uses LAND.
4. Open **Uçuş kayıtları** and select **Oynat**. Pause, seek and select 0.5×/1×/2×. All live command controls are disabled during replay. Replay does not stop a live vehicle running in the background.
5. Select **Analiz** for altitude/speed charts, battery change, threshold alerts, observed distance and planned-route deviation. Export versioned JSON or CSV.

Map tiles can be disabled; coordinates, route geometry and vehicle markers continue working. Repeated tile errors automatically switch to the grid background. Tile requests go to OpenStreetMap with visible attribution. External fonts have system fallbacks.

## Data and command semantics

- One MAVLink reader distributes messages to command/mission waiters and WebSocket subscribers. Telemetry snapshots are published every 0.5 seconds.
- Missing measurements remain `null`; CSV cells remain empty. Old position/speed measurements expire after 3 seconds and battery measurements after 5 seconds.
- Heartbeat silence: **stale at 3 seconds**, **disconnected at 10 seconds**. New commands require current telemetry and an owned running simulator.
- Commands have separate requested, acknowledged, observed, failed and timed-out events. An accepted acknowledgment does not prove takeoff or landing completed. Observation means the requested armed state or flight mode was seen; mission completion is inferred separately from telemetry and mission progress. Unobserved acknowledged transitions expire after 15 seconds.
- One browser control lease lasts 15 seconds and renews every 2.5 seconds. One command or mission transfer runs at a time. Other controllers receive a conflict/permission error.
- Mission upload uses MAVLink COUNT → REQUEST[_INT] → ITEM_INT → ACK and then REQUEST_LIST/COUNT/readback verification. Duplicate requests are idempotent; transfer retries are bounded. Command sends are not retried automatically.
- SQLite preserves telemetry, command results, mission progress and connection changes. Live subscriber queues are bounded; dropped live events are detectable by sequence numbers and do not delete the persisted recording.
- `received_utc` is backend reception time; `vehicle_time_ms` is autopilot boot time; `elapsed_s` is backend monotonic wall time. SITL integration tests run at 4×. Duration/distance gaps and frontend replay use reception time, not speed-corrected flight time. Battery percentages are simulator measurements, not an energy consumption model.
- Distance excludes stale positions and intervals longer than 3 seconds. Route deviation is horizontal distance to the user waypoint polyline, excluding the home-to-first-point leg. Unknown metrics remain null. Alerts count threshold-exceeding samples, not distinct episodes.

See [API contract](docs/API.md) for endpoints and examples.

## Tests

```bash
# Ubuntu, from backend/
/opt/mission-control/venv/bin/pip install -r requirements.txt
/opt/mission-control/venv/bin/python -m pytest -q
/opt/mission-control/venv/bin/python -m tests.integration_runner
```

```powershell
# Windows, from frontend/
npm test
npm run build
```

The integration runner requires real installed SITL and exclusive UDP 14550 ownership. It tests readback, rejected commands, a complete takeoff/route/landing recording and report, heartbeat loss/recovery/reconnect, hold/resume/RTL, and configured low-battery RTL/landing. It exits unsuccessfully on any failed scenario. Unit tests use protocol doubles; they do not replace SITL acceptance.

GitHub Actions runs backend/frontend tests and the production build before publishing Pages. A separate **Real SITL acceptance** workflow performs a clean Ubuntu firmware setup and the real scenarios on manual dispatch.

## Scope and license

One virtual quadcopter, one control session, local backend. Multi-vehicle operations, hardware, ROS 2, PX4 and cloud deployment are outside this release. This is a portfolio simulation application, not flight-certified software.

Application source: [MIT](LICENSE). ArduPilot is downloaded separately and remains under its own GPL license; firmware is not vendored. Leaflet/OpenStreetMap and other dependencies retain their own licenses. Developed with AI assistance, with executable tests and recorded verification evidence for review.
