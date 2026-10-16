# Phased software delivery

This implementation follows the approved sequence. A later phase does not imply
that physical board/sensor acceptance has passed. Every phase has its own commit
and evidence; uncompleted phases stay explicitly pending.

| Phase | Deliverable | Acceptance |
|---|---|---|
| 0 | Lazy runtime startup, controller reclaim, baseline regression | Passed: 7 real SITL scenarios, 66 backend / 69 frontend tests |
| 1 | Action-specific server-authoritative preflight | Passed: 7 real SITL scenarios, 75 backend / 69 frontend tests |
| 2 | Observed mission lifecycle and connection recovery | Passed: 7 SITL scenarios, actual browser reload flight, 78 backend / 69 frontend tests |
| 3 | Two-to-five flight comparison and portable exports | Passed: real full-interval flight, Python/TS parity, 81 backend / 71 frontend tests |
| 4 | Windows serial service and application integration | Pending |
| 5 | Repeatable experiment definitions and immutable runs | Pending |
| 6 | Unified acceptance runner, evidence and release | Pending |

## Phase 0

Creating or importing the FastAPI application no longer opens a database. The
runtime is initialized at ASGI startup (or explicit access to a test resource),
and cleanup is protected by `finally`. Recovery of interrupted sessions occurs
only when the store is actually opened.

`POST /api/v1/control/claim` reclaims an expired controller lease without
starting, stopping or reconnecting SITL. Another unexpired owner is rejected.
Automatic scenario ownership is also respected. Local frontend renewal can
reclaim its lease after expiration; no flight command is retried.

Local validation: 66 backend tests, 69 frontend tests and TypeScript/production
build passed. Additional tests cover app construction against a nonexistent
database and an active recording, expired lease reclaim and competing owners.
Real pinned-SITL baseline results are stored under `verification/phases/phase-0`.

Browser check: local mode and reload remained closed without spawning SITL. At a 390 px viewport, content width was 375 px (no horizontal overflow).

## Phase 1

`GET /api/v1/preflight?action=arm|start|resume` returns typed ready/blocked/unknown
checks, evaluation UTC and an operational-content SHA-256 mission fingerprint
(name, ID and generation labels excluded). Status includes all three action
assessments for the current controller header. Assessments do not acquire or
renew a control lease. Internal trusted scenario commands use the same vehicle
checks; API commands additionally require the controller lease.

Position/GPS/EKF age must be under 3 seconds; battery age under 5 seconds and
remaining percentage at least 20. Arm requires disarmed state. Start/resume also
require armed state, verified readback and independently valid loaded mission.
The current command's own lock is excluded from its readiness check. Preflight
events are emitted before arm/start/resume and recorded if a recording is open.
Return/land retain their existing connected transport requirement without the
preflight battery/GPS/mission gate. The frontend shows action selection, reasons,
timestamp and a draft/loaded mismatch note; local buttons use backend readiness.

Validation includes direct HTTP bypass attempts, competing controller, missing
measurements, threshold freshness, low battery, operation lock and unchanged
geometry rejection behaviour. Public demo retains explicitly simulated controls.

Phase 1 browser acceptance: action selector changes start/arm requirements; unknown GPS/battery and loaded-draft mismatch are visible. At 390 px, content width remains 375 px. TypeScript and production build passed.

## Phase 2

Connection, observed mission lifecycle and the most recent command result are
separate status fields. Lifecycle completion requires the final waypoint's
MISSION_ITEM_REACHED, observed landing phase, a fresh arm-to-disarm transition
and ground-relative altitude at most 1 m. A gap across disarm or an observed RTL
leaves the mission outcome unknown rather than manufacturing success. Established
completion evidence is retained after a later disconnect; a new upload resets it.

Commands accept an optional request ID. The last 128 request outcomes are cached
in process memory: duplicates of pending, failed or acknowledged requests do not
resend a command, and reusing an ID for a different action is rejected. This is
a bounded recent-request guard, not a persistent cross-restart retry contract.
The frontend never automatically retries a command and serializes operations
with an immediate ref guard as well as disabled controls.

Local mode selection survives page reload within a tab. WebSocket snapshots
replace the current state on reconnection; missed sequences and backend sequence
resets produce explicit notices. Failed status polls clear all live measurement
fields. Backend restart does not resume a process or replay a command.

Validation: 78 backend / 69 frontend tests and TypeScript/production build passed.
Seven pinned SITL scenarios passed, now also asserting observed completion of
the normal mission. Evidence is under `verification/phases/phase-2`.

Actual browser acceptance: a 1x concave SITL mission was started from the UI,
reloaded in flight and completed. The recording ID and requested command IDs
were unchanged after reload and after running pytest while recording was open.
Raw browser-flight evidence and before/after/final snapshots are included.

## Phase 3

The analysis page compares 2–5 distinct recordings with common map, altitude and
speed plots, condition warnings, completion evidence and nullable arm/disarm
duration. Deviation is taken from mission-index-assigned AUTO flight legs,
including the home-to-first-waypoint leg, rather than ground points projected
onto unrelated waypoint segments. Unobserved boundaries and one-sample battery
changes remain null. Incomplete endpoints or gaps do not yield a flight duration.

`POST /api/v1/recordings/compare` accepts 2–5 unique recording identifiers and
returns a Pydantic-validated version-1 report. Operational fingerprints use an
explicit `mcfp1` canonical encoding (IEEE-754 binary64 numeric bytes, sorted
object keys, null planning), shared with TypeScript. ID/name/generation labels
are excluded. New recordings include an environment event with actual simulator
speed and pinned firmware; missing historical conditions stay unknown.

Five public recordings include one new real 4x SITL flight with observed arm and
disarm (11.76 backend wall seconds). The other recordings intentionally show
missing duration/conditions where their evidence cannot establish them. Metrics
and fingerprints are cross-checked between independent Python and TS code.

The UI exports JSON/CSV and a standalone HTML report, with a sandboxed HTML
preview. Native browser download completion could not be observed by automation;
the exact preview HTML was inspected and saved as `verification/phases/phase-3/report.html`.
Browser tests cover five selections, bounded plot rendering and 390 px layout
(375 px content, no page overflow). Plots keep equal metre scale and never join
data gaps. JSON/CSV preserve nulls as null/empty cells. All earlier candidate
geometry validation tests remain in place.
