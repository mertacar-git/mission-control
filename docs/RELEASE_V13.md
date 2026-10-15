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
- [x] Captioned walkthrough and updated screenshots.
- [x] Public application, portfolio/profile refresh and successful deployment checks.

Planning boundary enforcement on the autopilot, terrain, holes, disconnected regions, camera triggering and physical vehicles remain outside this release.

## Published evidence

- Implementation commit: `b04d8ea4f47d19fbc39848f48944b846209a60e4`.
- [Application validation and deployment](https://github.com/mertacar-git/mission-control/actions/runs/38790974921): successful.
- [Walkthrough/documentation deployment](https://github.com/mertacar-git/mission-control/actions/runs/38791528453): successful.
- [Portfolio validation and deployment](https://github.com/mertacar-git/portfolio/actions/runs/38791518444): successful; new description and v1.3 image verified in the browser.
- [Clean Ubuntu SITL reproduction](https://github.com/mertacar-git/mission-control/actions/runs/38790974876): pinned firmware rebuild and seven-scenario artifact run for the implementation commit.
- Public demo generated and applied the example concave route successfully; profile links to the geometry contract and evidence.
