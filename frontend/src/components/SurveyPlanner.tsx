import { useState, useEffect, type Dispatch, type SetStateAction } from 'react';
import {
  defaultPlanning,
  examplePlanning,
  generateSurvey,
  unproject,
  validatePlanning,
  type SurveyPreview,
  type Validation,
} from '../planning';
import type {
  Coordinate,
  EditLayer,
  Mission,
  Planning,
  Waypoint,
} from '../types';

export function SurveyPlanner({
  mission,
  setMission,
  layer,
  setLayer,
  editing,
  onFocus,
  onPreview,
}: {
  mission: Mission;
  setMission: Dispatch<SetStateAction<Mission>>;
  layer: EditLayer;
  setLayer: (layer: EditLayer) => void;
  editing: boolean;
  onFocus: (p: Coordinate) => void;
  onPreview: (points: Waypoint[] | null) => void;
}) {
  const [preview, setPreview] = useState<{
      signature: string;
      result: SurveyPreview;
    } | null>(null),
    [notice, setNotice] = useState('');
  const p = mission.planning,
    signature = JSON.stringify(mission),
    current = preview?.signature === signature ? preview.result : null;
  useEffect(() => {
    onPreview(current?.waypoints ?? null);
    return () => onPreview(null);
  }, [current, onPreview]);
  function update(patch: Partial<Planning>) {
    if (editing)
      setMission((m) => ({
        ...m,
        schema_version: 2,
        planning: { ...(m.planning ?? defaultPlanning()), ...patch },
      }));
  }
  const areaKey = layer === 'survey_area' ? 'survey_area' : 'allowed_area';
  const labels = {
    waypoints: 'Rota noktaları',
    allowed_area: 'İzin verilen alan',
    survey_area: 'Tarama alanı',
  };
  return (
    <section className="panel survey-planner">
      <div className="panel-head">
        <div>
          <span className="eyebrow">ALAN GÖREVİ / PLANLAMA KONTROLÜ</span>
          <h2>Alan tarama</h2>
        </div>
        <span className="recording-source">v1.3</span>
      </div>
      {!p ? (
        <>
          <p className="muted">
            İzin verilen sınırı ve içindeki tarama alanını ayrı çizin. İçbükey
            alanlarda bağlantılar alan içinde üretilir.
          </p>
          <div className="row-actions">
            <button
              disabled={!editing}
              className="primary"
              onClick={() => {
                update(defaultPlanning());
                setLayer('allowed_area');
              }}
            >
              Alan planlaması ekle
            </button>
            <button
              disabled={!editing}
              className="secondary"
              onClick={() => {
                update(examplePlanning());
                setLayer('survey_area');
              }}
            >
              Örnek içbükey alan
            </button>
          </div>
        </>
      ) : (
        <>
          <div
            className="layer-tabs"
            role="group"
            aria-label="Harita düzenleme modu"
          >
            {(['waypoints', 'allowed_area', 'survey_area'] as EditLayer[]).map(
              (key) => (
                <button
                  key={key}
                  className={
                    layer === key ? 'primary small' : 'secondary small'
                  }
                  disabled={!editing}
                  aria-pressed={layer === key}
                  onClick={() => setLayer(key)}
                >
                  {labels[key]}
                </button>
              ),
            )}
          </div>
          <p className="muted">
            Seçili katman: <strong>{labels[layer]}</strong>. Haritaya tıklayarak
            köşe ekleyin; numaralı köşeleri sürükleyin. Her alan 3–60 köşe,
            başlangıçtan en fazla 2 km.
          </p>
          <div className="survey-settings">
            {(
              [
                ['spacing_m', 'Hat aralığı · m', 5, 200],
                ['heading_deg', 'Kuzeye göre yön · °', 0, 179.9],
                ['altitude_m', 'Tarama irtifası · m', 5, 120],
                ['max_distance_m', 'Mesafe sınırı · m', 1, 100000],
                ['max_altitude_m', 'İrtifa sınırı · m', 5, 120],
              ] as [keyof Planning, string, number, number][]
            ).map(([key, label, min, max]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  step="any"
                  min={min}
                  max={max}
                  disabled={!editing}
                  value={p[key] as number}
                  onChange={(e) => update({ [key]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
          {layer !== 'waypoints' && (
            <details className="area-coordinates">
              <summary>
                {labels[layer]} · {p[areaKey].length} köşe / koordinat editörü
              </summary>
              <div className="area-coordinate-list">
                {p[areaKey].map((point, i) => (
                  <div className="area-coordinate-row" key={i}>
                    <button
                      className="secondary small"
                      onClick={() => onFocus(point)}
                      aria-label={`${labels[layer]} köşe ${i + 1} odaklan`}
                    >
                      {i + 1}
                    </button>
                    {(['latitude', 'longitude'] as const).map((key) => (
                      <label key={key}>
                        {key === 'latitude' ? 'Enlem' : 'Boylam'}
                        <input
                          aria-label={`${labels[layer]} köşe ${i + 1} ${key === 'latitude' ? 'enlem' : 'boylam'}`}
                          type="number"
                          step="any"
                          disabled={!editing}
                          value={point[key]}
                          onChange={(e) =>
                            update({
                              [areaKey]: p[areaKey].map((v, j) =>
                                j === i
                                  ? { ...v, [key]: Number(e.target.value) }
                                  : v,
                              ),
                            })
                          }
                        />
                      </label>
                    ))}
                    <button
                      className="secondary small"
                      disabled={!editing}
                      aria-label={`${labels[layer]} köşe ${i + 1} sil`}
                      onClick={() =>
                        update({
                          [areaKey]: p[areaKey].filter((_, j) => i !== j),
                        })
                      }
                    >
                      Sil
                    </button>
                  </div>
                ))}
              </div>
              <div className="row-actions">
                <button
                  className="secondary small"
                  disabled={!editing || p[areaKey].length >= 60}
                  onClick={() =>
                    update({ [areaKey]: [...p[areaKey], unproject([0, 0])] })
                  }
                >
                  Koordinat satırı ekle
                </button>
                <button
                  className="secondary small"
                  disabled={!editing}
                  onClick={() => update({ [areaKey]: [] })}
                >
                  Alanı temizle
                </button>
              </div>
            </details>
          )}
          <div className="row-actions">
            <button
              className="primary"
              disabled={!editing}
              onClick={() => {
                try {
                  const result = generateSurvey(mission);
                  setPreview({ signature, result });
                  setNotice('');
                } catch (e) {
                  setPreview(null);
                  setNotice(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Tarama rotası üret
            </button>
            <button
              className="secondary"
              disabled={!editing}
              onClick={() => {
                update(examplePlanning());
                setNotice(
                  'Örnek alanlar eklendi. Rota üretip önizlemeyi inceleyin.',
                );
              }}
            >
              Örnek alanları getir
            </button>
            <button
              className="secondary small"
              disabled={!editing}
              onClick={() => {
                setMission((m) => ({
                  ...m,
                  schema_version: 2,
                  planning: null,
                }));
                setLayer('waypoints');
                setPreview(null);
              }}
            >
              Alan planlamasını kaldır
            </button>
          </div>
          {preview && !current && (
            <p className="inline-note" role="status">
              Görev veya ayarlar değişti; önizlemeyi yeniden üretin. Uygulanmış
              rota değişmedi.
            </p>
          )}
          {current && (
            <div className="survey-preview" role="status">
              <div>
                <strong>Rota önizlemesi</strong>
                <span>
                  {current.area_m2.toFixed(0)} m² · {current.line_count} hat /{' '}
                  {current.segment_count} tarama parçası ·{' '}
                  {current.distance_m.toFixed(1)} m · {current.waypoints.length}{' '}
                  nokta
                </span>
              </div>
              <button
                className="primary"
                disabled={!editing}
                onClick={() => {
                  setMission((m) => ({
                    ...m,
                    takeoff_altitude_m: p.altitude_m,
                    waypoints: current.waypoints,
                  }));
                  setLayer('waypoints');
                  setPreview(null);
                  setNotice(
                    'Tarama rotası tek işlemde uygulandı; Geri al ile önceki rotaya dönebilirsiniz.',
                  );
                }}
              >
                Rotayı uygula
              </button>
            </div>
          )}
          {notice && (
            <p className="inline-note" role="status">
              {notice}
            </p>
          )}
          <ValidationSummary result={validatePlanning(mission)} />
        </>
      )}
      <p className="survey-disclaimer">
        Sınır bir planlama kontrolüdür; otopilot geofence değildir. Tarama
        çizgileri kamera kapsaması veya uçuş izinin sınır içinde kalacağı
        garantisi vermez.
      </p>
    </section>
  );
}
export function ValidationSummary({ result }: { result: Validation }) {
  return (
    <div
      className={'validation-summary ' + (result.valid ? 'valid' : 'invalid')}
      role="status"
    >
      <strong>
        {result.valid
          ? 'Görev doğrulaması uygun'
          : 'Görev doğrulaması: düzeltme gerekiyor'}
      </strong>
      <span>
        {Number.isFinite(result.distance_m)
          ? result.distance_m.toFixed(1)
          : '—'}{' '}
        m · başlangıç bağlantısı dahil
      </span>
      {result.issues.length > 0 && (
        <ul>
          {result.issues.map((issue, i) => (
            <li key={i}>{issue.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
