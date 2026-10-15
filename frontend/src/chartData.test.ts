import { expect, it } from 'vitest';
import { chartData } from './chartData';
import { emptyTelemetry } from './types';
it('breaks plotted lines over missing samples without changing source measurements', () => {
  const rows = [0, 1, 8, 9].map((elapsed_s) => ({
    ...emptyTelemetry(),
    elapsed_s,
    relative_altitude_m: 10,
    ground_speed_ms: 2,
  }));
  const plotted = chartData(rows);
  expect(plotted).toHaveLength(5);
  expect(plotted[2].relative_altitude_m).toBeNull();
  expect(plotted[2].ground_speed_ms).toBeNull();
  expect(rows).toHaveLength(4);
  expect(rows.every((r) => r.relative_altitude_m === 10)).toBe(true);
});
