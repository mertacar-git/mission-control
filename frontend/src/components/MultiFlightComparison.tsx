import { useEffect, useMemo, useRef, useState } from 'react';
import { frames, download } from '../analysis';
import { project } from '../planning';
import { parseRecording } from '../recording';
import {
  compareFlights,
  comparisonCSV,
  type FlightComparison,
} from '../multiFlightComparison';
import type { Recording, Telemetry } from '../types';
const colors = ['#71dfbe', '#76b6ff', '#efc46d', '#eaa5d1', '#c4b5fd'];
const fmt = (v: unknown) =>
  typeof v === 'number' ? v.toFixed(2) : v == null ? '—' : String(v);
function plot(
  r: Recording,
  field: 'map' | 'relative_altitude_m' | 'ground_speed_ms',
) {
  const segments: number[][][] = [];
  let current: number[][] = [],
    previous: Telemetry | null = null;
  const rows = frames(r),
    origin = rows[0]?.elapsed_s ?? 0;
  for (const t of rows) {
    const valid =
      t.connection === 'connected' &&
      (field === 'map'
        ? t.position_fresh && t.latitude !== null && t.longitude !== null
        : t[field] !== null);
    if (!valid || (previous && t.elapsed_s - previous.elapsed_s > 3)) {
      if (current.length) segments.push(current);
      current = [];
    }
    if (valid)
      current.push(
        field === 'map'
          ? project({ latitude: t.latitude!, longitude: t.longitude! })
          : [t.elapsed_s - origin, t[field]!],
      );
    previous = t;
  }
  if (current.length) segments.push(current);
  const chosen = segments.filter((s) => s.length > 1).slice(0, 250);
  const budget = Math.max(2, Math.floor(2000 / Math.max(1, chosen.length)));
  return chosen.map((s) => {
    const stride = Math.max(1, Math.ceil(s.length / budget));
    return s.filter((_, i) => i % stride === 0 || i === s.length - 1);
  });
}
function Overlay({
  recordings,
  field,
}: {
  recordings: Recording[];
  field: 'map' | 'relative_altitude_m' | 'ground_speed_ms';
}) {
  const data = useMemo(
    () => recordings.map((r) => plot(r, field)),
    [recordings, field],
  );
  const plans =
    field === 'map'
      ? recordings.map((r) => r.session.mission?.waypoints.map(project) ?? [])
      : [];
  const all = [...data.flat(2), ...plans.flat()];
  const xs = all.map((p) => p[0]),
    ys = all.map((p) => p[1]);
  const lowX = Math.min(0, ...xs),
    lowY = Math.min(0, ...ys);
  let highX = Math.max(1, ...xs),
    highY = Math.max(1, ...ys);
  if (field === 'map') {
    const scale = Math.min(500 / (highX - lowX), 210 / (highY - lowY));
    highX = lowX + 500 / scale;
    highY = lowY + 210 / scale;
  }
  const map = (p: number[]) =>
    `${50 + ((p[0] - lowX) / (highX - lowX)) * 500},${245 - ((p[1] - lowY) / (highY - lowY)) * 210}`;
  const label =
    field === 'map'
      ? 'Ortak rota ve uçuş izleri · yerel metre'
      : field === 'relative_altitude_m'
        ? 'Göreli irtifa · m'
        : 'Yer hızı · m/s';
  return (
    <figure className="route-overlay">
      <svg viewBox="0 0 600 290" role="img" aria-label={label}>
        <text x="50" y="20" fill="#b8c8d9">
          {label}
        </text>
        <path d="M50 35 V245 H550" fill="none" stroke="#52687c" />
        {[0, 0.5, 1].map((q) => (
          <g key={q}>
            <text x="3" y={245 - q * 210} fill="#b8c8d9" fontSize="11">
              {(lowY + q * (highY - lowY)).toFixed(1)}
            </text>
            <text x={50 + q * 500} y="265" fill="#b8c8d9" fontSize="11">
              {(lowX + q * (highX - lowX)).toFixed(1)}
            </text>
          </g>
        ))}
        {plans.map((p, i) => (
          <polyline
            key={'plan' + i}
            points={p.map(map).join(' ')}
            fill="none"
            stroke={colors[i]}
            strokeDasharray="5 4"
            opacity=".45"
          />
        ))}
        {data.map((segments, i) =>
          segments.map((s, j) => (
            <polyline
              key={`${i}-${j}`}
              points={s.map(map).join(' ')}
              fill="none"
              stroke={colors[i]}
              strokeWidth="2"
            >
              <title>{recordings[i].session.name}</title>
            </polyline>
          )),
        )}
        <text x="50" y="285" fill="#b8c8d9" fontSize="11">
          {field === 'map'
            ? 'X doğu / Y kuzey · kesikli: plan · düz: gözlenen iz'
            : 'Kayıt başlangıcından geçen süre · s · veri boşlukları birleştirilmez'}
        </text>
      </svg>
    </figure>
  );
}
export function MultiFlightComparison({
  recordings,
}: {
  recordings: Recording[];
}) {
  const [published, setPublished] = useState<Recording[]>([]),
    [ids, setIds] = useState<string[]>([]),
    [result, setResult] = useState<FlightComparison | null>(null),
    [error, setError] = useState('');
  const root = useRef<HTMLElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const list = useMemo(
    () =>
      [...recordings, ...published].filter(
        (r, i, all) =>
          all.findIndex((v) => v.session.id === r.session.id) === i,
      ),
    [recordings, published],
  );
  const selected = useMemo(
    () => list.filter((r) => ids.includes(r.session.id)),
    [list, ids],
  );
  useEffect(() => {
    let disposed = false;
    setResult(null);
    if (selected.length >= 2)
      void compareFlights(selected)
        .then((r) => {
          if (!disposed) setResult(r);
        })
        .catch((e) => {
          if (!disposed) setError(String(e));
        });
    return () => {
      disposed = true;
    };
  }, [selected]);
  async function examples() {
    try {
      const loaded = await Promise.all(
        ['flight-0', 'flight-90', 'baseline-0', 'baseline-1', 'baseline-2'].map(
          async (name) => {
            const response = await fetch(
              import.meta.env.BASE_URL + `comparison/${name}.json`,
              { cache: 'no-store' },
            );
            if (!response.ok) throw Error('Örnek kayıt alınamadı.');
            return parseRecording(await response.json());
          },
        ),
      );
      setPublished(loaded);
      setIds(loaded.map((r) => r.session.id));
      setError('');
    } catch (e) {
      setError(String(e));
    }
  }
  function html(previewOnly = false) {
    if (!result) return;
    const esc = (s: string) =>
      s.replace(
        /[&<>"']/g,
        (c) =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
          })[c]!,
      );
    const figures = Array.from(root.current?.querySelectorAll('svg') ?? [])
      .map((s) => s.outerHTML)
      .join('');
    const document =
      '<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Uçuş karşılaştırması</title><style>body{font:16px system-ui;background:#111d29;color:#e1eaf2;max-width:1000px;margin:30px auto;padding:20px}svg{width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Mission Control · Uçuş karşılaştırması</h1><p>' +
      esc(result.assumptions) +
      '</p>' +
      figures +
      '<pre>' +
      esc(JSON.stringify(result, null, 2)) +
      '</pre></html>';
    if (previewOnly) setPreview(document);
    else download('flight-comparison.html', document, 'text/html');
  }
  return (
    <section className="panel multi-flight" ref={root}>
      <div className="panel-head">
        <div>
          <span className="eyebrow">2–5 KAYIT / ORTAK RAPOR</span>
          <h2>Çoklu uçuş karşılaştırması</h2>
        </div>
        <button className="secondary small" onClick={() => void examples()}>
          Beş gerçek SITL kaydını getir
        </button>
      </div>
      <p>
        En fazla beş kayıt seçin. Renkler harita, grafik ve tablolarda aynı
        kaydı gösterir. Karşılaştırma canlı komut göndermez.
      </p>
      <div className="multi-record-selection">
        {list.map((r) => (
          <label key={r.session.id}>
            <input
              type="checkbox"
              checked={ids.includes(r.session.id)}
              disabled={ids.length >= 5 && !ids.includes(r.session.id)}
              onChange={(e) =>
                setIds((previous) =>
                  e.target.checked
                    ? [...previous, r.session.id]
                    : previous.filter((id) => id !== r.session.id),
                )
              }
            />
            {r.session.name} · {r.session.source} ·{' '}
            {new Date(r.session.started_utc).toLocaleString('tr-TR')} ·{' '}
            {r.session.id.slice(0, 8)}
          </label>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      {selected.length < 2 && <p>Karşılaştırma için en az iki kayıt seçin.</p>}
      {result && (
        <>
          <p>{result.assumptions}</p>
          {result.warnings.map((w) => (
            <p key={w} role="status">
              {w}
            </p>
          ))}
          <p>
            {selected.map((r, i) => (
              <span
                key={r.session.id}
                style={{ color: colors[i], marginRight: 16 }}
              >
                {i + 1}: {r.session.name}
              </span>
            ))}
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Kayıt</th>
                  <th>Sonuç</th>
                  <th>Gözlenen uçuş · s</th>
                  <th>Atanmış sapma · m</th>
                  <th>Veri boşluğu</th>
                  <th>İhlal</th>
                  <th>İhlal · s</th>
                  <th>Batarya · yüzde puan</th>
                  <th>Simülasyon hızı</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((i, n) => (
                  <tr key={i.id}>
                    <th style={{ color: colors[n] }}>{i.name}</th>
                    <td>
                      {i.completion === 'completed'
                        ? 'Tamamlandı'
                        : 'Bilinmiyor'}
                    </td>
                    <td>{fmt(i.observed_flight_s)}</td>
                    <td>{fmt(i.metrics.max_route_deviation_m)}</td>
                    <td>{fmt(i.metrics.recording_gaps)}</td>
                    <td>{fmt(i.metrics.fence_violation_count)}</td>
                    <td>{fmt(i.metrics.fence_observed_violation_s)}</td>
                    <td>{fmt(i.metrics.battery_used_percentage_points)}</td>
                    <td>{fmt(i.speedup)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Overlay recordings={selected} field="map" />
          <Overlay recordings={selected} field="relative_altitude_m" />
          <Overlay recordings={selected} field="ground_speed_ms" />
          <p>
            Görünüm kayıt başına yaklaşık 2.000 nokta ve en fazla 250 kesintisiz
            parça ile sınırlıdır; rapor bütün örneklerden hesaplanır. Harita
            eşit metre ölçeği kullanır.
          </p>
          <div className="row-actions">
            <button
              onClick={() =>
                download(
                  'flight-comparison.json',
                  JSON.stringify(result, null, 2),
                  'application/json',
                )
              }
            >
              Karşılaştırma JSON
            </button>
            <button
              onClick={() =>
                download(
                  'flight-comparison.csv',
                  comparisonCSV(result),
                  'text/csv',
                )
              }
            >
              Karşılaştırma CSV
            </button>
            <button onClick={() => html()}>Karşılaştırma HTML</button>
            <button onClick={() => html(true)}>HTML önizle</button>
          </div>
          {preview && (
            <div role="dialog" aria-label="HTML raporu önizlemesi">
              <button onClick={() => setPreview(null)}>Önizlemeyi kapat</button>
              <iframe
                title="HTML karşılaştırma raporu"
                srcDoc={preview}
                sandbox=""
                style={{ width: '100%', height: 650, border: 0 }}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}
