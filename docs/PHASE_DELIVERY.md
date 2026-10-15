# Phased software delivery

This implementation follows the approved sequence. A later phase does not imply
that physical board/sensor acceptance has passed. Every phase has its own commit
and evidence; uncompleted phases stay explicitly pending.

| Phase | Deliverable | Acceptance |
|---|---|---|
| 0 | Lazy runtime startup, controller reclaim, baseline regression | Passed: 7 real SITL scenarios, 66 backend / 69 frontend tests |
| 1 | Action-specific server-authoritative preflight | Passed: 7 real SITL scenarios, 75 backend / 69 frontend tests |
| 2 | Observed mission lifecycle and connection recovery | Pending |
| 3 | Two-to-five flight comparison and portable exports | Pending |
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
