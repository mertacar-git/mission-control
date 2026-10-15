import { Component, lazy, Suspense, type ReactNode } from 'react';
import { Activity } from 'lucide-react';
import type { Telemetry } from '../types';

const Plot = lazy(() =>
  import('./FlightChart').then((module) => ({ default: module.FlightChart })),
);

// A deployment may remove an old lazy chunk while an existing tab remains open.
class ChartBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="chart">
        <div className="chart-empty" role="alert">
          <p>
            Grafik açılamadı. Güncel sürümü yüklemek için sayfayı yenileyin.
          </p>
          <button className="secondary small" onClick={() => location.reload()}>
            Sayfayı yenile
          </button>
        </div>
      </div>
    ) : (
      this.props.children
    );
  }
}

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
    <ChartBoundary>
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
    </ChartBoundary>
  );
}
