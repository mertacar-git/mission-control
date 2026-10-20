import { useEffect, useRef, useState } from 'react';
import { OperatorAdministration } from './OperatorAdministration';
import { DeviceEnrollment } from './DeviceEnrollment';
import { operatorBase, operatorError } from '../operatorApi';
import { CenterSensorPrototype } from './CenterSensorPrototype';

interface User { username: string; role: 'admin' | 'operator' }
interface RegistryView {
  user: User;
  registry: { schema_version: 1; devices: {
    device: { serial: string; name: string; model: string; station: string; firmware: string; equipment?: string[] };
    state: 'fresh' | 'stale' | 'disconnected' | 'unknown';
    age_s: number | null;
    measurement: { source: string; temperature_c: number | null; pressure_pa: number | null; humidity_percent: number | null;
      sensor_protocol?: string | null; stream_id?: string | null; firmware_code?: number | null;
      acceleration_x_ms2?: number | null; acceleration_y_ms2?: number | null; acceleration_z_ms2?: number | null;
      angular_velocity_x_rads?: number | null; angular_velocity_y_rads?: number | null; angular_velocity_z_rads?: number | null } | null;
  }[] };
}
const base = operatorBase;
const sensorNumber = (value: number | null | undefined) => value == null ? '—' : value.toFixed(3);

export function OperatorCenter() {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<RegistryView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision,setRevision] = useState(0), [search,setSearch] = useState('');
  const [receivedAt, setReceivedAt] = useState(0), [clock, setClock] = useState(0);
  const operation = useRef(false);

  useEffect(() => {
    if (!token) return;
    const timer = setInterval(() => setClock(performance.now()), 250);
    return () => clearInterval(timer);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let disposed = false, pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch(base + '/registry', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(4000), cache: 'no-store' });
        if (response.status === 401) {
          if (!disposed) { setToken(''); setUser(null); setView(null); setError('Oturum sona erdi veya hesap kapatıldı. Yeniden giriş yapın.'); }
          return;
        }
        if (!response.ok) throw Error(await operatorError(response));
        const next: RegistryView = await response.json();
        if (next.registry?.schema_version !== 1 || !Array.isArray(next.registry.devices) || !['admin', 'operator'].includes(next.user?.role)) throw Error('Sicil yanıtı uyumsuz.');
        next.registry.devices = next.registry.devices.map(row => ({ ...row, measurement: row.state === 'fresh' ? row.measurement : null }));
        if (!disposed) { const receipt = performance.now(); setReceivedAt(receipt); setClock(receipt); setView(next); setError(''); }
      } catch (reason) {
        if (!disposed) { setView(null); setError(reason instanceof TypeError || reason instanceof DOMException ? 'Güvenli hesap servisine ulaşılamıyor. Güncel ölçüm gösterilemiyor.' : reason instanceof Error ? reason.message : 'Sicil yanıtı okunamadı.'); }
      } finally { pending = false; }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => { disposed = true; clearInterval(timer); };
  }, [token,revision]);

  async function login() {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(base + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(8000), cache: 'no-store' });
      if (!response.ok) throw Error(response.status === 429 ? 'Giriş sınırına ulaşıldı. Daha sonra tekrar deneyin.' : 'Giriş doğrulanamadı. Kullanıcı bilgilerini kontrol edin.');
      const result = await response.json();
      if (typeof result.token !== 'string' || !['admin','operator'].includes(result.role) || typeof result.username !== 'string') throw Error('Hesap yanıtı uyumsuz.');
      setUser({ username: result.username, role: result.role }); setToken(result.token);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Güvenli hesap servisine ulaşılamıyor.'); }
    finally { setPassword(''); setBusy(false); operation.current = false; }
  }
  async function logout() {
    if (operation.current) return;
    operation.current = true; setBusy(true);
    const previous = token;
    setToken(''); setUser(null); setView(null); setError('');
    try {
      const response = await fetch(base + '/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + previous }, signal: AbortSignal.timeout(4000) });
      if (!response.ok && response.status !== 401) throw Error();
    } catch { setError('Ekran oturumu kapandı; sunucu çıkışı doğrulanamadı. Sunucu oturumu en fazla 15 dakika sürer.'); }
    finally { setBusy(false); operation.current = false; }
  }
  return <section className="panel fleet-lab operator-center">
    <span className="eyebrow">HTTPS MERKEZ · GERÇEK KULLANICI HESABI</span>
    <h2>Güvenli merkez sicili</h2>
    <p>Sunucunun doğruladığı kullanıcı yetkileriyle sivil cihaz bilgileri ve istasyon ölçümleri izlenir. Tarayıcı rol simülasyonu bu hesabı değiştirmez.</p>
    {!local ? <p>Bu bağlantı yalnızca yerel uygulamada kullanılabilir. Public demo kullanıcı hesabına veya cihaz servisine bağlanmaz.</p> : <>
      <p>8772 portundaki HTTPS hesap servisi, 8771 portundaki mTLS siciline bağlanır. Token yalnızca bu ekranın belleğinde tutulur.</p>
      {!token ? <form onSubmit={e => { e.preventDefault(); void login(); }}>
        <label>Merkez kullanıcı adı<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} disabled={busy} /></label>
        <label>Merkez parolası<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></label>
        <button disabled={busy || !username || !password}>Merkeze giriş yap</button>
      </form> : <><p>Hesap: {user?.username} · Yetki: {user?.role === 'admin' ? 'Yönetici' : 'Operatör'}</p><button className="secondary" disabled={busy} onClick={() => void logout()}>Merkez oturumunu kapat</button></>}
    </>}
    {busy && <p role="status">Hesap işlemi doğrulanıyor…</p>}
    {error && <p role="alert">{error}</p>}
    {token && <button className="secondary" onClick={()=>setRevision(value=>value+1)}>Sicili yenile</button>}
    {token && user?.role === 'admin' && <DeviceEnrollment token={token} onCreated={()=>setRevision(value=>value+1)} />}
    {token && user && <OperatorAdministration token={token} username={user.username} role={user.role} onSessionEnd={message => { setToken(''); setUser(null); setView(null); setError(message); }} />}
    {view && <><p>{view.registry.devices.length} kayıtlı cihaz · Sunucudan alınan sicil</p>
      {!view.registry.devices.length && <p>Sicilde cihaz yok.</p>}
      <label>Sicilde ara<input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Seri numarası, ad, model veya istasyon" /></label>
      {!!view.registry.devices.length && !view.registry.devices.some(row=>[row.device.serial,row.device.name,row.device.model,row.device.station].join(' ').toLocaleLowerCase('tr').includes(search.toLocaleLowerCase('tr'))) && <p>Aramaya uygun cihaz yok.</p>}
      <div className="fleet-grid">{view.registry.devices.filter(row=>[row.device.serial,row.device.name,row.device.model,row.device.station].join(' ').toLocaleLowerCase('tr').includes(search.toLocaleLowerCase('tr'))).map(row => {
        const age = row.age_s === null ? null : row.age_s + Math.max(0, clock - receivedAt) / 1000;
        const state = age === null ? 'unknown' : age >= 10 ? 'disconnected' : age >= 3 && row.state === 'fresh' ? 'stale' : row.state;
        const measurement = state === 'fresh' ? row.measurement : null;
        return <article className="panel" key={row.device.serial}>
        <h3>{row.device.serial}</h3><p>{row.device.name} · {row.device.model}</p><p>{row.device.station} · {row.device.firmware}</p>
        <details><summary>Cihaz ayrıntısı · {row.device.serial}</summary><p>Seri: {row.device.serial}</p><p>Kayıtlı firmware: {row.device.firmware}</p><p>Atama: {row.device.station}</p>
          <p>Ekipman: {row.device.equipment?.join(', ') || 'Belirtilmedi'}</p>
          <p>Ölçüm protokolü: {measurement?.sensor_protocol ?? '—'} · Akış: {measurement?.stream_id ?? '—'}</p>
          <p>Ölçüm firmware kodu: {measurement?.firmware_code ?? '—'}</p>
          <p>İvme X / Y / Z: {sensorNumber(measurement?.acceleration_x_ms2)} / {sensorNumber(measurement?.acceleration_y_ms2)} / {sensorNumber(measurement?.acceleration_z_ms2)} m/s²</p>
          <p>Açısal hız X / Y / Z: {sensorNumber(measurement?.angular_velocity_x_rads)} / {sensorNumber(measurement?.angular_velocity_y_rads)} / {sensorNumber(measurement?.angular_velocity_z_rads)} rad/s</p>
          <p>Merkez en fazla 5 Hz güncel görüntü alır. Tam paket kaydı Seri cihaz arşivindedir. Seri kaynak bildirimi fiziksel sensör kimliği veya doğruluk kanıtı değildir.</p>
        </details>
        <p>Veri durumu: {{ fresh: 'Güncel', stale: 'Gecikmiş', disconnected: 'Bağlantı kesildi', unknown: 'Bilinmiyor' }[state] ?? 'Bilinmiyor'}</p>
        <p>Kaynak: {measurement?.source === 'synthetic' ? 'Sentetik istasyon' : measurement?.source === 'serial' ? 'İstasyonun seri kaynak bildirimi' : 'Bilinmiyor'}</p>
        <p>Sıcaklık: {measurement?.temperature_c ?? '—'} °C · Nem: {measurement?.humidity_percent ?? '—'} %</p>
        <p>Basınç: {measurement?.pressure_pa ?? '—'} Pa · Ölçüm yaşı: {age === null ? '—' : age.toFixed(1) + ' s'}</p>
      </article>; })}</div></>}
    {token && user && <CenterSensorPrototype token={token} />}
  </section>;
}
