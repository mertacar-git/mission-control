# Release 1.3 acceptance checklist

- [x] Schema 2 with optional planning; version 1 input and recording compatibility.
- [x] Separate waypoint/allowed/survey editing, numeric vertices, draggable markers, deletion and shared undo history.
- [x] Concave scanlines, interior visibility-graph connectors, deterministic four-candidate selection.
- [x] Explicit preview/application, invalidation on mission changes and no silent waypoint truncation.
- [x] Independent backend geometry validation before upload/start/resume.
- [x] Uploaded-mission boundary observation, unknown readings, state events and measurable report durations.
- [x] Shared geometry fixtures, frontend tests and backend/API tests.
- [x] Seven actual SITL scenarios, including survey landing and narrow-boundary observation.
- [x] Desktop/mobile browser acceptance, recorded-flight replay and exports.
- [ ] Captioned walkthrough and updated screenshots.
- [ ] Public application, portfolio/profile refresh and successful deployment checks.

Planning boundary enforcement on the autopilot, terrain, holes, disconnected regions, camera triggering and physical vehicles remain outside this release.
