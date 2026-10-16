import { useEffect, useState } from 'react';
import { controller } from '../api';
import { download } from '../analysis';
import {
  parseSerialRecording,
  serialFrameAt,
  type SerialRecording,
  type SerialTelemetry,
} from '../serialRecording';
interface SerialRun {
  id: string;
  port: string;
  baud: number;
  experiment: string;
  status: string;
  transport: string;
  started_utc: string;
  error?: string | null;
}
interface SerialStatus {
  source: 'serial';
  transport: 'synthetic' | 'pyserial';
  control_owned: boolean;
  run: SerialRun | null;
  state: string;
  connection: string;
  age_s: number | null;
  telemetry: SerialTelemetry | null;
  counts: Record<string, number>;
  discarded_bytes: number;
  invalid_candidates: number;
}
interface SerialPort {
  port: string;
  description: string;
  serial_number: string | null;
}
const base = 'http://127.0.0.1:8767';
const labels: Record<string, string> = {
  fresh: 'Güncel',
  stale: 'Gecikmiş',
  unknown: 'Bilinmiyor',
  connecting: 'Bağlanıyor',
  connected: 'Bağlı',
  disconnected: 'Bağlantı kesildi',
  closed: 'Kapalı',
  running: 'Kayıt alınıyor',
  completed: 'Kayıt kapandı',
  failed: 'Başarısız',
  interrupted: 'Kesintiye uğradı',
};
export function SerialDevice({ local }: { local: boolean }) {
  const [draftToken, setDraftToken] = useState(''),
    [token, setToken] = useState(''),
    [status, setStatus] = useState<SerialStatus | null>(null),
    [ports, setPorts] = useState<SerialPort[]>([]),
    [port, setPort] = useState(''),
    [baud, setBaud] = useState(115200),
    [experiment, setExperiment] = useState('Tezgâh deneyi'),
    [duration, setDuration] = useState(10),
    [profile, setProfile] = useState('mixed'),
    [archive, setArchive] = useState<SerialRun[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [replay, setReplay] = useState<SerialRecording | null>(null),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1);
  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    key = token,
    raw = false,
  ) {
    const response = await fetch(base + '/api/v1/serial' + path, {
      method,
      signal: AbortSignal.timeout(raw ? 10000 : 3000),
      headers: {
        Authorization: 'Bearer ' + key,
        'X-Control-Session': controller(),
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const message = await response.text();
      throw Error(
        response.status === 401 ? 'Alıcı erişim anahtarı geçersiz.' : message,
      );
    }
    return raw ? response.text() : response.json();
  }
  async function perform(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function connectReceiver() {
    await perform(async () => {
      const key = draftToken.trim();
      if (!key)
        throw Error('Windows alıcısının terminalindeki anahtarı girin.');
      const [next, available, recordings] = await Promise.all([
        request('/status', 'GET', undefined, key),
        request('/ports', 'GET', undefined, key),
        request('/recordings', 'GET', undefined, key),
      ]);
      setStatus(next);
      setPorts(available);
      setPort(available[0]?.port ?? '');
      setArchive(recordings);
      setToken(key);
      setDraftToken('');
    });
  }
  useEffect(() => {
    if (!token || !local) return;
    let disposed = false;
    let ws: WebSocket | null = null;
    const openSocket = () => {
      const socket = new WebSocket('ws://127.0.0.1:8767/ws/serial');
      ws = socket;
      socket.onopen = () =>
        socket.send(JSON.stringify({ token, session: controller() }));
      socket.onmessage = (e) => {
        try {
          const message = JSON.parse(e.data);
          if (message.type === 'serial_snapshot' && !disposed)
            setStatus(message.payload);
        } catch {
          if (!disposed) setError('Alıcı anlık durum mesajı okunamadı.');
        }
      };
      socket.onclose = () => {
        if (!disposed) setStatus(null);
      };
    };
    openSocket();
    const timer = setInterval(() => {
      void (async () => {
        try {
          if (!ws || ws.readyState === WebSocket.CLOSED) openSocket();
          const next: SerialStatus = await request('/status');
          if (disposed) return;
          setStatus(next);
          if (next.control_owned && next.run?.status === 'running')
            await request('/control/renew', 'POST');
          const recordings: SerialRun[] = await request('/recordings');
          if (!disposed) setArchive(recordings);
        } catch {
          if (!disposed) {
            setStatus(null);
            setError(
              'Alıcı bağlantısı doğrulanamadı; servis ve erişim anahtarını kontrol edin. Canlı ölçüm bilinmiyor.',
            );
          }
        }
      })();
    }, 2500);
    return () => {
      disposed = true;
      clearInterval(timer);
      if (ws) {
        ws.onmessage = null;
        ws.onclose = null;
        ws.close();
      }
    };
  }, [token, local]);
  useEffect(() => {
    if (!playing || !replay) return;
    const timer = setInterval(
      () =>
        setTime((t) => {
          const next = Math.min(replay.summary.elapsed_s, t + 0.1 * speed);
          if (next >= replay.summary.elapsed_s) setPlaying(false);
          return next;
        }),
      100,
    );
    return () => clearInterval(timer);
  }, [playing, replay, speed]);
  function open(raw: string) {
    setReplay(parseSerialRecording(raw));
    setTime(0);
    setPlaying(false);
  }
  const shown = replay ? serialFrameAt(replay, time) : status;
  const telemetry = shown?.telemetry;
  const counts = replay ? replay.summary.counts : (status?.counts ?? {});
  const value = (n: number | null | undefined, unit = '') =>
    n == null ? '—' : n.toFixed(2) + unit;
  return (
    <section className="panel serial-device">
      <div className="panel-head">
        <div>
          <span className="eyebrow">
            SERİ KAYNAK / UÇUŞ KONTROLÜNDEN BAĞIMSIZ
          </span>
          <h2>Seri cihaz tezgâhı</h2>
        </div>
        <span className="count">
          {replay
            ? 'KAYIT OYNATMA'
            : status?.transport === 'synthetic'
              ? 'SENTETİK TEST'
              : status
                ? 'YEREL SERİ ALICI'
                : 'BAĞLANTI YOK'}
        </span>
      </div>
      <p>
        Ham MCT1 baytları CRC ve sıra kontrolünden geçer. Eksik sensörler boş
        kalır. Seri alıcı uçuş komutu göndermez.
      </p>
      {local ? (
        <>
          <div className="serial-settings">
            <label>
              Alıcı erişim anahtarı
              <input
                type="password"
                autoComplete="off"
                value={draftToken}
                onChange={(e) => setDraftToken(e.target.value)}
              />
            </label>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void connectReceiver()}
            >
              Alıcıya bağlan
            </button>
          </div>
          <p>
            Windows’ta <code>simulator/run-serial.ps1</code> ile başlatın.
            Anahtar yalnızca bu ekranın belleğinde tutulur; sayfa yenilendiğinde
            tekrar girilir.
          </p>
        </>
      ) : (
        <p>
          Public demo örnek kayıt oynatır. USB bağlantısı için yerel uygulamayı
          ve Windows alıcısını çalıştırın.
        </p>
      )}
      {status && local && (
        <>
          <p>
            Alıcı: {labels[status.connection] ?? status.connection} ·{' '}
            {status.transport === 'synthetic'
              ? 'Bilgisayar test akışı; seri sürücüsü ve fiziksel sensör kullanılmıyor.'
              : 'Seçilen yerel port okunur. Sensör doğruluğu ayrıca doğrulanmalıdır.'}
          </p>
          <div className="serial-settings">
            <label>
              Seri port
              <select
                value={port}
                disabled={status.run?.status === 'running'}
                onChange={(e) => setPort(e.target.value)}
              >
                {ports.map((p) => (
                  <option key={p.port} value={p.port}>
                    {p.port} · {p.description}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Baud
              <select
                value={baud}
                onChange={(e) => setBaud(Number(e.target.value))}
              >
                {[9600, 57600, 115200, 230400].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Deney açıklaması
              <input
                value={experiment}
                maxLength={200}
                onChange={(e) => setExperiment(e.target.value)}
              />
            </label>
            <label>
              Kayıt süresi · s
              <input
                type="number"
                min={1}
                max={status.transport==='synthetic'?60:3600}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </label>
            {status.transport === 'synthetic' && (
              <label>
                Test profili
                <select
                  value={profile}
                  onChange={(e) => setProfile(e.target.value)}
                >
                  <option value="nominal">Hatasız</option>
                  <option value="mixed">CRC / sıra / tekrar</option>
                  <option value="sensor_gap">Sensör boşluğu</option>
                </select>
              </label>
            )}
          </div>
          <div className="row-actions">
            <button
              disabled={busy || !port || status.run?.status === 'running'}
              onClick={() =>
                void perform(async () => {
                  setStatus(
                    await request('/connection', 'POST', {
                      port,
                      baud,
                      experiment,
                      duration_s: duration,
                      ...(status.transport === 'synthetic'
                        ? { test_profile: profile }
                        : {}),
                    }),
                  );
                  setReplay(null);
                })
              }
            >
              Okumayı ve kaydı başlat
            </button>
            <button
              disabled={
                busy ||
                !status.control_owned ||
                status.run?.status !== 'running'
              }
              onClick={() =>
                void perform(async () =>
                  setStatus(await request('/connection', 'DELETE')),
                )
              }
            >
              Okumayı ve kaydı durdur
            </button>
            <button
              disabled={busy || status.control_owned}
              onClick={() =>
                void perform(async () =>
                  setStatus(await request('/control/claim', 'POST')),
                )
              }
            >
              Seri kontrolünü al
            </button>
          </div>
          {status.run && (
            <p>
              {status.run.experiment} ·{' '}
              {labels[status.run.status] ?? status.run.status}
              {status.run.error ? ' · ' + status.run.error : ''}
            </p>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="serial-metrics">
        {[
          ['Durum', labels[shown?.state ?? 'unknown'] ?? 'Bilinmiyor'],
          ['Ölçüm yaşı', value(shown?.age_s, ' s')],
          ['Göreli irtifa', value(telemetry?.relative_altitude_m, ' m')],
          ['Yer hızı', value(telemetry?.ground_speed_ms, ' m/s')],
          ['Gerilim', value(telemetry?.battery_voltage_v, ' V')],
          ['Enlem', telemetry?.latitude ?? '—'],
          ['Boylam', telemetry?.longitude ?? '—'],
          [
            'Açılış / sıra',
            telemetry ? `${telemetry.boot_id} / ${telemetry.sequence}` : '—',
          ],
          ['Cihaz zamanı', telemetry ? telemetry.source_time_ms + ' ms' : '—'],
        ].map(([name, v]) => (
          <div key={name}>
            <small>{name}</small>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      <h3>Paket kalitesi</h3>
      <p>
        {replay
          ? 'Sayaçlar kaydın tamamını kapsar.'
          : 'Sayaçlar etkin alıcı koşusuna aittir.'}{' '}
        Cihaz zamanı ve alınma zamanı farklı saatlerdir; tek yönlü gecikme
        çıkarılmaz.
      </p>
      <pre>
        {JSON.stringify(
          {
            ...counts,
            invalid_candidates:
              replay?.summary.invalid_candidates ??
              status?.invalid_candidates ??
              null,
            discarded_bytes:
              replay?.summary.discarded_bytes ?? status?.discarded_bytes ?? null,
          },
          null,
          2,
        )}
      </pre>
      <div className="row-actions">
        <button
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              const response = await fetch(
                import.meta.env.BASE_URL + 'serial-bench/example.jsonl',
                { cache: 'no-store' },
              );
              if (!response.ok) throw Error('Örnek seri kayıt alınamadı.');
              open(await response.text());
            })
          }
        >
          Sentetik seri kayıt örneğini aç
        </button>
        {replay && (
          <button
            onClick={() => {
              setReplay(null);
              setPlaying(false);
            }}
          >
            Seri canlı görünüme dön
          </button>
        )}
      </div>
      {replay && (
        <>
          <p>
            Kayıt kaynağı:{' '}
            {String(replay.header.experiment ?? 'Cihaz kökeni doğrulanmadı')} ·
            canlı uçuş ve seri komut yollarından ayrı
          </p>
          <div className="replay-bar">
            <button
              onClick={() => {
                if (time >= replay.summary.elapsed_s) setTime(0);
                setPlaying(!playing);
              }}
            >
              {playing ? 'Duraklat' : 'Oynat'}
            </button>
            <input
              aria-label="Seri kayıt zamanı"
              type="range"
              min={0}
              max={replay.summary.elapsed_s}
              step="any"
              value={time}
              onChange={(e) => setTime(Number(e.target.value))}
            />
            <span>
              {time.toFixed(2)} / {replay.summary.elapsed_s.toFixed(2)} s
            </span>
            <select
              aria-label="Seri oynatma hızı"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              <option value={0.5}>0,5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
            </select>
            <button
              onClick={() =>
                download(
                  'serial-recording.jsonl',
                  replay.raw,
                  'application/x-ndjson',
                )
              }
            >
              Ham JSONL indir
            </button>
          </div>
        </>
      )}
      <h3>Seri kayıt arşivi</h3>
      {!archive.length && (
        <p>
          Yerel alıcıya bağlanıldığında kayıtlar burada listelenir. Seri
          kayıtlar uçuş arşiviyle birleştirilmez.
        </p>
      )}
      <div className="serial-archive">
        {archive.map((r) => (
          <div key={r.id}>
            <strong>{r.experiment}</strong>
            <small>
              {r.started_utc} · {r.port} · {labels[r.status] ?? r.status}
            </small>
            <button
              disabled={busy || r.status === 'running'}
              onClick={() =>
                void perform(async () =>
                  open(
                    await request(
                      '/recordings/' + r.id,
                      'GET',
                      undefined,
                      token,
                      true,
                    ),
                  ),
                )
              }
            >
              Seri kaydı aç
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
