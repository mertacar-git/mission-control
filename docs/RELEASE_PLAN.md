# Mission workflow release plan

## Scope

Improve the current single-vehicle application, verify its actual SITL workflow, and make the engineering work reviewable. No hardware, fleet support, cloud backend or activity backdating is part of this release.

## Work and acceptance

- [x] Inspect the operator workflow and record concrete usability findings.
- [x] Reorder route points without losing their coordinates/altitudes.
- [x] Select the same waypoint in the editor and on the map.
- [x] Undo/redo edits, including imports, removal, dragging and reordering.
- [x] Review a fixed mission snapshot before uploading; block invalid/stale submissions.
- [x] Test boundary conditions, redo branching and snapshot isolation.
- [x] Execute a mission through the new UI against owned ArduCopter SITL.
- [x] Verify hold/resume, connection loss/recovery, recording, replay and report.
- [x] Repeat the automated real SITL acceptance suite.
- [x] Publish an engineering case study with decisions, limitations and evidence.
- [x] Produce a captioned walkthrough from actual application views.
- [ ] Publish code/demo, refresh portfolio presentation, verify GitHub Actions.

The product review is performed as a task-based self-review because the user delegated this evening's work. It is not represented as an interview with the user or independent usability research.
