import { frameAt, frames } from './analysis';
import type { FlightEvent, Recording, Telemetry } from './types';

export function eventTime(
  recording: Recording,
  event: FlightEvent,
): number | null {
  const first = recording.events.find((e) => e.type === 'telemetry')
    ?.payload as unknown as Telemetry | undefined;
  if (!first) return null;
  const t =
    first.elapsed_s +
    (Date.parse(event.received_utc) - Date.parse(first.received_utc)) / 1000;
  return Number.isFinite(t) ? t : null;
}

export function incidentEvents(recording: Recording) {
  return recording.events.filter(
    (e) =>
      e.type === 'scenario' ||
      (e.type === 'fence' &&
        ['outside', 'unknown'].includes(String(e.payload.state))) ||
      (e.type === 'connection' &&
        ['stale', 'disconnected', 'connected'].includes(
          String(e.payload.state),
        )) ||
      (e.type === 'command' &&
        ['failed', 'timed_out', 'not_observed'].includes(
          String(e.payload.status),
        )) ||
      (e.type === 'vehicle_message' &&
        typeof e.payload.severity === 'number' &&
        e.payload.severity <= 4),
  );
}

export function incidentContext(recording: Recording, at: number, radius = 10) {
  const rows = frames(recording);
  const first = rows[0];
  if (!first)
    return { frame: null, precedingCommand: null, events: [], samples: [] };
  const utc = Date.parse(first.received_utc) + (at - first.elapsed_s) * 1000;
  const precedingCommand =
    recording.events
      .filter((e) => e.type === 'command' && Date.parse(e.received_utc) <= utc)
      .at(-1) ?? null;
  return {
    frame: frameAt(rows, at),
    precedingCommand,
    events: recording.events.filter(
      (e) =>
        e.type !== 'telemetry' &&
        Math.abs(Date.parse(e.received_utc) - utc) <= radius * 1000,
    ),
    samples: rows.filter((r) => Math.abs(r.elapsed_s - at) <= radius),
  };
}
