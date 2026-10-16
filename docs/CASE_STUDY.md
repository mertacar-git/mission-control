# Mission Control: from route editing to inspectable flight evidence

## v1.8: observable operation and immutable experiments

The backend now decides action-specific preflight against the loaded mission and
fresh navigation/battery evidence. Reconnection restores state without replaying
uncertain commands. Mission completion combines observed final waypoint, landing
and disarm rather than interpreting command acknowledgment as flight success.

Immutable definitions preserve mission/settings and every rerun preserves a new
result and recording. Runs retain failure/interruption states, bounded timeouts,
owner cancellation and source provenance. Independent Windows serial captures use
their own authentication, registry and replay, preparing hardware work without
claiming sensor/USB validation. Multi-flight reports compare 2–5 recordings with
explicit conditions, missing intervals and null-preserving exports.

A clean-environment acceptance runner ties these claims to 103 backend tests,
76 frontend tests, ten desktop/mobile browser cases, actual transport/PTY/UDP
checks and pinned SITL scenarios. Actual Uvicorn shutdown testing exposed an idle
WebSocket subscriber waiting for another queue item after its peer closed. A
concurrent receive task now releases the subscriber promptly, and the regression
and installed-server test both pass. [Evidence and exact source manifests](verification/phases/phase-6/README.md).

## v1.7: compare hypotheses against execution, then exercise the telemetry boundary

Heading comparison evaluates a bounded deterministic candidate set with explicit speed/turn assumptions. The worker remains cancellable and local candidates pass independent Shapely validation. Application is an explicit undoable step; an estimate is never presented as measured flight time.

Two actual 1× SITL flights over the same L-shaped area demonstrate frozen-mission execution analysis. Mission indices disambiguate nearby parallel lines. Reports expose observed intervals, missing data, turn windows and a sample-based corridor-length estimate instead of claiming complete camera coverage. The browser and Python independently reproduce execution reports from actual recordings. [Method and evidence](ROUTE_EXPERIMENTS.md).

A separate Python sender/UDP receiver then tests the binary telemetry boundary: CRC, missing/repeated/late packets, unavailable sensors and a real sender-process restart. These recordings have source `emulator` and an independent store/replay path. A C++ decoder consumes the same golden packet as Python, preparing a future board transport adapter without claiming unbuilt hardware validation. [Protocol and handoff](COMPUTER_EMULATOR.md).

## v1.4: falsifiable experiments and incident context

The laboratory exposes three fixed, reproducible fault experiments instead of generic control knobs. Real Copter-4.6.3 runs verify receiver staleness/recovery, configured battery RTL and GPS-loss EKF LAND. A parameter ACK is never a behavioral pass: voltage, fix type, mode and disarm are checked separately. Reports persist failure reasons and interrupted runs in SQLite. Cancelling waits for owned-process cleanup; a subsequent experiment starts with a fresh isolated EEPROM.

Public Pages includes those real recordings without pretending to run an autopilot. Incident selection aligns UTC events to the telemetry connection clock and drives the shared map/cards/chart cursor. The inspector shows the preceding command and surrounding events without inferring causation. Reviewing measurement gaps also corrected stale mode/battery display and chart lines that could bridge missing samples. [Definitions and limits](EXPERIMENTS.md), [actual acceptance reports](verification/scenarios/scenario-runs.json).

## Problem and result

A mission dashboard needs more than moving telemetry cards. An operator must know which route is being uploaded, recover a mistaken edit, distinguish command acceptance from vehicle behavior, and inspect a flight after a connection failure.

Mission Control joins route planning, an app-owned ArduCopter simulator, live telemetry, SQLite recording, isolated playback and export. Release 1.3 adds concave-area survey generation and independent boundary validation to the recoverable editor and reviewed upload workflow. The public browser demo remains a deterministic model; autopilot acceptance is demonstrated separately with real SITL.

## Concave survey planning · 1.3

The survey feature addresses two distinct problems: generating a route whose planned connectors remain inside a concave polygon, and observing whether the actual trajectory stays inside an allowed boundary. These are separate claims. Scanline clipping, four serpentine candidates and visibility-graph connectors solve the geometric planning problem. Backend Shapely checks all segments independently, including cases where both endpoints are inside but the segment crosses a concavity.

The generated L-shaped acceptance mission has seven points, a 138.463 m planned route and a 1,275 m² polygon. It completed on actual SITL and produced a recording/report. A second, deliberately narrow boundary observed a transient trajectory violation without sending corrective commands. An isolated outside sample is counted but has no measurable duration; the report does not fabricate time around it. [Detailed method, contracts and evidence](SURVEY_PLANNING.md).

Browser acceptance exposed an additional serialization defect: raw JSON string equality interpreted reordered backend object properties as a different uploaded mission. Canonical value comparison now normalizes mission version/null metadata and object key ordering while preserving route-array order. A regression test covers backend-shaped objects and real changed limits.

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
