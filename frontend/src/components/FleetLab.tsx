import { useEffect, useState } from 'react';
import { download } from '../analysis';
import {
  devices,
  initialFleet,
  ingest,
  freshness,
  permitStatus,
  requestPermit,
  decidePermit,
  cancelPermit,
  stationConnection,
  observe,
  type Fleet,
  type Role,
  type Observation,
} from '../fleet';
const roles: Record<Role, string> = {
  'station-a': 'İstasyon A',
  'station-b': 'İstasyon B',
  center: 'Merkez',
};
const labels: Record<string, string> = {
  fresh: 'Güncel',
  stale: 'Veri gecikmiş',
  disconnected: 'Bağlantı kesilmiş',
  unknown: 'Bilinmiyor',
  grounded: 'Yerde',
  airborne: 'Havada',
  landing: 'İnişte',
  pending: 'Bekliyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  cancelled: 'İptal edildi',
  expired: 'Süresi doldu',
};
export function FleetLab() {
  const [state, setState] = useState<Fleet>(() => initialFleet(Date.now()));
  const [now, setNow] = useState(Date.now()),
    [role, setRole] = useState<Role>('station-a'),
    [reason, setReason] = useState(''),
    [query, setQuery] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setState((s) => ingest(s, t));
    }, 500);
    return () => clearInterval(timer);
  }, []);
  function act(action: (s: Fleet) => Fleet) {
    setError('');
    try {
      setState(action(state));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <section className="panel fleet-lab">
      <span className="eyebrow">SİVİL FİLO · TARAYICI SİMÜLASYONU</span>
      <h2>Üç cihaz, iki örnek istasyon, bir merkez</h2>
      <p className="notice">
        Bu ekran sentetik bir iş akışı prototipidir. Rol seçimi gerçek kimlik
        doğrulama değildir; başka bilgisayara veya araca bağlanmaz. Onaylar uçuş
        komutu veya resmî hava sahası izni değildir.
      </p>
      <div className="thresholds">
        <label>
          Simülasyon rolü
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value as Role);
              setError('');
            }}
          >
            {Object.entries(roles).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Cihazlarda ara
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Seri numarası, model veya ekipman"
          />
        </label>
      </div>
      {role !== 'center' && (
        <button
          className="secondary small"
          onClick={() =>
            act((s) =>
              stationConnection(s, role, role, !s.stations[role], Date.now()),
            )
          }
        >
          {state.stations[role]
            ? 'İstasyon akışını kes'
            : 'İstasyon akışını aç'}
        </button>
      )}
      <div className="fleet-stations">
        {(['station-a', 'station-b'] as const).map((id) => (
          <span key={id}>
            {roles[id]} ·{' '}
            {state.stations[id] ? 'Sentetik akış açık' : 'Sentetik akış kapalı'}
          </span>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      {!devices.some(d=>(d.serial+' '+d.model+' '+d.equipment.join(' ')).toLocaleLowerCase('tr').includes(query.toLocaleLowerCase('tr'))) && <p role="status">Aramayla eşleşen cihaz yok.</p>}
      <div className="fleet-grid">
        {devices
          .filter((d) =>
            (d.serial + ' ' + d.model + ' ' + d.equipment.join(' '))
              .toLocaleLowerCase('tr')
              .includes(query.toLocaleLowerCase('tr')),
          )
          .map((d) => {
            const sample = state.samples[d.id],
              connection = freshness(sample, now),
              current = connection === 'fresh';
            return (
              <article className="panel" key={d.id}>
                <span className="eyebrow">{d.serial}</span>
                <h3>{d.name}</h3>
                <p>
                  {d.model} · {roles[d.station]} · {d.firmware}
                </p>
                <ul>
                  {d.equipment.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
                <dl>
                  <dt>Veri durumu</dt>
                  <dd>{labels[connection]}</dd>
                  <dt>Gözlenen durum</dt>
                  <dd>{current ? labels[sample.observation] : 'Bilinmiyor'}</dd>
                  <dt>Batarya · sentetik</dt>
                  <dd>
                    {current && sample.battery !== null
                      ? sample.battery + ' %'
                      : '—'}
                  </dd>
                  <dt>Son örnek yaşı</dt>
                  <dd>
                    {Math.max(0, (now - sample.received) / 1000).toFixed(1)} s
                  </dd>
                </dl>
                {role === d.station && (
                  <>
                    <div className="row-actions">
                      <button
                        className="secondary small"
                        onClick={() =>
                          act((s) =>
                            requestPermit(
                              s,
                              role,
                              d.id,
                              'takeoff',
                              Date.now(),
                              crypto.randomUUID(),
                            ),
                          )
                        }
                      >
                        Kalkış talebi · {d.serial}
                      </button>
                      <button
                        className="secondary small"
                        onClick={() =>
                          act((s) =>
                            requestPermit(
                              s,
                              role,
                              d.id,
                              'landing',
                              Date.now(),
                              crypto.randomUUID(),
                            ),
                          )
                        }
                      >
                        İniş talebi · {d.serial}
                      </button>
                    </div>
                    <label>
                      Ayrı simülasyon gözlemi · {d.serial}
                      <select
                        value={sample.observation}
                        disabled={!state.stations[d.station]}
                        onChange={(e) =>
                          act((s) =>
                            observe(
                              s,
                              role,
                              d.id,
                              e.target.value as Observation,
                              Date.now(),
                            ),
                          )
                        }
                      >
                        {['grounded', 'airborne', 'landing'].map((x) => (
                          <option key={x} value={x}>
                            {labels[x]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </article>
            );
          })}
      </div>
      <h3>Talep ve onay defteri</h3>
      <p>
        Talep ve onay 120 saniyelik pencereye aittir. Onay cihaz durumunu
        değiştirmez; gözlem ayrı simülasyon kontrolünden gelir. Bu sayfadan
        çıkınca örnek oturum sıfırlanır.
      </p>
      {role === 'center' && (
        <label>
          Karar gerekçesi
          <input
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      )}
      {!state.permits.length && (
        <p>
          Henüz talep yok. Bir istasyon rolü seçip cihazdan talep oluşturun.
        </p>
      )}
      {state.permits.map((p) => {
        const status = permitStatus(p, now);
        return (
          <article className="scenario-result" key={p.id}>
            <h4>
              {devices.find((d) => d.id === p.device)?.serial} ·{' '}
              {p.kind === 'takeoff' ? 'Kalkış' : 'İniş'} · {labels[status]}
            </h4>
            <p>
              {roles[p.requestedBy]} ·{' '}
              {new Date(p.created).toLocaleTimeString('tr-TR')} · Son
              geçerlilik: {new Date(p.expires).toLocaleTimeString('tr-TR')} ·{' '}
              {p.id.slice(0, 8)}
            </p>
            {p.reason && <p>Gerekçe: {p.reason}</p>}
            <div className="row-actions">
              {role === 'center' && status === 'pending' && (
                <>
                  <button
                    onClick={() =>
                      act((s) =>
                        decidePermit(s, role, p.id, true, reason, Date.now()),
                      )
                    }
                  >
                    Onayla
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      act((s) =>
                        decidePermit(s, role, p.id, false, reason, Date.now()),
                      )
                    }
                  >
                    Reddet
                  </button>
                </>
              )}
              {['pending', 'approved'].includes(status) &&
                (role === 'center' || role === p.requestedBy) && (
                  <button
                    className="secondary"
                    onClick={() =>
                      act((s) => cancelPermit(s, role, p.id, Date.now()))
                    }
                  >
                    İptal et
                  </button>
                )}
            </div>
          </article>
        );
      })}
      <h3>Örnek olay günlüğü</h3>
      {!state.events.length ? (
        <p>Henüz olay yok.</p>
      ) : (
        <ol>
          {state.events
            .slice(-20)
            .reverse()
            .map((e, i) => (
              <li key={i}>
                {new Date(e.at).toLocaleTimeString('tr-TR')} · {roles[e.actor]}{' '}
                · {e.detail}
              </li>
            ))}
        </ol>
      )}
      <button
        className="secondary"
        onClick={() =>
          download(
            'civil-fleet-simulation.json',
            JSON.stringify(
              { ...state, exported_utc: new Date().toISOString(), retention_limits: {permits:100,events:500}, permits: state.permits.map(p=>({...p,effective_status:permitStatus(p,Date.now())})) },
              null,
              2,
            ),
          )
        }
      >
        Simülasyon raporunu indir
      </button>
    </section>
  );
}
