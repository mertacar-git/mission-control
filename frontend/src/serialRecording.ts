/** MCT1 byte-stream replay, isolated from flight recordings and command APIs. */
export interface SerialTelemetry {
  protocol?: 'MCT1' | 'MCS1';
  firmware_code?: number | null;
  acceleration_x_ms2?: number | null;
  acceleration_y_ms2?: number | null;
  acceleration_z_ms2?: number | null;
  angular_velocity_x_rads?: number | null;
  angular_velocity_y_rads?: number | null;
  angular_velocity_z_rads?: number | null;
  temperature_c?: number | null;
  pressure_pa?: number | null;
  humidity_percent?: number | null;
  source: 'serial';
  stream_id: string;
  boot_id: number;
  sequence: number;
  source_time_ms: number | string;
  latitude: number | null;
  longitude: number | null;
  relative_altitude_m: number | null;
  ground_speed_ms: number | null;
  battery_voltage_v: number | null;
}
export interface SerialSnapshot {
  elapsed_s: number;
  state: 'fresh' | 'stale' | 'unknown';
  age_s: number | null;
  telemetry: SerialTelemetry | null;
  counts: Record<string, number>;
  discarded_bytes: number;
  invalid_candidates: number;
}
export interface SerialRecording {
  raw: string;
  header: Record<string, unknown>;
  timeline: SerialSnapshot[];
  summary: SerialSnapshot;
}
export function decodeSerialPacket(bytes: Uint8Array): SerialTelemetry {
  const magic = String.fromCharCode(...bytes.slice(0, 4));
  const sensor = magic === 'MCS1';
  const size = sensor ? 82 : 62;
  if (bytes.length !== size) throw Error('Paket uzunluğu geçersiz.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let crc = 0xffffffff;
  for (const b of bytes.slice(0, size - 4)) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  if ((crc ^ 0xffffffff) >>> 0 !== view.getUint32(size - 4, true))
    throw Error('CRC');
  if (
    (magic !== 'MCT1' && magic !== 'MCS1') ||
    bytes[4] !== 1 ||
    bytes[5] & 0xf0
  )
    throw Error('Sürüm veya bayrak');
  const flags = bytes[5],
    lat = view.getInt32(38, true) / 1e7,
    lon = view.getInt32(42, true) / 1e7;
  if (!sensor && flags & 1 && (Math.abs(lat) > 90 || Math.abs(lon) > 180))
    throw Error('Konum');
  const measurement = (at: number, flag: number, low: number, high: number) => {
    if (!(flags & flag)) return null;
    const value = view.getFloat32(at, true);
    if (!Number.isFinite(value) || value < low || value > high)
      throw Error('Ölçüm');
    return value;
  };
  const clock = view.getBigUint64(30, true);
  const sourceTime =
    clock <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(clock) : clock.toString();
  return {
    source: 'serial',
    protocol: sensor ? 'MCS1' : 'MCT1',
    ...(sensor
      ? {
          firmware_code: view.getUint32(38, true),
          acceleration_x_ms2: measurement(42, 1, -200, 200),
          acceleration_y_ms2: measurement(46, 1, -200, 200),
          acceleration_z_ms2: measurement(50, 1, -200, 200),
          angular_velocity_x_rads: measurement(54, 1, -40, 40),
          angular_velocity_y_rads: measurement(58, 1, -40, 40),
          angular_velocity_z_rads: measurement(62, 1, -40, 40),
          temperature_c: measurement(66, 2, -40, 85),
          pressure_pa: measurement(70, 4, 30000, 110000),
          humidity_percent: measurement(74, 8, 0, 100),
        }
      : {}),
    stream_id: Array.from(bytes.slice(6, 22), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join(''),
    boot_id: view.getUint32(22, true),
    sequence: view.getUint32(26, true),
    source_time_ms: sourceTime,
    latitude: !sensor && flags & 1 ? lat : null,
    longitude: !sensor && flags & 1 ? lon : null,
    relative_altitude_m: sensor ? null : measurement(46, 2, -1000, 20000),
    ground_speed_ms: sensor ? null : measurement(50, 4, 0, 500),
    battery_voltage_v: sensor ? null : measurement(54, 8, 0, 100),
  };
}

export function parseSerialRecording(raw: string): SerialRecording {
  if (raw.length > 64 * 1024 * 1024)
    throw Error('64 MB görüntüleme sınırı aşıldı.');
  const lines = raw.trim().split(/\r?\n/);
  if (lines.length > 200000) throw Error('Kayıt satır sınırı aşıldı.');
  const header = JSON.parse(lines[0]);
  if (
    header.format !== 'mission-control-serial' ||
    header.version !== 1 ||
    header.source !== 'serial'
  )
    throw Error('Seri kayıt biçimi desteklenmiyor.');
  const buffer: number[] = [];
  let discarded = 0,
    invalid = 0,
    stream: string | null = null,
    boot: number | null = null,
    sequence = -1,
    sourceMs = -1n,
    latest: SerialTelemetry | null = null,
    receivedAt: number | null = null,
    elapsed = 0;
  const counts: Record<string, number> = {
      accepted: 0,
      late_or_duplicate: 0,
      foreign: 0,
      clock_regression: 0,
      sequence_gaps: 0,
    },
    timeline: SerialSnapshot[] = [];
  function snapshot(t: number): SerialSnapshot {
    const age = receivedAt === null ? null : t - receivedAt;
    return {
      elapsed_s: t,
      state: age === null ? 'unknown' : age <= 3 ? 'fresh' : 'stale',
      age_s: age,
      telemetry: age !== null && age <= 3 ? latest : null,
      counts: { ...counts },
      discarded_bytes: discarded,
      invalid_candidates: invalid,
    };
  }
  function accept(frame: SerialTelemetry) {
    if (stream !== null && frame.stream_id !== stream) {
      counts.foreign++;
      return;
    }
    if (
      boot !== null &&
      (frame.boot_id < boot ||
        (frame.boot_id === boot && frame.sequence <= sequence))
    ) {
      counts.late_or_duplicate++;
      return;
    }
    if (boot === frame.boot_id && BigInt(frame.source_time_ms) < sourceMs) {
      counts.clock_regression++;
      return;
    }
    if (boot === frame.boot_id)
      counts.sequence_gaps += Math.max(0, frame.sequence - sequence - 1);
    stream = frame.stream_id;
    boot = frame.boot_id;
    sequence = frame.sequence;
    sourceMs = BigInt(frame.source_time_ms);
    latest = frame;
    receivedAt = elapsed;
    counts.accepted++;
  }
  for (const line of lines.slice(1)) {
    const row = JSON.parse(line);
    if (
      typeof row.elapsed_s !== 'number' ||
      !Number.isFinite(row.elapsed_s) ||
      row.elapsed_s < elapsed
    )
      throw Error('Kayıt saati geçersiz.');
    elapsed = row.elapsed_s;
    if (row.kind === 'bytes') {
      if (
        typeof row.hex !== 'string' ||
        row.hex.length % 2 ||
        !/^[0-9a-f]*$/i.test(row.hex)
      )
        throw Error('Ham bayt kaydı geçersiz.');
      for (let i = 0; i < row.hex.length; i += 2) {
        buffer.push(parseInt(row.hex.slice(i, i + 2), 16));
        while (buffer.length >= 4) {
          if (
            buffer[0] !== 77 ||
            buffer[1] !== 67 ||
            (buffer[2] !== 84 && buffer[2] !== 83) ||
            buffer[3] !== 49
          ) {
            buffer.shift();
            discarded++;
            continue;
          }
          const size = buffer[2] === 83 ? 82 : 62;
          if (buffer.length < size) break;
          let frame: SerialTelemetry;
          try {
            frame = decodeSerialPacket(Uint8Array.from(buffer.slice(0, size)));
          } catch {
            invalid++;
            discarded++;
            buffer.shift();
            continue;
          }
          buffer.splice(0, size);
          accept(frame);
        }
      }
    } else if (row.kind === 'connected' || row.kind === 'disconnected') {
      buffer.splice(0);
      receivedAt = null;
    } else if (row.kind !== 'frame' && row.kind !== 'stopped')
      throw Error('Kayıt olay türü desteklenmiyor.');
    if (row.kind !== 'frame') timeline.push(snapshot(elapsed));
  }
  return { raw, header, timeline, summary: snapshot(elapsed) };
}

export function serialFrameAt(
  recording: SerialRecording,
  t: number,
): SerialSnapshot {
  let low = 0,
    high = recording.timeline.length - 1,
    index = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (recording.timeline[middle].elapsed_s <= t) {
      index = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  if (index < 0)
    return {
      ...recording.summary,
      elapsed_s: t,
      state: 'unknown',
      age_s: null,
      telemetry: null,
      counts: {},
    };
  const row = recording.timeline[index],
    age = row.age_s === null ? null : row.age_s + t - row.elapsed_s;
  return {
    ...row,
    elapsed_s: t,
    age_s: age,
    state: age === null ? 'unknown' : age <= 3 ? 'fresh' : 'stale',
    telemetry: age !== null && age <= 3 ? row.telemetry : null,
  };
}
