# Acceptance evidence

Local environment: Windows host, Ubuntu 24.04 WSL, Python 3.12, ArduCopter `Copter-4.6.3` at commit `92b0cd788ec29406f26c6f9c31d5ceedbd1cc538`. Actual SITL scenarios were executed on 2026-10-15, at 4× simulator speed.

- [Five acceptance results](sitl-results.json): mission transfer/readback and command rejection; complete takeoff/waypoints/landing with recording/report; heartbeat loss/recovery and a new clean session; BRAKE/AUTO/RTL; configured low battery causing RTL and landing.
- [Actual SITL recording](golden-session.json): version 1 JSON with telemetry and command/vehicle events.
- [Report from that recording](golden-report.json): null-preserving metrics. Durations are reception wall time; at 4× speed they are not aircraft simulation time.

The initial integration attempt revealed that valid GPS coordinates alone do not imply a healthy EKF position estimate. The application now tracks `EKF_STATUS_REPORT` navigation readiness and checks it before arm; the runner waits for estimator readiness. All five scenarios subsequently passed together.

Backend: 22 unit/API/protocol tests. Frontend: 30 model/replay/analysis/history tests and a successful TypeScript/Vite production build. Protocol tests include duplicate/out-of-order requests, invalid indices, incomplete/rejected transfers, bounded timeout retries and acknowledgment versus observation. These scripted tests supplement the real simulator runs.

Reproduce with `python -m tests.integration_runner` from `backend/`, using the installed runtime virtual environment. It starts its own process, writes results here, captures failure context on failure, then stops its process. The optional GitHub Actions workflow repeats the tests from a clean Ubuntu setup and retains artifacts.

Browser checks cover demo flight/recording, replay command isolation, timeline/speed controls, analysis, grid-only route display and desktop/mobile layouts. Media in `../media` are captured application views, not design mockups. The walkthrough video is a sequence of captured browser views of an actual SITL recording and its report; seeking is accelerated for presentation.

References: [MAVLink mission protocol](https://mavlink.io/en/services/mission.html), [pinned ArduCopter release](https://github.com/ArduPilot/ardupilot/releases/tag/Copter-4.6.3).

## UI 1.2 evening acceptance

The five real SITL scenarios were rerun after changing hold from LOITER to BRAKE. The hold scenario now checks altitude retention for five wall seconds (20 simulated seconds at 4×), with a maximum permitted 1.5 m drop, before resume/RTL. All five passed together.

The first UI flight exposed the LOITER/default-throttle descent. [Regression telemetry](hold-regression.json) preserves the finding rather than presenting an acknowledgment as a successful hold. The corrected UI flight used 1× speed and is saved separately:

- [Browser acceptance summary](ui-acceptance.json): version, build, checks and measurement bounds.
- [Corrected actual UI flight](ui-acceptance-session.json), [report](ui-acceptance-report.json) and [CSV](ui-acceptance-telemetry.csv).
- 222 samples over 113.5 reception-wall seconds; peak relative altitude 10.011 m. Connected BRAKE samples stayed between 9.963 and 10.001 m. Controlled loss produced 32 null-altitude samples and explicit stale/disconnected/recovered events. The recorder continued sampling, so event-gap count is zero; that does not mean no measurement loss occurred.
- Browser checks include route reorder/undo/redo, linked marker selection, invalid review rejection, actual snapshot upload/readback, arm/start, hold, blocked controls during loss, recovery/resume, landing/disarm, isolated replay, pause/seek and all playback speeds.
- At a 390×844 viewport the page had no horizontal overflow; the 341 px review dialog fit between y=36.5 and y=807.5. [Mobile view](../media/mission-review-mobile.png).

See [case study](../CASE_STUDY.md) and [captioned video chapters](../media/walkthrough.md) for decisions and media provenance. UI self-review is not represented as independent operator research.
