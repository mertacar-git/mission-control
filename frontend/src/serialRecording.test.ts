import { expect, it } from 'vitest';
import raw from '../public/serial-bench/example.jsonl?raw';
import expected from '../../docs/verification/serial/results.json';
import golden from '../../prototype/golden-vectors.json';
import longClock from '../../prototype/long-clock-vector.json';
import sensorVector from '../../prototype/sensor-vector.json';
import sensorRaw from '../public/verification/mcs1-synthetic.jsonl?raw';
import windowsRaw from '../../docs/verification/phases/phase-4/windows-capture.jsonl?raw';
import windowsExpected from '../../docs/verification/phases/phase-4/windows-service.json';
import {
  decodeSerialPacket,
  parseSerialRecording,
  serialFrameAt,
} from './serialRecording';
import { parseRecording } from './recording';
it('matches sensor wire values, preserves uint64 time and excludes unmeasured flight fields', () => {
  const bytes = Uint8Array.from(sensorVector.packet_hex.match(/../g)!, (h) =>
    parseInt(h, 16),
  );
  const decoded = decodeSerialPacket(bytes);
  expect(decoded.source_time_ms).toBe('9007199254740993');
  expect(decoded.acceleration_z_ms2).toBe(9.75);
  expect(decoded.pressure_pa).toBe(101325);
  expect(decoded.latitude).toBeNull();
  expect(decoded.battery_voltage_v).toBeNull();
  bytes[50] ^= 1;
  expect(() => decodeSerialPacket(bytes)).toThrow('CRC');
});
it('replays sensor gaps, corrupt packets and stale samples without fabricating measurements', () => {
  const recording = parseSerialRecording(sensorRaw);
  expect(recording.summary.counts.accepted).toBe(99);
  expect(recording.summary.invalid_candidates).toBe(1);
  expect(recording.summary.counts.sequence_gaps).toBe(1);
  expect(recording.summary.telemetry).toBeNull();
  expect(
    serialFrameAt(recording, 1.8).telemetry?.acceleration_x_ms2,
  ).toBeNull();
  expect(serialFrameAt(recording, 1.8).telemetry?.temperature_c).toBe(23.5);
  expect(serialFrameAt(recording, 0).telemetry?.protocol).toBe('MCS1');
});
it('redecodes actual PTY raw bytes with Python-equivalent counters and null measurements', () => {
  const r = parseSerialRecording(raw);
  expect(r.summary.counts).toEqual(expected.result.counts);
  expect(r.summary.invalid_candidates).toBe(expected.result.invalid_candidates);
  expect(r.summary.discarded_bytes).toBe(expected.result.discarded_bytes);
  expect(r.summary.state).toBe('stale');
  expect(r.summary.telemetry).toBeNull();
  expect(serialFrameAt(r, 2.2).telemetry?.relative_altitude_m).toBeNull();
  expect(serialFrameAt(r, 3).telemetry?.battery_voltage_v).toBeCloseTo(12.4, 4);
  expect(serialFrameAt(r, 0).telemetry).toBeNull();
  expect(() => parseRecording(r)).toThrow();
});
it('replays a Windows service capture with the same receiver counters', () => {
  const r = parseSerialRecording(windowsRaw);
  expect(r.summary.counts).toEqual(windowsExpected.counts);
  expect(r.summary.invalid_candidates).toBe(windowsExpected.invalid_candidates);
  expect(r.summary.discarded_bytes).toBe(windowsExpected.discarded_bytes);
});
it('matches the shared C++/Python packet vector and rejects corrupt input', () => {
  const bytes = Uint8Array.from(golden.packet_hex.match(/../g)!, (h) =>
    parseInt(h, 16),
  );
  const frame = decodeSerialPacket(bytes);
  expect(frame.boot_id).toBe(2);
  expect(frame.sequence).toBe(17);
  expect(frame.relative_altitude_m).toBe(20.25);
  expect(frame.latitude).toBe(41.0082);
  expect(frame.source).toBe('serial');
  bytes[50] ^= 1;
  expect(() => decodeSerialPacket(bytes)).toThrow('CRC');
  expect(() => decodeSerialPacket(bytes.slice(0, 61))).toThrow();
});
it('rejects backwards or truncated raw recording events', () => {
  expect(() => parseSerialRecording(raw + '{bad')).toThrow();
  const lines = raw.trim().split('\n');
  const event = JSON.parse(lines.at(-1)!);
  event.elapsed_s = -1;
  lines[lines.length - 1] = JSON.stringify(event);
  expect(() => parseSerialRecording(lines.join('\n'))).toThrow('saati');
});
it('preserves the full uint64 clock without rounding it through a JS number', () => {
  const bytes = Uint8Array.from(longClock.packet_hex.match(/../g)!, (h) =>
    parseInt(h, 16),
  );
  expect(decodeSerialPacket(bytes).source_time_ms).toBe(
    longClock.source_time_ms,
  );
});
