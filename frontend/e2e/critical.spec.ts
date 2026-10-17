import { test, expect } from '@playwright/test';

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
