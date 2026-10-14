import { describe, it, expect } from 'vitest';
import {
  newMission,
  validateMission,
  emptyTelemetry,
  type Recording,
} from './types';
import { DemoVehicle, sampleRecording } from './demo';
import {
  analyze,
  frames,
  frameAt,
  eventsAt,
  toCSV,
  distance,
  deviation,
} from './analysis';

describe('mission contracts', () => {
  it('rejects invalid altitude, coordinates and version', () => {
    expect(() =>
      validateMission({ ...newMission(), takeoff_altitude_m: 121 }),
    ).toThrow();
    const m = newMission();
    m.waypoints[0].latitude = 91;
    expect(() => validateMission(m)).toThrow();
    expect(() =>
      validateMission({ ...newMission(), schema_version: 2 }),
    ).toThrow();
    expect(() => validateMission({ ...newMission(), waypoints: [] })).toThrow();
  });
  it('returns a detached mission copy', () => {
    const m = newMission(),
      copy = validateMission(m);
    copy.waypoints[0].altitude_m = 30;
    expect(m.waypoints[0].altitude_m).toBe(20);
  });
});
describe('demo flight state machine', () => {
  it('requires connection, upload and arm before start', () => {
    const d = new DemoVehicle();
    expect(() => d.command('start')).toThrow();
    d.connect();
    expect(() => d.command('start')).toThrow();
    d.upload(newMission());
    expect(() => d.command('start')).toThrow();
  });
  it('runs a mission to landing and preserves a recording', () => {
    const r = sampleRecording(newMission()),
      rows = frames(r);
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.at(-1)!.armed).toBe(false);
    expect(rows.at(-1)!.relative_altitude_m).toBe(0);
    expect(analyze(r).peak_relative_altitude_m).toBe(20);
    expect(r.events.some((e) => e.type === 'mission_progress')).toBe(true);
  });
  it('hold stops route progress and resume restores it', () => {
    const d = new DemoVehicle();
    d.connect();
    d.upload(newMission());
    d.command('arm');
    d.command('start');
    for (let i = 0; i < 15; i++) d.tick(0.5);
    d.command('hold');
    const position = { ...d.position };
    for (let i = 0; i < 10; i++) d.tick(0.5);
    expect(d.position).toEqual(position);
    d.command('resume');
    d.tick(1);
    expect(d.position).not.toEqual(position);
  });
  it('does not allow mission replacement while armed', () => {
    const d = new DemoVehicle();
    d.connect();
    d.upload(newMission());
    d.command('arm');
    expect(() => d.upload(newMission())).toThrow();
  });
  it('reference flight samples are reproducible', () => {
    const mission = newMission(),
      a = frames(sampleRecording(mission)),
      b = frames(sampleRecording(mission));
    expect(a).toEqual(b);
  });
});
describe('replay and reporting', () => {
  it('aligns event time when recording starts after connection', () => {
    const r: Recording = {
      schema_version: 1,
      session: {
        id: 'x',
        name: 'x',
        source: 'sitl',
        started_utc: '2026-10-15T00:01:00Z',
        ended_utc: null,
      },
      events: [
        {
          type: 'telemetry',
          received_utc: '2026-10-15T00:01:01Z',
          payload: {
            ...emptyTelemetry('sitl'),
            received_utc: '2026-10-15T00:01:01Z',
            elapsed_s: 61,
          },
        },
        {
          type: 'command',
          received_utc: '2026-10-15T00:01:10Z',
          payload: { status: 'observed' },
        },
      ],
    };
    expect(eventsAt(r, 62)).toHaveLength(1);
    expect(eventsAt(r, 70)).toHaveLength(2);
  });
  it('rejects invalid report thresholds', () => {
    expect(() => analyze(sampleRecording(newMission()), 80, 101)).toThrow();
  });
  it('does not interpolate missing measurements across gaps', () => {
    const rows = [
      {
        ...emptyTelemetry(),
        elapsed_s: 0,
        latitude: 41,
        longitude: 29,
        relative_altitude_m: 20,
        position_fresh: true,
      },
      {
        ...emptyTelemetry(),
        elapsed_s: 10,
        latitude: 42,
        longitude: 30,
        relative_altitude_m: 30,
        position_fresh: true,
      },
    ];
    expect(frameAt(rows, 5)?.latitude).toBeNull();
    expect(frameAt(rows, 5)?.connection).toBe('stale');
    expect(frameAt(rows, 10)?.latitude).toBe(42);
    expect(frameAt(rows, -1)).toBeNull();
  });
  it('empty report preserves unknown values', () => {
    const r: Recording = {
      schema_version: 1,
      session: {
        id: 'x',
        name: 'x',
        source: 'demo',
        started_utc: '2026-10-15T00:00:00Z',
        ended_utc: null,
      },
      events: [],
    };
    expect(analyze(r).peak_relative_altitude_m).toBeNull();
    expect(analyze(r).battery_used_percentage_points).toBeNull();
  });
  it('CSV leaves null values empty', () => {
    const csv = toCSV([emptyTelemetry()]);
    expect(csv).not.toContain('null');
    expect(csv).not.toContain('undefined');
    expect(csv.split('\n')).toHaveLength(2);
  });
  it('distance and route deviation are meaningful', () => {
    expect(
      distance(
        { latitude: 0, longitude: 0 },
        { latitude: 0.0001, longitude: 0 },
      ),
    ).toBeCloseTo(11.1195, 3);
    expect(
      deviation({ latitude: 0, longitude: 0 }, [
        { latitude: 0, longitude: -0.001, altitude_m: 20 },
        { latitude: 0, longitude: 0.001, altitude_m: 20 },
      ]),
    ).toBe(0);
  });
  it('reads recorded data without changing live vehicle state', () => {
    const live = new DemoVehicle();
    live.connect();
    const before = structuredClone(live.state),
      recording = sampleRecording(newMission());
    for (let t = 0; t < 20; t++) frameAt(frames(recording), t);
    expect(live.state).toEqual(before);
  });
});
