export type ConnectionState =
  | 'closed'
  | 'connecting'
  | 'connected'
  | 'stale'
  | 'disconnected';
export type Action = 'arm' | 'start' | 'hold' | 'resume' | 'return' | 'land';
export interface Coordinate {
  latitude: number;
  longitude: number;
}
export interface Planning {
  allowed_area: Coordinate[];
  survey_area: Coordinate[];
  spacing_m: number;
  heading_deg: number;
  altitude_m: number;
  max_distance_m: number;
  max_altitude_m: number;
}
export type EditLayer = 'waypoints' | 'allowed_area' | 'survey_area';
export interface Waypoint extends Coordinate {
  altitude_m: number;
}
export interface Mission {
  generation?: {
    waypoints: Waypoint[];
    takeoff_altitude_m: number;
    survey_leg_indices: number[];
  } | null;
  schema_version: 1 | 2;
  planning?: Planning | null;
  id: string;
  name: string;
  takeoff_altitude_m: number;
  waypoints: Waypoint[];
}
export interface Telemetry {
  source: 'demo' | 'sitl';
  received_utc: string;
  elapsed_s: number;
  vehicle_time_ms: number | null;
  latitude: number | null;
  longitude: number | null;
  relative_altitude_m: number | null;
  ground_speed_ms: number | null;
  battery_pct: number | null;
  battery_voltage_v: number | null;
  flight_mode: string | null;
  armed: boolean | null;
  mission_index: number | null;
  position_fresh: boolean;
  navigation_ready?: boolean;
  gps_fix_type?: number | null;
  heartbeat_age_s: number | null;
  connection: ConnectionState;
}
export interface FlightEvent {
  type: string;
  received_utc: string;
  payload: Record<string, unknown>;
  sequence?: number;
}
export interface SessionInfo {
  id: string;
  name: string;
  started_utc: string;
  ended_utc: string | null;
  source: 'demo' | 'sitl';
  mission?: Mission | null;
}
export interface Recording {
  schema_version: 1;
  session: SessionInfo;
  events: FlightEvent[];
}
export interface Status {
  scenario_active?: boolean;
  state: ConnectionState;
  telemetry: Telemetry;
  recording_id: string | null;
  mission: Mission | null;
  upload_verified: boolean;
  events: FlightEvent[];
  event_sequence: number;
  simulator_owned: boolean;
  simulator_revision: string;
}
export interface Report {
  fence_violation_count?: number;
  fence_observed_violation_s?: number;
  samples: number;
  duration_s: number;
  peak_relative_altitude_m: number | null;
  peak_ground_speed_ms: number | null;
  battery_used_percentage_points: number | null;
  observed_ground_distance_m: number;
  max_route_deviation_m: number | null;
  recording_gaps: number;
  altitude_alert_samples: number;
  battery_alert_samples: number;
}
export const HOME = { latitude: 41.0082, longitude: 28.9784 };
export function newMission(): Mission {
  return {
    schema_version: 2,
    planning: null,
    id: crypto.randomUUID(),
    name: 'İstanbul · örnek görev',
    takeoff_altitude_m: 20,
    waypoints: [
      { latitude: 41.0085, longitude: 28.9784, altitude_m: 20 },
      { latitude: 41.0085, longitude: 28.9788, altitude_m: 20 },
      { latitude: 41.0082, longitude: 28.9788, altitude_m: 20 },
    ],
  };
}
export function emptyTelemetry(source: 'demo' | 'sitl' = 'demo'): Telemetry {
  return {
    source,
    received_utc: new Date().toISOString(),
    elapsed_s: 0,
    vehicle_time_ms: null,
    latitude: null,
    longitude: null,
    relative_altitude_m: null,
    ground_speed_ms: null,
    battery_pct: null,
    battery_voltage_v: null,
    flight_mode: null,
    armed: null,
    mission_index: null,
    position_fresh: false,
    heartbeat_age_s: null,
    connection: 'closed',
  };
}
export function validateMission(input: unknown): Mission {
  if (typeof input !== 'object' || !input)
    throw Error('Görev JSON nesnesi olmalıdır.');
  const m = input as Mission;
  if (
    ![1, 2].includes(m.schema_version) ||
    typeof m.id !== 'string' ||
    !m.id.length ||
    m.id.length > 80 ||
    typeof m.name !== 'string' ||
    !m.name.trim() ||
    m.name.length > 100
  )
    throw Error('Görev kimliği, adı veya sürümü geçersiz.');
  if (
    !Number.isFinite(m.takeoff_altitude_m) ||
    m.takeoff_altitude_m < 5 ||
    m.takeoff_altitude_m > 120
  )
    throw Error('Kalkış irtifası 5–120 m olmalıdır.');
  if (
    !Array.isArray(m.waypoints) ||
    m.waypoints.length < 1 ||
    m.waypoints.length > 50
  )
    throw Error('Görev 1–50 rota noktası içermelidir.');
  for (const w of m.waypoints)
    if (
      !w ||
      ![w.latitude, w.longitude, w.altitude_m].every(Number.isFinite) ||
      Math.abs(w.latitude) > 90 ||
      Math.abs(w.longitude) > 180 ||
      w.altitude_m < 5 ||
      w.altitude_m > 120
    )
      throw Error('Koordinatlar veya nokta irtifası geçersiz.');
  if (m.schema_version === 1 && m.planning != null)
    throw Error('Sürüm 1 alan planlama bilgisi içeremez.');
  if (m.planning != null) {
    const p = m.planning;
    for (const area of [p.allowed_area, p.survey_area])
      if (
        !Array.isArray(area) ||
        area.length > 60 ||
        area.some(
          (w) =>
            !w ||
            !Number.isFinite(w.latitude) ||
            !Number.isFinite(w.longitude) ||
            Math.abs(w.latitude) > 90 ||
            Math.abs(w.longitude) > 180,
        )
      )
        throw Error(
          'Alan koordinatları geçersiz; en fazla 60 köşe kullanılabilir.',
        );
    if (
      !Number.isFinite(p.spacing_m) ||
      p.spacing_m < 5 ||
      p.spacing_m > 200 ||
      !Number.isFinite(p.heading_deg) ||
      p.heading_deg < 0 ||
      p.heading_deg >= 180 ||
      !Number.isFinite(p.altitude_m) ||
      p.altitude_m < 5 ||
      p.altitude_m > 120 ||
      !Number.isFinite(p.max_distance_m) ||
      p.max_distance_m < 1 ||
      p.max_distance_m > 100000 ||
      !Number.isFinite(p.max_altitude_m) ||
      p.max_altitude_m < 5 ||
      p.max_altitude_m > 120
    )
      throw Error('Tarama ayarları veya görev sınırları geçersiz.');
  }
  if (m.generation != null) {
    const g = m.generation;
    if (
      m.schema_version !== 2 ||
      !g ||
      !Array.isArray(g.waypoints) ||
      g.waypoints.length < 1 ||
      g.waypoints.length > 50 ||
      !Number.isFinite(g.takeoff_altitude_m) ||
      g.takeoff_altitude_m < 5 ||
      g.takeoff_altitude_m > 120 ||
      g.waypoints.some(
        (w) =>
          !w ||
          ![w.latitude, w.longitude, w.altitude_m].every(Number.isFinite) ||
          Math.abs(w.latitude) > 90 ||
          Math.abs(w.longitude) > 180 ||
          w.altitude_m < 5 ||
          w.altitude_m > 120,
      ) ||
      !Array.isArray(g.survey_leg_indices) ||
      new Set(g.survey_leg_indices).size !== g.survey_leg_indices.length ||
      g.survey_leg_indices.some(
        (i) => !Number.isInteger(i) || i < 1 || i >= g.waypoints.length,
      )
    )
      throw Error('Tarama üretim bilgisi geçersiz.');
  }
  return {
    ...structuredClone(m),
    schema_version: 2,
    planning: m.planning ? structuredClone(m.planning) : null,
    generation: m.generation ? structuredClone(m.generation) : null,
  };
}

// Wire serializers may reorder properties. Mission identity must compare values,
// preserving array order while normalizing legacy version/nullable metadata.
export function missionFingerprint(mission: Mission): string {
  return JSON.stringify(
    {
      ...mission,
      schema_version: 2,
      planning: mission.planning ?? null,
      generation: mission.generation ?? null,
    },
    (_key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
          )
        : value,
  );
}
