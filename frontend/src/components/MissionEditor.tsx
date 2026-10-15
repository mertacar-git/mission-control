import { useState, useEffect, useRef } from 'react';
import { ArrowUp, ArrowDown, Undo2, Redo2 } from 'lucide-react';
import { MissionReview } from './MissionReview';
import type { Dispatch, SetStateAction } from 'react';
import { Plus, Trash2, Database, ArrowUpToLine } from 'lucide-react';
import { download } from '../analysis';
import { routeLength } from '../missionPresentation';
import { validateMission, missionFingerprint, type Mission } from '../types';
type Props = {
  selectedIndex: number;
  onSelect: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
  source: 'demo' | 'local';
  mission: Mission;
  missions: Mission[];
  setMission: Dispatch<SetStateAction<Mission>>;
  editing: boolean;
  connected: boolean;
  editWaypoint: (
    index: number,
    field: 'latitude' | 'longitude' | 'altitude_m',
    value: number,
  ) => void;
  addPoint: () => void;
  saveMission: () => Promise<void>;
  uploadMission: (approved: Mission) => Promise<void>;
  onImport: () => void;
  setNotice: (message: string) => void;
};
export function MissionEditor({
  selectedIndex,
  onSelect,
  onReorder,
  undo,
  redo,
  canUndo,
  canRedo,
  busy,
  source,
  mission,
  missions,
  setMission,
  editing,
  connected,
  editWaypoint,
  addPoint,
  saveMission,
  uploadMission,
  onImport,
  setNotice,
}: Props) {
  const [review, setReview] = useState<Mission | null>(null);
  const list = useRef<HTMLDivElement>(null),
    rows = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    const container = list.current,
      row = rows.current[selectedIndex];
    if (
      container &&
      row &&
      (row.offsetTop < container.scrollTop ||
        row.offsetTop + row.offsetHeight >
          container.scrollTop + container.clientHeight)
    )
      container.scrollTo({ top: row.offsetTop, behavior: 'smooth' });
  }, [selectedIndex]);
  return (
    <section className="panel editor">
      <div className="panel-head">
        <div>
          <span className="eyebrow">GÖREV DÜZENLEYİCİSİ</span>
          <h2>Rota noktaları</h2>
        </div>
        <span className="count">{mission.waypoints.length} nokta</span>
      </div>
      <div className="draft-tools">
        <button
          className="secondary small"
          disabled={!editing || !canUndo}
          onClick={undo}
        >
          <Undo2 size={15} />
          Geri al
        </button>
        <button
          className="secondary small"
          disabled={!editing || !canRedo}
          onClick={redo}
        >
          <Redo2 size={15} />
          Yinele
        </button>
        <span>Son 100 değişiklik</span>
      </div>
      <div className="route-summary">
        <span>
          Planlanan mesafe
          <strong>
            {routeLength(mission).toFixed(0)} <small>m</small>
          </strong>
        </span>
        <span>
          Kalkış
          <strong>
            {mission.takeoff_altitude_m} <small>m</small>
          </strong>
        </span>
        <span>
          Bitiş<strong>İniş</strong>
        </span>
      </div>
      <label>
        Görev adı
        <input
          value={mission.name}
          maxLength={100}
          disabled={!editing}
          onChange={(e) => setMission({ ...mission, name: e.target.value })}
        />
      </label>
      <label>
        Kalkış irtifası · eve göre m
        <input
          type="number"
          min={5}
          max={120}
          value={mission.takeoff_altitude_m}
          disabled={!editing}
          onChange={(e) =>
            setMission({
              ...mission,
              takeoff_altitude_m: Number(e.target.value),
            })
          }
        />
      </label>
      <div className="waypoint-list" ref={list}>
        {mission.waypoints.map((point, index) => (
          <div
            className={
              'waypoint-row ' + (selectedIndex === index ? 'selected' : '')
            }
            key={index}
            ref={(node) => {
              rows.current[index] = node;
            }}
            onFocusCapture={() => {
              if (selectedIndex !== index) onSelect(index);
            }}
          >
            <div className="waypoint-title">
              <button
                className="waypoint-select"
                aria-label={`Nokta ${index + 1} seç`}
                aria-pressed={selectedIndex === index}
                onClick={() => onSelect(index)}
              >
                NOKTA {index + 1}
              </button>
              <div className="waypoint-controls">
                <button
                  className="icon-button"
                  aria-label={`Nokta ${index + 1} yukarı taşı`}
                  disabled={!editing || index === 0}
                  onClick={() => onReorder(index, index - 1)}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Nokta ${index + 1} aşağı taşı`}
                  disabled={!editing || index === mission.waypoints.length - 1}
                  onClick={() => onReorder(index, index + 1)}
                >
                  <ArrowDown size={15} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Nokta ${index + 1} sil`}
                  disabled={!editing || mission.waypoints.length === 1}
                  onClick={() =>
                    setMission({
                      ...mission,
                      waypoints: mission.waypoints.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div className="coordinate-inputs">
              <label>
                Enlem
                <input
                  aria-label={`Nokta ${index + 1} enlem`}
                  type="number"
                  step=".00001"
                  value={point.latitude}
                  disabled={!editing}
                  onChange={(e) =>
                    editWaypoint(index, 'latitude', Number(e.target.value))
                  }
                />
              </label>
              <label>
                Boylam
                <input
                  aria-label={`Nokta ${index + 1} boylam`}
                  type="number"
                  step=".00001"
                  value={point.longitude}
                  disabled={!editing}
                  onChange={(e) =>
                    editWaypoint(index, 'longitude', Number(e.target.value))
                  }
                />
              </label>
              <label className="altitude-input">
                İrtifa · m
                <input
                  aria-label={`Nokta ${index + 1} irtifa`}
                  type="number"
                  min={5}
                  max={120}
                  value={point.altitude_m}
                  disabled={!editing}
                  onChange={(e) =>
                    editWaypoint(index, 'altitude_m', Number(e.target.value))
                  }
                />
              </label>
            </div>
          </div>
        ))}
      </div>
      <button
        className="secondary full"
        disabled={!editing}
        onClick={() => addPoint()}
      >
        <Plus size={15} />
        Nokta ekle
      </button>
      <div className="editor-actions">
        <button
          className="secondary"
          disabled={!editing}
          onClick={() => void saveMission()}
        >
          <Database size={15} />
          Kaydet
        </button>
        <button
          className="primary"
          disabled={!editing || !connected}
          onClick={() => setReview(structuredClone(mission))}
        >
          <ArrowUpToLine size={15} />
          Görevi yükle
        </button>
      </div>
      <div className="file-actions">
        <button disabled={!editing} onClick={() => onImport()}>
          JSON içe aktar
        </button>
        <button
          onClick={() => {
            try {
              download(
                'mission.json',
                JSON.stringify(validateMission(mission), null, 2),
              );
            } catch (e) {
              setNotice(String(e));
            }
          }}
        >
          JSON dışa aktar
        </button>
      </div>
      {missions.length > 0 && (
        <label>
          Kayıtlı görev
          <select
            disabled={!editing}
            value=""
            onChange={(e) => {
              const m = missions.find((m) => m.id === e.target.value);
              if (m) setMission(validateMission(m));
            }}
          >
            <option value="">Görev seçin…</option>
            {missions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {review && (
        <MissionReview
          mission={review}
          source={source}
          connected={connected}
          editing={editing}
          busy={busy}
          matches={missionFingerprint(review) === missionFingerprint(mission)}
          onClose={() => setReview(null)}
          onConfirm={async () => {
            await uploadMission(review);
            setReview(null);
          }}
        />
      )}
    </section>
  );
}
