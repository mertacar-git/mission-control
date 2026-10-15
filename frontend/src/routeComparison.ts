import { generateSurvey, project, type SurveyPreview } from './planning';
import { HOME, type Mission } from './types';

export interface Candidate {
  heading_deg: number;
  preview: SurveyPreview | null;
  error: string | null;
  turn_count: number | null;
  turn_angles_deg: number[];
  connector_distance_m: number | null;
  estimated_duration_s: number | null;
  backend_validated?: boolean;
}
export function compareRoutes(
  mission: Mission,
  speed = 5,
  turnDelay = 2,
): Candidate[] {
  if (
    !Number.isFinite(speed) ||
    speed < 1 ||
    speed > 15 ||
    !Number.isFinite(turnDelay) ||
    turnDelay < 0 ||
    turnDelay > 20
  )
    throw Error('Hız 1–15 m/s, dönüş beklemesi 0–20 s olmalı.');
  const headings = [
    ...new Set([
      ...Array.from({ length: 12 }, (_, i) => i * 15),
      mission.planning?.heading_deg ?? 0,
    ]),
  ].sort((a, b) => a - b);
  return headings.map((heading_deg) => {
    try {
      const preview = generateSurvey({
        ...mission,
        planning: mission.planning
          ? { ...mission.planning, heading_deg }
          : null,
      });
      const route = [HOME, ...preview.waypoints].map(project),
        angles: number[] = [];
      for (let i = 1; i < route.length - 1; i++) {
        const a = [
            route[i][0] - route[i - 1][0],
            route[i][1] - route[i - 1][1],
          ],
          b = [route[i + 1][0] - route[i][0], route[i + 1][1] - route[i][1]];
        const norm = Math.hypot(...a) * Math.hypot(...b);
        if (norm > 1e-8)
          angles.push(
            (Math.acos(
              Math.min(1, Math.max(-1, (a[0] * b[0] + a[1] * b[1]) / norm)),
            ) *
              180) /
              Math.PI,
          );
      }
      const turn_count = angles.filter((a) => a >= 10).length;
      return {
        heading_deg,
        preview,
        error: null,
        turn_count,
        turn_angles_deg: angles,
        connector_distance_m: Math.max(
          0,
          preview.distance_m - preview.survey_distance_m,
        ),
        estimated_duration_s:
          preview.distance_m / speed + turn_count * turnDelay,
      };
    } catch (e) {
      return {
        heading_deg,
        preview: null,
        error: String(e instanceof Error ? e.message : e),
        turn_count: null,
        turn_angles_deg: [],
        connector_distance_m: null,
        estimated_duration_s: null,
      };
    }
  });
}
export function rankCandidates(rows: Candidate[]) {
  return rows
    .filter((r) => r.preview && !r.error)
    .sort(
      (a, b) =>
        a.estimated_duration_s! - b.estimated_duration_s! ||
        a.preview!.distance_m - b.preview!.distance_m ||
        a.heading_deg - b.heading_deg,
    );
}
