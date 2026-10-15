import { frames } from './analysis';
import { project, type XY } from './planning';
import { HOME, type Mission, type Recording, type Telemetry } from './types';
export interface LegResult {
  index: number;
  kind: 'survey' | 'connector' | 'unclassified';
  planned_m: number;
  samples: number;
  observed_s: number | null;
  max_deviation_m: number | null;
  mean_speed_ms: number | null;
  observed_corridor_m: number | null;
  turn_peak_deviation_m: number | null;
  turn_speed_change_ms: number | null;
}
export function generationMatches(m: Mission) {
  return (
    !!m.generation &&
    m.takeoff_altitude_m === m.generation.takeoff_altitude_m &&
    m.waypoints.length === m.generation.waypoints.length &&
    m.waypoints.every((w, i) =>
      (['latitude', 'longitude', 'altitude_m'] as const).every(
        (k) => w[k] === m.generation!.waypoints[i][k],
      ),
    )
  );
}
const length = (a: XY, b: XY) => Math.hypot(b[0] - a[0], b[1] - a[1]);
function projection(p: XY, a: XY, b: XY) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    norm = dx * dx + dy * dy;
  const t = norm ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / norm : 0,
    clipped = Math.max(0, Math.min(1, t));
  return {
    t: clipped,
    deviation: Math.hypot(
      p[0] - a[0] - clipped * dx,
      p[1] - a[1] - clipped * dy,
    ),
  };
}
function unionLength(intervals: [number, number][]) {
  let total = 0,
    end = -Infinity;
  for (const [a, b] of intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    total += Math.max(0, b - Math.max(a, end));
    end = Math.max(end, b);
  }
  return total;
}
export function analyzeExecution(recording: Recording, corridor = 5) {
  if (!Number.isFinite(corridor) || corridor < 0.1 || corridor > 100)
    throw Error('Koridor yarı genişliği 0,1–100 m olmalıdır.');
  const mission = recording.session.mission;
  if (!mission)
    return {
      schema_version: 1,
      source: recording.session.source,
      mission_id: null,
      corridor_half_width_m: corridor,
      provenance_valid: false,
      legs: [] as LegResult[],
      observed_survey_fraction: null,
    };
  const points = [HOME, ...mission.waypoints].map(project),
    rows = frames(recording),
    valid = generationMatches(mission);
  const intervals = mission.waypoints.map(() => [] as [number, number][]),
    speeds = mission.waypoints.map(() => [] as number[]);
  const legs: LegResult[] = mission.waypoints.map((_, i) => ({
    index: i,
    kind: valid
      ? mission.generation!.survey_leg_indices.includes(i)
        ? 'survey'
        : 'connector'
      : 'unclassified',
    planned_m: length(points[i], points[i + 1]),
    samples: 0,
    observed_s: null,
    max_deviation_m: null,
    mean_speed_ms: null,
    observed_corridor_m: valid ? 0 : null,
    turn_peak_deviation_m: null,
    turn_speed_change_ms: null,
  }));
  function assigned(r: Telemetry) {
    if (
      r.connection !== 'connected' ||
      !r.position_fresh ||
      r.latitude === null ||
      r.longitude === null ||
      r.flight_mode !== 'AUTO' ||
      r.armed !== true ||
      r.mission_index === null ||
      !Number.isInteger(r.mission_index)
    )
      return null;
    const index = r.mission_index - (r.source === 'sitl' ? 2 : 1);
    return index >= 0 && index < legs.length ? index : null;
  }
  rows.forEach((r, i) => {
    const index = assigned(r);
    if (index === null) return;
    const leg = legs[index],
      p = projection(
        project({ latitude: r.latitude!, longitude: r.longitude! }),
        points[index],
        points[index + 1],
      );
    leg.samples++;
    leg.max_deviation_m = Math.max(leg.max_deviation_m ?? 0, p.deviation);
    if (r.ground_speed_ms !== null) speeds[index].push(r.ground_speed_ms);
    if (i === 0) return;
    const previous = rows[i - 1],
      dt = r.elapsed_s - previous.elapsed_s;
    if (assigned(previous) !== index || dt <= 0 || dt > 3) return;
    leg.observed_s = (leg.observed_s ?? 0) + dt;
    const before = projection(
      project({ latitude: previous.latitude!, longitude: previous.longitude! }),
      points[index],
      points[index + 1],
    );
    if (valid && before.deviation <= corridor && p.deviation <= corridor)
      intervals[index].push([Math.min(before.t, p.t), Math.max(before.t, p.t)]);
  });
  // Windows around explicit reached events, bounded to fresh samples of the incoming/outgoing legs.
  const anchor = rows[0];
  if (anchor)
    for (const event of recording.events.filter(
      (e) => e.type === 'mission_progress',
    )) {
      const reached =
        Number(event.payload.reached_index) -
        (recording.session.source === 'sitl' ? 2 : 1);
      if (
        !Number.isInteger(reached) ||
        reached < 0 ||
        reached >= legs.length - 1
      )
        continue;
      const at =
        anchor.elapsed_s +
        (Date.parse(event.received_utc) - Date.parse(anchor.received_utc)) /
          1000;
      const window = rows.filter(
        (r) =>
          Math.abs(r.elapsed_s - at) <= 2 &&
          [reached, reached + 1].includes(assigned(r) ?? -1),
      );
      const deviations = window.map(
        (r) =>
          projection(
            project({ latitude: r.latitude!, longitude: r.longitude! }),
            points[assigned(r)!],
            points[assigned(r)! + 1],
          ).deviation,
      );
      if (deviations.length)
        legs[reached].turn_peak_deviation_m = Math.max(...deviations);
      const before = window
          .filter((r) => r.elapsed_s <= at && r.ground_speed_ms !== null)
          .at(-1),
        after = window.find(
          (r) => r.elapsed_s > at && r.ground_speed_ms !== null,
        );
      if (before && after && after.elapsed_s - before.elapsed_s <= 3)
        legs[reached].turn_speed_change_ms =
          after.ground_speed_ms! - before.ground_speed_ms!;
    }
  legs.forEach((leg, i) => {
    leg.mean_speed_ms = speeds[i].length
      ? speeds[i].reduce((a, b) => a + b, 0) / speeds[i].length
      : null;
    if (valid)
      leg.observed_corridor_m = unionLength(intervals[i]) * leg.planned_m;
  });
  const survey = legs.filter((l) => l.kind === 'survey'),
    total = survey.reduce((s, l) => s + l.planned_m, 0);
  return {
    schema_version: 1,
    source: recording.session.source,
    mission_id: mission.id,
    corridor_half_width_m: corridor,
    provenance_valid: valid,
    legs,
    observed_survey_fraction:
      total && survey.some((l) => l.samples)
        ? survey.reduce((s, l) => s + (l.observed_corridor_m ?? 0), 0) / total
        : null,
  };
}
export function executionCSV(report: ReturnType<typeof analyzeExecution>) {
  const keys = [
    'index',
    'kind',
    'planned_m',
    'samples',
    'observed_s',
    'max_deviation_m',
    'mean_speed_ms',
    'observed_corridor_m',
    'turn_peak_deviation_m',
    'turn_speed_change_ms',
  ] as const;
  return [
    keys.join(','),
    ...report.legs.map((l) => keys.map((k) => l[k] ?? '').join(',')),
  ].join('\n');
}
