import { useEffect, useRef, useState } from 'react';
import { download } from '../analysis';
interface Definition {
  id: string;
  name: string;
  version: number;
  profile: string;
  duration_s: number;
  seed: number;
}
interface Run {
  id: string;
  definition: Definition;
  status: string;
  created_utc: string;
  recording_ids: string[];
  checks: { label: string; status: string }[];
  error: string | null;
}
type Request = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<unknown>;
const labels: Record<string, string> = {
  queued: 'Sırada',
  running: 'Çalışıyor',
  passed: 'Geçti',
  failed: 'Kaldı',
  cancelled: 'İptal edildi',
  interrupted: 'Kesintiye uğradı',
};
export function SerialExperimentLab({
  request,
  onOpen,
}: {
  request: Request;
  onOpen: (id: string) => void;
}) {
  const [definitions, setDefinitions] = useState<Definition[]>([]),
    [runs, setRuns] = useState<Run[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [name, setName] = useState('Seri hata deneyi'),
    [profile, setProfile] = useState('mixed'),
    [duration, setDuration] = useState(10),
    [parent, setParent] = useState('');
  const pending = useRef(false),
    latest = useRef(request);
  latest.current = request;
  useEffect(() => {
    let disposed = false;
    async function refresh() {
      try {
        const [d, r] = await Promise.all([
          latest.current('/experiments'),
          latest.current('/experiment-runs'),
        ]);
        if (!disposed) {
          setDefinitions(d as Definition[]);
          setRuns(r as Run[]);
        }
      } catch (e) {
        if (!disposed) setError(String(e));
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);
  async function perform(action: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
      setDefinitions((await request('/experiments')) as Definition[]);
      setRuns((await request('/experiment-runs')) as Run[]);
    } catch (e) {
      setError(String(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const active = runs.some((r) => ['queued', 'running'].includes(r.status));
  return (
    <section className="serial-experiments">
      <h3>Tekrarlanabilir seri hata deneyleri</h3>
      <p>
        Sentetik MCT1 kaynağı · sabit tohum 42 · USB veya sensör doğruluğu
        kabulü değildir. Her koşu ayrı ham kayıt üretir.
      </p>
      <div className="thresholds">
        <label>
          Seri deney adı
          <input
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Deney profili
          <select value={profile} onChange={(e) => setProfile(e.target.value)}>
            <option value="nominal">Normal paketler</option>
            <option value="mixed">Bozuk / kayıp / geç paketler</option>
            <option value="sensor_gap">Eksik sensör alanları</option>
          </select>
        </label>
        <label>
          Deney süresi (s)
          <input
            type="number"
            value={duration}
            min={5}
            max={60}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </label>
        <label>
          Üst tanım
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">Bağımsız</option>
            {definitions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} v{d.version}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        disabled={busy || !name.trim()}
        onClick={() =>
          void perform(() =>
            request('/experiments', 'POST', {
              name,
              profile,
              duration_s: duration,
              parent_id: parent || null,
            }),
          )
        }
      >
        Seri deney tanımı oluştur
      </button>
      {error && <p role="alert">{error}</p>}
      {definitions.map((d) => (
        <div className="scenario-result" key={d.id}>
          <strong>
            {d.name} · v{d.version} · {d.profile} · {d.duration_s} s
          </strong>
          <button
            disabled={busy || active}
            onClick={() =>
              void perform(() => request(`/experiment-runs/${d.id}`, 'POST'))
            }
          >
            Yeni seri koşu başlat
          </button>
        </div>
      ))}
      {runs.map((r) => (
        <div className="scenario-result" key={r.id}>
          <strong>
            {r.definition.name} · {labels[r.status]}
          </strong>
          <p>
            {r.id} · {r.checks.filter((c) => c.status === 'passed').length}/
            {r.checks.length} gözlem · {r.created_utc}
          </p>
          {r.error && <p role="alert">{r.error}</p>}
          <div className="row-actions">
            {['queued', 'running'].includes(r.status) ? (
              <button
                disabled={busy}
                onClick={() =>
                  void perform(() =>
                    request(`/experiment-runs/${r.id}/cancel`, 'POST'),
                  )
                }
              >
                Seri koşuyu iptal et
              </button>
            ) : (
              r.recording_ids.map((id) => (
                <button key={id} disabled={busy} onClick={() => onOpen(id)}>
                  Koşu kaydını aç
                </button>
              ))
            )}
            <button
              onClick={() =>
                download(
                  `serial-experiment-${r.id}.json`,
                  JSON.stringify(r, null, 2),
                )
              }
            >
              Deney JSON
            </button>
          </div>
          <details>
            <summary>Beklentiler ve gözlemler</summary>
            <pre>{JSON.stringify(r, null, 2)}</pre>
          </details>
        </div>
      ))}
    </section>
  );
}
