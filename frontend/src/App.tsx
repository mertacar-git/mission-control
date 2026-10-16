import { useMissionDraft, moveWaypoint } from './missionDraft';
import { SurveyPlanner } from './components/SurveyPlanner';
import { fenceState, validatePlanning, defaultPlanning } from './planning';
import { missionFingerprint, type EditLayer, type Waypoint } from './types';
import { parseRecording } from './recording';
import { MissionEditor } from './components/MissionEditor';
import { RecordingArchive } from './components/RecordingArchive';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  Activity,
  ChevronRight,
  Compass,
  Database,
  MapPin,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Square,
  Wifi,
  X,
} from 'lucide-react';
import { FlightChart } from './components/TelemetryChart';
import { EventLog, eventLabel } from './components/EventLog';
import { IncidentInspector } from './components/IncidentInspector';
import { ScenarioLab } from './components/ScenarioLab';
import { ExecutionComparison } from './components/ExecutionComparison';
import { EmulatorLab } from './components/EmulatorLab';
import { SerialDevice } from './components/SerialDevice';
import { MissionReadiness } from './components/MissionReadiness';
import { missionStage, routeLength } from './missionPresentation';
import { MapView } from './MapView';
import { DemoVehicle, sampleRecording } from './demo';
import { api, subscribe } from './api';
import {
  analyze,
  download,
  frames,
  frameAt,
  eventsAt,
  toCSV,
} from './analysis';
import {
  emptyTelemetry,
  newMission,
  validateMission,
  type Mission,
  type Recording,
  type Status,
  type Telemetry,
  type Action,
  type FlightEvent,
} from './types';

type Page =
  | 'mission'
  | 'flight'
  | 'recordings'
  | 'analysis'
  | 'experiments'
  | 'emulator'
  | 'serial';
const names = {
  closed: 'Bağlantı kapalı',
  connecting: 'Bağlanıyor',
  connected: 'Bağlı',
  stale: 'Veri gecikmiş',
  disconnected: 'Bağlantı kesildi',
};
const initialStatus: Status = {
  state: 'closed',
  telemetry: emptyTelemetry(),
  recording_id: null,
  mission: null,
  upload_verified: false,
  events: [],
  event_sequence: 0,
  simulator_owned: false,
  simulator_revision: '—',
};
const actions: [Action, string][] = [
  ['arm', 'Arm'],
  ['start', 'Görevi başlat'],
  ['hold', 'Beklet'],
  ['resume', 'Devam et'],
  ['return', 'Eve dön'],
  ['land', 'İniş'],
];
const localAvailable = ['localhost', '127.0.0.1'].includes(location.hostname);
function readSaved<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
function value(number: number | null, unit = '', digits = 1) {
  return number === null
    ? '—'
    : number.toFixed(digits) + (unit ? ' ' + unit : '');
}
function stat(label: string, number: string, hint: string) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{number}</strong>
      <small>{hint}</small>
    </div>
  );
}
export default function App() {
  const { mission, setMission, undo, redo, canUndo, canRedo } = useMissionDraft(
    () => {
      try {
        return validateMission(readSaved('mc-draft-v1', newMission()));
      } catch {
        return newMission();
      }
    },
  );
  const [selectedWaypoint, setSelectedWaypoint] = useState(0);
  const [editLayer, setEditLayer] = useState<EditLayer>('waypoints');
  const [previewRoute, setPreviewRoute] = useState<Waypoint[] | null>(null);
  const [mapFocus, setMapFocus] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  function selectWaypoint(index: number) {
    setSelectedWaypoint(index);
    const point = mission.waypoints[index];
    if (point)
      setMapFocus({ latitude: point.latitude, longitude: point.longitude });
  }
  function reorderWaypoint(from: number, to: number) {
    if (!editing) return;
    setMission((previous) => moveWaypoint(previous, from, to));
    setSelectedWaypoint(to);
  }
  useEffect(() => {
    setSelectedWaypoint((index) =>
      Math.max(0, Math.min(index, mission.waypoints.length - 1)),
    );
  }, [mission.waypoints.length]);
  const operationPending = useRef(false);
  const [mode, setMode] = useState<'demo' | 'local'>(() =>
      ['localhost', '127.0.0.1'].includes(location.hostname) &&
      sessionStorage.getItem('mc-mode') === 'local'
        ? 'local'
        : 'demo',
    ),
    [page, setPage] = useState<Page>('mission'),
    [status, setStatus] = useState<Status>(initialStatus);
  const [missions, setMissions] = useState<Mission[]>(() =>
    readSaved('mc-missions-v1', []),
  );
  const [recordings, setRecordings] = useState<Recording[]>(() => {
    const raw = readSaved<unknown>('mc-recordings-v1', []);
    const data = (Array.isArray(raw) ? raw : []).flatMap((value) => {
      try {
        return [parseRecording(value)];
      } catch {
        return [];
      }
    });
    return [
      sampleRecording(newMission()),
      ...data.filter((r) => r?.session?.id !== 'sample-demo-flight'),
    ];
  });
  const [history, setHistory] = useState<Telemetry[]>([]),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [replay, setReplay] = useState<Recording | null>(null),
    [replayTime, setReplayTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<Recording | null>(null),
    [altThreshold, setAltThreshold] = useState(80),
    [batThreshold, setBatThreshold] = useState(20);
  const demo = useRef(new DemoVehicle()),
    fileMission = useRef<HTMLInputElement>(null),
    fileRecording = useRef<HTMLInputElement>(null),
    latest = useRef(status),
    replayRef = useRef(replay);
  const replayFrames = replay ? frames(replay) : [],
    replayEnd = replayFrames.at(-1)?.elapsed_s ?? 0;
  const shown = replay
    ? (frameAt(replayFrames, replayTime) ??
      emptyTelemetry(replay.session.source))
    : status.telemetry;
  const route =
    replay?.session.mission ??
    (page === 'mission' ? mission : (status.mission ?? mission));
  const trace = replay
    ? replayFrames.filter((r) => r.elapsed_s <= replayTime)
    : history;
  const editing =
    !busy && !replay && !status.telemetry.armed && !status.scenario_active;
  const uploadMatches =
    status.upload_verified &&
    status.mission !== null &&
    missionFingerprint(status.mission) === missionFingerprint(mission);
  const activeRecord = selected ?? replay ?? recordings[0] ?? null;
  const report = activeRecord
    ? analyze(activeRecord, altThreshold, batThreshold)
    : null;
  const chartRows = (
    page === 'analysis' && activeRecord ? frames(activeRecord) : trace
  ).slice(-1200);

  useEffect(() => {
    latest.current = status;
  }, [status]);
  useEffect(() => {
    replayRef.current = replay;
  }, [replay]);
  useEffect(() => {
    try {
      localStorage.setItem('mc-draft-v1', JSON.stringify(mission));
    } catch {
      setNotice(
        'Görev tarayıcıya kaydedilemedi; JSON ile dışa aktarabilirsiniz.',
      );
    }
  }, [mission]);
  function refreshDemo() {
    const state = demo.current.state;
    setStatus({
      ...state,
      telemetry: { ...state.telemetry },
      events: [...state.events],
    });
  }
  function persistRecording(recording: Recording) {
    setRecordings((previous) => {
      const next = [
        recording,
        ...previous.filter((r) => r.session.id !== recording.session.id),
      ];
      try {
        localStorage.setItem(
          'mc-recordings-v1',
          JSON.stringify(
            next.filter((r) => r.session.id !== 'sample-demo-flight'),
          ),
        );
      } catch {
        setNotice('Tarayıcı kayıt alanı dolu; kaydı JSON ile dışa aktarın.');
      }
      return next;
    });
    setSelected(recording);
  }
  useEffect(() => {
    if (mode !== 'demo') return;
    const timer = setInterval(() => {
      const vehicle = demo.current;
      if (vehicle.state.state === 'connected') {
        vehicle.tick(0.5);
        refreshDemo();
        setHistory((previous) =>
          [...previous, vehicle.state.telemetry].slice(-1800),
        );
      }
    }, 500);
    return () => clearInterval(timer);
  }, [mode]);
  useEffect(() => {
    if (mode !== 'local') return;
    void api
      .missions()
      .then(setMissions)
      .catch(() => {});
    let disposed = false,
      lastSequence = 0,
      ws: WebSocket | null = null;
    const receive = (event: FlightEvent) => {
      if (disposed) return;
      if (event.type === 'snapshot') {
        const next = event.payload as unknown as Status;
        if (lastSequence && next.event_sequence > lastSequence + 1)
          setNotice(
            'Yeniden bağlantı sırasında olay boşluğu var. Güncel backend durumu alındı; komut tekrarlanmadı.',
          );
        if (lastSequence && next.event_sequence < lastSequence)
          setNotice(
            'Backend yeniden başlatıldı; güncel durum alındı. Komutlar otomatik tekrarlanmaz.',
          );
        lastSequence = next.event_sequence;
        setStatus(next);
        return;
      }
      if (event.sequence && lastSequence && event.sequence > lastSequence + 1)
        setNotice(
          'Canlı olay akışında boşluk var. Backend kayıtları ayrıca korunur.',
        );
      lastSequence = event.sequence ?? lastSequence;
      if (event.type === 'telemetry') {
        const t = event.payload as unknown as Telemetry;
        setStatus((previous) => ({
          ...previous,
          telemetry: t,
          state: t.connection,
        }));
        setHistory((previous) => [...previous, t].slice(-1800));
      } else {
        setStatus((previous) => ({
          ...previous,
          events: [...previous.events, event].slice(-100),
        }));
        void api
          .status()
          .then((s) => {
            if (!disposed) setStatus(s);
          })
          .catch(() => {});
      }
    };
    const connectSocket = () => {
      ws = subscribe(receive, () => {
        if (!disposed)
          setNotice(
            'Backend olay akışı kapalı; bağlantı durumunu kontrol edin.',
          );
      });
    };
    void api
      .status()
      .then((s) => {
        if (!disposed) {
          setStatus(s);
          connectSocket();
        }
      })
      .catch(() => {
        if (!disposed)
          setNotice(
            'Yerel backend bulunamadı. simulator/run-backend.sh ile başlatın.',
          );
      });
    const timer = setInterval(() => {
      if (disposed) return;
      void api
        .status()
        .then((s) => {
          if (!disposed) setStatus(s);
        })
        .catch(() => {
          if (!disposed)
            setStatus((previous) => ({
              ...previous,
              state: 'disconnected',
              telemetry: {
                ...previous.telemetry,
                connection: 'disconnected',
                position_fresh: false,
                latitude: null,
                longitude: null,
                relative_altitude_m: null,
                ground_speed_ms: null,
                battery_pct: null,
                battery_voltage_v: null,
                flight_mode: null,
                armed: null,
                gps_fix_type: null,
                navigation_ready: false,
              },
            }));
        });
      if (latest.current.state !== 'closed')
        void api.renew().catch(() => api.claim().catch(() => {}));
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        connectSocket();
      }
    }, 2500);
    return () => {
      disposed = true;
      clearInterval(timer);
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      }
    };
  }, [mode]);
  useEffect(() => {
    if (!playing || !replay) return;
    const timer = setInterval(
      () =>
        setReplayTime((t) => {
          const next = Math.min(replayEnd, t + 0.1 * speed);
          if (next >= replayEnd) setPlaying(false);
          return next;
        }),
      100,
    );
    return () => clearInterval(timer);
  }, [playing, replay, replayEnd, speed]);
  async function perform(fn: () => Promise<void> | void) {
    if (operationPending.current) return;
    operationPending.current = true;
    setBusy(true);
    setNotice('');
    try {
      await fn();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      operationPending.current = false;
      setBusy(false);
    }
  }
  function changeMode(next: 'demo' | 'local') {
    if (next === mode) return;
    if (status.state !== 'closed') {
      setNotice('Mod değiştirmeden önce açık bağlantıyı kapatın.');
      return;
    }
    if (next === 'local' && !localAvailable) {
      setNotice(
        'Yerel SITL modu için projeyi bilgisayarınızda çalıştırın. Bu public yayın yalnızca tarayıcı demosudur. README kurulum adımlarını içerir.',
      );
      return;
    }
    setReplay(null);
    setPlaying(false);
    setHistory([]);
    setStatus({
      ...initialStatus,
      telemetry: emptyTelemetry(next === 'local' ? 'sitl' : 'demo'),
    });
    setMode(next);
    sessionStorage.setItem('mc-mode', next);
    setNotice('');
  }
  async function connect() {
    await perform(async () => {
      if (mode === 'demo') {
        demo.current = new DemoVehicle();
        demo.current.connect();
        refreshDemo();
        setHistory([]);
      } else {
        const s = await api.connect();
        setStatus(s);
        setHistory([]);
      }
    });
  }
  async function stopRecording() {
    if (mode === 'demo') {
      const r = demo.current.stopRecording();
      if (r) persistRecording(r);
      refreshDemo();
    } else {
      const result = await api.stopRecording();
      if (result.id) {
        const r = await api.recording(result.id);
        persistRecording(r);
      }
      setStatus(await api.status());
    }
  }
  async function disconnect() {
    await perform(async () => {
      if (status.recording_id) await stopRecording();
      if (mode === 'demo') {
        demo.current.disconnect();
        refreshDemo();
      } else setStatus(await api.disconnect());
      setHistory([]);
    });
  }
  async function saveMission() {
    await perform(async () => {
      const checked = validateMission(mission);
      let saved = checked;
      if (mode === 'local') saved = await api.save(checked);
      setMissions((previous) => {
        const next = [saved, ...previous.filter((m) => m.id !== saved.id)];
        localStorage.setItem('mc-missions-v1', JSON.stringify(next));
        return next;
      });
      setNotice('Görev kaydedildi.');
    });
  }
  async function uploadMission(approved?: Mission) {
    setBusy(true);
    setNotice('');
    try {
      const checked = validateMission(approved ?? mission);
      const validation = validatePlanning(checked);
      if (!validation.valid)
        throw Error(validation.issues.map((i) => i.message).join(' '));
      if (mode === 'demo') {
        demo.current.upload(checked);
        refreshDemo();
      } else {
        const remote = await api.validate(checked);
        if (!remote.valid)
          throw Error(remote.issues.map((i) => i.message).join(' '));
        await api.save(checked);
        await api.upload(checked.id);
        setStatus(await api.status());
      }
      setNotice(
        'Görev yükleme ve geri okuma doğrulandı' +
          (mode === 'demo' ? ' · demo modeli.' : '.'),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setBusy(false);
    }
  }
  async function startRecording() {
    if (mode === 'demo') {
      demo.current.startRecording(mission.name);
      refreshDemo();
    } else {
      await api.startRecording(mission.name);
      setStatus(await api.status());
    }
  }
  async function command(action: Action) {
    if (replayRef.current) {
      setNotice('Tekrar oynatmada canlı komutlar kapalıdır.');
      return;
    }
    await perform(async () => {
      if (action === 'start' && !status.recording_id) await startRecording();
      if (mode === 'demo') {
        demo.current.command(action);
        refreshDemo();
      } else {
        await api.command(action);
        setStatus(await api.status());
      }
      if (action === 'start') setPage('flight');
    });
  }
  function editWaypoint(
    index: number,
    field: 'latitude' | 'longitude' | 'altitude_m',
    v: number,
  ) {
    setMission((previous) => ({
      ...previous,
      waypoints: previous.waypoints.map((point, i) =>
        i === index ? { ...point, [field]: v } : point,
      ),
    }));
  }
  function addPoint(latitude = 41.0082, longitude = 28.9784) {
    if (!editing) return;
    if (mission.waypoints.length >= 50) {
      setNotice('En fazla 50 rota noktası ekleyebilirsiniz.');
      return;
    }
    setMission((previous) => ({
      ...previous,
      waypoints: [
        ...previous.waypoints,
        { latitude, longitude, altitude_m: previous.takeoff_altitude_m },
      ],
    }));
  }
  async function importFile(
    event: ChangeEvent<HTMLInputElement>,
    kind: 'mission' | 'recording',
  ) {
    const file = event.target.files?.[0];
    if (!file) return;
    await perform(async () => {
      if (file.size > 20_000_000) throw Error('Dosya 20 MB sınırını aşıyor.');
      const json = JSON.parse(await file.text());
      if (kind === 'mission') {
        if (!editing) throw Error('Görev düzenleme kilitli.');
        setMission(validateMission(json));
        setNotice('Görev JSON dosyası yüklendi.');
      } else {
        const r = parseRecording(json);
        persistRecording(r);
        setPage('recordings');
        setNotice('Kayıt içe aktarıldı.');
      }
    });
    event.target.value = '';
  }
  async function loadLocalRecordings() {
    await perform(async () => {
      const infos = await api.recordings();
      const loaded = await Promise.all(
        infos.map((info) => api.recording(info.id)),
      );
      setRecordings((previous) => [
        ...loaded,
        ...previous.filter(
          (r) => !loaded.some((s) => s.session.id === r.session.id),
        ),
      ]);
    });
  }
  function openReplay(recording: Recording) {
    setReplay(recording);
    setSelected(recording);
    setPlaying(false);
    setReplayTime(frames(recording)[0]?.elapsed_s ?? 0);
    setPage('flight');
    setNotice(
      'Tekrar oynatma açık. Canlı komutlar devre dışı; arka plandaki simülatör kendiliğinden durdurulmaz.',
    );
  }
  const events = replay ? eventsAt(replay, replayTime) : status.events;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="https://mertacar-git.github.io/portfolio/">
          <span className="brand-mark">
            <Compass size={22} />
          </span>
          <span>
            MISSION
            <br />
            <b>CONTROL</b>
          </span>
        </a>
        <div className="sidebar-label">ÇALIŞMA ALANI</div>
        <nav>
          {(
            [
              ['mission', 'Görev planlama', MapPin],
              ['flight', 'Uçuş takibi', Activity],
              ['recordings', 'Uçuş kayıtları', Database],
              ['analysis', 'Uçuş analizi', Compass],
              ['experiments', 'Senaryo laboratuvarı', Radio],
              ['emulator', 'Bilgisayar emülatörü', Database],
              ['serial', 'Seri cihaz', Radio],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              className={page === id ? 'active' : ''}
              onClick={() => setPage(id)}
            >
              <Icon size={17} />
              {label}
              {page === id && <ChevronRight size={15} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="source-label">OPERASYON ALANI</div>
          <p>
            Tek araç. Tek görev.
            <br />
            Planlama, izleme ve analiz.
          </p>
          <a
            href="https://github.com/mertacar-git/mission-control"
            target="_blank"
            rel="noreferrer"
          >
            Kaynak kodu & kurulum ↗
          </a>
          <span>v1.7 · ArduCopter 4.6.3</span>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            Çalışma alanı <ChevronRight size={13} />{' '}
            <strong>Mission Control</strong>
          </div>
          <div className="top-actions">
            {page==='serial'?<span>Bağımsız seri kaynak</span>:<>
            <div className="mode-picker">
              <button
                className={mode === 'demo' ? 'selected' : ''}
                onClick={() => changeMode('demo')}
              >
                Demo
              </button>
              <button
                className={mode === 'local' ? 'selected' : ''}
                onClick={() => changeMode('local')}
              >
                Yerel SITL
              </button>
            </div>
            <span className={'connection ' + status.state}>
              <i />
              {names[status.state]}
            </span>
            </>}
          </div>
        </header>
        <main>
          <section className="title-row">
            <div>
              <div className="eyebrow">
                {page === 'serial'
                  ? 'SERİ ALICI / AYRI VERİ KAYNAĞI'
                  : page === 'emulator'
                    ? 'EMÜLATÖR / AYRI TELEMETRİ KAYNAĞI'
                    : page === 'analysis' && activeRecord
                      ? activeRecord.session.source === 'sitl'
                        ? 'KAYDEDİLMİŞ SITL / UÇUŞ ANALİZİ'
                        : 'KAYDEDİLMİŞ DEMO / UÇUŞ ANALİZİ'
                      : replay
                        ? 'KAYDEDİLMİŞ UÇUŞ / TEKRAR OYNATMA'
                        : page === 'experiments' && mode === 'demo'
                          ? 'GERÇEK SITL / YAYIMLANMIŞ DENEY KAYITLARI'
                          : mode === 'demo'
                            ? 'TARAYICI DEMOSU / SİMÜLE VERİ'
                            : 'YEREL ARDUPILOT / CANLI SİMÜLATÖR'}
              </div>
              <h1>
                {page === 'serial'
                  ? 'Seri cihaz tezgâhı'
                  : page === 'mission'
                    ? 'Görev planlama'
                    : page === 'flight'
                      ? 'Uçuş kontrol merkezi'
                      : page === 'recordings'
                        ? 'Uçuş arşivi'
                        : page === 'emulator'
                          ? 'Uçuş bilgisayarı emülatörü'
                          : page === 'experiments'
                            ? 'Senaryo laboratuvarı'
                            : 'Uçuş analizi'}
              </h1>
              <p>
                {page === 'serial'
                  ? 'Windows seri alıcısı · bağımsız kayıt ve oynatma · uçuş komutu içermez.'
                  : page === 'emulator'
                    ? 'Sentetik sensörler · ayrı gönderici süreç · paket doğrulama ve tekrar oynatma.'
                    : page === 'analysis' && activeRecord
                      ? activeRecord.session.source === 'sitl'
                        ? 'Gerçek SITL kaydı · analiz kayıtlı ölçümleri kullanır.'
                        : 'Tarayıcı modeli kaydı · analiz kayıtlı örnekleri kullanır.'
                      : replay
                        ? replay.session.source === 'sitl'
                          ? 'Gerçek SITL kaydı · kayıtlı ölçümler inceleniyor.'
                          : 'Tarayıcı modeli kaydı inceleniyor.'
                        : page === 'experiments' && mode === 'demo'
                          ? 'Kontrollü hata senaryoları · gerçek gözlemler ve kabul raporları.'
                          : mode === 'demo'
                            ? 'Örnek araç modeli · tüm işlemler bu tarayıcıda çalışır.'
                            : 'ArduCopter 4.6.3 · uygulamanın başlattığı yerel simülatör.'}
              </p>
            </div>
            <div className="connection-actions">
              {['mission', 'flight'].includes(page) &&
                !replay &&
                status.state === 'closed' && (
                  <button
                    className="secondary"
                    onClick={() =>
                      openReplay(
                        recordings.find(
                          (r) => r.session.id === 'sample-demo-flight',
                        ) ?? recordings[0],
                      )
                    }
                  >
                    <Play size={15} />
                    Örnek uçuşu incele
                  </button>
                )}
              {status.state === 'closed' ? (
                !['mission', 'flight'].includes(page) ? null : (
                  <button
                    className="primary"
                    disabled={busy || !!replay || !!status.scenario_active}
                    onClick={() => void connect()}
                  >
                    <Wifi size={16} />
                    {mode === 'demo' ? 'Demoya bağlan' : 'SITL başlat & bağlan'}
                  </button>
                )
              ) : (
                <button
                  className="secondary"
                  disabled={busy || !!replay || !!status.scenario_active}
                  onClick={() => void disconnect()}
                >
                  <X size={16} />
                  {page==='serial'?(mode==='local'?'SITL oturumunu kapat':'Demo uçuş oturumunu kapat'):'Bağlantıyı kapat'}
                </button>
              )}
            </div>
          </section>
          {notice && (
            <div className="notice" role="status">
              <Radio size={16} />
              <span>{notice}</span>
              <button
                aria-label="Bildirimi kapat"
                onClick={() => setNotice('')}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {(page === 'mission' || page === 'flight') && (
            <>
              {page === 'mission' && status.state === 'closed' && !replay ? (
                <>
                  <div className="telemetry-caption">
                    <span>GÖREV ÖZETİ</span>
                    <span>Henüz araca gönderilmedi</span>
                  </div>
                  <div className="metrics">
                    {stat(
                      'ROTA NOKTASI',
                      String(mission.waypoints.length),
                      'Sıralı görev noktaları',
                    )}
                    {stat(
                      'PLANLANAN MESAFE',
                      routeLength(mission).toFixed(0) + ' m',
                      'Başlangıç noktası dahil',
                    )}
                    {stat(
                      'KALKIŞ İRTİFASI',
                      mission.takeoff_altitude_m + ' m',
                      'Eve göre planlanan irtifa',
                    )}
                    {stat('GÖREV SONU', 'İniş', 'Son rota noktasında')}
                  </div>
                </>
              ) : (
                <>
                  <div className="telemetry-caption">
                    <span>
                      <i className={replay ? 'replay-dot' : 'live-dot'} />
                      {replay ? 'KAYITTAN TELEMETRİ' : 'ARAÇ TELEMETRİSİ'}
                    </span>
                    <span>
                      {replay
                        ? replay.session.name
                        : status.recording_id
                          ? '● Uçuş kaydı alınıyor'
                          : 'Kayıt beklemede'}
                    </span>
                  </div>
                  <div className="metrics">
                    {stat(
                      'EVE GÖRE İRTİFA',
                      value(shown.relative_altitude_m, 'm'),
                      'm · eve göre',
                    )}
                    {stat(
                      'YER HIZI',
                      value(shown.ground_speed_ms, 'm/s'),
                      'm/s · yer referansı',
                    )}
                    {stat(
                      'BATARYA',
                      value(shown.battery_pct, '%', 0),
                      value(shown.battery_voltage_v, 'V', 2),
                    )}
                    {stat(
                      'UÇUŞ MODU',
                      shown.flight_mode ?? '—',
                      shown.armed === null
                        ? 'Durum bilinmiyor'
                        : shown.armed
                          ? 'ARMED · motorlar açık'
                          : mode === 'local'
                            ? shown.navigation_ready
                              ? 'DISARMED · EKF hazır'
                              : 'DISARMED · EKF bekleniyor'
                            : 'DISARMED',
                    )}
                  </div>
                </>
              )}
            </>
          )}
          {replay && page !== 'emulator' && page !== 'serial' && (
            <section className="replay-bar panel">
              <div>
                <strong>{replay.session.name}</strong>
                <span>
                  {replay.session.source === 'sitl'
                    ? 'Gerçek SITL kaydı'
                    : 'Demo kaydı'}{' '}
                  · canlı komutlar kapalı
                </span>
              </div>
              <button
                className="icon-button"
                aria-label={playing ? 'Oynatmayı duraklat' : 'Kaydı oynat'}
                onClick={() => setPlaying(!playing)}
              >
                {playing ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <input
                aria-label="Kayıt zaman çizelgesi"
                type="range"
                min={replayFrames[0]?.elapsed_s ?? 0}
                max={replayEnd}
                step="0.1"
                value={replayTime}
                onChange={(e) => setReplayTime(Number(e.target.value))}
              />
              <span>
                {Math.max(
                  0,
                  replayTime - (replayFrames[0]?.elapsed_s ?? 0),
                ).toFixed(1)}{' '}
                /{' '}
                {Math.max(
                  0,
                  replayEnd - (replayFrames[0]?.elapsed_s ?? 0),
                ).toFixed(1)}{' '}
                s
              </span>
              <select
                aria-label="Oynatma hızı"
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
              >
                <option value=".5">0,5×</option>
                <option value="1">1×</option>
                <option value="2">2×</option>
              </select>
              <button
                className="secondary small"
                onClick={() => {
                  setReplay(null);
                  setPlaying(false);
                  setNotice('');
                }}
              >
                Canlı görünüme dön
              </button>
            </section>
          )}
          {(page === 'mission' || page === 'flight') && (
            <div
              className={
                'workspace ' +
                (page === 'flight' ? 'flight-workspace' : 'planning-workspace')
              }
            >
              <div className="workspace-main">
                <MapView
                  onLayerChange={(key) => {
                    setEditLayer(key);
                    if (key !== 'waypoints' && !mission.planning)
                      setMission((m) => ({
                        ...m,
                        schema_version: 2,
                        planning: defaultPlanning(),
                      }));
                  }}
                  layer={
                    page === 'mission' && mission.planning
                      ? editLayer
                      : 'waypoints'
                  }
                  previewRoute={
                    page === 'mission' && !replay ? previewRoute : null
                  }
                  onAreaMove={(area, index, point) => {
                    if (editing)
                      setMission((m) => ({
                        ...m,
                        planning: m.planning
                          ? {
                              ...m.planning,
                              [area]: m.planning[area].map((v, i) =>
                                i === index ? point : v,
                              ),
                            }
                          : null,
                      }));
                  }}
                  selectedIndex={
                    replay || page !== 'mission' ? null : selectedWaypoint
                  }
                  focusPoint={replay ? null : mapFocus}
                  onSelect={selectWaypoint}
                  mission={route}
                  telemetry={shown}
                  trace={trace}
                  editing={editing && page === 'mission'}
                  onAdd={(lat, lon) => {
                    if (!editing) return;
                    if (mission.planning && editLayer !== 'waypoints') {
                      if (mission.planning[editLayer].length >= 60) {
                        setNotice('Alan en fazla 60 köşe içerebilir.');
                        return;
                      }
                      setMission((m) => ({
                        ...m,
                        planning: m.planning
                          ? {
                              ...m.planning,
                              [editLayer]: [
                                ...m.planning[editLayer],
                                { latitude: lat, longitude: lon },
                              ],
                            }
                          : null,
                      }));
                    } else addPoint(lat, lon);
                  }}
                  onMove={(index, lat, lon) =>
                    setMission((previous) => ({
                      ...previous,
                      waypoints: previous.waypoints.map((w, i) =>
                        i === index
                          ? { ...w, latitude: lat, longitude: lon }
                          : w,
                      ),
                    }))
                  }
                />
                {page === 'mission' && !replay && (
                  <SurveyPlanner
                    local={mode === 'local'}
                    mission={mission}
                    setMission={setMission}
                    layer={mission.planning ? editLayer : 'waypoints'}
                    setLayer={setEditLayer}
                    editing={editing}
                    onFocus={setMapFocus}
                    onPreview={setPreviewRoute}
                  />
                )}
                <section className="panel flight-actions">
                  <div>
                    <span className="eyebrow">UÇUŞ KONTROLLERİ</span>
                    <h2>
                      {replay
                        ? 'Kayıt inceleniyor'
                        : mode === 'local' && status.mission_lifecycle
                          ? ({
                              preparing: 'Hazırlık',
                              loaded: 'Görev yüklendi',
                              executing: 'Görev yürütülüyor',
                              holding: 'Görev bekletiliyor',
                              returning: 'Eve dönüş',
                              landing: 'İniş',
                              completed: 'Görev tamamlandı',
                              unknown: 'Görev durumu bilinmiyor',
                            }[status.mission_lifecycle.state] ??
                            'Görev durumu bilinmiyor')
                          : missionStage(shown, route.waypoints.length)}
                    </h2>
                  </div>
                  <div className="command-buttons">
                    {actions.map(([action, label]) => (
                      <button
                        key={action}
                        className={
                          action === 'start'
                            ? 'primary small'
                            : 'secondary small'
                        }
                        disabled={
                          busy ||
                          !!status.scenario_active ||
                          !!replay ||
                          status.state !== 'connected' ||
                          (mode === 'local' &&
                            ['arm', 'start', 'resume'].includes(action) &&
                            !status.preflight?.[
                              action as 'arm' | 'start' | 'resume'
                            ]?.ready) ||
                          (action === 'arm' && shown.armed === true) ||
                          (action === 'start' &&
                            (!uploadMatches ||
                              shown.armed !== true ||
                              shown.flight_mode === 'AUTO')) ||
                          (action === 'arm' &&
                            mode === 'local' &&
                            !shown.navigation_ready) ||
                          (['hold', 'resume', 'return', 'land'].includes(
                            action,
                          ) &&
                            shown.armed !== true)
                        }
                        onClick={() => void command(action)}
                      >
                        {action === 'start' ? (
                          <Play size={14} />
                        ) : action === 'hold' ? (
                          <Pause size={14} />
                        ) : action === 'return' ? (
                          <RotateCcw size={14} />
                        ) : null}
                        {label}
                      </button>
                    ))}
                  </div>
                  {mode === 'local' && status.last_command && (
                    <p>
                      Son komut:{' '}
                      {eventLabel({
                        type: 'command',
                        payload: status.last_command,
                        received_utc: '',
                      })}
                      . Komut kabulü görev tamamlanması değildir.
                    </p>
                  )}
                  <p>
                    Komut kabulü ve telemetride gözlenen durum ayrı izlenir.
                    Başlatma sırasında uçuş kaydı otomatik açılır.
                  </p>
                  <p
                    className={
                      'fence-state ' +
                      fenceState(
                        replay?.session.mission ?? status.mission,
                        shown,
                      )
                    }
                  >
                    Görev sınırı:{' '}
                    {
                      {
                        unconfigured: 'Tanımlanmadı',
                        inside: 'İçeride',
                        outside: 'İHLAL GÖZLENDİ',
                        unknown: 'Bilinmiyor / güncel ölçüm yok',
                      }[
                        fenceState(
                          replay?.session.mission ?? status.mission,
                          shown,
                        )
                      ]
                    }{' '}
                    · Otomatik komut gönderilmez.
                  </p>
                </section>
                <section className="panel chart-panel">
                  <div className="panel-head">
                    <div>
                      <span className="eyebrow">TELEMETRİ / SON ÖRNEKLER</span>
                      <h2>İrtifa ve yer hızı</h2>
                    </div>
                    <span className="muted">
                      {shown.source === 'demo' ? 'Demo verisi' : 'SITL ölçümü'}
                    </span>
                  </div>
                  <FlightChart
                    rows={replay ? replayFrames : chartRows}
                    cursor={replay ? replayTime : undefined}
                  />
                </section>
              </div>
              <div className="workspace-side">
                {!replay && (
                  <MissionReadiness
                    status={status}
                    matches={uploadMatches}
                    local={mode === 'local'}
                  />
                )}
                {page === 'mission' && !replay ? (
                  <MissionEditor
                    selectedIndex={selectedWaypoint}
                    onSelect={selectWaypoint}
                    onReorder={reorderWaypoint}
                    undo={undo}
                    redo={redo}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    busy={busy}
                    source={mode}
                    mission={mission}
                    missions={missions}
                    setMission={setMission}
                    editing={editing}
                    connected={status.state === 'connected'}
                    editWaypoint={editWaypoint}
                    addPoint={addPoint}
                    saveMission={saveMission}
                    uploadMission={uploadMission}
                    onImport={() => fileMission.current?.click()}
                    setNotice={setNotice}
                  />
                ) : (
                  <section className="panel editor">
                    <span className="eyebrow">UÇUŞ OTURUMU</span>
                    <h2>{route.name}</h2>
                    <p>
                      {route.waypoints.length} rota noktası ·{' '}
                      {route.takeoff_altitude_m} m kalkış
                    </p>
                    <div className="session-facts">
                      <span>
                        Geçen süre
                        <strong>{shown.elapsed_s.toFixed(1)} s</strong>
                      </span>
                      <span>
                        Görev indeksi
                        <strong>{shown.mission_index ?? '—'}</strong>
                      </span>
                      <span>
                        Konum
                        <strong>
                          {shown.position_fresh
                            ? 'Güncel'
                            : 'Gecikmiş / bilinmiyor'}
                        </strong>
                      </span>
                      <span>
                        Heartbeat yaşı
                        <strong>{value(shown.heartbeat_age_s, 's')}</strong>
                      </span>
                    </div>
                  </section>
                )}
                <EventLog events={events} />
              </div>
            </div>
          )}
          {page === 'recordings' && (
            <RecordingArchive
              recordings={recordings}
              local={mode === 'local'}
              busy={busy}
              onImport={() => fileRecording.current?.click()}
              onLoad={loadLocalRecordings}
              onReplay={openReplay}
              onAnalyze={(recording) => {
                setSelected(recording);
                setPage('analysis');
              }}
            />
          )}
          {replay && page === 'flight' && (
            <IncidentInspector
              recording={replay}
              time={replayTime}
              onSeek={(time) => {
                setPlaying(false);
                setReplayTime(
                  Math.max(
                    replayFrames[0]?.elapsed_s ?? 0,
                    Math.min(replayEnd, time),
                  ),
                );
              }}
            />
          )}
          {page === 'experiments' && (
            <ScenarioLab
              local={mode === 'local'}
              replaying={!!replay}
              onReplay={openReplay}
            />
          )}
          {page === 'emulator' && <EmulatorLab local={localAvailable} />}
          {page === 'serial' && <SerialDevice local={localAvailable} />}
          {page === 'analysis' && (
            <>
              {activeRecord && (
                <ExecutionComparison
                  recording={activeRecord}
                  recordings={recordings}
                  onReplay={openReplay}
                  onSelectRecording={setSelected}
                />
              )}
              <section className="panel analysis-head">
                <div>
                  <span className="eyebrow">KAYIT ANALİZİ</span>
                  <h2>{activeRecord?.session.name ?? 'Bir kayıt seçin'}</h2>
                  <p>
                    Yalnızca gözlenen, güncel ölçümler kullanılır. Veri
                    boşlukları uçuş izinde birleştirilmez.
                  </p>
                </div>
                <div className="thresholds">
                  <label>
                    İrtifa eşiği · m
                    <input
                      type="number"
                      value={altThreshold}
                      onChange={(e) =>
                        setAltThreshold(
                          Number.isFinite(Number(e.target.value))
                            ? Math.max(0, Math.min(120, Number(e.target.value)))
                            : 80,
                        )
                      }
                    />
                  </label>
                  <label>
                    Batarya eşiği · %
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={batThreshold}
                      onChange={(e) =>
                        setBatThreshold(
                          Number.isFinite(Number(e.target.value))
                            ? Math.max(0, Math.min(100, Number(e.target.value)))
                            : 20,
                        )
                      }
                    />
                  </label>
                </div>
              </section>
              {report && (
                <>
                  <div className="metrics analysis-metrics">
                    {stat(
                      'KAYIT SÜRESİ',
                      value(report.duration_s, 's'),
                      'Örnek zamanları arası',
                    )}
                    {stat(
                      'EN YÜKSEK İRTİFA',
                      value(report.peak_relative_altitude_m, 'm'),
                      'Eve göre irtifa',
                    )}
                    {stat(
                      'GÖZLENEN MESAFE',
                      value(report.observed_ground_distance_m, 'm'),
                      'Gecikmiş örnekler hariç',
                    )}
                    {stat(
                      'ROTA SAPMASI',
                      value(report.max_route_deviation_m, 'm'),
                      'Planlanan parçalara uzaklık',
                    )}
                  </div>
                  <section className="panel chart-panel">
                    <FlightChart rows={chartRows} />
                  </section>
                  <section className="panel report-details">
                    <div>
                      <span>
                        Görev sınırı ihlali
                        <strong>
                          {activeRecord?.session.mission?.planning
                            ? report.fence_violation_count
                            : '—'}
                        </strong>
                      </span>
                      <span>
                        Gözlenen ihlal süresi
                        <strong>
                          {activeRecord?.session.mission?.planning
                            ? value(report.fence_observed_violation_s ?? 0, 's')
                            : '—'}
                        </strong>
                      </span>
                      <span>
                        İrtifa uyarısı
                        <strong>{report.altitude_alert_samples} örnek</strong>
                      </span>
                      <span>
                        Batarya uyarısı
                        <strong>{report.battery_alert_samples} örnek</strong>
                      </span>
                      <span>
                        Veri boşluğu (&gt;3 s)
                        <strong>{report.recording_gaps}</strong>
                      </span>
                      <span>
                        Batarya değişimi
                        <strong>
                          {value(
                            report.battery_used_percentage_points,
                            'yüzde puan',
                          )}
                        </strong>
                      </span>
                    </div>
                    <p className="muted">
                      Rota sapması kısa görevler için yerel düzlem yaklaşımıdır;
                      kalkış noktası görev parçalarına dahil değildir. Yer hızı
                      ve eve göre irtifa farklı referanslardaki ölçümlerle
                      karıştırılmaz.
                    </p>
                    <div className="row-actions">
                      <button
                        className="primary small"
                        onClick={() =>
                          download(
                            'flight-report.json',
                            JSON.stringify(
                              {
                                ...report,
                                thresholds: {
                                  max_altitude_m: altThreshold,
                                  min_battery_pct: batThreshold,
                                },
                              },
                              null,
                              2,
                            ),
                          )
                        }
                      >
                        Rapor JSON indir
                      </button>
                      <button
                        className="secondary small"
                        onClick={() =>
                          download(
                            'flight-telemetry.csv',
                            toCSV(frames(activeRecord!)),
                            'text/csv',
                          )
                        }
                      >
                        Telemetri CSV indir
                      </button>
                      <button
                        className="secondary small"
                        onClick={() => openReplay(activeRecord!)}
                      >
                        Kaydı oynat
                      </button>
                    </div>
                  </section>
                </>
              )}
            </>
          )}
          <footer>
            <span>
              <i className={status.recording_id ? 'record-dot' : ''} />
              {status.recording_id ? 'Uçuş kaydı açık' : 'Uçuş kaydı kapalı'}
            </span>
            <div>
              {status.state === 'connected' && !replay && (
                <button
                  disabled={busy || !!status.scenario_active}
                  onClick={() =>
                    void perform(() =>
                      status.recording_id ? stopRecording() : startRecording(),
                    )
                  }
                >
                  {status.recording_id ? (
                    <Square size={12} />
                  ) : (
                    <Radio size={12} />
                  )}{' '}
                  {status.recording_id ? 'Kaydı durdur' : 'Kayıt başlat'}
                </button>
              )}
              <a
                href="https://github.com/mertacar-git/mission-control"
                target="_blank"
                rel="noreferrer"
              >
                Model, kurulum ve doğrulama ↗
              </a>
            </div>
            <span>Mert Açar · Mission Control</span>
          </footer>
          <input
            className="hidden"
            type="file"
            accept="application/json,.json"
            ref={fileMission}
            onChange={(e) => void importFile(e, 'mission')}
            aria-label="Görev JSON dosyası"
          />
          <input
            className="hidden"
            type="file"
            accept="application/json,.json"
            ref={fileRecording}
            onChange={(e) => void importFile(e, 'recording')}
            aria-label="Uçuş kaydı JSON dosyası"
          />
        </main>
      </div>
    </div>
  );
}
