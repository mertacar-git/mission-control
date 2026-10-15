import {
  HOME,
  emptyTelemetry,
  type Mission,
  type Recording,
  type Telemetry,
  type Action,
  type FlightEvent,
  type Status,
} from './types';
import { distance } from './analysis';
import { validatePlanning, fenceState, type FenceState } from './planning';

export class DemoVehicle {
  state: Status = {
    state: 'closed',
    telemetry: emptyTelemetry(),
    recording_id: null,
    mission: null,
    upload_verified: false,
    events: [],
    event_sequence: 0,
    simulator_owned: false,
    simulator_revision: 'Tarayıcı örnek modeli',
  };
  elapsed = 0;
  armed = false;
  phase = 'STABILIZE';
  progress = 0;
  altitude = 0;
  position = { ...HOME };
  battery = 100;
  recording: Recording | null = null;
  lastFenceState: FenceState | null = null;
  emit(type: string, payload: Record<string, unknown>) {
    const event: FlightEvent = {
      type,
      payload,
      received_utc: new Date().toISOString(),
      sequence: ++this.state.event_sequence,
    };
    if (type !== 'telemetry')
      this.state.events = [...this.state.events, event].slice(-100);
    this.recording?.events.push(event);
    return event;
  }
  connect() {
    this.state.state = 'connected';
    this.emit('connection', { state: 'connected' });
    this.tick(0);
  }
  disconnect() {
    this.state.state = 'closed';
    this.state.upload_verified = false;
    this.armed = false;
    this.phase = 'STABILIZE';
    this.emit('connection', { state: 'closed' });
    this.stopRecording();
    this.state.telemetry = emptyTelemetry();
  }
  upload(m: Mission) {
    const validation = validatePlanning(m);
    if (!validation.valid)
      throw Error(validation.issues.map((i) => i.message).join(' '));
    if (this.armed)
      throw Error('Görev değişikliği için sanal araç disarmed olmalıdır.');
    this.state.mission = structuredClone(m);
    this.state.upload_verified = true;
    this.progress = 0;
    this.emit('mission_transfer', { status: 'verified' });
  }
  command(action: Action) {
    if (this.state.state !== 'connected')
      throw Error('Önce demo bağlantısını açın.');
    if (['start', 'resume'].includes(action) && this.state.mission) {
      const validation = validatePlanning(this.state.mission);
      if (!validation.valid)
        throw Error(validation.issues.map((i) => i.message).join(' '));
    }
    const id = crypto.randomUUID();
    this.emit('command', { id, action, status: 'requested' });
    if (action === 'arm') this.armed = true;
    else if (action === 'start') {
      if (!this.armed || !this.state.upload_verified)
        throw Error('Önce görevi yükleyin ve arm edin.');
      this.phase = 'AUTO';
      this.progress = 0;
    } else if (action === 'hold') this.phase = 'BRAKE';
    else if (action === 'resume') {
      if (!this.armed || !this.state.upload_verified)
        throw Error('Devam ettirilecek aktif görev yok.');
      this.phase = 'AUTO';
    } else if (action === 'return') this.phase = 'RTL';
    else if (action === 'land') this.phase = 'LAND';
    this.emit('command', { id, action, status: 'acknowledged' });
    this.tick(0);
    this.emit('command', { id, action, status: 'observed' });
  }
  tick(dt: number) {
    if (this.state.state !== 'connected') return;
    this.elapsed += dt;
    let speed = 0;
    const mission = this.state.mission;
    if (this.armed && this.phase === 'AUTO' && mission) {
      if (this.progress === 0) {
        this.altitude = Math.min(
          mission.takeoff_altitude_m,
          this.altitude + 3 * dt,
        );
        if (this.altitude >= mission.takeoff_altitude_m) this.progress = 1;
      } else if (this.progress <= mission.waypoints.length) {
        const target = mission.waypoints[this.progress - 1],
          d = distance(this.position, target),
          f = d ? Math.min(1, (8 * dt) / d) : 1;
        this.position.latitude +=
          (target.latitude - this.position.latitude) * f;
        this.position.longitude +=
          (target.longitude - this.position.longitude) * f;
        this.altitude += (target.altitude_m - this.altitude) * Math.min(1, dt);
        speed = d > 0.5 ? 8 : 0;
        if (d < 1) {
          this.emit('mission_progress', { reached_index: this.progress });
          this.progress++;
        }
      } else this.phase = 'LAND';
    }
    if (this.armed && this.phase === 'RTL') {
      const d = distance(this.position, HOME),
        f = d ? Math.min(1, (8 * dt) / d) : 1;
      this.position.latitude += (HOME.latitude - this.position.latitude) * f;
      this.position.longitude += (HOME.longitude - this.position.longitude) * f;
      speed = d > 1 ? 8 : 0;
      if (d < 1) this.phase = 'LAND';
    }
    if (this.armed && this.phase === 'LAND') {
      this.altitude = Math.max(0, this.altitude - 2 * dt);
      if (this.altitude === 0) {
        this.armed = false;
        this.emit('vehicle_message', {
          text: 'Demo inişi tamamlandı; sanal araç disarmed.',
        });
      }
    }
    if (this.armed) this.battery = Math.max(0, this.battery - 0.08 * dt);
    const telemetry: Telemetry = {
      source: 'demo',
      received_utc: new Date().toISOString(),
      elapsed_s: this.elapsed,
      vehicle_time_ms: Math.round(this.elapsed * 1000),
      latitude: this.position.latitude,
      longitude: this.position.longitude,
      relative_altitude_m: this.altitude,
      ground_speed_ms: speed,
      battery_pct: this.battery,
      battery_voltage_v: 12.6 - (100 - this.battery) * 0.025,
      flight_mode: this.phase,
      armed: this.armed,
      mission_index: this.progress,
      position_fresh: true,
      heartbeat_age_s: 0,
      connection: this.state.state,
    };
    this.state.telemetry = telemetry;
    const state = fenceState(this.state.mission, telemetry);
    if (state !== this.lastFenceState) {
      this.lastFenceState = state;
      this.emit('fence', { state, mission_id: this.state.mission?.id ?? null });
    }
    if (dt > 0)
      this.emit('telemetry', telemetry as unknown as Record<string, unknown>);
  }
  startRecording(name: string) {
    if (this.recording) throw Error('Bir kayıt zaten açık.');
    const id = crypto.randomUUID();
    this.recording = {
      schema_version: 1,
      session: {
        id,
        name,
        started_utc: new Date().toISOString(),
        ended_utc: null,
        source: 'demo',
        mission: this.state.mission,
      },
      events: [],
    };
    this.state.recording_id = id;
    this.emit('recording', { status: 'started', id });
    return id;
  }
  stopRecording() {
    if (!this.recording) return null;
    this.emit('recording', {
      status: 'stopped',
      id: this.recording.session.id,
    });
    this.recording.session.ended_utc = new Date().toISOString();
    const recording = this.recording;
    this.recording = null;
    this.state.recording_id = null;
    return recording;
  }
}
export function sampleRecording(mission: Mission): Recording {
  const vehicle = new DemoVehicle();
  vehicle.connect();
  vehicle.upload(mission);
  vehicle.startRecording('Örnek görev · demo verisi');
  vehicle.command('arm');
  vehicle.command('start');
  for (let i = 0; i < 240; i++) {
    vehicle.tick(0.5);
    if (!vehicle.armed && vehicle.progress > 0) break;
  }
  const result = vehicle.stopRecording()!;
  // Fixed reference dates make the bundled example independent of the wall clock.
  const epoch = Date.parse('2026-10-15T09:00:00Z');
  result.session.id = 'sample-demo-flight';
  result.session.started_utc = new Date(epoch).toISOString();
  let elapsed = 0;
  for (const event of result.events) {
    if (event.type === 'telemetry') elapsed = Number(event.payload.elapsed_s);
    event.received_utc = new Date(epoch + elapsed * 1000).toISOString();
    if (event.type === 'telemetry')
      event.payload.received_utc = event.received_utc;
  }
  result.session.ended_utc = new Date(
    epoch + vehicle.elapsed * 1000,
  ).toISOString();
  return result;
}
