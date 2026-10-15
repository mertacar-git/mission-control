import { Check, Circle, Radio, ArrowUpToLine, ShieldCheck } from 'lucide-react';
import type { Status } from '../types';
import { useState } from 'react';

export function MissionReadiness({
  status,
  matches,
  local,
}: {
  status: Status;
  matches: boolean;
  local: boolean;
}) {
  const [action, setAction] = useState<'arm' | 'start' | 'resume'>('start');
  if (local) {
    const assessment = status.preflight?.[action];
    const names: Record<string, string> = {
      controller: 'Kontrol sahipliği',
      simulator: 'SITL kaynağı',
      connection: 'Bağlantı',
      position: 'Güncel konum',
      gps: 'GPS',
      ekf: 'EKF',
      battery: 'Batarya',
      operation: 'İşlem kilidi',
      armed: 'Motor durumu',
      disarmed: 'Motor durumu',
      upload: 'Görev aktarımı',
      mission: 'Görev geçerliliği',
    };
    return (
      <section className="panel readiness-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">BACKEND / UÇUŞ ÖNCESİ</span>
            <h2>Hazırlık kontrolü</h2>
          </div>
          <span className="count">
            {assessment?.ready ? 'Hazır' : 'Hazır değil'}
          </span>
        </div>
        <label>
          Kontrol edilecek işlem{' '}
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as typeof action)}
          >
            <option value="arm">Arm</option>
            <option value="start">Görevi başlat</option>
            <option value="resume">Devam et</option>
          </select>
        </label>
        {!matches && (
          <p>
            Taslak yüklenmiş görevle eşleşmiyor. Başlatma değerlendirmesi
            yüklenmiş göreve aittir.
          </p>
        )}
        {!assessment ? (
          <p>Backend değerlendirmesi bekleniyor · bilinmiyor</p>
        ) : (
          <>
            <ol className="readiness-list">
              {assessment.checks.map((c) => (
                <li key={c.id} className={c.state === 'ready' ? 'ready' : ''}>
                  <div>
                    <strong>
                      {names[c.id] ?? c.id} ·{' '}
                      {c.state === 'ready'
                        ? 'Hazır'
                        : c.state === 'blocked'
                          ? 'Engel'
                          : 'Bilinmiyor'}
                    </strong>
                    <small>{c.reason}</small>
                  </div>
                </li>
              ))}
            </ol>
            <small>
              Değerlendirme:{' '}
              {new Date(assessment.evaluated_utc).toLocaleTimeString('tr-TR')} ·
              Komut öncesinde yeniden kontrol edilir.
            </small>
          </>
        )}
      </section>
    );
  }
  const checks = [
    {
      label: 'Bağlantı',
      detail:
        status.state === 'connected'
          ? 'Telemetri güncel'
          : 'Araç bağlantısını açın',
      ready: status.state === 'connected',
      icon: Radio,
    },
    {
      label: 'Görev aktarımı',
      detail: matches ? 'Rota doğrulandı' : 'Görevi yükleyip doğrulayın',
      ready: matches,
      icon: ArrowUpToLine,
    },
    {
      label: 'Uçuşa hazırlık',
      detail: status.telemetry.armed
        ? 'Motorlar hazır'
        : local && !status.telemetry.navigation_ready
          ? 'EKF konum tahmini bekleniyor'
          : 'Arm komutunu gönderin',
      ready: status.telemetry.armed === true,
      icon: ShieldCheck,
    },
  ];
  const completed = checks.filter((check) => check.ready).length;
  return (
    <section className="panel readiness-panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">UÇUŞ ÖNCESİ</span>
          <h2>Hazırlık kontrolü</h2>
        </div>
        <span className="count">{completed} / 3</span>
      </div>
      <ol className="readiness-list">
        {checks.map(({ label, detail, ready, icon: Icon }, i) => (
          <li key={label} className={ready ? 'ready' : ''}>
            <span className="readiness-icon">
              <Icon size={17} />
            </span>
            <div>
              <strong>{label}</strong>
              <small>{detail}</small>
            </div>
            {ready ? (
              <Check size={17} />
            ) : (
              <span className="step-index">0{i + 1}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
