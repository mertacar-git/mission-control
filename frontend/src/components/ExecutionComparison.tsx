import { useState, useMemo } from 'react';
import type { Coordinate, Recording } from '../types';
import { analyzeExecution, executionCSV } from '../flightComparison';
import { download, frames } from '../analysis';
import { RouteOverlay } from './RouteOverlay';
function trace(recording: Recording) {
  const segments: Coordinate[][] = [];
  let current: Coordinate[] = [],
    previous = -Infinity;
  for (const row of frames(recording)) {
    if (
      !row.position_fresh ||
      row.connection !== 'connected' ||
      row.latitude === null ||
      row.longitude === null ||
      row.elapsed_s - previous > 3
    ) {
      if (current.length) segments.push(current);
      current = [];
    }
    if (
      row.position_fresh &&
      row.connection === 'connected' &&
      row.latitude !== null &&
      row.longitude !== null
    )
      current.push({ latitude: row.latitude, longitude: row.longitude });
    previous = row.elapsed_s;
  }
  if (current.length) segments.push(current);
  const drawable = segments.filter((s) => s.length > 1),
    segmentStep = Math.max(1, Math.ceil(drawable.length / 250));
  const selected = drawable.filter((_, i) => i % segmentStep === 0),
    budget = Math.max(2, Math.floor(2000 / Math.max(1, selected.length)));
  return selected.map((segment) => {
    const step = Math.max(1, Math.ceil(segment.length / budget));
    return segment.filter(
      (_, i) => i === 0 || i === segment.length - 1 || i % step === 0,
    );
  });
}

export function ExecutionComparison({
  recording,
  recordings,
  onReplay,
  onSelectRecording,
}: {
  recording: Recording;
  recordings: Recording[];
  onReplay: (r: Recording) => void;
  onSelectRecording: (r: Recording) => void;
}) {
  const [corridor, setCorridor] = useState(5),
    [otherId, setOtherId] = useState('');
  const [published, setPublished] = useState<Recording[]>([]),
    [error, setError] = useState('');
  const list = [...recordings, ...published].filter(
    (r, i, all) => all.findIndex((v) => v.session.id === r.session.id) === i,
  );
  const other = list.find((r) => r.session.id === otherId);
  const result = useMemo(
      () => analyzeExecution(recording, corridor),
      [recording, corridor],
    ),
    second = useMemo(
      () => (other ? analyzeExecution(other, corridor) : null),
      [other, corridor],
    );
  const traceA = useMemo(() => trace(recording), [recording]),
    traceB = useMemo(() => (other ? trace(other) : []), [other]);
  const fmt = (v: number | null, d = 1) => (v === null ? '—' : v.toFixed(d));
  async function examples() {
    try {
      const loaded = await Promise.all(
        [0, 90].map((h) =>
          fetch(import.meta.env.BASE_URL + `comparison/flight-${h}.json`).then(
            (r) => {
              if (!r.ok)
                throw Error('Yayımlanmış karşılaştırma kaydı bulunamadı.');
              return r.json() as Promise<Recording>;
            },
          ),
        ),
      );
      setPublished(loaded);
      onSelectRecording(loaded[0]);
      setOtherId(loaded[1].session.id);
    } catch (e) {
      setError(String(e));
    }
  }
  const compatible =
    other &&
    recording.session.mission?.planning &&
    other.session.mission?.planning &&
    recording.session.source === other.session.source &&
    recording.session.mission.takeoff_altitude_m ===
      other.session.mission.takeoff_altitude_m &&
    JSON.stringify(recording.session.mission?.planning?.survey_area) ===
      JSON.stringify(other.session.mission?.planning?.survey_area) &&
    recording.session.mission?.planning?.spacing_m ===
      other.session.mission?.planning?.spacing_m;
  return (
    <section className="panel execution-comparison">
      <div className="panel-head">
        <div>
          <span className="eyebrow">PLANLANAN / GERÇEKLEŞEN</span>
          <h2>Rota parçası ve uçuş karşılaştırması</h2>
        </div>
        <button className="secondary small" onClick={() => void examples()}>
          İki gerçek SITL örneğini getir
        </button>
      </div>
      <p className="muted">
        Yüklenmiş görevin dondurulmuş rotası kullanılır. Atama görev indeksine
        dayanır; yakın paralel hatlar arasında en yakın çizgiyle tahmin
        yapılmaz.
      </p>
      <div className="thresholds">
        <label>
          Koridor yarı genişliği · m
          <input
            type="number"
            min="0.1"
            max="100"
            step="0.1"
            value={corridor}
            onChange={(e) =>
              setCorridor(
                Math.max(0.1, Math.min(100, Number(e.target.value) || 5)),
              )
            }
          />
        </label>
        <label>
          Birinci uçuş
          <select
            value={recording.session.id}
            onChange={(e) => {
              const selected = list.find(
                (r) => r.session.id === e.target.value,
              );
              if (selected) onSelectRecording(selected);
            }}
          >
            {[
              recording,
              ...list.filter((r) => r.session.id !== recording.session.id),
            ].map((r) => (
              <option key={r.session.id} value={r.session.id}>
                {r.session.name} · {r.session.source}
              </option>
            ))}
          </select>
        </label>
        <label>
          İkinci uçuş
          <select value={otherId} onChange={(e) => setOtherId(e.target.value)}>
            <option value="">Kayıt seçin</option>
            {list
              .filter((r) => r.session.id !== recording.session.id)
              .map((r) => (
                <option key={r.session.id} value={r.session.id}>
                  {r.session.name} · {r.session.source}
                </option>
              ))}
          </select>
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {!result.provenance_valid && (
        <p className="inline-note">
          Bu kayıtta doğrulanabilir tarama üretim bilgisi yok veya rota sonradan
          düzenlenmiş. Tarama oranı hesaplanmaz; rota parçaları
          sınıflandırılmaz.
        </p>
      )}
      <div className="comparison-grid">
        <div className="comparison-card">
          <h3>{recording.session.name}</h3>
          <p>
            Kaynak: {recording.session.source} · örneklerden hesaplanan hat
            oranı{' '}
            {result.observed_survey_fraction === null
              ? '—'
              : fmt(result.observed_survey_fraction * 100) + '%'}
          </p>
          <button
            className="secondary small"
            onClick={() => onReplay(recording)}
          >
            Harita ve izi birlikte incele
          </button>
        </div>
        {other && (
          <div className="comparison-card">
            <h3>{other.session.name}</h3>
            <p>
              Kaynak: {other.session.source} · örneklerden hesaplanan hat oranı{' '}
              {second!.observed_survey_fraction === null
                ? '—'
                : fmt(second!.observed_survey_fraction! * 100) + '%'}
            </p>
            <button className="secondary small" onClick={() => onReplay(other)}>
              İkinci uçuşun izini incele
            </button>
            {!compatible && (
              <p className="inline-note">
                Alan veya hat aralığı farklı; sonuçlar eşdeğer deney sayılmaz.
              </p>
            )}
          </div>
        )}
      </div>
      {recording.session.mission && (
        <RouteOverlay
          mission={recording.session.mission}
          a={recording.session.mission.waypoints}
          b={other?.session.mission?.waypoints}
          traceA={traceA}
          traceB={traceB}
        />
      )}
      <div className="table-scroll">
        <table className="execution-table">
          <thead>
            <tr>
              <th>Uçuş</th>
              <th>Planlanan yatay mesafe · m</th>
              <th>Gözlenen parça süreleri toplamı · s</th>
              <th>En büyük atanmış sapma · m</th>
              <th>Atanmış örnek sayısı</th>
            </tr>
          </thead>
          <tbody>
            {[
              { recording, report: result },
              ...(other && second
                ? [{ recording: other, report: second }]
                : []),
            ].map(({ recording: r, report }) => {
              const measured = report.legs.filter((l) => l.samples);
              return (
                <tr key={r.session.id}>
                  <td>{r.session.name}</td>
                  <td>
                    {fmt(report.legs.reduce((s, l) => s + l.planned_m, 0))}
                  </td>
                  <td>
                    {fmt(
                      report.legs.some((l) => l.observed_s !== null)
                        ? report.legs.reduce(
                            (s, l) => s + (l.observed_s ?? 0),
                            0,
                          )
                        : null,
                    )}
                  </td>
                  <td>
                    {fmt(
                      measured.length
                        ? Math.max(
                            ...measured.map((l) => l.max_deviation_m ?? 0),
                          )
                        : null,
                    )}
                  </td>
                  <td>{report.legs.reduce((s, l) => s + l.samples, 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="table-scroll">
        <table className="execution-table">
          <thead>
            <tr>
              <th>Parça</th>
              <th>Tür</th>
              <th>Plan m</th>
              <th>Örnek</th>
              <th>Gözlenen s</th>
              <th>En büyük sapma m</th>
              <th>Ort. hız m/s</th>
              <th>Dönüş sapması m</th>
              <th>Dönüş Δhız m/s</th>
            </tr>
          </thead>
          <tbody>
            {result.legs.map((l) => (
              <tr key={l.index}>
                <td>
                  {l.index === 0 ? 'H → 1' : `${l.index} → ${l.index + 1}`}
                </td>
                <td>
                  {
                    {
                      survey: 'Tarama',
                      connector: 'Bağlantı',
                      unclassified: 'Bilinmiyor',
                    }[l.kind]
                  }
                </td>
                <td>{fmt(l.planned_m)}</td>
                <td>{l.samples}</td>
                <td>{fmt(l.observed_s)}</td>
                <td>{fmt(l.max_deviation_m)}</td>
                <td>{fmt(l.mean_speed_ms)}</td>
                <td>{fmt(l.turn_peak_deviation_m)}</td>
                <td>{fmt(l.turn_speed_change_ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Yalnızca güncel, bağlı, armed AUTO ölçümleri atanır. Süre aynı parçada
        ardışık ≤3 s aralıklı ölçümlerin toplamıdır; tam uçuş süresi değildir.
        Koridor oranı bu örnekler arasında doğrusal iz varsayımıyla gözlenen
        uzunluğun tahminidir; kamera kapsaması değildir. Dönüşler ulaşılma
        olayının ±2 s çevresinde incelenir. Bilinmeyen alanlar boş bırakılır.
      </p>
      <div className="row-actions">
        <button
          className="secondary small"
          onClick={() =>
            download(
              'execution-report.json',
              JSON.stringify(
                {
                  report: result,
                  comparison: second,
                  assumptions: {
                    max_gap_s: 3,
                    turn_window_s: 2,
                    corridor_half_width_m: corridor,
                  },
                  recording_ids: [
                    recording.session.id,
                    other?.session.id ?? null,
                  ],
                },
                null,
                2,
              ),
            )
          }
        >
          Karşılaştırma JSON indir
        </button>
        <button
          className="secondary small"
          onClick={() =>
            download('execution-legs.csv', executionCSV(result), 'text/csv')
          }
        >
          Rota parçaları CSV indir
        </button>
      </div>
    </section>
  );
}
