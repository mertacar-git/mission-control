import { describe, it, expect } from 'vitest';
import {
  initialFleet,
  requestPermit,
  decidePermit,
  cancelPermit,
  permitStatus,
  observe,
  stationConnection,
  ingest,
  freshness,
} from './fleet';
describe('civilian browser-only fleet workflow', () => {
  it('separates approval from observed aircraft state', () => {
    let state = requestPermit(
      initialFleet(0),
      'station-a',
      'demo-001',
      'takeoff',
      0,
      'permit-1',
    );
    expect(() =>
      decidePermit(state, 'station-b', 'permit-1', true, 'review', 1),
    ).toThrow('merkez');
    state = decidePermit(
      state,
      'center',
      'permit-1',
      true,
      'Simülasyon kontrol edildi',
      1,
    );
    expect(state.samples['demo-001'].observation).toBe('grounded');
    expect(state.permits[0].status).toBe('approved');
    state = observe(state, 'station-a', 'demo-001', 'airborne', 2);
    expect(state.samples['demo-001'].observation).toBe('airborne');
    expect(state.events.map((e) => e.type)).toEqual([
      'request',
      'decision',
      'observation',
    ]);
  });
  it('rejects foreign requests, duplicate open requests and empty review reasons', () => {
    const initial = initialFleet(0);
    expect(() =>
      requestPermit(initial, 'station-b', 'demo-001', 'takeoff', 0, 'p'),
    ).toThrow('atanmış');
    const state = requestPermit(
      initial,
      'station-a',
      'demo-001',
      'takeoff',
      0,
      'p',
    );
    expect(() =>
      requestPermit(state, 'station-a', 'demo-001', 'landing', 1, 'q'),
    ).toThrow('açık');
    expect(() => decidePermit(state, 'center', 'p', true, '  ', 1)).toThrow(
      'gerekçesi',
    );
  });
  it('expires pending and approved windows at the exact boundary', () => {
    const state = requestPermit(
      initialFleet(0),
      'station-a',
      'demo-001',
      'takeoff',
      0,
      'p',
    );
    expect(permitStatus(state.permits[0], 119999)).toBe('pending');
    expect(permitStatus(state.permits[0], 120000)).toBe('expired');
    const approved = decidePermit(state, 'center', 'p', true, 'review', 1);
    expect(permitStatus(approved.permits[0], 120000)).toBe('expired');
    expect(() =>
      decidePermit(state, 'center', 'p', true, 'review', 120000),
    ).toThrow('süresi');
  });
  it('preserves missing observations after station loss and only refreshes its own devices', () => {
    const offline = stationConnection(
      initialFleet(0),
      'station-a',
      'station-a',
      false,
      1,
    );
    const later = ingest(offline, 3000);
    expect(freshness(later.samples['demo-001'], 3000)).toBe('stale');
    expect(freshness(later.samples['demo-003'], 3000)).toBe('fresh');
    expect(freshness(later.samples['demo-001'], 10000)).toBe('disconnected');
    expect(freshness(later.samples['demo-001'], -1)).toBe('unknown');
    const pending = requestPermit(
      offline,
      'station-a',
      'demo-001',
      'takeoff',
      1,
      'p',
    );
    expect(() =>
      decidePermit(pending, 'center', 'p', true, 'review', 2),
    ).toThrow('bağlı');
    expect(() =>
      observe(offline, 'station-a', 'demo-001', 'airborne', 2),
    ).toThrow('kapalı');
  });
  it('requires observed state to match the request, while rejection remains possible', () => {
    const state = requestPermit(
      initialFleet(0),
      'station-a',
      'demo-001',
      'landing',
      0,
      'p',
    );
    expect(() => decidePermit(state, 'center', 'p', true, 'review', 1)).toThrow(
      'durum',
    );
    const rejected = decidePermit(
      state,
      'center',
      'p',
      false,
      'Araç yerde',
      10000,
    );
    expect(permitStatus(rejected.permits[0], 200000)).toBe('rejected');
  });
  it('restricts cancellation and allows a new request after expiry', () => {
    const state = requestPermit(
      initialFleet(0),
      'station-a',
      'demo-001',
      'takeoff',
      0,
      'p',
    );
    expect(() => cancelPermit(state, 'station-b', 'p', 1)).toThrow('rolünüz');
    expect(cancelPermit(state, 'center', 'p', 1).permits[0].status).toBe(
      'cancelled',
    );
    expect(
      requestPermit(state, 'station-a', 'demo-001', 'takeoff', 120000, 'q')
        .permits,
    ).toHaveLength(2);
  });
});
