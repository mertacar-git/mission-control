import { expect, it } from 'vitest';
import { compareRoutes, rankCandidates } from './routeComparison';
import { newMission, validateMission } from './types';
import { examplePlanning, validatePlanning } from './planning';
it('compares deterministic valid routes and decomposes their distances', () => {
  const m = { ...newMission(), planning: examplePlanning() };
  const rows = compareRoutes(m),
    again = compareRoutes(m);
  expect(rows).toEqual(again);
  expect(rows).toHaveLength(12);
  const ranked = rankCandidates(rows);
  expect(ranked.length).toBeGreaterThan(1);
  for (const c of ranked) {
    expect(
      validatePlanning({ ...m, waypoints: c.preview!.waypoints }).valid,
    ).toBe(true);
    expect(c.connector_distance_m! + c.preview!.survey_distance_m).toBeCloseTo(
      c.preview!.distance_m,
      5,
    );
    expect(c.preview!.generation.survey_leg_indices).toHaveLength(
      c.preview!.segment_count,
    );
    expect(c.estimated_duration_s).toBeCloseTo(
      c.preview!.distance_m / 5 + c.turn_count! * 2,
    );
  }
});
it('retains invalid candidates and rejects invalid assumptions and malformed provenance', () => {
  expect(() => compareRoutes(newMission(), 0)).toThrow();
  expect(compareRoutes(newMission()).every((c) => c.error !== null)).toBe(true);
  const m = newMission();
  expect(() =>
    validateMission({
      ...m,
      generation: {
        waypoints: m.waypoints,
        takeoff_altitude_m: 20,
        survey_leg_indices: [-1],
      },
    }),
  ).toThrow();
});
