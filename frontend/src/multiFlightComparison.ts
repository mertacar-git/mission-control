import { analyze, frames } from './analysis';
import { analyzeExecution } from './flightComparison';
import type { Mission, Recording, Telemetry } from './types';

export async function operationalFingerprint(
  m: Mission | null | undefined,
): Promise<string | null> {
  if (!m) return null;
  function canonical(value: unknown): unknown {
    if (typeof value === 'number') {
      const bytes = new Uint8Array(8);
      new DataView(bytes.buffer).setFloat64(0, value === 0 ? 0 : value, false);
      return {
        f64: Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''),
      };
    }
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, canonical(v)]),
      );
    return value;
  }
  const text = JSON.stringify(
    canonical({
      takeoff_altitude_m: m.takeoff_altitude_m,
      waypoints: m.waypoints,
      planning: m.planning ?? null,
    }),
  );
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return (
    'mcfp1:' +
    Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('')
  );
}

export interface FlightSummary {
  id: string;
  name: string;
  source: string;
  mission_fingerprint: string | null;
  completion: 'completed' | 'unknown';
  observed_flight_s: number | null;
  speedup: number | null;
  firmware: string | null;
  experiment: unknown;
  metrics: Record<string, number | null>;
}
export interface FlightComparison {
  schema_version: 1;
  items: FlightSummary[];
  warnings: string[];
  assumptions: string;
}

async function summarize(r: Recording): Promise<FlightSummary> {
  const mission = r.session.mission,
    rows = frames(r),
    metrics = analyze(r);
  let previous: Telemetry | null = null,
    started: number | null = null,
    incomplete = false;
  const intervals: number[] = [];
  let final = false,
    landing = false,
    everArmed = false,
    previousArmed: boolean | null = null,
    interrupted = false,
    completed = false;
  for (const event of r.events) {
    if (
      event.type === 'mission_progress' &&
      mission &&
      event.payload.reached_index === mission.waypoints.length + 1
    )
      final = true;
    if (event.type !== 'telemetry') continue;
    const t = event.payload as unknown as Telemetry;
    if (r.session.source === 'sitl' && !completed) {
      if (t.connection !== 'connected' || !t.position_fresh)
        previousArmed = null;
      else if (mission) {
        if (t.armed === true) {
          everArmed = true;
          if (t.flight_mode === 'RTL') interrupted = true;
          if (
            t.flight_mode === 'LAND' ||
            (t.flight_mode === 'AUTO' &&
              t.mission_index === mission.waypoints.length + 2)
          )
            landing = true;
        } else if (
          t.armed === false &&
          previousArmed === true &&
          everArmed &&
          final &&
          landing &&
          !interrupted &&
          t.relative_altitude_m !== null &&
          t.relative_altitude_m <= 1
        )
          completed = true;
        previousArmed = t.armed;
      }
    }
    const consecutive =
      previous !== null &&
      t.connection === 'connected' &&
      t.armed !== null &&
      previous.connection === 'connected' &&
      t.elapsed_s - previous.elapsed_s > 0 &&
      t.elapsed_s - previous.elapsed_s <= 3;
    if (!consecutive) {
      if (started !== null || t.armed === true) incomplete = true;
      started = null;
    }
    if (consecutive && previous!.armed === false && t.armed === true)
      started = t.elapsed_s;
    if (consecutive && previous!.armed === true && t.armed === false) {
      if (started !== null) intervals.push(t.elapsed_s - started);
      started = null;
    }
    previous = t;
  }
  const environment =
    r.events.find((e) => e.type === 'environment')?.payload ?? {};
  const batteries = rows.filter((t) => t.battery_pct !== null);
  const deviations=analyzeExecution(r).legs.flatMap(leg=>leg.max_deviation_m===null?[]:[leg.max_deviation_m]);
  const boundary =
    !!mission?.planning?.allowed_area.length &&
    rows.some((t) => t.position_fresh);
  return {
    id: r.session.id,
    name: r.session.name,
    source: r.session.source,
    mission_fingerprint: await operationalFingerprint(mission),
    completion: completed ? 'completed' : 'unknown',
    observed_flight_s:
      intervals.length === 1 && started === null && !incomplete
        ? intervals[0]
        : null,
    speedup:
      typeof environment.speedup === 'number' ? environment.speedup : null,
    firmware:
      typeof environment.firmware === 'string' ? environment.firmware : null,
    experiment: environment.experiment ?? null,
    metrics: {
      max_route_deviation_m: deviations.length?Math.max(...deviations):null,
      recording_gaps: metrics.recording_gaps,
      fence_violation_count: boundary
        ? (metrics.fence_violation_count ?? null)
        : null,
      fence_observed_violation_s: boundary
        ? (metrics.fence_observed_violation_s ?? null)
        : null,
      battery_used_percentage_points:
        batteries.length >= 2 ? metrics.battery_used_percentage_points : null,
      peak_relative_altitude_m: metrics.peak_relative_altitude_m,
      peak_ground_speed_ms: metrics.peak_ground_speed_ms,
    },
  };
}

export async function compareFlights(
  recordings: Recording[],
): Promise<FlightComparison> {
  if (
    recordings.length < 2 ||
    recordings.length > 5 ||
    new Set(recordings.map((r) => r.session.id)).size !== recordings.length
  )
    throw Error('2–5 farklı kayıt seçin.');
  const items = await Promise.all(recordings.map(summarize)),
    warnings: string[] = [];
  if (items.some((i) => i.mission_fingerprint === null))
    warnings.push('Görev bilgisi eksik; aynı görev olduğu doğrulanamaz.');
  if (new Set(items.map((i) => i.mission_fingerprint)).size > 1)
    warnings.push(
      'Rota veya planlama içeriği farklı; aynı görevin tekrarı değildir.',
    );
  if (new Set(items.map((i) => i.source)).size > 1)
    warnings.push('Veri kaynakları farklı.');
  if (items.some((i) => i.speedup === null || i.firmware === null))
    warnings.push('En az bir kaydın simülasyon koşulları bilinmiyor.');
  if (
    new Set(items.filter((i) => i.speedup !== null).map((i) => i.speedup))
      .size > 1
  )
    warnings.push(
      'Simülasyon hızları farklı; süreler doğrudan eşdeğer değildir.',
    );
  if (
    new Set(items.filter((i) => i.firmware !== null).map((i) => i.firmware))
      .size > 1
  )
    warnings.push('Firmware sürümleri farklı.');
  if (new Set(items.map((i) => JSON.stringify(i.experiment))).size > 1)
    warnings.push('Deney ayarları farklı veya eksik.');
  return {
    schema_version: 1,
    items,
    warnings,
    assumptions:
      'Süre yalnızca kayıtta gözlenen kesintisiz arm/disarm aralığıdır. Eksik uçlar veya veri boşluğu süre üretmez. Otomatik kazanan seçilmez.',
  };
}

export function comparisonCSV(report: FlightComparison) {
  const columns = [
    'id',
    'name',
    'source',
    'mission_fingerprint',
    'completion',
    'observed_flight_s',
    'speedup',
    'firmware',
    ...Object.keys(report.items[0].metrics),
  ];
  const cell = (value: unknown) => {
    let s = value == null ? '' : String(value);
    if (typeof value === 'string' && /^[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return [
    columns,
    ...report.items.map((i) =>
      columns.map(
        (c) => (({ ...i, ...i.metrics }) as Record<string, unknown>)[c],
      ),
    ),
  ]
    .map((row) => row.map(cell).join(','))
    .join('\r\n');
}
