import { useRef, useState } from 'react';
import { operatorBase, operatorError } from '../operatorApi';

export function DeviceEnrollment({ token, onCreated }: { token: string; onCreated: () => void }) {
  const [serial,setSerial] = useState(''), [name,setName] = useState(''), [model,setModel] = useState('');
  const [station,setStation] = useState('station-a'), [firmware,setFirmware] = useState(''), [equipment,setEquipment] = useState('');
  const [busy,setBusy] = useState(false), [message,setMessage] = useState(''), [error,setError] = useState('');
  const pending = useRef(false);
  return <details className="device-enrollment"><summary>Cihaz kaydı oluştur</summary>
    <p>Yeni seri numarası kaydedilir. Mevcut kayıtların üzerine yazılmaz.</p>
    <form onSubmit={event => { event.preventDefault(); if (pending.current) return; pending.current = true; setBusy(true); setError(''); setMessage('');
      void (async () => {
        try {
          const response = await fetch(operatorBase + '/devices', { method:'POST', headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
            body:JSON.stringify({serial,name,model,station,firmware,equipment:equipment.split('\n').map(value=>value.trim()).filter(Boolean)}), signal:AbortSignal.timeout(5000) });
          if (!response.ok) throw Error(await operatorError(response));
          setMessage(serial+' kaydedildi.'); setSerial(''); setName(''); setModel(''); setFirmware(''); setEquipment(''); onCreated();
        } catch (reason) { setError(reason instanceof TypeError || reason instanceof DOMException ? 'Kayıt sonucu doğrulanamadı. Yeniden göndermeden sicili yenileyip seri numarasını kontrol edin.' : reason instanceof Error ? reason.message : 'Kayıt başarısız.'); }
        finally { pending.current=false; setBusy(false); }
      })();
    }}>
      <label>Cihaz seri numarası<input required maxLength={80} pattern="[A-Za-z0-9_-]+" value={serial} onChange={event=>setSerial(event.target.value)} disabled={busy}/></label>
      <label>Cihaz adı<input required maxLength={100} value={name} onChange={event=>setName(event.target.value)} disabled={busy}/></label>
      <label>Cihaz modeli<input required maxLength={100} value={model} onChange={event=>setModel(event.target.value)} disabled={busy}/></label>
      <label>Atanmış istasyon<select value={station} onChange={event=>setStation(event.target.value)} disabled={busy}><option value="station-a">İstasyon A</option><option value="station-b">İstasyon B</option></select></label>
      <label>Cihaz firmware sürümü<input required maxLength={80} value={firmware} onChange={event=>setFirmware(event.target.value)} disabled={busy}/></label>
      <label>Ekipmanlar · her satıra bir tane<textarea value={equipment} onChange={event=>setEquipment(event.target.value)} disabled={busy}/></label>
      <button disabled={busy}>Cihazı kaydet</button>
    </form>
    {busy && <p role="status">Cihaz kaydı doğrulanıyor…</p>}{message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </details>;
}
