# Operator workflow review · 1.2

This is a task-based self-review of the existing application, not a user interview or independent usability study. The review tasks were: change a route, recover an accidental edit, understand the upload target, execute a flight, and inspect its evidence.

| Observed workflow problem | Change | Verification |
| --- | --- | --- |
| Reordering required rewriting coordinates or deleting points. | Move a complete waypoint up/down, preserving its altitude. | Unit tests cover order, invalid indices and altitude preservation; browser reorder/undo checked. |
| A map marker and its coordinate row were hard to associate. | Shared selection, numbered highlight and editor scrolling. | Selecting marker 2 selects row 2 without inserting another point. |
| An accidental edit or removal had no recovery path. | Bounded 100-step undo/redo across edits, imports, dragging, deletion and reordering. | Tests cover history branching, isolation, limits and compound edits. |
| Upload immediately acted on an editable draft. | Modal review of an immutable snapshot, explicit source, route, altitude reference and landing. | Invalid latitude 91 blocks confirmation; corrected snapshot uploads and reads back through real SITL. |
| Invalid coordinates could reach the map renderer. | Exclude invalid geometry; keep coordinate editing available. | Invalid-coordinate tests and browser correction without a map crash. |
| LOITER acknowledged a hold while default simulated throttle caused descent. | Use BRAKE, which ignores pilot inputs. | Captured regression telemetry; real SITL test now checks sustained altitude retention. |

The review dialog uses the browser's modal focus/inert behavior. Editing and confirmation remain gated by connection/armed/replay state. An upload error stays visible in the dialog, allowing an explicit retry. A reviewed route is not described as uploaded until backend readback succeeds.

Remaining limits: no independent operator study, no keyboard shortcuts for history, no persistent undo history across reloads, and no hardware qualification. The demo and local SITL remain separate sources.
