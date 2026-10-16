# Mission Control v1.8

The operator workflow now connects reasoned preflight, observed mission outcomes,
recording/replay, multi-flight comparison, independent Windows serial captures
and immutable experiments to repeatable acceptance evidence.

## Delivered

- Action-specific backend readiness and loaded-mission validation immediately
  before arm/start/resume; explicit unknown/blocked reasons and recorded decisions.
- Expired controller reclaim, single-operation locking and request identities;
  restored snapshots after reconnect without repeating uncertain flight commands.
- Completion requires observed final waypoint, landing and contiguous disarm.
- 2–5 recording analysis, shared maps/charts, condition fingerprints and portable
  HTML/CSV/JSON with null-preserving measurements.
- Token/Origin/Host-limited Windows loopback receiver, one reader, MCT1/CRC archive
  and isolated replay; independent synthetic serial fault experiments.
- Versioned immutable SITL definitions, new run per rerun, owner-bound cancel,
  restart interruption and expected behavior checked against actual telemetry.
- One-command acceptance, source manifests, raw recordings, JUnit/HTML reports,
  desktop/mobile browser videos and gated Pages deployment.

## Validation

103 backend tests, 76 frontend tests and ten isolated Chromium desktop/mobile
cases pass. Actual HTTP/WebSocket startup and prompt closure, Linux pyserial PTY
and owned UDP subprocesses pass. Pinned Copter-4.6.3 passes seven baseline cases,
five experiment runs and two actual 1× paired heading flights. The complete
software suite passed again after final UI presentation changes.

[Full evidence and source parity](verification/phases/phase-6/README.md).

## Use and scope

Public Pages runs a browser model and replays published real/synthetic evidence.
New SITL experiments require Ubuntu; the serial receiver runs independently on
Windows. [Acceptance setup](ACCEPTANCE.md), [serial setup](SERIAL_DEVICE.md),
[experiment contract](VERSIONED_EXPERIMENTS.md), [captioned video](media/operations-v18.md).

One virtual aircraft remains the scope. Hardware accuracy/calibration and
physical-flight control are not validated. SITL RNG seed is unknown; repeated
procedures do not promise identical trajectories. Planning boundaries remain
application checks rather than an uploaded autopilot geofence. Reported intervals
use the backend wall clock and preserve data gaps.
