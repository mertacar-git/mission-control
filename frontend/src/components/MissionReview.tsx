import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, X, ArrowUpToLine } from 'lucide-react';
import { routeLength } from '../missionPresentation';
import { validatePlanning } from '../planning';
import { ValidationSummary } from './SurveyPlanner';
import { validateMission, type Mission } from '../types';

type Props = {
  mission: Mission;
  source: 'demo' | 'local';
  connected: boolean;
  editing: boolean;
  busy: boolean;
  matches: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
};
export function MissionReview({
  mission,
  source,
  connected,
  editing,
  busy,
  matches,
  onConfirm,
  onClose,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [failure, setFailure] = useState('');
  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => {
      if (node?.open) node.close();
    };
  }, []);
  let error = '';
  try {
    validateMission(mission);
  } catch (problem) {
    error = problem instanceof Error ? problem.message : String(problem);
  }
  const validation = validatePlanning(mission);
  const allowed =
    connected && editing && matches && !error && !busy && validation.valid;
  return (
    <dialog
      ref={dialog}
      className="mission-review"
      aria-labelledby="review-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="review-heading">
        <div>
          <span className="eyebrow">YÜKLEME ÖNCESİ KONTROL</span>
          <h2 id="review-title">Görev özetini doğrula</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Görev özetini kapat"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <p className="review-mission-name">{mission.name}</p>
      <span
        className={'recording-source ' + (source === 'local' ? 'sitl' : 'demo')}
      >
        {source === 'local' ? 'ARDUCOPTER SITL' : 'TARAYICI DEMOSU'}
      </span>
      <div className="review-facts">
        <span>
          Rota noktası<strong>{mission.waypoints.length}</strong>
        </span>
        <span>
          Planlanan mesafe
          <strong>
            {error ? '—' : routeLength(mission).toFixed(0) + ' m'}
          </strong>
        </span>
        <span>
          Kalkış irtifası<strong>{mission.takeoff_altitude_m} m</strong>
        </span>
      </div>
      <ol className="review-route">
        <li>
          <CheckCircle2 size={16} />
          <span>Kalkış · {mission.takeoff_altitude_m} m</span>
        </li>
        {mission.waypoints.map((point, index) => (
          <li key={index}>
            <span className="review-number">{index + 1}</span>
            <div>
              <strong>
                Nokta {index + 1} · {point.altitude_m} m
              </strong>
              <small>
                {point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}
              </small>
            </div>
          </li>
        ))}
        <li>
          <CheckCircle2 size={16} />
          <span>Son rota noktasında iniş</span>
        </li>
      </ol>
      {mission.planning && (
        <>
          <p className="muted">
            İzin verilen alan: {mission.planning.allowed_area.length} köşe ·
            Tarama alanı: {mission.planning.survey_area.length} köşe · Sınırlar:{' '}
            {mission.planning.max_distance_m} m /{' '}
            {mission.planning.max_altitude_m} m. Alan koordinatları bu görev
            özetiyle birlikte dondurulmuştur; otopilot geofence olarak
            yüklenmez.
          </p>
          <details>
            <summary>Alan koordinatlarını incele</summary>
            {(['allowed_area', 'survey_area'] as const).map((area) => (
              <div key={area}>
                <strong>
                  {area === 'allowed_area'
                    ? 'İzin verilen alan'
                    : 'Tarama alanı'}
                </strong>
                <ol>
                  {mission.planning![area].map((p, i) => (
                    <li key={i}>
                      {p.latitude.toFixed(6)}, {p.longitude.toFixed(6)}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </details>
          <ValidationSummary result={validation} />
        </>
      )}
      <p className="muted">
        İrtifalar eve göredir. Yükleme aracı arm etmez ve uçuşu başlatmaz.
        Aktarım tamamlanınca rota geri okunarak doğrulanır.
      </p>
      {(error || failure || !connected || !matches) && (
        <p className="review-error" role="alert">
          {error ||
            failure ||
            (!matches
              ? 'Görev değişti; özeti kapatıp yeniden açın.'
              : 'Yükleme için güncel araç bağlantısı gerekiyor.')}
        </p>
      )}
      <div className="review-actions">
        <button className="secondary" disabled={busy} onClick={onClose}>
          Düzenlemeye dön
        </button>
        <button
          className="primary"
          disabled={!allowed}
          onClick={() => {
            setFailure('');
            void onConfirm().catch((problem) =>
              setFailure(
                problem instanceof Error ? problem.message : String(problem),
              ),
            );
          }}
        >
          <ArrowUpToLine size={16} />
          {busy ? 'Yükleniyor…' : 'Doğrula ve yükle'}
        </button>
      </div>
    </dialog>
  );
}
