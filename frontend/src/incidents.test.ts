import { expect, it } from 'vitest';
import { incidentContext, incidentEvents, eventTime } from './incidents';
import { emptyTelemetry, type Recording, type FlightEvent } from './types';
import gpsEvidence from '../public/verification/gps_loss.json';
import batteryEvidence from '../public/verification/low_battery.json';
import { parseRecording } from './recording';
import { frameAt, frames } from './analysis';
const epoch = Date.parse('2026-10-15T10:00:00Z');
it('opens real fault recordings and aligns acceptance mode observations with replay', () => {
  for (const [evidence, label, mode] of [[gpsEvidence, 'Autopilot LAND', 'LAND'], [batteryEvidence, 'Autopilot RTL', 'RTL']] as const) {
    const recording = parseRecording(evidence);
    const observed = recording.events.find(e => e.type === 'scenario' && e.payload.label === label)!;
    expect(observed).toBeDefined();
    expect(frameAt(frames(recording), eventTime(recording, observed)!)?.flight_mode).toBe(mode);
  }
});
const utc = (t: number) => new Date(epoch + t * 1000).toISOString();
const telemetry = (t: number): FlightEvent => ({
  type: 'telemetry',
  received_utc: utc(t),
  payload: {
    ...emptyTelemetry('sitl'),
    elapsed_s: t + 40,
    received_utc: utc(t),
    position_fresh: true,
    latitude: 41,
    longitude: 29,
    relative_altitude_m: 10,
    battery_voltage_v: 12,
    flight_mode: 'AUTO',
    armed: true,
  },
});
const event = (
  t: number,
  type: string,
  payload: Record<string, unknown>,
): FlightEvent => ({ type, payload, received_utc: utc(t) });
const record = (events: FlightEvent[]): Recording => ({
  schema_version: 1,
  session: {
    id: 'test',
    name: 'Test',
    source: 'sitl',
    started_utc: utc(0),
    ended_utc: utc(15),
  },
  events,
});

it('aligns UTC with connection clock, including events before first telemetry', () => {
  const r = record([event(0, 'scenario', { status: 'started' }), telemetry(2)]);
  expect(eventTime(r, r.events[0])).toBe(40);
  expect(eventTime(r, r.events[1])).toBe(42);
});
it('finds preceding command without importing future commands', () => {
  const earlier = event(1, 'command', { action: 'start', status: 'observed' });
  const r = record([
    telemetry(0),
    earlier,
    telemetry(2),
    event(7, 'command', { action: 'return' }),
  ]);
  expect(incidentContext(r, 43).precedingCommand).toEqual(earlier);
  expect(incidentContext(r, 40).precedingCommand).toBeNull();
});
it('clears position, battery and mode across recording gaps', () => {
  const r = record([telemetry(0), telemetry(10)]),
    at = incidentContext(r, 45).frame!;
  expect(at.position_fresh).toBe(false);
  expect([
    at.latitude,
    at.battery_voltage_v,
    at.flight_mode,
    at.armed,
    at.gps_fix_type,
  ]).toEqual([null, null, null, null, null]);
  expect(incidentContext(r, 39).frame).toBeNull();
});
it('bounds context and selects failures and unknown measurements', () => {
  const r = record([
    telemetry(0),
    event(1, 'fence', { state: 'inside' }),
    event(2, 'fence', { state: 'outside' }),
    event(3, 'connection', { state: 'stale' }),
    event(4, 'command', { status: 'timed_out' }),
    event(5, 'vehicle_message', { severity: 4 }),
    event(30, 'scenario', { status: 'passed' }),
  ]);
  expect(incidentEvents(r)).toHaveLength(5);
  expect(incidentContext(r, 44).events).toHaveLength(5);
  expect(incidentContext(record([]), 0).frame).toBeNull();
  expect(eventTime(record([]), r.events[0])).toBeNull();
});
