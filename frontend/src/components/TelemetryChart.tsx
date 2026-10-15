import { lazy, Suspense } from 'react';
import { Activity } from 'lucide-react';
import type { Telemetry } from '../types';

const Plot = lazy(() =>
  import('./FlightChart').then((module) => ({ default: module.FlightChart })),
);

export function FlightChart({
  rows,
  cursor,
}: {
  rows: Telemetry[];
  cursor?: number;
}) {
  if (!rows.length)
    return (
      <div className="chart">
        <div className="chart-empty">
          <Activity size={24} />
          <span>Bağlantı açıldığında telemetri burada çizilecek.</span>
        </div>
      </div>
    );
  return (
    <Suspense
      fallback={
        <div className="chart">
          <div className="chart-empty" role="status">
            Grafik hazırlanıyor…
          </div>
        </div>
      }
    >
      <Plot rows={rows} cursor={cursor} />
    </Suspense>
  );
}
