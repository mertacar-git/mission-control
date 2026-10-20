import { useEffect, useState } from 'react';
import { operatorBase } from '../operatorApi';
interface Identity {identity:string;fingerprint:string;state:string;expires_utc:string|null}
interface Operation {operation_id:string;utc_ms:number;action:'activate'|'renew';phase:string;identity:string;actor_source:'offline-os';os_user:string;old_fingerprints:string[];new_fingerprint:string}
interface Snapshot {schema_version:1;scope:'offline-certificate-audit';human_approval:false;evaluated_utc_ms:number;identities:Identity[];operations:Operation[];total_operations:number;pending_operations:number;audit_present:boolean}
const states:Record<string,string>={valid:'Süre geçerli',expires_soon:'24 saatten az kaldı',expired:'Süresi doldu',not_yet_valid:'Geçerlilik başlamadı',revoked:'İptal edilmiş',unavailable:'Sertifika dosyası bulunamadı'};
const phases:Record<string,string>={intent:'Sonuç kaydı eksik · inceleme gerekli',applied:'Uygulandı',failed:'Başarısız · önceki eşleme değişmedi',observed_mapped:'Güncel eşlemede görüldü · tarihsel sonuç belirsiz',observed_not_mapped:'Güncel eşlemede yok · tarihsel sonuç belirsiz'};
export function StationIdentityAudit({token}:{token:string}) {
  const [open,setOpen]=useState(false),[revision,setRevision]=useState(0),[view,setView]=useState<Snapshot|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    if(!open)return;
    let disposed=false;setBusy(true);setError('');setView(null);
    void fetch(operatorBase+'/station-identities',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(4000)}).then(async response=>{
      if(!response.ok)throw Error(response.status===403?'Sertifika kayıtlarını yalnızca yönetici inceleyebilir.':response.status===409?'Offline kimlik işlemi sürüyor veya kilit kurtarması gerekiyor. Başlatıcı ve offline işlem durumunu kontrol edin.':'Sertifika sicili veya işlem kaydı okunamadı. Güncel kimlik gösterilemiyor.');
      const value:Snapshot=await response.json();
      if(value.schema_version!==1||value.scope!=='offline-certificate-audit'||value.human_approval!==false||!Array.isArray(value.identities)||!Array.isArray(value.operations))throw Error('Sertifika yanıtı uyumsuz.');
      if(!disposed)setView(value);
    }).catch(reason=>{if(!disposed)setError(reason instanceof Error?reason.message:'Kayıt okunamadı.');}).finally(()=>{if(!disposed)setBusy(false);});
    return ()=>{disposed=true;};
  },[token,open,revision]);
  return <details className="station-identity-audit" onToggle={event=>setOpen(event.currentTarget.open)}><summary>İstasyon sertifikaları ve işlem kaydı</summary>
    <p>Salt okunur inceleme. Sertifika imzalama ve etkinleştirme mevcut offline araçta yapılır. Bu ekran araç bağlantısı veya fiziksel sensör kimliği kanıtı değildir.</p>
    <button className="secondary" disabled={busy} onClick={()=>setRevision(value=>value+1)}>Sertifika durumunu yenile</button>
    {busy&&<p role="status">Sertifika kayıtları okunuyor…</p>}{error&&<p role="alert">{error}</p>}
    {view&&<>
      <p>İnceleme zamanı: {new Date(view.evaluated_utc_ms).toLocaleString('tr-TR')} · Süre durumu bu görüntüye aittir.</p>
      {view.pending_operations>0&&<p role="status">{view.pending_operations} tamamlanmamış işlem var. Yeni kimlik değişiminden önce offline inceleme ve açık uzlaştırma gerekir.</p>}
      <h3>Kayıtlı sertifika kimlikleri</h3>
      {!view.identities.length&&<p>Kayıtlı kimlik yok.</p>}
      {view.identities.map(row=><article className="panel" key={row.fingerprint}><h4>{row.identity}</h4><p>Süre / iptal durumu: {states[row.state]??'Bilinmiyor'}</p><p>Bitiş: {row.expires_utc?new Date(row.expires_utc).toLocaleString('tr-TR'):'Bilinmiyor'}</p><p>SHA-256 parmak izi: <code>{row.fingerprint}</code></p></article>)}
      <h3>Offline kimlik işlemleri</h3><p>Toplam {view.total_operations} işlem · En son 100 işlem gösterilir. OS kullanıcı adı doğrulanmış merkez hesabı onayı değildir; günlük yerel dosya yetkilerine dayanır.</p>
      {!view.audit_present&&<p>Bu kurulumda işlem günlüğü bulunmuyor. Geçmiş işlemler sonradan üretilmez.</p>}
      {view.audit_present&&!view.operations.length&&<p>Kaydedilmiş kimlik işlemi yok.</p>}
      <ol className="operator-audit">{view.operations.map(row=><li key={row.operation_id}><p>{new Date(row.utc_ms).toLocaleString('tr-TR')} · {row.identity} · {row.action==='renew'?'Yenileme':'Etkinleştirme'} · {phases[row.phase]??'Bilinmiyor'}</p><p>Offline OS kullanıcısı: {row.os_user} · İşlem: {row.operation_id}</p><p>Önceki: {row.old_fingerprints.join(', ')}</p><p>Yeni: {row.new_fingerprint}</p></li>)}</ol>
    </>}
  </details>;
}
