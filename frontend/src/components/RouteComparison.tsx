import { useEffect, useRef, useState } from 'react';
import type { Mission } from '../types';
import { missionFingerprint } from '../types';
import { rankCandidates, type Candidate } from '../routeComparison';
import { api } from '../api';
import type { SurveyPreview } from '../planning';
import { RouteOverlay } from './RouteOverlay';

export function RouteComparison({
  mission,
  editing,
  local,
  onSelect,
}: {
  mission: Mission;
  editing: boolean;
  local: boolean;
  onSelect: (preview: SurveyPreview, heading: number) => void;
}) {
  const [speed, setSpeed] = useState(5),
    [delay, setDelay] = useState(2),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [result, setResult] = useState<{
    signature: string;
    rows: Candidate[];
  } | null>(null);
  const [left, setLeft] = useState(0),
    [right, setRight] = useState(90);
  const worker = useRef<Worker | null>(null),
    epoch = useRef(0);
  const signature = missionFingerprint(mission) + `/${speed}/${delay}/${local}`;
  useEffect(() => {
    epoch.current++;
    setBusy(false);
    worker.current?.terminate();
    return () => {
      epoch.current++;
      worker.current?.terminate();
    };
  }, [signature]);
  const rows = result?.signature === signature ? result.rows : [],
    ranked = rankCandidates(rows),
    best = ranked[0];
  async function compute() {
    worker.current?.terminate();
    const generation = ++epoch.current;
    setBusy(true);
    setError('');
    const w = new Worker(
      new URL('../workers/routeComparison.ts', import.meta.url),
      { type: 'module' },
    );
    worker.current = w;
    w.onerror = () => {
      if (epoch.current === generation) {
        setError('Rota hesaplaması başarısız.');
        setBusy(false);
      }
      w.terminate();
    };
    w.onmessage = async ({ data }) => {
      try {
        if (data.error) throw Error(data.error);
        const candidates = data.rows as Candidate[];
        if (local)
          for (const c of candidates)
            if (c.preview) {
              if (epoch.current !== generation) return;
              const validation = await api.validate({
                ...mission,
                takeoff_altitude_m: mission.planning!.altitude_m,
                waypoints: c.preview.waypoints,
                generation: c.preview.generation,
                planning: { ...mission.planning!, heading_deg: c.heading_deg },
              });
              c.backend_validated = validation.valid;
              if (!validation.valid)
                c.error = validation.issues.map((i) => i.message).join(' ');
            }
        if (epoch.current === generation) {
          setResult({ signature, rows: candidates });
          setLeft(rankCandidates(candidates)[0]?.heading_deg ?? 0);
          setRight(rankCandidates(candidates)[1]?.heading_deg ?? 90);
        }
      } catch (e) {
        if (epoch.current === generation) setError(String(e));
      } finally {
        w.terminate();
        if (epoch.current === generation) setBusy(false);
      }
    };
    w.postMessage({ mission, speed, delay });
  }
  function card(
    heading: number,
    setHeading: (v: number) => void,
    label: string,
  ) {
    const c = rows.find((r) => r.heading_deg === heading);
    return (
      <div className="comparison-card">
        <label>
          {label}
          <select
            value={heading}
            onChange={(e) => setHeading(Number(e.target.value))}
          >
            {rows.map((r) => (
              <option key={r.heading_deg} value={r.heading_deg}>
                {r.heading_deg}°{r.error ? ' · geçersiz' : ''}
              </option>
            ))}
          </select>
        </label>
        {c?.preview && !c.error ? (
          <>
            <dl>
              <dt>Toplam / tarama / bağlantı</dt>
              <dd>
                {c.preview.distance_m.toFixed(1)} /{' '}
                {c.preview.survey_distance_m.toFixed(1)} /{' '}
                {c.connector_distance_m!.toFixed(1)} m
              </dd>
              <dt>Dönüş / nokta</dt>
              <dd>
                {c.turn_count} / {c.preview.waypoints.length}
              </dd>
              <dt>Tahmini yatay rota süresi</dt>
              <dd>{c.estimated_duration_s!.toFixed(1)} s</dd>
            </dl>
            <p className="muted">
              Dönüş açıları:{' '}
              {c.turn_angles_deg.map((a) => a.toFixed(0) + '°').join(', ') ||
                '—'}
            </p>
            <button
              className="secondary small"
              disabled={!editing}
              onClick={() => onSelect(c.preview!, c.heading_deg)}
            >
              Haritada önizle · {heading}°
            </button>
          </>
        ) : (
          <p role="status">{c?.error ?? 'Aday seçin.'}</p>
        )}
      </div>
    );
  }
  return (
    <section className="route-comparison">
      <h3>Rota adaylarını karşılaştır</h3>
      <p className="muted">
        0–165° arası 15° adımlı yönler ve seçili açı değerlendirilir. Öneri
        yalnızca bu adaylar arasındadır.
      </p>
      <div className="thresholds">
        <label>
          Varsayılan hız · m/s
          <input
            type="number"
            min="1"
            max="15"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          />
        </label>
        <label>
          Dönüş başına bekleme · s
          <input
            type="number"
            min="0"
            max="20"
            value={delay}
            onChange={(e) => setDelay(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="row-actions">
        <button
          className="primary small"
          disabled={!editing || busy}
          onClick={() => void compute()}
        >
          {busy ? 'Adaylar hesaplanıyor…' : 'Rota adaylarını hesapla'}
        </button>
        {busy && (
          <button
            className="secondary small"
            onClick={() => {
              epoch.current++;
              worker.current?.terminate();
              setBusy(false);
            }}
          >
            Hesabı durdur
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {result && !rows.length && (
        <p>Ayarlar değişti; karşılaştırmayı yeniden hesaplayın.</p>
      )}
      {best && (
        <p className="inline-note">
          Önerilen {best.heading_deg}°: belirtilen hız/bekleme modeliyle
          değerlendirilen geçerli adaylar içinde en kısa tahmini süre (
          {best.estimated_duration_s!.toFixed(1)} s).{' '}
          {local
            ? 'Backend doğrulaması yapıldı.'
            : 'Tarayıcı doğrulaması; gerçek SITL sonucu değildir.'}
        </p>
      )}
      {!!rows.length && (
        <>
          <div className="comparison-grid">
            {card(left, setLeft, 'A rotası')}
            {card(right, setRight, 'B rotası')}
          </div>
          <RouteOverlay
            mission={mission}
            a={
              rows.find((r) => r.heading_deg === left && !r.error)?.preview
                ?.waypoints
            }
            b={
              rows.find((r) => r.heading_deg === right && !r.error)?.preview
                ?.waypoints
            }
          />
          <details>
            <summary>Tüm {rows.length} adayın sonucu</summary>
            <ul>
              {rows.map((c) => (
                <li key={c.heading_deg}>
                  {c.heading_deg}° ·{' '}
                  {c.error ??
                    `${c.preview!.distance_m.toFixed(1)} m / ${c.estimated_duration_s!.toFixed(1)} s`}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      <p className="muted">
        Süre modeli = yatay mesafe / hız + ≥10° dönüş sayısı × bekleme. Kalkış,
        iniş, ivmelenme, rüzgâr ve batarya modellenmez. Önizleme mevcut görevi
        değiştirmez; uygulamak için Rotayı uygula düğmesini kullanın.
      </p>
    </section>
  );
}
