# Survey planning and boundary validation · 1.3

## Operator workflow

Choose the map layer: **Rota noktaları** edits mission points, **İzin verilen alan** edits the allowed boundary, and **Tarama alanı** edits the survey polygon. Click to append a vertex, drag its numbered A/S marker, or expand the coordinate editor below the map. Coordinates, deletions, area settings and route replacement share the 100-step undo history. An example L-shaped area makes the workflow reproducible without drawing.

Set line spacing (5–200 m), heading (0° inclusive to 180° exclusive, clockwise from north), and altitude (5–120 m relative to home). Defaults are 20 m, 0°, 20 m. Mission limits default to 2,000 m route length and an 80 m altitude ceiling; configurable distance is 1–100,000 m and altitude 5–120 m. All new planning geometry stays within 2 km of the fixed simulation home.

Generate a preview, inspect its gold route overlay and metrics, then explicitly apply it. Changing the mission or settings invalidates the preview; applied waypoints remain unchanged until another explicit application. Route replacement and takeoff-altitude update are one undo operation. The existing 50-waypoint limit includes transit and concavity connectors; no route is silently truncated.

## Geometry and deterministic routing

Each area is one simple, hole-free polygon with 3–60 distinct vertices and at least 1 m² area. Self intersections, repeated vertices, degenerate areas and invalid settings are rejected. The allowed area must include home and the complete survey polygon, including its edges.

The local plane uses `x=R*cos(homeLatitude)*(longitude-homeLongitude)` and `y=R*(latitude-homeLatitude)`, with angular differences in radians and R=6,371,000 m. This short-range approximation is bounded by the 2 km input radius. Boundaries are included, with 0.1 m numerical tolerance; this is not a physical clearance margin.

The survey polygon rotates into across-track/along-track axes. Its across-track extent is divided into `ceil(width/spacing)` equal strips; one line crosses the centre of each strip. Thus the requested spacing is an upper bound on actual line spacing. Half-open edge intersections avoid double counting at vertices. All interior intervals are retained, including multiple intervals in U-shaped polygons.

Four serpentine candidates cover forward/reverse strip order and the two initial directions. Between survey pieces, a visibility graph of polygon vertices provides a shortest interior connector via Dijkstra. The initial transit uses the allowed polygon; subsequent connectors use the survey polygon. The shortest complete candidate is selected with deterministic tie order. This is not a globally optimal coverage solver, and no camera footprint/coverage percentage is claimed.

Frontend predicates use narrowly imported Turf modules; backend validation uses Shapely independently. Concave segment checks split at boundary crossings and test all intervals, rather than checking only endpoints. Shared fixtures exercise both implementations.

## Contracts and compatibility

Mission schema 2 adds nullable `planning`: `allowed_area` and `survey_area` arrays of `{latitude,longitude}`, `spacing_m`, `heading_deg`, `altitude_m`, `max_distance_m`, and `max_altitude_m`. Rings are stored without repeating the first vertex. Empty survey areas are allowed for manually planned boundary-only missions; enabled planning always requires a valid allowed area before upload. Drafts may be saved while their polygon geometry needs correction.

Schema 1 missions normalize to schema 2 with `planning:null`; version 1 may not contain planning metadata. Existing recording envelope schema 1 stays supported and may contain either mission version. Existing SQLite JSON columns are reused. Unknown mission versions remain rejected. No limits are retroactively added to legacy missions without planning.

`POST /api/v1/missions/validate` accepts a mission and returns `{valid,distance_m,issues}`. Issues have a stable `code`, a human message, and optional `area`, `waypoint_index`, or `segment_index` (all indices zero based; segment 0 is home → first waypoint). Structural violations return HTTP 422; geometric violations return HTTP 200 with `valid:false`. Upload and start/resume validate the stored/uploaded mission independently of this endpoint and reject invalid geometry before sending MAVLink operations.

The upload review freezes polygon coordinates and limits with the waypoint snapshot. Flight monitoring uses the uploaded mission, never an edited draft. The boundary is not sent through MAVLink's fence protocol and cannot trigger an automatic command.

## Observation and reporting

Boundary state is `unconfigured`, `inside`, `outside`, or `unknown`. Position must be fresh, connection current, and relative altitude available; otherwise the state is unknown. Being outside the lateral polygon or above the altitude ceiling produces an observed violation. Backend and demo emit `fence` events on state changes with the mission identifier. Replay evaluates saved telemetry against the recorded mission and retains the original fence events.

Reports add `fence_violation_count` and `fence_observed_violation_s`. A count is a newly observed outside episode, including reappearance after unknown data. Duration sums only adjacent outside samples at most three seconds apart. An isolated outside sample can therefore give count 1 and duration 0: its actual duration was not measurable. Unknown intervals are never filled or bridged. Reports without planning display the boundary metrics as unconfigured in the UI.

## Acceptance evidence

The TypeScript-generated [L-shaped mission](verification/survey-mission.json) contains seven waypoints, covers a geometric area of 1,275 m² and has a planned route length of 138.463 m including initial transit. Its [actual SITL recording](verification/survey-session.json), [report](verification/survey-report.json) and [CSV](verification/survey-telemetry.csv) are separate from the browser model.

The [narrow-boundary observation](verification/narrow-boundary-session.json) deliberately places a planning boundary close to turns. The actual path can cross it despite valid planned line segments. Its [report](verification/narrow-boundary-report.json) records what was observed; this scenario does not demand the exact same number of excursions on every platform. No corrective fence command is sent.

The real SITL runner includes the original five scenarios plus generated-survey completion and narrow-boundary observation. Unit tests cover shared geometry, schema compatibility, backend bypass rejection, unknown measurements, and route/history semantics. See [acceptance evidence](verification/README.md).

Terrain, polygon holes, disconnected regions, camera triggering, image overlap, hardware control and autopilot geofence enforcement are outside this release.
