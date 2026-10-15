import { validateMission, type Recording, type Telemetry } from './types';
export function parseRecording(input: unknown): Recording {
  const recording = input as Recording;
  if (
    !recording ||
    recording.schema_version !== 1 ||
    !recording.session ||
    !Array.isArray(recording.events) ||
    recording.events.length > 200000
  )
    throw Error('Kayıt sürümü veya olay listesi geçersiz.');
  if (
    !['demo', 'sitl'].includes(recording.session.source) ||
    typeof recording.session.id !== 'string' ||
    typeof recording.session.name !== 'string'
  )
    throw Error('Kayıt başlığı geçersiz.');
  if (recording.session.mission) validateMission(recording.session.mission);
  let previous = -Infinity;
  for (const event of recording.events) {
    if (
      typeof event.type !== 'string' ||
      !event.payload ||
      !Number.isFinite(Date.parse(event.received_utc))
    )
      throw Error('Kayıt olayı geçersiz.');
    if (event.type === 'telemetry') {
      const r = event.payload as unknown as Telemetry;
      if (
        !Number.isFinite(r.elapsed_s) ||
        r.elapsed_s < 0 ||
        r.elapsed_s < previous
      )
        throw Error('Telemetri zamanı sıralı ve sonlu olmalıdır.');
      previous = r.elapsed_s;
      if (
        r.gps_fix_type != null &&
        (!Number.isInteger(r.gps_fix_type) ||
          r.gps_fix_type < 0 ||
          r.gps_fix_type > 8)
      )
        throw Error('GPS fix alanı geçersiz.');
      for (const field of [
        'latitude',
        'longitude',
        'relative_altitude_m',
        'ground_speed_ms',
        'battery_pct',
        'battery_voltage_v',
        'vehicle_time_ms',
        'mission_index',
        'heartbeat_age_s',
      ] as const)
        if (r[field] !== null && !Number.isFinite(r[field]))
          throw Error('Telemetri alanları sayısal veya null olmalıdır.');
      if (
        r.source !== recording.session.source ||
        !Number.isFinite(Date.parse(r.received_utc)) ||
        typeof r.position_fresh !== 'boolean' ||
        (r.armed !== null && typeof r.armed !== 'boolean') ||
        (r.flight_mode !== null && typeof r.flight_mode !== 'string') ||
        ![
          'closed',
          'connecting',
          'connected',
          'stale',
          'disconnected',
        ].includes(r.connection)
      )
        throw Error('Telemetri kaynak ve durum alanları geçersiz.');
      if (
        (r.latitude !== null && Math.abs(r.latitude) > 90) ||
        (r.longitude !== null && Math.abs(r.longitude) > 180)
      )
        throw Error('Kayıt koordinatları geçersiz.');
    }
  }
  return structuredClone(recording);
}
