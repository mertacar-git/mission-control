import { test, expect } from '@playwright/test';

test('operator center clears password, isolates roles and removes readings after session expiry', async ({ page }) => {
  let expired = false;
  await page.route('https://127.0.0.1:8772/api/v1/operators/**', route => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith('/login') ? { token: 'test-only-human-session', username: 'observer', role: 'operator' } : {
      user: { username: 'observer', role: 'operator' }, registry: { schema_version: 1, devices: [{ device: { serial: 'HUMAN-SENSOR-001', name: 'Bench', model: 'Sensor node', station: 'station-a', firmware: 'SIM' }, state: 'fresh', age_s: 0, measurement: { source: 'synthetic', temperature_c: 24, humidity_percent: 45, pressure_pa: 101325 } }] }
    };
    return route.fulfill({ status: expired ? 401 : 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.getByRole('button', { name: 'Sivil filo prototipi', exact: true }).click();
  await page.getByRole('textbox', { name: 'Merkez kullanıcı adı', exact: true }).fill('observer');
  const password = page.getByLabel('Merkez parolası', { exact: true });
  await password.fill('test-only long passphrase');
  await page.getByRole('button', { name: 'Merkeze giriş yap', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'HUMAN-SENSOR-001', exact: true })).toBeVisible();
  await expect(page.getByText('Hesap: observer · Yetki: Operatör', { exact: true })).toBeVisible();
  expired = true;
  await expect(page.getByRole('heading', { name: 'HUMAN-SENSOR-001', exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'Oturum sona erdi' })).toBeVisible();
  await expect(password).toHaveValue('');
  expect(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('test-only-human-session')))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test.beforeEach(async ({ page }) => {
  // Tile/network availability must not decide whether planning works.
  await page.route('**/*.tile.openstreetmap.org/**', (route) => route.abort());
  await page.goto('/');
});

test('offline planning, undo, explicit upload review and demo flight commands', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page
    .getByRole('checkbox', { name: 'Harita döşemeleri', exact: true })
    .uncheck();
  const name = page.getByRole('textbox', { name: 'Görev adı', exact: true });
  const original = await name.inputValue();
  await name.fill('Acceptance browser mission');
  await page.getByRole('button', { name: 'Geri al', exact: true }).click();
  await expect(name).toHaveValue(original);
  await page.getByRole('button', { name: 'Yinele', exact: true }).click();
  await expect(name).toHaveValue('Acceptance browser mission');
  await page
    .getByRole('button', { name: 'Demoya bağlan', exact: true })
    .click();
  await page.getByRole('button', { name: 'Görevi yükle', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page
    .getByRole('button', { name: 'Doğrula ve yükle', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Arm', exact: true }).click();
  await page
    .getByRole('button', { name: 'Görevi başlat', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Beklet', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Beklet', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Devam et', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Devam et', exact: true }).click();
  await page.getByRole('button', { name: 'İniş', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBeTruthy();
  expect(errors).toEqual([]);
});

test('published SITL experiment opens isolated replay with working charts', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Deney merkezi', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Yayımlanmış koşu kaydını aç', exact: true })
    .first()
    .click();
  await expect(
    page.getByText('Gerçek SITL kaydı · canlı komutlar kapalı', {
      exact: true,
    }),
  ).toBeVisible();
  for (const name of [
    'Arm',
    'Görevi başlat',
    'Beklet',
    'Devam et',
    'Eve dön',
    'İniş',
  ])
    await expect(
      page.getByRole('button', { name, exact: true }),
    ).toBeDisabled();
  const timeline = page.getByRole('slider', {
    name: 'Kayıt zaman çizelgesi',
    exact: true,
  });
  await timeline.press('End');
  await page
    .getByRole('combobox', { name: 'Oynatma hızı', exact: true })
    .selectOption('2');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBeTruthy();
});

test('five-record report, portable HTML and explicit conditions', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Uçuş analizi', exact: true }).click();
  await page
    .getByRole('button', { name: 'Beş gerçek SITL kaydını getir', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Karşılaştırma JSON', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Rota veya planlama içeriği farklı; aynı görevin tekrarı değildir.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'HTML önizle', exact: true }).click();
  await expect(
    page.locator('iframe[title="HTML karşılaştırma raporu"]'),
  ).toBeVisible();
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Karşılaştırma CSV', exact: true })
    .click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBeTruthy();
});

test('serial sample remains an independent source and preserves missing fields', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Seri cihaz', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Sentetik seri kayıt örneğini aç',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('button', { name: 'Oynat', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Bağımsız seri kaynak', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Arm', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('textbox', { name: 'Alıcı erişim anahtarı', exact: true }),
  ).toHaveValue('');
  const timeline = page.getByRole('slider', {
    name: 'Seri kayıt zamanı',
    exact: true,
  });
  await timeline.press('Home');
  for (let i = 0; i < 38; i++) await timeline.press('ArrowRight');
  await expect(
    page
      .locator('.serial-metrics > div')
      .filter({ has: page.getByText('Enlem', { exact: true }) })
      .locator('strong'),
  ).toHaveText('—');
  await expect(
    page
      .locator('.serial-metrics > div')
      .filter({ has: page.getByText('Yer hızı', { exact: true }) })
      .locator('strong'),
  ).toHaveText('—');
  await expect(
    page
      .locator('.serial-metrics > div')
      .filter({ has: page.getByText('Gerilim', { exact: true }) })
      .locator('strong'),
  ).toHaveText('12.40 V');
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBeTruthy();
});

test('failed experiment evidence request shows an error rather than fabricated results', async ({
  page,
}) => {
  await page.route(
    '**/verification/experiments/experiment-runs.json',
    (route) => route.fulfill({ status: 503, body: 'Unavailable' }),
  );
  await page
    .getByRole('button', { name: 'Deney merkezi', exact: true })
    .click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Deney kanıtları yüklenemedi.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Yayımlanmış koşu kaydını aç',
      exact: true,
    }),
  ).toHaveCount(0);
});

test('unavailable experiment backend blocks mutations and retry recovers', async ({
  page,
}) => {
  let available = false;
  let mutations = 0;
  await page.route('**/api/v1/experiments', (route) => {
    if (route.request().method() !== 'GET') mutations++;
    return route.fulfill({
      status: available ? 200 : 503,
      contentType: 'application/json',
      body: available
        ? '[]'
        : JSON.stringify({ detail: 'Deney servisi kullanılamıyor.' }),
    });
  });
  await page.route('**/api/v1/experiment-runs', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.getByRole('button', { name: 'Yerel SITL', exact: true }).click();
  await page
    .getByRole('button', { name: 'Deney merkezi', exact: true })
    .click();
  const create = page.getByRole('button', {
    name: 'Değişmez tanım oluştur',
    exact: true,
  });
  await expect(
    page.getByRole('button', { name: 'Bağlantıyı yeniden dene', exact: true }),
  ).toBeVisible();
  await expect(create).toBeDisabled();
  expect(mutations).toBe(0);
  available = true;
  await page
    .getByRole('button', { name: 'Bağlantıyı yeniden dene', exact: true })
    .click();
  await expect(create).toBeEnabled();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Deney servisi kullanılamıyor.' }),
  ).toHaveCount(0);
  expect(mutations).toBe(0);
});

test('sensor contract replay shows sensor gaps and never invents flight measurements', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Seri cihaz', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Sentetik sensör sözleşmesi örneğini aç',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Sensör ölçümleri · MCS1', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Sentetik örnek · fiziksel sensör ölçümü değildir.', {
      exact: true,
    }),
  ).toBeVisible();
  const metric = (name: string) =>
    page
      .locator('.serial-metrics > div')
      .filter({ has: page.getByText(name, { exact: true }) })
      .locator('strong');
  await expect(metric('Basınç')).toHaveText('101325.00 Pa');
  await expect(metric('Enlem')).toHaveText('—');
  await expect(metric('Gerilim')).toHaveText('—');
  const timeline = page.getByRole('slider', {
    name: 'Seri kayıt zamanı',
    exact: true,
  });
  await timeline.press('Home');
  for (let i = 0; i < 18; i++) await timeline.press('ArrowRight');
  await expect(metric('İvme X')).toHaveText('—');
  await expect(metric('Sıcaklık')).toHaveText('23.50 °C');
  await timeline.press('End');
  await expect(
    page.getByRole('heading', { name: 'Sensör ölçümleri · MCS1', exact: true }),
  ).toHaveCount(0);
  await expect(metric('Enlem')).toHaveText('—');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});


test('civilian fleet demo isolates approval from observations and foreign station requests', async ({ page }) => {
 await page.getByRole('button',{name:'Sivil filo prototipi',exact:true}).click();
 await expect(page.getByText('Bu ekran sentetik bir iş akışı prototipidir.',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'Kalkış talebi · SIM-FLW-0003',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Kalkış talebi · SIM-FLW-0001',exact:true}).click();
 await page.getByRole('combobox',{name:'Simülasyon rolü',exact:true}).selectOption('center');
 await page.getByLabel('Karar gerekçesi',{exact:true}).fill('Örnek görev incelendi');
 await page.getByRole('button',{name:'Onayla',exact:true}).click();
 await expect(page.getByRole('heading',{name:'SIM-FLW-0001 · Kalkış · Onaylandı',exact:true})).toBeVisible();
 const card=page.locator('.fleet-grid article').filter({hasText:'SIM-FLW-0001'});
 await expect(card.getByText('Yerde',{exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'Simülasyon rolü',exact:true}).selectOption('station-a');
 await page.getByRole('combobox',{name:'Ayrı simülasyon gözlemi · SIM-FLW-0001',exact:true}).selectOption('airborne');
 await expect(card.locator('dd').filter({hasText:'Havada'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Arm',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});


test('authenticated registry view keeps scoped credentials in memory and clears unavailable measurements', async ({ page }) => {
 let available=true;
 await page.route('http://127.0.0.1:8770/api/v1/fleet/snapshot',route=>route.fulfill({status:available?200:503,contentType:'application/json',body:JSON.stringify({schema_version:1,actor:'center',scope:'civilian-equipment-registry',devices:[{device:{serial:'SIM-REG-001',name:'Bench device',model:'Sensor node',station:'station-a',firmware:'SIM 1',equipment:['BME280']},state:'fresh',age_s:0,measurement:{source:'synthetic',temperature_c:23.5,pressure_pa:101325,humidity_percent:45,sequence:1,boot:1}}]})}));
 await page.getByRole('button',{name:'Sivil filo prototipi',exact:true}).click();
 const key=page.getByRole('textbox',{name:'Sicil erişim anahtarı',exact:true});
 await key.fill('test-only-registry-key');
 await page.getByRole('button',{name:'Sicile bağlan',exact:true}).click();
 await expect(page.getByRole('heading',{name:'SIM-REG-001',exact:true})).toBeVisible();
 await expect(key).toHaveValue('');
 available=false;
 await expect(page.getByRole('alert').filter({hasText:'Cihaz siciline ulaşılamıyor.'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'SIM-REG-001',exact:true})).toHaveCount(0);
});
