import type { FlightEvent } from '../types';
import { observationLabels, scenarioStatus } from '../scenarioLabels';
const names = {
  closed: 'Bağlantı kapalı',
  connecting: 'Bağlanıyor',
  connected: 'Bağlı',
  stale: 'Veri gecikmiş',
  disconnected: 'Bağlantı kesildi',
};
const actionNames: Record<string, string> = {
  arm: 'Arm',
  start: 'Başlat',
  hold: 'Beklet',
  resume: 'Devam et',
  return: 'Eve dön',
  land: 'İniş',
};
export function eventLabel(event: FlightEvent) {
  const p = event.payload;
  if (event.type === 'preflight')
    return `Hazırlık kontrolü · ${actionNames[String(p.action)] ?? p.action} · ${p.ready ? 'hazır' : 'engel veya bilinmeyen ölçüm'}`;
  if (event.type === 'mission_lifecycle')
    return 'Görev durumu · ' + (({preparing:'hazırlık',loaded:'yüklendi',executing:'yürütülüyor',holding:'bekletiliyor',returning:'eve dönüş',landing:'iniş',completed:'tamamlandı',unknown:'bilinmiyor'} as Record<string,string>)[String(p.state)] ?? String(p.state));
  if (event.type === 'scenario') {
    if (p.status === 'started')
      return (
        'Deney başladı · ' +
        ((
          {
            gps_loss: 'GPS kaybı',
            heartbeat_loss: 'Telemetri kesilmesi',
            low_battery: 'Düşük batarya',
          } as Record<string, string>
        )[String(p.kind)] ?? String(p.kind))
      );
    const key = String(p.label ?? p.fault ?? p.name ?? p.kind ?? p.status);
    return (
      'Deney · ' +
      (observationLabels[key] ?? scenarioStatus[key] ?? key) +
      (p.label ? ' · ' + (scenarioStatus[String(p.status)] ?? p.status) : '')
    );
  }
  if (event.type === 'fence')
    return (
      'Görev sınırı · ' +
      ((
        {
          inside: 'içeride',
          outside: 'İHLAL GÖZLENDİ',
          unknown: 'ölçüm bilinmiyor',
          unconfigured: 'tanımlanmadı',
        } as Record<string, string>
      )[String(p.state)] ?? String(p.state))
    );
  if (event.type === 'command')
    return `${actionNames[String(p.action)] ?? p.action} · ${p.status === 'requested' ? 'istendi' : p.status === 'acknowledged' ? 'kabul edildi' : p.status === 'observed' ? 'telemetride gözlendi' : p.status === 'timed_out' ? 'zaman aşımı' : p.status === 'not_observed' ? 'henüz gözlenmedi' : 'başarısız'}${p.error ? ' · ' + p.error : ''}`;
  if (event.type === 'connection')
    return names[p.state as keyof typeof names] ?? String(p.state);
  if (event.type === 'mission_transfer')
    return (
      'Görev aktarımı · ' +
      ((
        { uploading: 'yükleniyor', verified: 'doğrulandı' } as Record<
          string,
          string
        >
      )[String(p.status)] ?? String(p.status))
    );
  if (event.type === 'mission_progress')
    return 'Rota noktasına ulaşıldı · ' + p.reached_index;
  if (event.type === 'recording')
    return p.status === 'started'
      ? 'Uçuş kaydı başladı'
      : 'Uçuş kaydı durduruldu';
  return String(p.text ?? event.type);
}

export function EventLog({ events }: { events: FlightEvent[] }) {
  const meaningful = events.filter((event) => event.type !== 'telemetry');
  return (
    <section className="panel event-panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">OTURUM KAYDI</span>
          <h2>Olay günlüğü</h2>
        </div>
        <span className="count">{meaningful.length}</span>
      </div>
      <div className="event-list">
        {meaningful.length === 0 ? (
          <div className="empty-events">
            <span className="empty-signal">○</span>
            <strong>Henüz bir olay yok</strong>
            <p>
              Bağlantı, görev aktarımı ve komut sonuçları burada zaman sırasıyla
              görünür.
            </p>
          </div>
        ) : (
          [...meaningful]
            .reverse()
            .slice(0, 30)
            .map((event, index) => (
              <div className="event" key={event.sequence ?? index}>
                <i
                  className={
                    ['failed', 'timed_out', 'not_observed'].includes(
                      String(event.payload.status),
                    )
                      ? 'warning'
                      : event.type === 'command'
                        ? 'blue'
                        : ''
                  }
                />
                <div>
                  <strong>{eventLabel(event)}</strong>
                  <small>
                    {new Date(event.received_utc).toLocaleTimeString('tr-TR')}
                  </small>
                </div>
              </div>
            ))
        )}
      </div>
    </section>
  );
}
