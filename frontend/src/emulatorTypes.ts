export interface EmulatorFrame {
  source: 'emulator';
  stream_id: string;
  boot_id: number;
  sequence: number;
  source_time_ms: number;
  received_elapsed_s: number;
  received_utc: string;
  latitude: number | null;
  longitude: number | null;
  relative_altitude_m: number | null;
  ground_speed_ms: number | null;
  battery_voltage_v: number | null;
}
export interface EmulatorPacket {
  received_elapsed_s: number;
  received_utc: string;
  classification: string;
  error: string | null;
  frame: EmulatorFrame | null;
  raw_hex: string;
  datagram_bytes: number;
}
export interface EmulatorRun {
  schema_version: 1;
  source: 'emulator';
  id: string;
  profile: string;
  seed: number;
  rate_hz: number;
  duration_s: number;
  status: string;
  expected_packets: number;
  started_utc: string;
  ended_utc: string | null;
  error: string | null;
  counters: Record<string, number>;
  packets: EmulatorPacket[];
  latest?: EmulatorFrame | null;
  stream_state?: string;
}
export function emulatorFrameAt(
  run: EmulatorRun,
  seconds: number,
): EmulatorFrame | null {
  const sample = run.packets
    .filter(
      (p) => p.classification === 'accepted' && p.received_elapsed_s <= seconds,
    )
    .at(-1);
  return sample && seconds - sample.received_elapsed_s < 3
    ? sample.frame
    : null;
}
