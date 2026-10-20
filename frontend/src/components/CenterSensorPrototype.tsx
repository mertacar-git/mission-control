import { useEffect, useState } from 'react';
import { operatorBase } from '../operatorApi';
import { SerialDevice } from './SerialDevice';
interface Prototype { configured: boolean; profile: string; station_id: string; device_id: string; stream_id: string; port: string; bridge?: { state: string; code: string | null; forwarded: number } }
const diagnostics:Record<string,string>={
  enroll_configured_device:'Belirtilen seri numarasını belirtilen istasyona kaydedin.',
  source_stream_mismatch:'Sensör akış kimliği eşlemeyle uyuşmuyor. Kaynak veya yapılandırmayı kontrol edin.',
  source_protocol_mismatch:'Alıcı MCS1 sensör paketi sağlamıyor. Seçilen kaynağı kontrol edin.',
  source_packet_regression:'Paket sırası veya kaynak zamanı geriledi. Kaynağı inceleyin.',
  receiver_run_changed_restart_required:'Yeni seri kayıt koşusu açıldı. Köprüyü açıkça yeniden başlatın.',
  identity_rejected:'İstasyon kimliği reddedildi. Sertifika kaydını, süresini ve iptal durumunu kontrol edin.',
  communication_or_ack_unknown:'Alıcı/merkez iletişimi veya işlem sonucu doğrulanamadı. Bağlantıyı ve servis günlüklerini inceleyin.',
  report_ack_unknown:'Merkez aktarım onayı doğrulanamadı. Otomatik yeniden gönderim yapılmadı.',
  station_device_binding_rejected:'Cihaz bu istasyona kayıtlı değil. Sicildeki atamayı kontrol edin.',
  bridge_start_failed:'Köprü başlatılamadı. Yerel yapılandırmayı ve sertifika erişimini kontrol edin.',
};
export function CenterSensorPrototype({ token }: { token: string }) {
  const [setup,setSetup]=useState<Prototype|null>(null), [error,setError]=useState('');
  useEffect(()=>{
    let disposed=false;
    let pending=false;
    const refresh=()=>{if(pending)return;pending=true;void fetch(operatorBase+'/prototype',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(4000),cache:'no-store'}).then(async response=>{
      if(!response.ok) throw Error();
      const value:Prototype=await response.json(); if(!disposed){setSetup(value);setError('');}
    }).catch(()=>{if(!disposed)setError('Tek bilgisayarlı prototip yapılandırması okunamadı. Başlatıcıyı kontrol edin.');}).finally(()=>{pending=false;});};
    refresh();const timer=setInterval(refresh,1500);
    return ()=>{disposed=true;clearInterval(timer);};
  },[token]);
  if(error)return <p role="alert">{error}</p>;
  if(!setup?.configured)return null;
  return <div className="center-sensor-prototype">
    <h3>Sensör prototipi · {setup.profile==='synthetic'?'SENTETİK':'YEREL SERİ KAYNAK'}</h3>
    <p>Köprü eşlemesi: {setup.station_id} → {setup.device_id} · Beklenen akış: {setup.stream_id} · Port: {setup.port}</p>
    <p role="status">Köprü: {({waiting:'Yeni ölçüm veya cihaz kaydı bekleniyor',running:'Aktarıyor',error:'Hata · yeniden başlatma gerekli',unknown:'Bilinmiyor'} as Record<string,string>)[setup.bridge?.state ?? 'unknown'] ?? 'Bilinmiyor'} · Aktarılan görüntü: {setup.bridge?.forwarded ?? '—'}{setup.bridge?.code ? ' · Tanı: '+setup.bridge.code : ''}</p>
    {setup.bridge?.code && <p>{diagnostics[setup.bridge.code] ?? 'Köprü yanıtı uyumsuz. Başlatıcı günlüğünü inceleyin.'}</p>}
    <p>Önce bu seri numarasını belirtilen istasyona kaydedin. Ardından aşağıdaki portu doğrulayıp seri kaydı başlatın. Köprü yalnızca yeni MCS1 paketlerini taşır. Hata sonrası otomatik yeniden başlatılmaz; başlatıcıdaki nedeni giderip yeniden çalıştırın.</p>
    <details><summary>Seri alıcı ve ayrı kayıt arşivi</summary><SerialDevice key={token} local gatewayToken={token} preferredPort={setup.port}/></details>
  </div>;
}
