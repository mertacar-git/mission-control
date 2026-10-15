# Mission Control: from route editing to inspectable flight evidence

## Problem and result

A mission dashboard needs more than moving telemetry cards. An operator must know which route is being uploaded, recover a mistaken edit, distinguish command acceptance from vehicle behavior, and inspect a flight after a connection failure.

Mission Control joins route planning, an app-owned ArduCopter simulator, live telemetry, SQLite recording, isolated playback and export. Release 1.2 adds route reordering, linked map/editor selection, bounded undo/redo and a reviewed upload snapshot. The public browser demo remains a deterministic model; autopilot acceptance is demonstrated separately with real SITL.

## Data path and responsibilities

React edits a draft mission. A review dialog freezes a snapshot, then the backend performs MAVLink upload and readback before marking that snapshot verified. One MAVLink reader distributes telemetry, mission responses and acknowledgments to their consumers. FastAPI publishes WebSocket events while SQLite retains recording events. Playback reads saved events into its own view and never calls the live command path.

The backend owns the simulator process and fixed loopback endpoint. A renewable controller lease and a single transfer/command operation prevent competing writes. Physical-aircraft connectivity, multiple vehicles and cloud deployment are outside this version.

## Decisions and tradeoffs

- **Draft, reviewed snapshot and uploaded mission are distinct.** A mutable editor is convenient; an immutable submission makes the operator's confirmation meaningful. Backend readback remains the authority on what the autopilot received.
- **History is a bounded reducer.** Deep snapshots isolate past edits; new edits after undo clear the redo branch. Keeping 100 changes bounds memory. History is session-local and does not survive a reload.
- **One MAVLink reader avoids competing receive loops.** Command waiters and transfer state machines consume distributed messages. Duplicate mission requests are idempotent and retries are bounded. Flight-start commands are never automatically retried.
- **Acknowledged is not completed.** Events separately show request, acknowledgment and observed state/mode. Seeing AUTO does not prove a complete route; mission progress and landing telemetry supply additional evidence.
- **A hold must actually hold.** The first evening flight exposed a defect that a mode-only test missed: LOITER was acknowledged while the default simulated throttle caused descent. [Captured telemetry](verification/hold-regression.json) preserves the finding. Hold now selects BRAKE, whose pinned implementation targets zero climb and whose [official documentation](https://ardupilot.org/copter/docs/brake-mode.html) specifies no pilot input. The integration test checks altitude retention for five wall seconds, not only the mode name.
- **Missing values stay missing.** Stale measurements become null and CSV fields remain empty. A heartbeat is stale after 3 seconds and disconnected after 10; new commands are rejected. A resumed simulator must supply fresh data before controls become available.
- **Three clocks answer different questions.** UTC reception timestamps support audit, autopilot boot time describes vehicle messages, and monotonic reception time drives playback. The 4× integration runner's report duration is wall time, not simulated aircraft time.
- **Measurement loss differs from recording loss.** The recorder can continue emitting snapshots with null measurements during transport loss. This is not necessarily an event gap; connection events and null readings must also be inspected.
- **Map tiles are optional.** Coordinates and route geometry remain usable on a grid when external tiles fail. Invalid coordinates are kept editable without entering Leaflet geometry.

## Evidence and reproducibility

See [acceptance evidence](verification/README.md), [workflow review](PRODUCT_REVIEW.md), the [release checklist](RELEASE_PLAN.md) and the [captioned walkthrough](media/walkthrough.md). The suite covers mission protocol ordering/duplicates/rejection/timeouts, command acknowledgment versus observation, null-preserving export, recording/replay and edit-history edge cases.

The evening acceptance uses the actual local UI and pinned ArduCopter 4.6.3: upload/readback, arm/start, hold, controlled heartbeat loss, recovery, AUTO, landing, archive playback and report export. The first flight's hold defect is retained as regression evidence; the corrected behavior is checked separately. The automated suite repeats normal mission completion, heartbeat recovery, hold/resume/RTL and a configured low-battery RTL/landing scenario. Evidence files identify source and timing; browser demo footage is not substituted for simulator validation.

## How to review the work

Start with the public demo's route editor and upload review. Inspect `frontend/src/missionDraft.ts` for history semantics and `backend/mission_control/mavlink.py` for message distribution and transfer state. Follow the actual recording's command and connection events into its report. Reproduce the five SITL scenarios using the documented pinned setup.

This is a software engineering prototype for one virtual aircraft. It does not establish flight safety, hardware readiness, operator usability with independent participants, or scalability to fleets. Those require separate requirements, testing and evidence.
