# Route experiments: planning, execution and evidence

The v1.5 planning work and v1.6 execution work ship together with the computer-emulator preparation in **v1.7**. Existing schema 1 recordings and legacy missions remain readable. New mission schema 2 data may contain optional `generation` provenance: the exact generated waypoint list, takeoff altitude and survey-leg indices. It is stored in the existing mission JSON column and frozen into a recording; it does not add MAVLink items.

## Planning comparison

**Alan tarama → Rota adaylarını hesapla** evaluates headings 0–165° in 15° steps plus the selected heading if different. Each uses the existing clipped survey lines, interior visibility-graph connectors and four serpentine orders. Invalid candidates remain visible with their rejection reason; routes are never truncated to meet the 50-point limit.

The comparison reports survey distance, connection distance (including home transit), total horizontal distance, turns of at least 10°, individual deflection angles and waypoint count. The estimated horizontal-route time is:

```
distance_m / assumed_speed_ms + turn_count * assumed_turn_delay_s
```

Defaults are 5 m/s and 2 seconds per turn. This model excludes climb, descent, acceleration, wind and battery behavior. The recommendation minimizes this model among the evaluated valid candidates, with deterministic distance/heading tie breaks; it is not a global optimum or actual flight-time prediction. The overlay shows A/B routes in a shared local metre plane with north up.

Computation runs in a cancellable Web Worker. Changing mission/assumptions invalidates results and prevents a late worker/backend response from becoming current. In local mode **every valid candidate is independently checked by backend Shapely validation** before publication in the comparison; public Pages uses browser validation. Checked-in candidate fixtures also undergo independent Python validation in CI. Preview does not change the mission; **Rotayı uygula** replaces the route, heading and provenance in a single undoable operation.

## Execution comparison

**Uçuş analizi → İki gerçek SITL örneğini getir** loads paired 0°/90° flights over the same L-shaped polygon. The selectors can compare other archived recordings. The analysis uses each recording's frozen mission, never the current editable draft.

Fresh connected, armed AUTO samples are assigned by the target mission index: SITL indices 2..N+1 map to route segments 0..N-1; the browser model uses 1..N. Segment 0 is home→first waypoint. Unavailable/out-of-range indices, non-AUTO operation and unavailable positions are not guessed using nearest lines. This prevents a position near an adjacent parallel line from being silently assigned to it.

For each segment:

- Planned horizontal length; assigned sample count; largest distance to the finite segment.
- Sum of consecutive observation intervals on that segment, only for positive gaps ≤3 s. Null when no interval was observed; this is not complete transit or airborne duration.
- Mean observed ground speed, ignoring null values.
- Around explicit reached-waypoint events, ±2 s fresh incoming/outgoing-leg samples give peak deviation. Speed change is the last observed speed before versus first after that event when their separation is ≤3 s. Unobservable turns remain null.

The configurable **corridor half width** defaults to 5 m. A survey leg accumulates the union of projected longitudinal intervals between consecutive qualifying samples whose endpoints are within that corridor. Reverse passes do not double count. This is a sample-based linear-track estimate with no interpolation across missing/late samples. The displayed fraction is a **lower bound on observed survey-line length**, not complete-task certification, camera coverage or an area-imaging guarantee. If no survey measurements or matching provenance exist, the fraction is null. Editing the generated waypoint coordinates/order/altitudes invalidates provenance instead of reusing stale survey labels.

The overlay displays both plans and both measured tracks, splitting tracks at unknown positions or gaps >3 s. Large tracks are reduced for drawing to a bounded set of segments/points; reports still use all qualifying samples. JSON exports contain both results, recording IDs and assumptions; CSV has one row per first-flight segment and blank cells for unknown measurements. `GET /api/v1/recordings/{id}/execution?corridor=5` provides an independent Python implementation. Browser/Python results are compared against actual SITL evidence in tests.

## Actual paired SITL acceptance

The [candidate fixtures](verification/comparison/candidates.json) use a 1,275 m² L-shaped survey polygon, 20 m spacing and 10 m relative altitude. [Two real flight results](verification/comparison/sitl-results.json) use pinned Copter-4.6.3 at **1×**, with WPNAV_SPEED=500 cm/s. Heading 0° plans 138.463 m; heading 90° plans 147.064 m. Their execution JSON files report measured corridor fractions; the UI shows approximately 90.8% and 90.9% at the default corridor. These are observations, not an assertion that one heading always flies better.

The best model candidate for these inputs is 15° (about 36.9 s estimated horizontal-route time). The 0° and 90° flights demonstrate two deliberately different plans; we do not claim the model winner has been proven fastest in flight.

Reproduce from `frontend`:

```bash
npx tsx@4.20.6 scripts/generate-comparison.ts
```

Then from `backend`, with UDP 14550 free and the firmware installed:

```bash
/opt/mission-control/venv/bin/python -m tests.comparison_runner
```

Recordings and reports are written to `docs/verification/comparison` and identical public replay fixtures under `frontend/public/comparison`. The existing seven SITL scenarios and three fault experiments remain in the acceptance workflow.
