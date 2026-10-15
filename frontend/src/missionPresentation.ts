import { distance } from './analysis';
import { HOME, type Mission, type Telemetry } from './types';

export function routeLength(mission: Mission): number {
  const route = [HOME, ...mission.waypoints];
  return route
    .slice(1)
    .reduce((sum, point, i) => sum + distance(route[i], point), 0);
}

export function missionStage(
  telemetry: Telemetry,
  waypointCount: number,
): string {
  if (telemetry.connection !== 'connected') return 'Bağlantı bekleniyor';
  if (telemetry.armed !== true) return 'Motorlar kapalı';
  if (['LOITER', 'BRAKE'].includes(telemetry.flight_mode ?? ''))
    return 'Görev bekletiliyor';
  if (telemetry.flight_mode === 'RTL') return 'Eve dönüş';
  if (telemetry.flight_mode === 'LAND') return 'İniş';
  if (telemetry.flight_mode !== 'AUTO') return 'Başlatma için hazır';
  const index = telemetry.mission_index;
  if (index === null) return 'Görev yürütülüyor · ilerleme bilinmiyor';
  const takeoffIndex = telemetry.source === 'sitl' ? 1 : 0;
  if (index <= takeoffIndex) return 'Kalkış';
  const waypoint = index - takeoffIndex;
  return waypoint > waypointCount
    ? 'İniş'
    : `Rota noktası ${waypoint} / ${waypointCount}`;
}
