# Versioned experiment management

In **Yerel SITL → Senaryo laboratuvarı**, create an immutable definition,
expand its mission snapshot, then select **Yeni koşu başlat**. A normal
experiment captures the current draft; later edits cannot change that snapshot.
Fault profiles use their documented fixed 10 m, approximately 555 m mission
instead, so the injection cannot accidentally follow a completed short mission.

Definitions include schema version, parent, revision number, mission content
fingerprint, simulation speed (1× or 4×), expected observations and a 90–600 s
wall-clock timeout. Creating a child never updates its parent. Branches from the
same parent may have the same revision number; UUIDs identify them unambiguously.
There is no arbitrary command, executable or parameter injection interface.

Each rerun creates a fresh run and isolated SITL process. The run stores the
definition, git revision and dirty-worktree indicator, pinned firmware revision,
source, speed, recording identifiers, observations and error. Git metadata is
null when unavailable. SITL's random seed is **null**, because this application
does not establish a firmware RNG seed; repeatable procedure does not imply
bit-identical vehicle trajectories. Raw recordings include experiment conditions
in their first environment event, including the immutable definition identifier.

States are `queued`, `running`, `passed`, `failed`, `cancelled`, `interrupted`.
Missing required observations, startup failure, timeout or cleanup failure cannot
pass. Explicit owner cancellation is separate from shutdown/restart interruption.
Cancellation is bound to the initiating browser session and remains available
after its short manual-control lease expires. Other tabs cannot cancel or seize
the run. Manual commands and mission transfers stay locked through cleanup.
There is no automatic flight-command retry.

Select 2–5 runs to inspect their conditions together. Open their recordings to
use the multi-flight analysis screen and its HTML/CSV/JSON reports. Different
definitions, routes, speeds or fault profiles are explicitly different conditions;
the application does not declare a winner.

## REST

- `GET/POST /api/v1/experiments`: immutable SITL definitions; POST accepts
  name, kind, optional mission (normal only), speedup, timeout_s and parent_id.
- `GET/POST /api/v1/experiment-runs`: history / start `{definition_id}`.
- `GET /api/v1/experiment-runs/{id}`: frozen definition and observed results.
- `POST /api/v1/experiment-runs/{id}/cancel`: initiating control session only.

Mutating run operations use `X-Control-Session`. The old `/scenarios` endpoints
remain available and share the same SITL exclusivity guard. SQLite migration 1
adds two tables without rewriting previous mission/session JSON. Running and
queued jobs are recovered as interrupted at runtime startup, never on import.

## Independent serial experiments

Windows' loopback receiver owns its own definition/run registry under
`.runtime/serial/experiments`; WSL does not receive the receiver's token. Launch
`simulator/run-serial.ps1 -Synthetic`, connect in **Seri cihaz**, and create a
nominal, mixed-packet or sensor-gap definition (5–60 seconds). These use seed 42
and a software byte source, not a USB driver or physical sensor. Firmware is
null. The main UI never converts a serial capture into a flight recording.

The receiver exposes authenticated `GET/POST /api/v1/serial/experiments`,
`GET /api/v1/serial/experiment-runs`,
`POST /api/v1/serial/experiment-runs/{definition_id}`, and
`POST /api/v1/serial/experiment-runs/{run_id}/cancel`.
Capture completion alone is insufficient: profiles require accepted frames,
rejected CRC/late packets and sequence gaps, or re-decoded nullable sensor
fields with valid speed/voltage, as appropriate. A cancelled capture cannot pass.
Live capture/claim/stop endpoints cannot interrupt an experiment. Physical-device
calibration and accuracy acceptance remain pending hardware work.

## Acceptance

From `backend`, `python -m tests.experiment_runner` executes two normal runs
from one definition, heartbeat loss/recovery, low-battery RTL/landing and GPS
loss/LAND/disarm using pinned real SITL. Evidence is in
`verification/phases/phase-5`. Public Pages exposes those recordings read-only.
Software tests also exercise owner rejection, queued-state locking, restart,
append-only revisions, startup failure, timeout and three serial fault profiles.
