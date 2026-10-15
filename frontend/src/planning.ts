import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { lineIntersect } from '@turf/line-intersect';
import { kinks } from '@turf/kinks';
import { polygon, lineString } from '@turf/helpers';
import {
  HOME,
  validateMission,
  type Coordinate,
  type Mission,
  type Planning,
  type Telemetry,
  type Waypoint,
} from './types';

export const TOLERANCE_M = 0.1;
const SCALE = (6371000 * Math.PI) / 180,
  COS = Math.cos((HOME.latitude * Math.PI) / 180);
export type XY = [number, number];
export const project = (p: Coordinate): XY => [
  (p.longitude - HOME.longitude) * SCALE * COS,
  (p.latitude - HOME.latitude) * SCALE,
];
export const unproject = ([x, y]: XY): Coordinate => ({
  latitude: HOME.latitude + y / SCALE,
  longitude: HOME.longitude + x / SCALE / COS,
});
const norm = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const ring = (ps: XY[]) => [...ps, ps[0]];
const edges = (ps: XY[]) =>
  ps.map((p, i) => [p, ps[(i + 1) % ps.length]] as [XY, XY]);
export function defaultPlanning(): Planning {
  return {
    allowed_area: [],
    survey_area: [],
    spacing_m: 20,
    heading_deg: 0,
    altitude_m: 20,
    max_distance_m: 2000,
    max_altitude_m: 80,
  };
}
export function examplePlanning(): Planning {
  return {
    ...defaultPlanning(),
    allowed_area: (
      [
        [-20, -20],
        [70, -20],
        [70, 70],
        [-20, 70],
      ] as XY[]
    ).map(unproject),
    survey_area: (
      [
        [5, 5],
        [50, 5],
        [50, 20],
        [25, 20],
        [25, 50],
        [5, 50],
      ] as XY[]
    ).map(unproject),
  };
}
export function pointSegment(p: XY, a: XY, b: XY) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    d = dx * dx + dy * dy;
  const t = d
    ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / d))
    : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
export function inside(p: XY, ps: XY[]): boolean {
  if (ps.length < 3) return false;
  return (
    edges(ps).some(([a, b]) => pointSegment(p, a, b) <= TOLERANCE_M) ||
    booleanPointInPolygon(p, polygon([ring(ps)]))
  );
}
// Split at every boundary crossing. Endpoints alone cannot validate a concave route.
export function segmentInside(a: XY, b: XY, ps: XY[]): boolean {
  if (!inside(a, ps) || !inside(b, ps)) return false;
  if (norm(a, b) < 1e-8) return true;
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    d = dx * dx + dy * dy;
  const cuts = [
    0,
    1,
    ...lineIntersect(lineString([a, b]), polygon([ring(ps)])).features.map(
      (f) =>
        ((f.geometry.coordinates[0] - a[0]) * dx +
          (f.geometry.coordinates[1] - a[1]) * dy) /
        d,
    ),
  ];
  // Collinear overlaps need explicit vertex cuts too.
  ps.forEach((p) => {
    if (pointSegment(p, a, b) < 1e-7)
      cuts.push(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / d);
  });
  cuts.sort((x, y) => x - y);
  return cuts.slice(1).every((t, i) => {
    const u = (cuts[i] + t) / 2;
    return inside([a[0] + u * dx, a[1] + u * dy], ps);
  });
}
export function areaM2(ps: XY[]) {
  return (
    Math.abs(
      ps.reduce((s, p, i) => {
        const q = ps[(i + 1) % ps.length];
        return s + p[0] * q[1] - q[0] * p[1];
      }, 0),
    ) / 2
  );
}
export function polygonError(ps: XY[]): string | null {
  if (ps.length < 3 || ps.length > 60) return 'Alan 3–60 köşe içermelidir.';
  if (ps.some((p) => !p.every(Number.isFinite)))
    return 'Alan koordinatları sonlu olmalıdır.';
  if (ps.some((p) => Math.hypot(...p) > 2000 + TOLERANCE_M))
    return 'Alan başlangıçtan en fazla 2 km uzakta olabilir.';
  if (ps.some((p, i) => ps.some((q, j) => i !== j && norm(p, q) < 1e-6)))
    return 'Tekrarlı köşeleri kaldırın.';
  if (kinks(polygon([ring(ps)])).features.length || areaM2(ps) < 1)
    return 'Alan kendini kesmemeli ve en az 1 m² olmalıdır.';
  return null;
}
export interface ValidationIssue {
  code: string;
  message: string;
  area?: 'allowed_area' | 'survey_area';
  waypoint_index?: number;
  segment_index?: number;
}
export interface Validation {
  valid: boolean;
  distance_m: number;
  issues: ValidationIssue[];
}
export function missionDistance(m: Mission) {
  const ps = [project(HOME), ...m.waypoints.map(project)];
  return ps.slice(1).reduce((s, p, i) => s + norm(ps[i], p), 0);
}
export function validatePlanning(m: Mission): Validation {
  const issues: ValidationIssue[] = [],
    distance_m = missionDistance(m);
  try {
    validateMission(m);
  } catch (e) {
    issues.push({ code: 'structure', message: String(e) });
    return { valid: false, distance_m, issues };
  }
  const p = m.planning;
  if (!p) return { valid: true, distance_m, issues };
  const fence = p.allowed_area.map(project),
    survey = p.survey_area.map(project);
  const fe = polygonError(fence),
    se = survey.length ? polygonError(survey) : null;
  if (fe) issues.push({ code: 'polygon', area: 'allowed_area', message: fe });
  if (se) issues.push({ code: 'polygon', area: 'survey_area', message: se });
  if (!fe) {
    if (!inside([0, 0], fence))
      issues.push({
        code: 'home_outside',
        message: 'Başlangıç noktası izin verilen alanın dışında.',
      });
    if (
      !se &&
      survey.length &&
      !edges(survey).every(([a, b]) => segmentInside(a, b, fence))
    )
      issues.push({
        code: 'survey_outside',
        area: 'survey_area',
        message: 'Tarama alanı izin verilen alanın içinde kalmalı.',
      });
    const route = [project(HOME), ...m.waypoints.map(project)];
    route.slice(1).forEach((b, i) => {
      if (!segmentInside(route[i], b, fence))
        issues.push({
          code: 'segment_outside',
          segment_index: i,
          message: `Rota parçası ${i + 1} izin verilen alanın dışına çıkıyor.`,
        });
    });
  }
  if (m.takeoff_altitude_m > p.max_altitude_m)
    issues.push({
      code: 'altitude',
      message: 'Kalkış irtifası görev sınırını aşıyor.',
    });
  m.waypoints.forEach((w, i) => {
    if (w.altitude_m > p.max_altitude_m)
      issues.push({
        code: 'altitude',
        waypoint_index: i,
        message: `Nokta ${i + 1} irtifa sınırını aşıyor.`,
      });
    if (Math.hypot(...project(w)) > 2000 + TOLERANCE_M)
      issues.push({
        code: 'range',
        waypoint_index: i,
        message: `Nokta ${i + 1} başlangıçtan 2 km sınırını aşıyor.`,
      });
  });
  if (distance_m > p.max_distance_m + TOLERANCE_M)
    issues.push({
      code: 'distance',
      message: 'Toplam rota mesafe sınırını aşıyor.',
    });
  return { valid: !issues.length, distance_m, issues };
}
function shortestPath(start: XY, end: XY, ps: XY[]): XY[] {
  if (segmentInside(start, end, ps)) return [start, end];
  const nodes = [start, end, ...ps],
    dist = nodes.map(() => Infinity),
    prev = nodes.map(() => -1),
    visited = new Set<number>();
  dist[0] = 0;
  while (visited.size < nodes.length) {
    let u = -1;
    nodes.forEach((_, i) => {
      if (!visited.has(i) && (u < 0 || dist[i] < dist[u])) u = i;
    });
    if (u < 0 || !Number.isFinite(dist[u])) break;
    if (u === 1) break;
    visited.add(u);
    nodes.forEach((v, i) => {
      if (!visited.has(i) && segmentInside(nodes[u], v, ps)) {
        const d = dist[u] + norm(nodes[u], v);
        if (d < dist[i] - 1e-8) {
          dist[i] = d;
          prev[i] = u;
        }
      }
    });
  }
  if (!Number.isFinite(dist[1]))
    throw Error('Alan içinde bağlantı rotası bulunamadı.');
  const path: XY[] = [];
  for (let i = 1; i >= 0; i = prev[i]) path.unshift(nodes[i]);
  return path;
}
export interface SurveyPreview {
  generation: NonNullable<Mission['generation']>;
  survey_distance_m: number;
  waypoints: Waypoint[];
  area_m2: number;
  line_count: number;
  segment_count: number;
  distance_m: number;
}
export function generateSurvey(m: Mission): SurveyPreview {
  validateMission(m);
  const p = m.planning;
  if (!p) throw Error('Alan planlamasını etkinleştirin.');
  const survey = p.survey_area.map(project),
    fence = p.allowed_area.map(project);
  for (const ps of [fence, survey]) {
    const err = polygonError(ps);
    if (err) throw Error(err);
  }
  if (
    !inside([0, 0], fence) ||
    !edges(survey).every(([a, b]) => segmentInside(a, b, fence))
  )
    throw Error('Başlangıç ve tarama alanı izin verilen alanın içinde olmalı.');
  if (p.altitude_m > p.max_altitude_m)
    throw Error('Tarama irtifası görev sınırını aşıyor.');
  const angle = (p.heading_deg * Math.PI) / 180;
  // u is across-track east at heading 0; v is along-track north.
  const rotate = ([x, y]: XY): XY => [
    x * Math.cos(angle) - y * Math.sin(angle),
    x * Math.sin(angle) + y * Math.cos(angle),
  ];
  const restore = ([u, v]: XY): XY => [
    u * Math.cos(angle) + v * Math.sin(angle),
    -u * Math.sin(angle) + v * Math.cos(angle),
  ];
  const rotated = survey.map(rotate),
    min = Math.min(...rotated.map((p) => p[0])),
    max = Math.max(...rotated.map((p) => p[0]));
  const count = Math.max(1, Math.ceil((max - min) / p.spacing_m)),
    step = (max - min) / count;
  if (count > 1000) throw Error('Çok fazla tarama hattı; aralığı büyütün.');
  const lines: [XY, XY][][] = [];
  for (let i = 0; i < count; i++) {
    const u = min + (i + 0.5) * step,
      ys: number[] = [];
    edges(rotated).forEach(([a, b]) => {
      if ((a[0] <= u && u < b[0]) || (b[0] <= u && u < a[0]))
        ys.push(a[1] + ((u - a[0]) * (b[1] - a[1])) / (b[0] - a[0]));
    });
    ys.sort((a, b) => a - b);
    const parts: [XY, XY][] = [];
    for (let j = 0; j + 1 < ys.length; j += 2)
      if (ys[j + 1] - ys[j] > 1e-6)
        parts.push([restore([u, ys[j]]), restore([u, ys[j + 1]])]);
    if (parts.length) lines.push(parts);
  }
  if (!lines.length) throw Error('Bu alan için tarama hattı üretilemedi.');
  if (lines.reduce((sum, parts) => sum + parts.length, 0) > 25)
    throw Error(
      'Rota 50 nokta sınırını aşıyor. Hat aralığını büyütün veya alanı küçültün.',
    );
  const candidates: {
    points: XY[];
    survey: [XY, XY][];
    surveyLegs: number[];
  }[] = [];
  for (const reverse of [false, true])
    for (const flip of [false, true]) {
      const rows = reverse ? [...lines].reverse() : lines;
      let route: XY[] = [];
      const surveyParts: [XY, XY][] = [];
      const tags: boolean[] = [];
      rows.forEach((parts, i) => {
        const backwards = (i % 2 === 1) !== flip;
        const ordered = backwards
          ? [...parts].reverse().map(([a, b]) => [b, a] as [XY, XY])
          : parts;
        ordered.forEach(([a, b]) => {
          surveyParts.push([a, b]);
          const path = shortestPath(
            route.at(-1) ?? [0, 0],
            a,
            route.length ? survey : fence,
          );
          route.push(...path.slice(1), b);
          tags.push(...path.slice(1).map(() => false), true);
        });
      });
      const kept = route.flatMap((v, i) =>
        i === 0 || norm(route[i - 1], v) > 1e-6 ? [i] : [],
      );
      route = kept.map((i) => route[i]);
      candidates.push({
        points: route,
        survey: surveyParts,
        surveyLegs: kept.flatMap((original, i) =>
          i > 0 && tags[original] ? [i] : [],
        ),
      });
    }
  const length = (r: XY[]) =>
    r.reduce((s, v, i) => s + norm(i ? r[i - 1] : [0, 0], v), 0);
  candidates.sort((a, b) => length(a.points) - length(b.points));
  const selected = candidates[0],
    chosen = selected.points;
  if (chosen.length > 50)
    throw Error(
      `Rota ${chosen.length} nokta gerektiriyor (sınır 50). Hat aralığını büyütün veya alanı küçültün.`,
    );
  const waypoints = chosen.map((v) => ({
    ...unproject(v),
    altitude_m: p.altitude_m,
  }));
  const result = validatePlanning({
    ...m,
    takeoff_altitude_m: p.altitude_m,
    waypoints,
  });
  if (!result.valid) throw Error(result.issues.map((i) => i.message).join(' '));
  return {
    generation: {
      waypoints: structuredClone(waypoints),
      takeoff_altitude_m: p.altitude_m,
      survey_leg_indices: selected.surveyLegs,
    },
    survey_distance_m: selected.survey.reduce(
      (sum, [a, b]) => sum + norm(a, b),
      0,
    ),
    waypoints,
    area_m2: areaM2(survey),
    line_count: lines.length,
    segment_count: lines.reduce((s, l) => s + l.length, 0),
    distance_m: result.distance_m,
  };
}
export type FenceState = 'unconfigured' | 'inside' | 'outside' | 'unknown';
export function fenceState(
  m: Mission | null | undefined,
  t: Telemetry,
): FenceState {
  if (!m?.planning) return 'unconfigured';
  if (
    t.connection !== 'connected' ||
    !t.position_fresh ||
    t.latitude === null ||
    t.longitude === null ||
    t.relative_altitude_m === null
  )
    return 'unknown';
  const fence = m.planning.allowed_area.map(project);
  if (polygonError(fence)) return 'unknown';
  return inside(
    project({ latitude: t.latitude, longitude: t.longitude }),
    fence,
  ) && t.relative_altitude_m <= m.planning.max_altitude_m + TOLERANCE_M
    ? 'inside'
    : 'outside';
}
export function fenceMetrics(m: Mission | null | undefined, rows: Telemetry[]) {
  let count = 0,
    seconds = 0,
    previous: FenceState = 'unknown';
  rows.forEach((row, i) => {
    const state = fenceState(m, row);
    if (state === 'outside' && previous !== 'outside') count++;
    if (i && state === 'outside' && previous === 'outside') {
      const dt = row.elapsed_s - rows[i - 1].elapsed_s;
      if (dt > 0 && dt <= 3) seconds += dt;
    }
    previous = state;
  });
  return { fence_violation_count: count, fence_observed_violation_s: seconds };
}
