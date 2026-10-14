import { describe, expect, it } from 'vitest';
import { parseRecording } from './recording';
import { newMission, emptyTelemetry } from './types';
import { sampleRecording } from './demo';
describe('recording import boundary', () => {
  it('imports a detached recording and preserves null measurements', () => {
    const recording = sampleRecording(newMission());
    recording.events.push({
      type: 'telemetry',
      received_utc: recording.session.ended_utc!,
      payload: { ...emptyTelemetry(), elapsed_s: 100 },
    });
    const imported = parseRecording(recording);
    expect(imported).not.toBe(recording);
    expect(imported.events.at(-1)!.payload.latitude).toBeNull();
  });
  it('rejects unsupported schema and reversed telemetry time', () => {
    const recording = sampleRecording(newMission());
    expect(() => parseRecording({ ...recording, schema_version: 2 })).toThrow();
    const last = [...recording.events]
      .reverse()
      .find((event) => event.type === 'telemetry')!;
    last.payload.elapsed_s = -1;
    expect(() => parseRecording(recording)).toThrow();
  });
  it('rejects malformed numeric data instead of treating it as measurement', () => {
    const recording = sampleRecording(newMission());
    recording.events.find(
      (event) => event.type === 'telemetry',
    )!.payload.latitude = '41';
    expect(() => parseRecording(recording)).toThrow();
  });
});
