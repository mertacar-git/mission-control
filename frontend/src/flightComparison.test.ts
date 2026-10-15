import { expect, it } from 'vitest';
import { analyzeExecution, generationMatches } from './flightComparison';
import { unproject } from './planning';
import { emptyTelemetry, newMission, type Recording } from './types';
import flight0 from '../public/comparison/flight-0.json';
import report0 from '../public/comparison/execution-0.json';

it('attributes nearby lines by mission index, excludes gaps and does not double-count reversed progress', () => {
  const waypoints = [
    [0, 10],
    [0, 30],
    [2, 30],
    [2, 10],
  ].map((v) => ({ ...unproject(v as [number, number]), altitude_m: 20 }));
  const m = {
    ...newMission(),
    waypoints,
    generation: {
      waypoints: structuredClone(waypoints),
      takeoff_altitude_m: 20,
      survey_leg_indices: [1, 3],
    },
  };
  const samples = [
    [0, 12],
    [1, 20],
    [2, 12],
    [8, 28],
  ].map(([t, y]) => ({
    ...emptyTelemetry('sitl'),
    ...unproject([1.9, y]),
    connection: 'connected' as const,
    position_fresh: true,
    armed: true,
    flight_mode: 'AUTO',
    mission_index: 3,
    elapsed_s: t,
    ground_speed_ms: 5,
  }));
  const r: Recording = {
    schema_version: 1,
    session: {
      id: 'x',
      name: 'test',
      source: 'sitl',
      started_utc: '2026-10-15T00:00:00Z',
      ended_utc: null,
      mission: m,
    },
    events: samples.map((payload) => ({
      type: 'telemetry',
      received_utc: payload.received_utc,
      payload,
    })),
  };
  const report = analyzeExecution(r, 2);
  expect(report.legs[1].max_deviation_m).toBeCloseTo(1.9);
  expect(report.legs[1].observed_s).toBe(2);
  expect(report.legs[1].observed_corridor_m).toBeCloseTo(8);
  expect(report.legs[3].samples).toBe(0);
  expect(report.observed_survey_fraction).toBeCloseTo(0.2);
  m.waypoints[0].altitude_m = 21;
  expect(generationMatches(m)).toBe(false);
  expect(analyzeExecution(r).observed_survey_fraction).toBeNull();
});
it('matches independent Python execution analysis of actual SITL data', () => {
  const actual = analyzeExecution(flight0 as Recording);
  expect(actual.provenance_valid).toBe(true);
  expect(actual.observed_survey_fraction).toBeCloseTo(
    report0.observed_survey_fraction!,
    8,
  );
  actual.legs.forEach((l, i) => {
    for (const key of [
      'planned_m',
      'observed_s',
      'max_deviation_m',
      'observed_corridor_m',
      'mean_speed_ms',
      'turn_peak_deviation_m',
      'turn_speed_change_ms',
    ] as const) {
      const expected = report0.legs[i][key];
      if (expected === null) expect(l[key]).toBeNull();
      else expect(l[key]).toBeCloseTo(expected, 6);
    }
  });
});
