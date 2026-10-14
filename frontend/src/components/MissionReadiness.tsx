import { Check, Circle, Radio, ArrowUpToLine, ShieldCheck } from 'lucide-react';
import type { Status } from '../types';

export function MissionReadiness({
  status,
  matches,
  local,
}: {
  status: Status;
  matches: boolean;
  local: boolean;
}) {
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
