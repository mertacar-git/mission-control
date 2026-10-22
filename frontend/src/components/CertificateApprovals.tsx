import { useRef, useState } from 'react';
import { operatorBase } from '../operatorApi';
interface Review { station_id: string; new_fingerprint: string; old_fingerprints: string[]; expires_utc: string }
interface Approval { id: string; station_id: string; approved_by: string; state: string; expires_utc_ms: number; operation_id: string | null }
const states: Record<string, string> = { approved: 'Onaylı', expired: 'Süresi doldu', authorization_revoked: 'Oturum / yetki geçersiz', consumed: 'Kullanıldı · sonuç incelenmeli', applied: 'Etkinleştirildi', unknown: 'Sonuç belirsiz · inceleme gerekli' };
export function CertificateApprovals({ token }: { token: string }) {
  const [station, setStation] = useState('station-a'), [pem, setPem] = useState(''), [reason, setReason] = useState('');
  const [review, setReview] = useState<Review | null>(null), [rows, setRows] = useState<Approval[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [created, setCreated] = useState('');
  const lock = useRef(false), inventoryRevision = useRef(0);
  async function request(path: string, body?: unknown) {
    const response = await fetch(operatorBase + '/station-approvals' + path, {
      method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw Error(response.status === 401 ? 'Oturum sona erdi; yeniden giriş yapın.' : response.status === 409 ? 'Kimlik kaydı değişmiş veya işlem sürüyor. Yeniden inceleyin.' : 'Sertifika veya yetki doğrulanamadı. Sonucu listeden kontrol edin.');
    return response.json();
  }
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    inventoryRevision.current++;
    lock.current = true; setBusy(true); setError('');
    try { await action(); } catch (failure) { setReview(null); setError(failure instanceof Error ? failure.message : 'Sonuç belirsiz. Otomatik tekrar gönderilmedi.'); }
    finally { lock.current = false; setBusy(false); }
  }
  function invalidate() { setReview(null); setCreated(''); }
  return <details onToggle={event => { if (event.currentTarget.open) { const revision = ++inventoryRevision.current; void request('').then(value => { if (revision === inventoryRevision.current) setRows(value); }).catch(() => { if (revision === inventoryRevision.current) setError('Onay listesi alınamadı. Listeyi yenileyerek tekrar kontrol edin.'); }); } }}>
    <summary>İstasyon sertifikası için yönetici onayı</summary>
    <p>Yalnızca offline imzalanmış açık sertifikayı inceleyin. Özel anahtar yüklemeyin. Onay en fazla 15 dakika ve bu oturum süresince geçerlidir; çıkış veya hesap yetkisinin kaldırılması kullanılmamış onayı geçersiz kılar.</p>
    <label>İstasyon <select disabled={busy} value={station} onChange={event => { setStation(event.target.value); invalidate(); }}><option>station-a</option><option>station-b</option></select></label>
    <label>Açık sertifika (PEM)<textarea disabled={busy} value={pem} maxLength={16384} rows={5} style={{ width: '100%', boxSizing: 'border-box' }} onChange={event => { setPem(event.target.value); invalidate(); }} /></label>
    <label>Değişiklik gerekçesi<input disabled={busy} value={reason} maxLength={300} onChange={event => { setReason(event.target.value); invalidate(); }} /></label>
    <button disabled={busy || !pem.trim() || reason.trim().length < 5} onClick={() => void run(async () => { setCreated(''); setReview(await request('/preview', { station_id: station, certificate_pem: pem })); })}>Sertifikayı incele</button>
    {review && <div><p>İstasyon: {review.station_id} · Sertifika bitişi: {review.expires_utc}</p>
      <p>Mevcut parmak izleri:</p>{review.old_fingerprints.map(value => <code key={value} style={{ display: 'block', overflowWrap: 'anywhere' }}>{value}</code>)}
      <p>Yeni parmak izi: <code style={{ overflowWrap: 'anywhere' }}>{review.new_fingerprint}</code></p>
      <p>Bu işlem yalnızca onay kaydeder. Sertifika merkezde otomatik etkinleştirilmez.</p>
      <button disabled={busy} onClick={() => void run(async () => {
        const result: Approval = await request('', { station_id: station, certificate_pem: pem, reason, expected_fingerprints: review.old_fingerprints, expected_new_fingerprint: review.new_fingerprint });
        setCreated(result.id); setReview(null); setPem(''); setRows(await request(''));
      })}>Bu sertifika değişikliğini onayla</button></div>}
    {created && <p role="status">Onay kaydedildi: <code style={{ overflowWrap: 'anywhere' }}>{created}</code>. Offline etkinleştirmede bu kimliği kullanın.</p>}
    {error && <p role="alert">{error} Belirsiz işlemi yeniden göndermeden önce listeyi kontrol edin.</p>}
    <button disabled={busy} onClick={() => void run(async () => setRows(await request('')))}>Onay listesini yenile</button>
    {!rows.length && <p>Listelenen onay yok.</p>}
    {rows.map(row => <div key={row.id} style={{ overflowWrap: 'anywhere' }}><p>{row.station_id} · {row.approved_by} · {states[row.state] ?? 'Bilinmiyor'} · Son geçerlilik: {new Date(row.expires_utc_ms).toLocaleString('tr-TR')}</p><code>{row.id}</code>{row.operation_id && <p>Offline işlem: {row.operation_id}</p>}</div>)}
  </details>;
}
