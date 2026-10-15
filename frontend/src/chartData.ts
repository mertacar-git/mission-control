import type { Telemetry } from './types';

// Null display separators break charts at absent samples. Never persisted or exported as measurements.
export function chartData(rows: Telemetry[]): Telemetry[] {
  return rows.flatMap((row, index) =>
    index > 0 && row.elapsed_s - rows[index - 1].elapsed_s > 3
      ? [
          {
            ...row,
            elapsed_s: (row.elapsed_s + rows[index - 1].elapsed_s) / 2,
            relative_altitude_m: null,
            ground_speed_ms: null,
          },
          row,
        ]
      : [row],
  );
}
