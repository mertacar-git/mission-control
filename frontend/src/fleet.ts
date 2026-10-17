/** Civilian fleet workflow simulator. No network, aircraft or actuator adapter. */
export type Observation = 'grounded' | 'airborne' | 'landing';
export type PermitKind = 'takeoff' | 'landing';
export type Role = 'station-a' | 'station-b' | 'center';
export interface Device {
  id: string;
  serial: string;
  name: string;
  model: string;
  firmware: string;
  station: Exclude<Role, 'center'>;
  equipment: string[];
}
export const devices: Device[] = [
  {
    id: 'demo-001',
    serial: 'SIM-FLW-0001',
    name: 'Örnek multikopter 01',
    model: 'Sivil multikopter',
    firmware: 'SIM 1.0',
    station: 'station-a',
    equipment: ['RGB kamera · SIM-CAM-01', 'IMU · SIM-IMU-01'],
  },
  {
    id: 'demo-002',
    serial: 'SIM-FLW-0002',
    name: 'Örnek VTOL 02',
    model: 'Sivil VTOL',
    firmware: 'SIM 1.0',
    station: 'station-a',
    equipment: ['RGB kamera · SIM-CAM-02', 'Basınç sensörü · SIM-BARO-02'],
  },
  {
    id: 'demo-003',
    serial: 'SIM-FLW-0003',
    name: 'Örnek multikopter 03',
    model: 'Sivil multikopter',
    firmware: 'SIM 1.0',
    station: 'station-b',
    equipment: ['Termal kamera · SIM-THERM-03', 'IMU · SIM-IMU-03'],
  },
];
export interface Sample {
  received: number;
  observation: Observation;
  battery: number | null;
}
export interface Permit {
  id: string;
  device: string;
  kind: PermitKind;
  requestedBy: Role;
  created: number;
  expires: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decidedBy: Role | null;
  reason: string;
}
export interface FleetEvent {
  at: number;
  actor: Role;
  type: string;
  device: string | null;
  detail: string;
}
export interface Fleet {
  schema_version: 1;
  source: 'browser-synthetic';
  stations: Record<'station-a' | 'station-b', boolean>;
  samples: Record<string, Sample>;
  permits: Permit[];
  events: FleetEvent[];
}
export function initialFleet(now: number): Fleet {
  return {
    schema_version: 1,
    source: 'browser-synthetic',
    stations: { 'station-a': true, 'station-b': true },
    samples: Object.fromEntries(
      devices.map((d, i) => [
        d.id,
        { received: now, observation: 'grounded', battery: 90 - i * 10 },
      ]),
    ),
    permits: [],
    events: [],
  };
}
export function freshness(sample: Sample | undefined, now: number) {
  if (!sample) return 'unknown';
  const age = now - sample.received;
  return age < 0
    ? 'unknown'
    : age < 3000
      ? 'fresh'
      : age < 10000
        ? 'stale'
        : 'disconnected';
}
export function permitStatus(permit: Permit, now: number) {
  return (permit.status === 'pending' || permit.status === 'approved') &&
    now >= permit.expires
    ? 'expired'
    : permit.status;
}
export function ingest(state: Fleet, now: number): Fleet {
  return {
    ...state,
    samples: Object.fromEntries(
      Object.entries(state.samples).map(([id, s]) => [
        id,
        state.stations[devices.find((d) => d.id === id)!.station]
          ? { ...s, received: now }
          : s,
      ]),
    ),
  };
}
function event(state: Fleet, row: FleetEvent): Fleet {
  return { ...state, events: [...state.events, row].slice(-500) };
}
export function stationConnection(
  state: Fleet,
  actor: Role,
  station: 'station-a' | 'station-b',
  online: boolean,
  now: number,
): Fleet {
  if (actor !== station)
    throw Error(
      'Yalnızca seçili istasyon kendi simülasyon bağlantısını değiştirebilir.',
    );
  return event(
    { ...state, stations: { ...state.stations, [station]: online } },
    {
      at: now,
      actor,
      type: 'station',
      device: null,
      detail: online
        ? 'İstasyon örnek akışı açıldı'
        : 'İstasyon örnek akışı kesildi',
    },
  );
}
export function requestPermit(
  state: Fleet,
  actor: Role,
  id: string,
  kind: PermitKind,
  now: number,
  permitId: string,
): Fleet {
  const device = devices.find((d) => d.id === id);
  if (!device || device.station !== actor)
    throw Error('Bu cihaz için yalnızca atanmış istasyon talep oluşturabilir.');
  if (
    state.permits.some(
      (p) =>
        p.device === id &&
        ['pending', 'approved'].includes(permitStatus(p, now)),
    )
  )
    throw Error('Cihazın açık bir talebi veya geçerli onayı var.');
  const permit: Permit = {
    id: permitId,
    device: id,
    kind,
    requestedBy: actor,
    created: now,
    expires: now + 120000,
    status: 'pending',
    decidedBy: null,
    reason: '',
  };
  return event(
    { ...state, permits: [permit, ...state.permits].slice(0, 100) },
    {
      at: now,
      actor,
      type: 'request',
      device: id,
      detail:
        kind === 'takeoff' ? 'Kalkış onayı istendi' : 'İniş onayı istendi',
    },
  );
}
export function decidePermit(
  state: Fleet,
  actor: Role,
  id: string,
  approve: boolean,
  reason: string,
  now: number,
): Fleet {
  if (actor !== 'center')
    throw Error('Kararı yalnızca merkez simülasyon rolü verebilir.');
  const permit = state.permits.find((p) => p.id === id);
  if (!permit || permitStatus(permit, now) !== 'pending')
    throw Error('Talep açık değil veya süresi dolmuş.');
  if (!reason.trim()) throw Error('Karar gerekçesi gerekli.');
  const sample = state.samples[permit.device];
  if (
    approve &&
    (!state.stations[devices.find((d) => d.id === permit.device)!.station] ||
      freshness(sample, now) !== 'fresh')
  )
    throw Error('Güncel ve bağlı örnek istasyon yok; onay verilemez.');
  if (
    approve &&
    (permit.kind === 'takeoff'
      ? sample.observation !== 'grounded'
      : sample.observation === 'grounded')
  )
    throw Error('Gözlenen durum talep türüne uygun değil.');
  const updated: Permit = {
    ...permit,
    status: approve ? 'approved' : 'rejected',
    decidedBy: actor,
    reason: reason.trim(),
  };
  return event(
    {
      ...state,
      permits: state.permits.map((p) => (p.id === id ? updated : p)),
    },
    {
      at: now,
      actor,
      type: 'decision',
      device: permit.device,
      detail: (approve ? 'Onaylandı: ' : 'Reddedildi: ') + reason.trim(),
    },
  );
}
export function cancelPermit(
  state: Fleet,
  actor: Role,
  id: string,
  now: number,
): Fleet {
  const permit = state.permits.find((p) => p.id === id);
  if (!permit || (actor !== 'center' && actor !== permit.requestedBy))
    throw Error('Bu talebi iptal etme rolünüz yok.');
  if (!['pending', 'approved'].includes(permitStatus(permit, now)))
    throw Error('Talep artık açık değil.');
  return event(
    {
      ...state,
      permits: state.permits.map((p) =>
        p.id === id ? { ...p, status: 'cancelled' } : p,
      ),
    },
    {
      at: now,
      actor,
      type: 'cancel',
      device: permit.device,
      detail: 'Talep/onay iptal edildi',
    },
  );
}
export function observe(
  state: Fleet,
  actor: Role,
  id: string,
  observation: Observation,
  now: number,
): Fleet {
  const device = devices.find((d) => d.id === id);
  if (!device || actor !== device.station)
    throw Error('Gözlemi yalnızca atanmış örnek istasyon değiştirebilir.');
  if (!state.stations[device.station]) throw Error('İstasyon akışı kapalı.');
  return event(
    {
      ...state,
      samples: {
        ...state.samples,
        [id]: { ...state.samples[id], received: now, observation },
      },
    },
    {
      at: now,
      actor,
      type: 'observation',
      device: id,
      detail: 'Ayrı simülasyon gözlemi: ' + observation,
    },
  );
}
