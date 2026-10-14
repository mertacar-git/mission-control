import { Activity } from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { Telemetry } from '../types';
export function FlightChart({ rows }: { rows: Telemetry[] }) {
  return (
    <div className="chart">
      {rows.length === 0 ? (
        <div className="chart-empty">
          <Activity size={28} />
          <span>Bağlantı açıldığında telemetri burada çizilecek.</span>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={rows}
            margin={{ top: 12, right: 18, left: -18, bottom: 0 }}
          >
            <defs>
              <linearGradient id="altFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#71dfbe" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#71dfbe" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#24354c" strokeDasharray="3 5" />
            <XAxis
              dataKey="elapsed_s"
              type="number"
              domain={['dataMin', 'dataMax']}
              tick={{ fill: '#94a8c4', fontSize: 12 }}
              tickFormatter={(v) => Number(v).toFixed(0) + ' s'}
            />
            <YAxis
              yAxisId="alt"
              tick={{ fill: '#94a8c4', fontSize: 12 }}
              unit=" m"
            />
            <YAxis
              yAxisId="speed"
              orientation="right"
              tick={{ fill: '#76b6ff', fontSize: 12 }}
              unit=" m/s"
            />
            <Tooltip
              contentStyle={{
                background: '#122035',
                border: '1px solid #30445c',
                borderRadius: 8,
              }}
              labelFormatter={(v) => Number(v).toFixed(1) + ' s'}
              formatter={(v) =>
                typeof v === 'number' ? v.toFixed(2) : String(v ?? '—')
              }
            />
            <Area
              isAnimationActive={false}
              yAxisId="alt"
              name="Eve göre irtifa (m)"
              type="linear"
              dataKey="relative_altitude_m"
              stroke="#71dfbe"
              fill="url(#altFill)"
              connectNulls={false}
            />
            <Area
              isAnimationActive={false}
              yAxisId="speed"
              name="Yer hızı (m/s)"
              type="linear"
              dataKey="ground_speed_ms"
              stroke="#76b6ff"
              fill="transparent"
              connectNulls={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
