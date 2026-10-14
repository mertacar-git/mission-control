import { useState } from 'react';
import { FileJson, Play, ArrowDownToLine, Database } from 'lucide-react';
import { analyze, frames, download } from '../analysis';
import type { Recording } from '../types';
type Props = {
  recordings: Recording[];
  local: boolean;
  busy: boolean;
  onImport: () => void;
  onLoad: () => Promise<void>;
  onReplay: (recording: Recording) => void;
  onAnalyze: (recording: Recording) => void;
};
export function RecordingArchive({
  recordings,
  local,
  busy,
  onImport,
  onLoad,
  onReplay,
  onAnalyze,
}: Props) {
  const [query, setQuery] = useState(''),
    [source, setSource] = useState('all');
  const filtered = recordings.filter(
    (recording) =>
      (source === 'all' || recording.session.source === source) &&
      recording.session.name
        .toLocaleLowerCase('tr')
        .includes(query.toLocaleLowerCase('tr')),
  );
  return (
    <section className="panel recordings-panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">UÇUŞ ARŞİVİ</span>
          <h2>Kayıtlar ve tekrar oynatma</h2>
        </div>
        <div className="row-actions">
          <button className="secondary small" onClick={() => onImport()}>
            <FileJson size={15} />
            Kayıt içe aktar
          </button>
          {local && (
            <button
              className="secondary small"
              disabled={busy}
              onClick={() => void onLoad()}
            >
              Backend kayıtlarını getir
            </button>
          )}
        </div>
      </div>
      <p className="muted">
        Örnek kayıt demo modelinden üretilmiştir. SITL kayıtları gerçek
        simülatör telemetrisini içerir.
      </p>
      <div className="archive-toolbar">
        <label>
          Kayıtlarda ara
          <input
            type="search"
            placeholder="Görev veya kayıt adı"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          Veri kaynağı
          <select
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            <option value="all">Tüm kaynaklar</option>
            <option value="sitl">ArduCopter SITL</option>
            <option value="demo">Tarayıcı demosu</option>
          </select>
        </label>
        <span>
          {filtered.length} / {recordings.length} kayıt
        </span>
      </div>
      {filtered.length === 0 && (
        <div className="archive-empty">
          <Database size={28} />
          <h3>Eşleşen kayıt bulunamadı</h3>
          <p>Aramayı veya kaynak filtresini değiştirin.</p>
          <button
            className="secondary"
            onClick={() => {
              setQuery('');
              setSource('all');
            }}
          >
            Filtreleri temizle
          </button>
        </div>
      )}
      <div className="recording-grid">
        {filtered.map((r) => (
          <article className="recording-card" key={r.session.id}>
            <span className={'recording-source ' + r.session.source}>
              {r.session.source === 'sitl' ? 'SITL KAYDI' : 'DEMO KAYDI'}
            </span>
            <h3>{r.session.name}</h3>
            <p>
              {frames(r).length} örnek · {analyze(r).duration_s.toFixed(1)} s
            </p>
            <span className="muted">
              {new Date(r.session.started_utc).toLocaleString('tr-TR')}
            </span>
            <div>
              <button className="primary small" onClick={() => onReplay(r)}>
                <Play size={14} />
                Oynat
              </button>
              <button
                className="secondary small"
                onClick={() => {
                  onAnalyze(r);
                }}
              >
                Analiz
              </button>
              <button
                className="icon-button"
                aria-label={`${r.session.name} JSON indir`}
                onClick={() =>
                  download('flight-session.json', JSON.stringify(r, null, 2))
                }
              >
                <ArrowDownToLine size={17} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
