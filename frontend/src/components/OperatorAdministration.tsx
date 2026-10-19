import { useEffect, useRef, useState } from 'react';

interface User { username: string; role: 'admin' | 'operator'; active: boolean }
interface Audit { id: number; utc_ms: number; actor: string; event: string; subject: string }
const base = 'https://127.0.0.1:8772/api/v1/operators';

export function OperatorAdministration({ token, username, role, onSessionEnd }: {
  token: string; username: string; role: 'admin' | 'operator'; onSessionEnd: (message: string) => void;
}) {
  const [users, setUsers] = useState<User[]>([]), [audit, setAudit] = useState<Audit[]>([]);
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [name, setName] = useState(''), [initial, setInitial] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'operator'>('operator');
  const [selected, setSelected] = useState('');
  const [current, setCurrent] = useState(''), [next, setNext] = useState(''), [repeat, setRepeat] = useState('');
  const operation = useRef(false);

  async function request(path: string, body?: unknown) {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401) { onSessionEnd('Oturum sona erdi. Yeniden giriş yapın.'); throw Error('Oturum geçersiz.'); }
    if (!response.ok) throw Error(response.status === 403 ? 'İşlem için yetki veya mevcut parola doğrulanamadı.' : response.status === 429 ? 'İşlem sınırına ulaşıldı. Daha sonra tekrar deneyin.' : 'İşlem tamamlanamadı. Sonucu yenileyerek kontrol edin.');
    return response.json();
  }

  useEffect(() => {
    if (role !== 'admin') return;
    let disposed = false;
    setUsers([]); setAudit([]);
    async function read() {
      try {
        const responses = await Promise.all([
          fetch(base + '/users', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(4000), cache: 'no-store' }),
          fetch(base + '/audit', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(4000), cache: 'no-store' }),
        ]);
        if (responses.some(response => response.status === 401)) {
          if (!disposed) onSessionEnd('Yönetim oturumu sona erdi. Yeniden giriş yapın.');
          return;
        }
        if (responses.some(response => !response.ok)) throw Error();
        const [nextUsers, nextAudit] = await Promise.all(responses.map(response => response.json()));
        if (!Array.isArray(nextUsers) || !Array.isArray(nextAudit)) throw Error();
        if (!disposed) { setUsers(nextUsers); setAudit(nextAudit); setError(''); }
      } catch { if (!disposed) { setUsers([]); setAudit([]); setError('Yönetim listeleri alınamadı. Yenileyerek tekrar deneyin.'); } }
    }
    void read();
    return () => { disposed = true; };
  }, [token, role, revision]);

  async function mutate(action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'İşlem sonucu doğrulanamadı; otomatik tekrar gönderilmedi.'); }
    finally { operation.current = false; setBusy(false); }
  }

  return <div className="operator-administration">
    <details><summary>Hesap parolasını değiştir</summary>
      <p>Mevcut parola gerekir. Başarıyla değişince bu hesaba ait bütün oturumlar kapanır.</p>
      <form onSubmit={event => { event.preventDefault(); if (next !== repeat) { setError('Yeni parola ve tekrarı aynı olmalı.'); return; }
        void mutate(async () => {
          try { await request('/password', { current_password: current, new_password: next }); onSessionEnd('Parola değişti. Yeni parolanızla yeniden giriş yapın.'); }
          finally { setCurrent(''); setNext(''); setRepeat(''); }
        });
      }}>
        <label>Mevcut hesap parolası<input type="password" autoComplete="current-password" value={current} onChange={event => setCurrent(event.target.value)} disabled={busy} required /></label>
        <label>Yeni hesap parolası<input type="password" autoComplete="new-password" minLength={15} maxLength={128} value={next} onChange={event => setNext(event.target.value)} disabled={busy} required /></label>
        <label>Yeni parola tekrarı<input type="password" autoComplete="new-password" value={repeat} onChange={event => setRepeat(event.target.value)} disabled={busy} required /></label>
        <button disabled={busy}>Parolayı değiştir ve oturumları kapat</button>
      </form>
    </details>
    {role === 'admin' && <details><summary>Kullanıcı ve güvenlik yönetimi</summary>
      <p>Bu yetkiler sivil cihaz sicili içindir. İstasyon sertifikası veya uçuş kontrolü yetkisi oluşturulmaz.</p>
      <button className="secondary" disabled={busy} onClick={() => setRevision(value => value + 1)}>Yönetim listelerini yenile</button>
      <h3>Kullanıcılar</h3>
      {!users.length && <p>Kullanıcı listesi boş veya henüz yüklenmedi.</p>}
      <ul>{users.map(account => <li key={account.username}>
        {account.username} · {account.role === 'admin' ? 'Yönetici' : 'Operatör'} · {account.active ? 'Açık' : 'Kapalı'}
        {account.active && account.username !== username && <button className="secondary" disabled={busy} onClick={() => setSelected(account.username)}>{account.username} hesabını kapat</button>}
      </li>)}</ul>
      {selected && <div role="group" aria-label="Hesap kapatma incelemesi">
        <p>{selected} hesabı kapatılacak ve açık oturumları iptal edilecek.</p>
        <button disabled={busy} onClick={() => void mutate(async () => { await request('/users/' + encodeURIComponent(selected) + '/disable', {}); setSelected(''); setRevision(value => value + 1); setNotice('Hesap kapatıldı.'); })}>Seçilen hesabı kapatmayı onayla</button>
        <button className="secondary" disabled={busy} onClick={() => setSelected('')}>Kapatmaktan vazgeç</button>
      </div>}
      <h3>Yeni kullanıcı</h3>
      <form onSubmit={event => { event.preventDefault(); void mutate(async () => {
        try { await request('/users', { username: name, password: initial, role: newRole }); setName(''); setRevision(value => value + 1); setNotice('Kullanıcı oluşturuldu.'); }
        finally { setInitial(''); }
      }); }}>
        <label>Yeni kullanıcı adı<input value={name} pattern="[a-z][a-z0-9_-]{2,39}" onChange={event => setName(event.target.value)} disabled={busy} required /></label>
        <label>Başlangıç parolası<input type="password" autoComplete="new-password" minLength={15} maxLength={128} value={initial} onChange={event => setInitial(event.target.value)} disabled={busy} required /></label>
        <label>Yeni hesap yetkisi<select value={newRole} onChange={event => setNewRole(event.target.value as 'admin' | 'operator')} disabled={busy}><option value="operator">Operatör</option><option value="admin">Yönetici</option></select></label>
        <button disabled={busy}>Kullanıcı oluştur</button>
      </form>
      <h3>Son güvenlik olayları</h3>
      {!audit.length && <p>Gösterilecek güvenlik olayı yok.</p>}
      <ol className="operator-audit">{audit.map(event => <li key={event.id}>{new Date(event.utc_ms).toLocaleString('tr-TR')} · {event.actor} · {event.event}{event.subject ? ' · ' + event.subject : ''}</li>)}</ol>
    </details>}
    {busy && <p role="status">Hesap işlemi sürüyor…</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </div>;
}
