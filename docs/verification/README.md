# Acceptance evidence

Local environment: Windows host, Ubuntu 24.04 WSL, Python 3.12, ArduCopter `Copter-4.6.3` at commit `92b0cd788ec29406f26c6f9c31d5ceedbd1cc538`. Actual SITL scenarios were executed on 2026-10-15, at 4× simulator speed.

- [Five acceptance results](sitl-results.json): mission transfer/readback and command rejection; complete takeoff/waypoints/landing with recording/report; heartbeat loss/recovery and a new clean session; LOITER/AUTO/RTL; configured low battery causing RTL and landing.
- [Actual SITL recording](golden-session.json): version 1 JSON with telemetry and command/vehicle events.
- [Report from that recording](golden-report.json): null-preserving metrics. Durations are reception wall time; at 4× speed they are not aircraft simulation time.

The initial integration attempt revealed that valid GPS coordinates alone do not imply a healthy EKF position estimate. The application now tracks `EKF_STATUS_REPORT` navigation readiness and checks it before arm; the runner waits for estimator readiness. All five scenarios subsequently passed together.

Backend: 22 unit/API/protocol tests. Frontend: 14 model/replay/analysis tests and a successful TypeScript/Vite production build. Protocol tests include duplicate/out-of-order requests, invalid indices, incomplete/rejected transfers, bounded timeout retries and acknowledgment versus observation. These scripted tests supplement the real simulator runs.

Reproduce with `python -m tests.integration_runner` from `backend/`, using the installed runtime virtual environment. It starts its own process, writes results here, captures failure context on failure, then stops its process. The optional GitHub Actions workflow repeats the tests from a clean Ubuntu setup and retains artifacts.

Browser checks cover demo flight/recording, replay command isolation, timeline/speed controls, analysis, grid-only route display and desktop/mobile layouts. Media in `../media` are captured application views, not design mockups. The walkthrough video is a sequence of captured browser views of an actual SITL recording and its report; seeking is accelerated for presentation.

References: [MAVLink mission protocol](https://mavlink.io/en/services/mission.html), [pinned ArduCopter release](https://github.com/ArduPilot/ardupilot/releases/tag/Copter-4.6.3).
