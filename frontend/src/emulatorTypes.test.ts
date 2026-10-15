import { expect, it } from 'vitest';
import { emulatorFrameAt, type EmulatorRun } from './emulatorTypes';
import { parseRecording } from './recording';
it('isolates emulator playback, ignores corrupt packets and expires stale readings', () => {
  const frame = { source: 'emulator', relative_altitude_m: 20 } as const;
  const run = {
    packets: [
      { classification: 'accepted', received_elapsed_s: 1, frame },
      { classification: 'corrupt', received_elapsed_s: 2, frame: null },
    ],
  } as unknown as EmulatorRun;
  expect(emulatorFrameAt(run, 0)).toBeNull();
  expect(emulatorFrameAt(run, 2)?.source).toBe('emulator');
  expect(emulatorFrameAt(run, 4)).toBeNull();
  expect(() =>
    parseRecording({
      schema_version: 1,
      session: { source: 'emulator', id: 'x', name: 'Not a flight' },
      events: [],
    }),
  ).toThrow();
});
