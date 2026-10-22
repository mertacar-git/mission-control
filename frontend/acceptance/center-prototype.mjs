// Test-only browser transport adapter. Every local HTTP response is fetched over
// verified TLS 1.3 with this run's CA. No browser certificate exception is set.
// OS/browser trust-store enrollment remains a separate manual acceptance item.
import { chromium } from '@playwright/test';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const [directory, output, mobile] = process.argv.slice(2);
const ca=fs.readFileSync(path.join(directory,'tls/ca.crt'));
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:mobile==='mobile'?{width:390,height:844}:{width:1440,height:1000}});
try {
  await context.route('https://127.0.0.1:8772/**', async route=>{
    const incoming=route.request();
    const headers={...incoming.headers()};delete headers.host;delete headers['content-length'];
    const result=await new Promise((resolve,reject)=>{
      const request=https.request(incoming.url(),{method:incoming.method(),headers,ca,rejectUnauthorized:true,minVersion:'TLSv1.3'},response=>{
        const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)}));response.on('error',reject);
      });request.on('error',reject);request.setTimeout(5000,()=>request.destroy(Error('Local verified TLS timeout')));
      request.end(incoming.postDataBuffer()??undefined);
    });
    await route.fulfill(result);
  });
  const page=await context.newPage();
  await page.goto('https://127.0.0.1:8772/');
  await page.getByRole('button',{name:'Merkez',exact:true}).click();
  await page.getByLabel('Merkez kullanıcı adı',{exact:true}).fill('admin');
  await page.getByLabel('Merkez parolası',{exact:true}).fill('test-only long passphrase 2026');
  await page.getByRole('button',{name:'Merkeze giriş yap',exact:true}).click();
  await page.getByText('İstasyon sertifikaları ve işlem kaydı',{exact:true}).click();
  await page.getByText('Bu kurulumda işlem günlüğü bulunmuyor. Geçmiş işlemler sonradan üretilmez.',{exact:true}).waitFor();
  await page.getByRole('heading',{name:'station-a',exact:true}).waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Certificate inventory overflow');
  await page.screenshot({path:path.join(output,`certificates-${mobile}.png`),fullPage:true});
  await page.getByText('İstasyon sertifikaları ve işlem kaydı',{exact:true}).click();
  const approvalResponse=page.waitForResponse(response=>response.url().endsWith('/api/v1/operators/station-approvals'));
  await page.getByText('İstasyon sertifikası için yönetici onayı',{exact:true}).click();
  assert((await approvalResponse).status()===200,'Real center approval inventory failed');
  await page.getByText('Listelenen onay yok.',{exact:true}).waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Approval inventory overflow');
  await page.screenshot({path:path.join(output,`approvals-${mobile}.png`),fullPage:true});
  await page.getByText('İstasyon sertifikası için yönetici onayı',{exact:true}).click();
  await page.getByText('Cihaz kaydı oluştur',{exact:true}).click();
  for(const [label,value] of [['Cihaz seri numarası','MCS-BENCH-01'],['Cihaz adı','Sentetik tezgâh sensörü'],['Cihaz modeli','MCS1 prototip'],['Cihaz firmware sürümü','SIM 1']]) await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByRole('button',{name:'Cihazı kaydet',exact:true}).click();
  const card=page.locator('.operator-center article').filter({hasText:'MCS-BENCH-01'});
  await card.getByRole('heading',{name:'MCS-BENCH-01',exact:true}).waitFor();
  await page.getByText('Seri alıcı ve ayrı kayıt arşivi',{exact:true}).click();
  await page.getByRole('combobox',{name:'Seri port',exact:true}).selectOption('TEST:MCS1');
  await page.getByRole('spinbutton',{name:'Kayıt süresi · s',exact:true}).fill('20');
  await page.getByRole('button',{name:'Okumayı ve kaydı başlat',exact:true}).click();
  await card.getByText('Kaynak: Sentetik istasyon',{exact:true}).waitFor({timeout:12000});
  await card.getByText('Cihaz ayrıntısı · MCS-BENCH-01',{exact:true}).click();
  assert((await card.innerText()).includes('Ölçüm protokolü: MCS1'));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');
  await page.screenshot({path:path.join(output,`center-${mobile}.png`),fullPage:true});
  await page.getByRole('button',{name:'Okumayı ve kaydı durdur',exact:true}).click();
  await card.getByText('Sıcaklık: — °C · Nem: — %',{exact:true}).waitFor({timeout:12000});
  await page.getByRole('button',{name:'Seri kaydı aç',exact:true}).click();
  await page.locator('.center-sensor-prototype').getByText(/^(SENTETİK ÖRNEK OYNATMA|KAYIT OYNATMA)$/).waitFor();
  await page.screenshot({path:path.join(output,`replay-${mobile}.png`),fullPage:true});
  console.log(JSON.stringify({viewport:mobile,status:'passed',transport:'test adapter with verified local TLS 1.3',physical_sensor:false}));
} finally {await context.close();await browser.close();}
