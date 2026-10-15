import { useEffect, useState } from 'react';
import { request } from '../api';
import { download } from '../analysis';
import { emulatorFrameAt, type EmulatorRun } from '../emulatorTypes';
const profiles = [
  ['nominal', 'Hatasız akış'],
  ['loss', 'Paket kaybı'],
  ['corruption', 'CRC bozulması'],
  ['reorder', 'Sıra değişimi / tekrar'],
  ['mixed', 'Karışık hatalar'],
  ['sensor_gap', 'Sensör ölçüm kaybı'],
  ['restart', 'Gönderici süreç yeniden başlatma'],
];
const statuses: Record<string, string> = {
  running: 'Çalışıyor',
  completed: 'Tamamlandı',
  failed: 'Başarısız',
  interrupted: 'Yarıda kaldı',
  connected: 'Güncel',
  stale: 'Veri gecikmiş',
  closed: 'Kapalı',
};
export function EmulatorLab({ local }: { local: boolean }) {
  const [profile, setProfile] = useState('mixed'),
    [seed, setSeed] = useState(42),
    [duration, setDuration] = useState(10),
    [run, setRun] = useState<EmulatorRun | null>(null),
    [archive, setArchive] = useState<Omit<EmulatorRun, 'packets'>[]>([]);
  const [replay, setReplay] = useState<EmulatorRun | null>(null),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false,
      archiveKey = 'initial';
    async function refresh() {
      try {
        if (local) {
          const current = await request<EmulatorRun | null>('/emulator');
          if (!disposed) setRun(current);
          const key = current ? current.id + '/' + current.status : 'none';
          if (key !== archiveKey) {
            const runs =
              await request<Omit<EmulatorRun, 'packets'>[]>('/emulator/runs');
            if (!disposed) {
              setArchive(runs);
              archiveKey = key;
            }
          }
        } else {
          const response = await fetch(
            import.meta.env.BASE_URL + 'emulator/index.json',
          );
          if (!response.ok)
            throw Error('Yayımlanmış emülatör kayıtları yüklenemedi.');
          const data = await response.json();
          if (!disposed) setArchive(data);
        }
      } catch (e) {
        if (!disposed) setError(String(e));
      }
    }
    void refresh();
    const timer = local ? setInterval(() => void refresh(), 500) : undefined;
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [local]);
  const shown = replay ?? run,
    end = replay?.packets.at(-1)?.received_elapsed_s ?? 0,
    current = replay ? emulatorFrameAt(replay, time) : run?.latest;
  useEffect(() => {
    if (!playing || !replay) return;
    const timer = setInterval(
      () =>
        setTime((t) => {
          const next = Math.min(end, t + 0.1 * speed);
          if (next >= end) setPlaying(false);
          return next;
        }),
      100,
    );
    return () => clearInterval(timer);
  }, [playing, replay, end, speed]);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string) {
    await perform(async () => {
      const data = local
        ? await request<EmulatorRun>('/emulator/runs/' + encodeURIComponent(id))
        : await fetch(
            import.meta.env.BASE_URL + 'emulator/' + id + '.json',
          ).then((r) => {
            if (!r.ok) throw Error('Kayıt bulunamadı.');
            return r.json() as Promise<EmulatorRun>;
          });
      setReplay(data);
      setTime(0);
      setPlaying(false);
    });
  }
  const labels: Record<string, string> = {
    received: 'Alınan datagram',
    accepted: 'Güncel kabul',
    duplicates: 'Tekrar',
    out_of_order: 'Geç / sıra dışı',
    corrupt: 'Geçersiz / CRC',
    foreign: 'Başka akış',
    sequence_missing: 'Eksik sıra numarası',
    boots: 'Gözlenen açılış',
  };
  const packets =
    shown?.packets.filter((p) => !replay || p.received_elapsed_s <= time) ?? [];
  const valid = packets.filter((p) => p.classification === 'accepted'),
    alts = valid.filter((p) => p.frame?.relative_altitude_m !== null);
  return (
    <>
      <section className="panel emulator-lab">
        <div className="panel-head">
          <div>
            <span className="eyebrow">AYRI KAYNAK / SENTETİK SENSÖRLER</span>
            <h2>Paket gönderimi ve alıcı doğrulaması</h2>
          </div>
          <span className="count">MCT1 v1 · UDP 14600</span>
        </div>
        <p>
          Bağımsız Python süreci sensör paketleri gönderir. Alıcı CRC, sıra,
          açılış kimliği ve ölçüm geçerliliğini denetler. Bu süreç otopilot
          değildir; uçuş komutu göndermez.{' '}
          {local
            ? 'Yeni deney yerel bilgisayarınızda çalışır.'
            : 'Public görünüm gerçek yazılım emülatörü deneylerinin kayıtlarını oynatır; yeni süreç başlatmaz.'}
        </p>
        <div className="thresholds">
          <label>
            Hata senaryosu
            <select
              value={profile}
              disabled={busy || run?.status === 'running'}
              onChange={(e) => setProfile(e.target.value)}
            >
              {profiles.map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Rastgelelik tohumu
            <input
              type="number"
              min="0"
              max="2147483647"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
            />
          </label>
          <label>
            Süre · s
            <input
              type="number"
              min="5"
              max="60"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="row-actions">
          <button
            className="primary small"
            disabled={!local || busy || !!replay || run?.status === 'running'}
            onClick={() =>
              void perform(async () =>
                setRun(
                  await request('/emulator', 'POST', {
                    profile,
                    seed,
                    duration_s: duration,
                  }),
                ),
              )
            }
          >
            Emülatör deneyini başlat
          </button>
          <button
            className="secondary small"
            disabled={!local || busy || !!replay || run?.status !== 'running'}
            onClick={() =>
              void perform(async () =>
                setRun(await request('/emulator/stop', 'POST')),
              )
            }
          >
            Göndericiyi durdur
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
      </section>
      <section className="panel emulator-lab">
        <h3>Deney kayıtları</h3>
        <div className="row-actions">
          {archive.map((r) => (
            <button
              key={r.id}
              className="secondary small"
              onClick={() => void open(r.id)}
            >
              {profiles.find((p) => p[0] === r.profile)?.[1] ?? r.profile} ·{' '}
              {statuses[r.status] ?? r.status} · tohum {r.seed}
            </button>
          ))}
        </div>
      </section>
      {shown && (
        <section className="panel emulator-lab">
          <div className="panel-head">
            <h2>
              {replay ? 'Emülatör kaydı / oynatma' : 'Emülatör canlı akışı'}
            </h2>
            <strong>
              {shown.source} ·{' '}
              {replay ? 'kayıt' : statuses[shown.stream_state ?? 'closed']}
            </strong>
          </div>
          {replay && (
            <div className="row-actions">
              <button
                className="secondary small"
                onClick={() => setPlaying(!playing)}
              >
                {playing
                  ? 'Emülatör kaydını duraklat'
                  : 'Emülatör kaydını oynat'}
              </button>
              <input
                aria-label="Emülatör kayıt zamanı"
                type="range"
                min="0"
                max={end}
                step="any"
                value={time}
                onChange={(e) => {
                  setPlaying(false);
                  setTime(Number(e.target.value));
                }}
              />
              <span>
                {time.toFixed(1)} / {end.toFixed(1)} s
              </span>
              <select
                aria-label="Emülatör oynatma hızı"
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
              >
                <option value="0.5">0,5×</option>
                <option value="1">1×</option>
                <option value="2">2×</option>
              </select>
              <button
                className="secondary small"
                onClick={() => {
                  setReplay(null);
                  setPlaying(false);
                }}
              >
                Emülatör canlı görünümüne dön
              </button>
            </div>
          )}
          <div className="comparison-grid">
            <div className="comparison-card">
              <h3>Son güncel ölçüm</h3>
              <p>
                İrtifa: {current?.relative_altitude_m?.toFixed(2) ?? '—'} m ·
                hız: {current?.ground_speed_ms?.toFixed(2) ?? '—'} m/s ·
                batarya: {current?.battery_voltage_v?.toFixed(2) ?? '—'} V
              </p>
              <p>
                Konum: {current?.latitude?.toFixed(7) ?? '—'},{' '}
                {current?.longitude?.toFixed(7) ?? '—'}
              </p>
              <p>
                Açılış: {current?.boot_id ?? '—'} · sıra:{' '}
                {current?.sequence ?? '—'} · kaynak saati:{' '}
                {current?.source_time_ms ?? '—'} ms
              </p>
            </div>
            <div className="comparison-card">
              <h3>Deney sonucu</h3>
              <p>
                {statuses[shown.status] ?? shown.status} · {shown.profile} ·{' '}
                {shown.expected_packets} planlanan paket · 5 Hz
              </p>
              <p>
                {shown.error ??
                  'Kaynak saati ile alıcı saati eşzamanlı değildir; tek yönlü ağ gecikmesi hesaplanmaz.'}
              </p>
              <p>
                {replay
                  ? 'Sayaçlar tamamlanmış deneyin toplamıdır; aşağıdaki paketler seçili ana kadardır.'
                  : shown.status === 'running'
                    ? 'Eksik sıra sayısı süreç bitene kadar geçici tahmindir.'
                    : 'Deney tamamlandı; sayaçlar tüm kaydın toplamıdır.'}
              </p>
            </div>
          </div>
          <div className="emulator-counters">
            {Object.entries(shown.counters).map(([key, v]) => (
              <div key={key}>
                <span>{labels[key] ?? key}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
          <svg
            className="emulator-chart"
            viewBox="0 0 700 160"
            role="img"
            aria-label="Emülatör irtifa ölçümleri; eksik ölçümler nokta bırakmaz"
          >
            <text x="10" y="16" fill="#afc3de">
              İrtifa · m / alıcı zamanı · s
            </text>
            {alts.map((p, i) => (
              <circle
                key={i}
                cx={
                  20 +
                  (p.received_elapsed_s /
                    Math.max(1, replay ? end : shown.duration_s)) *
                    660
                }
                cy={140 - (p.frame?.relative_altitude_m ?? 0) * 3}
                r="2"
                fill="#71dfbe"
              />
            ))}
          </svg>
          <details>
            <summary>
              Ham paketler ve alıcı kararları · {packets.length}
            </summary>
            <div className="packet-list">
              {packets
                .slice(-100)
                .reverse()
                .map((p, i) => (
                  <div key={i}>
                    <strong>
                      {p.received_elapsed_s.toFixed(3)} s · {p.classification} ·{' '}
                      {p.error ??
                        `${p.frame?.boot_id ?? '—'}:${p.frame?.sequence ?? '—'}`}
                    </strong>
                    <code>{p.raw_hex}</code>
                  </div>
                ))}
            </div>
          </details>
          <button
            className="secondary small"
            onClick={() =>
              download(
                'emulator-' + shown.id + '.json',
                JSON.stringify(shown, null, 2),
              )
            }
          >
            Ham paket kaydını JSON indir
          </button>
          <p className="muted">
            Bozuk, tekrar veya geç paket son güncel ölçümü değiştirmez. Üç
            saniye güncel paket yoksa değerler bilinmiyor olur. Sensör
            geçerlilik biti kapalı alanlar null kalır. Emülatör kaydı SITL uçuş
            kaydı değildir.
          </p>
        </section>
      )}
    </>
  );
}
