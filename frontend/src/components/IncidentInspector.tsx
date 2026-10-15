import { eventTime, incidentContext, incidentEvents } from '../incidents';
import { eventLabel } from './EventLog';
import type { Recording, Telemetry } from '../types';

export function IncidentInspector({
  recording,
  time,
  onSeek,
}: {
  recording: Recording;
  time: number;
  onSeek: (time: number) => void;
}) {
  const incidents = incidentEvents(recording),
    context = incidentContext(recording, time);
  const first = recording.events.find((e) => e.type === 'telemetry');
  const origin = first ? (first.payload as unknown as Telemetry).elapsed_s : 0;
  return (
    <section className="panel incident-inspector">
      <div className="panel-head">
        <div>
          <span className="eyebrow">UÇUŞ SONRASI İNCELEME</span>
          <h2>Olayın öncesi ve sonrası</h2>
        </div>
        <span className="count">{incidents.length} olay</span>
      </div>
      <p className="muted">
        Bir olay seçin. Harita, ölçümler ve grafik aynı ana gider. ±10 saniyelik
        bağlam; komut ile olay arasında nedensellik varsayılmaz.
      </p>
      <div className="incident-grid">
        <div className="incident-list" aria-label="İncelenebilir olaylar">
          {incidents.length === 0 && (
            <p>
              Bu kayıtta işaretlenmiş bir olay yok. Zaman çizelgesinden herhangi
              bir anı inceleyebilirsiniz.
            </p>
          )}
          {incidents.map((event, i) => {
            const at = eventTime(recording, event);
            return (
              <button
                key={i}
                className="secondary incident-item"
                disabled={at === null}
                onClick={() => at !== null && onSeek(at)}
              >
                <span>
                  {at === null
                    ? 'Ölçüm yok'
                    : at < origin - 0.05
                      ? 'Ölçüm öncesi'
                      : `${Math.max(0, at - origin).toFixed(1)} s`}
                </span>
                <strong>{eventLabel(event)}</strong>
              </button>
            );
          })}
        </div>
        <div>
          <h3>Seçili an · {Math.max(0, time - origin).toFixed(1)} s</h3>
          <p>
            {context.frame?.position_fresh
              ? 'Konum güncel'
              : 'Konum bilinmiyor / ölçüm boşluğu'}{' '}
            · {context.frame?.flight_mode ?? 'Mod bilinmiyor'}
          </p>
          <p>
            GPS fix: {context.frame?.gps_fix_type ?? '—'} · Batarya:{' '}
            {context.frame?.battery_voltage_v?.toFixed(2) ?? '—'} V
          </p>
          <h3>Önceki komut olayı</h3>
          <p>
            {context.precedingCommand
              ? eventLabel(context.precedingCommand)
              : 'Bu andan önce kaydedilmiş komut yok.'}
          </p>
          <h3>±10 s olay bağlamı</h3>
          <ol className="incident-context">
            {context.events.map((e, i) => (
              <li key={i}>
                <button
                  onClick={() => {
                    const at = eventTime(recording, e);
                    if (at !== null) onSeek(at);
                  }}
                >
                  {eventLabel(e)}
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
