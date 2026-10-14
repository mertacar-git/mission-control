import { describe, expect, it } from 'vitest';
import { missionStage, routeLength } from './missionPresentation';
import { emptyTelemetry, newMission } from './types';
import { DemoVehicle } from './demo';
describe('operator presentation', () => {
  it('requires a fresh upload after the demo connection closes', () => {
    const vehicle = new DemoVehicle();
    vehicle.connect();
    vehicle.upload(newMission());
    vehicle.disconnect();
    expect(vehicle.state.upload_verified).toBe(false);
    expect(vehicle.state.telemetry.latitude).toBeNull();
  });
  const active = {
    ...emptyTelemetry('sitl'),
    connection: 'connected' as const,
    armed: true,
    flight_mode: 'AUTO',
  };
  it('distinguishes SITL home/takeoff indices from browser waypoint indices', () => {
    expect(missionStage({ ...active, mission_index: 1 }, 3)).toBe('Kalkış');
    expect(missionStage({ ...active, mission_index: 2 }, 3)).toBe(
      'Rota noktası 1 / 3',
    );
    expect(
      missionStage({ ...active, source: 'demo', mission_index: 1 }, 3),
    ).toBe('Rota noktası 1 / 3');
    expect(missionStage({ ...active, mission_index: 5 }, 3)).toBe('İniş');
  });
  it('does not declare success from unknown or disarmed telemetry', () => {
    expect(missionStage({ ...active, mission_index: null }, 3)).toContain(
      'bilinmiyor',
    );
    expect(missionStage({ ...active, armed: false, mission_index: 1 }, 3)).toBe(
      'Motorlar kapalı',
    );
    expect(missionStage({ ...active, connection: 'stale' }, 3)).toBe(
      'Bağlantı bekleniyor',
    );
  });
  it('shows hold and return before interpreting mission indices', () => {
    expect(
      missionStage({ ...active, flight_mode: 'LOITER', mission_index: 2 }, 3),
    ).toBe('Görev bekletiliyor');
    expect(
      missionStage({ ...active, flight_mode: 'RTL', mission_index: 2 }, 3),
    ).toBe('Eve dönüş');
  });
  it('includes home-to-first-point in planning distance', () => {
    const plan = newMission();
    expect(routeLength(plan)).toBeGreaterThan(90);
    expect(routeLength(plan)).toBeLessThan(110);
  });
});
