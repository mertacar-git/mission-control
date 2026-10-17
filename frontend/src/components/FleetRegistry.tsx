import { useEffect, useState } from 'react';
interface Snapshot {
  schema_version: 1;
  actor: string;
  scope: string;
  devices: {
    device: {
      serial: string;
      name: string;
      model: string;
      station: string;
      firmware: string;
      equipment: string[];
    };
    state: string;
    age_s: number | null;
    measurement: {
      source: string;
      temperature_c: number | null;
      pressure_pa: number | null;
      humidity_percent: number | null;
      sequence: number;
      boot: number;
    } | null;
  }[];
}
const base = 'http://127.0.0.1:8770/api/v1/fleet';
export function FleetRegistry() {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const [draft, setDraft] = useState(''),
    [token, setToken] = useState(''),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  async function read(key: string): Promise<Snapshot> {
    const response = await fetch(base + '/snapshot', {
      headers: { Authorization: 'Bearer ' + key },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok)
      throw Error(
        response.status === 401
          ? 'Cihaz sicili anahtarı geçersiz.'
          : 'Cihaz sicili isteği başarısız.',
      );
    const next = await response.json();
    if (
      next.schema_version !== 1 ||
      !Array.isArray(next.devices) ||
      !['center', 'station-a', 'station-b'].includes(next.actor)
    )
      throw Error('Sicil yanıtı bu sürümle uyumlu değil.');
    return next;
  }
  useEffect(() => {
    if (!token) return;
    let disposed = false;
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const next = await read(token);
        if (!disposed) {
          setSnapshot(next);
          setError('');
        }
      } catch {
        if (!disposed) {
          setSnapshot(null);
          setError('Cihaz siciline ulaşılamıyor. Güncel ölçüm gösterilemiyor.');
        }
      } finally {
        pending = false;
      }
    }
    const timer = setInterval(() => void refresh(), 1500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [token]);
  return (
    <section className="panel fleet-lab">
      <span className="eyebrow">
        KALICI SİVİL CİHAZ SİCİLİ · AYRI YEREL SERVİS
      </span>
      <h2>Kimliği doğrulanmış sicil görünümü</h2>
      <p>
        Bu bölüm tarayıcı rol simülasyonundan ayrıdır. İstasyon kimliği
        sunucudaki anahtardan belirlenir. Yalnızca kayıtlı cihaz bilgileri ve
        sensör ölçümleri okunur; uçuş veya onay komutu gönderilmez.
      </p>
      {!local ? (
        <p>
          Public Pages üzerinde yerel servise bağlanılmaz. Bu görünümü
          bilgisayarınızda çalışan uygulamadan açın.
        </p>
      ) : (
        <>
          <p>
            Yerel sicil servisini 8770 portunda başlatın. Merkez veya istasyon
            anahtarı yalnızca ekran belleğinde tutulur.
          </p>
          <label>
            Sicil erişim anahtarı
            <input
              type="password"
              autoComplete="off"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <div className="row-actions">
            <button
              disabled={loading || !draft.trim()}
              onClick={() => {
                setLoading(true);
                setError('');
                void read(draft.trim())
                  .then((next) => {
                    setSnapshot(next);
                    setToken(draft.trim());
                    setDraft('');
                  })
                  .catch((e) => {
                    setSnapshot(null);
                    setToken('');
                    setError(e instanceof Error ? e.message : String(e));
                  })
                  .finally(() => setLoading(false));
              }}
            >
              Sicile bağlan
            </button>
            {token && (
              <button
                className="secondary"
                onClick={() => {
                  setToken('');
                  setSnapshot(null);
                  setError('');
                }}
              >
                Sicil bağlantısını kapat
              </button>
            )}
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Sicil bağlantısı doğrulanıyor…</p>}
      {snapshot && (
        <>
          <p>
            Sunucu kimliği: {snapshot.actor} · {snapshot.devices.length} kayıtlı
            cihaz
          </p>
          {!snapshot.devices.length && <p>Bu kimliğe atanmış cihaz yok.</p>}
          <div className="fleet-grid">
            {snapshot.devices.map((row) => (
              <article className="panel" key={row.device.serial}>
                <h3>{row.device.serial}</h3>
                <p>
                  {row.device.name} · {row.device.station} ·{' '}
                  {row.device.firmware}
                </p>
                <ul>
                  {row.device.equipment.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
                <p>
                  Veri durumu:{' '}
                  {(
                    {
                      fresh: 'Güncel',
                      stale: 'Gecikmiş',
                      disconnected: 'Bağlantı kesildi',
                      unknown: 'Bilinmiyor',
                    } as Record<string, string>
                  )[row.state] ?? 'Bilinmiyor'}
                </p>
                <p>
                  Kaynak:{' '}
                  {row.measurement?.source === 'synthetic'
                    ? 'Sentetik istasyon örneği'
                    : row.measurement?.source === 'serial'
                      ? 'İstasyonun seri kaynak bildirimi'
                      : 'Bilinmiyor'}
                </p>
                <p>
                  Sıcaklık: {row.measurement?.temperature_c ?? '—'} °C · Nem:{' '}
                  {row.measurement?.humidity_percent ?? '—'} %
                </p>
                <p>
                  Basınç: {row.measurement?.pressure_pa ?? '—'} Pa · Son örnek
                  yaşı: {row.age_s === null ? '—' : row.age_s.toFixed(1) + ' s'}
                </p>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
