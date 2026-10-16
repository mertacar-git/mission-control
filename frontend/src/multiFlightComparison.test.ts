import { expect, it } from 'vitest';
import {
  compareFlights,
  operationalFingerprint,
  comparisonCSV,
} from './multiFlightComparison';
import type { Recording } from './types';
import a from '../public/comparison/flight-0.json';
import b from '../public/comparison/flight-90.json';
import c from '../public/comparison/baseline-0.json';
import d from '../public/comparison/baseline-1.json';
import e from '../public/comparison/baseline-2.json';
import expected from '../../docs/verification/phases/phase-3/comparison.json';
const recordings = [a, b, c, d, e] as unknown as Recording[];
it('matches independently computed Python metrics and fingerprints on five real flights', async () => {
  const actual = await compareFlights(recordings);
  expect(actual.warnings).toEqual(expected.warnings);
  actual.items.forEach((item, i) => {
    const wanted = expected.items[i];
    expect(item.mission_fingerprint).toBe(wanted.mission_fingerprint);
    expect(item.completion).toBe(wanted.completion);
    if (wanted.observed_flight_s === null)
      expect(item.observed_flight_s).toBeNull();
    else
      expect(item.observed_flight_s).toBeCloseTo(wanted.observed_flight_s, 8);
    for (const [key, value] of Object.entries(wanted.metrics))
      if (value === null) expect(item.metrics[key]).toBeNull();
      else expect(item.metrics[key]).toBeCloseTo(value, 6);
  });
  expect(comparisonCSV(actual)).toContain('observed_flight_s');
});
it('ignores identity labels but preserves missing endpoints and battery measurements', async () => {
  const r = structuredClone(recordings[0]);
  const original = await operationalFingerprint(r.session.mission);
  r.session.mission!.id = 'renamed';
  r.session.mission!.name = 'renamed';
  expect(await operationalFingerprint(r.session.mission)).toBe(original);
  r.session.id = 'partial';
  r.events = r.events
    .filter((e) => e.type === 'telemetry' && e.payload.armed === true)
    .slice(0, 1);
  const result = await compareFlights([recordings[0], r]);
  expect(result.items[1].observed_flight_s).toBeNull();
  expect(result.items[1].metrics.battery_used_percentage_points).toBeNull();
  await expect(compareFlights([r, r])).rejects.toThrow();
});
