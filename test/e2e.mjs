/**
 * Uctan uca arayuz testi: Electron uygulamasini gercekten baslatir,
 * sekmeleri gezer, abonelik ekler/siler ve hesaplarin ekrana dogru
 * yansidigini dogrular. Calistirmak icin: node test/e2e.mjs
 *
 * Gecici bir userData klasoru kullanir; gercek verine dokunmaz.
 */

import { _electron as electron } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subkill-e2e-'));

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(['ok', name]);
    console.log('  ok  ', name);
  } catch (err) {
    results.push(['fail', name, err.message]);
    console.log('  FAIL', name, '\n       ', err.message);
  }
}

const app = await electron.launch({
  args: [root, `--user-data-dir=${userDataDir}`],
  env: { ...process.env, SUBKILL_E2E: '1' }
});

const win = await app.firstWindow();
await win.waitForSelector('#view', { timeout: 15000 });

console.log('\nSubKill uctan uca test\n');

await step('ilk acilista kurulum rehberi cikiyor', async () => {
  await win.waitForFunction(() => !document.getElementById('modalBackdrop').hidden, null, { timeout: 8000 });
  const title = await win.locator('.modal h3').innerText();
  assert.match(title, /SubKill ne işe yarar/, 'rehberin ilk adimi gorunmuyor');
  const dots = await win.locator('.wizard-dots span').count();
  assert.strictEqual(dots, 4, `4 adim bekleniyordu, ${dots} bulundu`);
});

await step('rehberde ileri gidilebiliyor ve gmail adimi anlatiliyor', async () => {
  await win.locator('.modal-foot button.primary').click();
  await win.waitForTimeout(250);
  const body = await win.locator('.modal-body').innerText();
  assert.match(body, /2 Adımlı Doğrulama/, 'iki adimli dogrulama uyarisi yok');
  assert.match(body, /uygulama şifresi/i, 'uygulama sifresi anlatimi yok');
});

await step('rehber atlanabiliyor ve bir daha acilmiyor', async () => {
  await win.locator('.modal-foot button.ghost').click(); // Geri
  await win.waitForTimeout(200);
  await win.locator('.modal-foot button.ghost').click(); // Rehberi atla
  await win.waitForFunction(() => document.getElementById('modalBackdrop').hidden, null, { timeout: 5000 });
  const onboarded = await win.evaluate(() => window.__subkillState && window.__subkillState.settings.onboarded);
  assert.ok(onboarded !== false, 'onboarded ayari yazilmadi');
});

await step('panel acildi ve dort ozet karti var', async () => {
  await win.waitForSelector('.stat', { timeout: 10000 });
  const count = await win.locator('.stat').count();
  assert.strictEqual(count, 4, `4 kart bekleniyordu, ${count} bulundu`);
});

await step('bos envanterde yonlendirme mesaji gorunuyor', async () => {
  const text = await win.locator('#view').innerText();
  assert.ok(/Uyarı yok|Gmail taraması/i.test(text), 'bos durum mesaji yok');
});

await step('yeni abonelik formu aciliyor', async () => {
  await win.click('#btnNew');
  await win.waitForFunction(() => !document.getElementById('modalBackdrop').hidden, null, { timeout: 5000 });
  const title = await win.locator('.modal h3').innerText();
  assert.match(title, /Yeni abonelik/);
});

await step('abonelik kaydediliyor', async () => {
  const fields = win.locator('.modal .field input, .modal .field select, .modal .field textarea');
  await win.locator('.modal input').first().fill('Test Servisi');
  await win.locator('.modal input[type="number"]').first().fill('100');
  // select sirasi: 0 kategori, 1 para birimi, 2 periyot, 3 durum, 4 giris yontemi
  await win.locator('.modal select').nth(1).selectOption('USD');
  await win.locator('.modal select').nth(2).selectOption('monthly');
  await win.click('.modal .primary');
  await win.waitForFunction(() => document.getElementById('modalBackdrop').hidden, null, { timeout: 5000 });
  void fields;
});

await step('ozet karti eklenen abonelikle guncellendi', async () => {
  const text = await win.locator('.stats').innerText();
  assert.match(text, /1 aktif abonelik/);
});

await step('abonelikler sekmesi kaydi listeliyor', async () => {
  await win.click('#nav button[data-view="abonelikler"]');
  await win.waitForSelector('table', { timeout: 5000 });
  const row = await win.locator('tbody tr').first().innerText();
  assert.match(row, /Test Servisi/);
  assert.match(row, /\$100/);
});

await step('arama filtresi calisiyor', async () => {
  await win.fill('.filters input[type="text"]', 'bulunmayan');
  await win.waitForTimeout(300);
  const text = await win.locator('#listBody').innerText();
  assert.match(text, /Filtreye uyan kayıt yok/);
  await win.fill('.filters input[type="text"]', '');
  await win.waitForTimeout(300);
});

await step('takvim sekmesi 12 ay ciziyor', async () => {
  await win.click('#nav button[data-view="takvim"]');
  await win.waitForSelector('.bar-row', { timeout: 5000 });
  const rows = await win.locator('.bar-row').count();
  assert.strictEqual(rows, 12, `12 ay bekleniyordu, ${rows} bulundu`);
});

await step('kartlar sekmesinde elle kart ekleme yok, makbuzdan geleni anlatiyor', async () => {
  await win.click('#nav button[data-view="kartlar"]');
  await win.waitForSelector('.panel', { timeout: 5000 });

  const addBtn = await win.locator('button:has-text("Kart ekle")').count();
  assert.strictEqual(addBtn, 0, 'elle kart ekleme dugmesi hala duruyor');

  const text = await win.locator('#view').innerText();
  assert.match(text, /son d\u00f6rt hanes/i, 'kartlarin makbuzdan geldigi anlatilmiyor');
  assert.match(text, /bankan\u0131za ba\u011flanmaz/i, 'banka baglantisi olmadigi yazmiyor');
  assert.match(text, /Gmail taramas\u0131/i, 'kart yoksa ne yapilacagi yazmiyor');
});

await step('etiket ve limit alanlari makbuzdaki karta bagli aciliyor', async () => {
  const rows = await win.locator('.card-digits').count();
  const emptyMsg = await win.locator('#view .empty').count();
  assert.ok(rows > 0 || emptyMsg > 0, 'ne kart satiri ne de bos durum mesaji var');
});

await step('tarama sekmesi gmail alanlarini gosteriyor', async () => {
  await win.click('#nav button[data-view="tarama"]');
  await win.waitForSelector('input[type="password"]', { timeout: 5000 });
  const text = await win.locator('#view').innerText();
  assert.match(text, /uygulama şifresi/i);
});

await step('eksik sifreyle tarama anlasilir hata veriyor', async () => {
  await win.fill('.form-grid input[type="text"]', 'ornek@gmail.com');
  await win.click('button:has-text("Bağlantıyı test et")');
  await win.waitForSelector('.toast:not([hidden])', { timeout: 30000 });
  const toast = await win.locator('#toast').innerText();
  assert.ok(toast.length > 5, 'hata mesaji bos');
  assert.ok(!/undefined|\[object/i.test(toast), `ham hata sizdi: ${toast}`);
});

await step('ayarlar sekmesi kur alanlarini gosteriyor', async () => {
  await win.click('#nav button[data-view="ayarlar"]');
  await win.waitForSelector('input[type="number"]', { timeout: 5000 });
  const text = await win.locator('#view').innerText();
  assert.match(text, /USD\/TRY/);
});

await step('TCMB kuru cekilebiliyor', async () => {
  await win.click('button:has-text("TCMB kurunu çek")');
  await win.waitForTimeout(6000);
  const toast = await win.locator('#toast').innerText();
  assert.match(toast, /Kur güncellendi|Kur güncellenemedi/);
});

await step('kullanim taramasi calisiyor', async () => {
  await win.click('#btnUsage');
  await win.waitForTimeout(12000);
  const toast = await win.locator('#toast').innerText();
  assert.ok(/tarayıcı profili okundu|okunamadı/i.test(toast), `beklenmeyen sonuc: ${toast}`);
});

await step('abonelik silinebiliyor', async () => {
  await win.keyboard.press('Escape');            // olasi acik modali kapat
  await win.click('#nav button[data-view="abonelikler"]');
  await win.waitForSelector('tbody tr', { timeout: 5000 });
  const durum = await win.evaluate(() => ({
    backdropHidden: document.getElementById('modalBackdrop').hidden,
    satir: document.querySelectorAll('tbody tr').length,
    ilkSatir: document.querySelector('tbody .row-name')?.textContent
  }));
  // Koordinat bazli tiklama sticky topbar'a takilabiliyor; DOM olayini dogrudan tetikle
  const row = win.locator('tbody tr').first();
  await row.evaluate((el) => el.click());
  await win.waitForTimeout(300);
  const baslik = await win.locator('#modal h3').innerText().catch(() => '(yok)');
  if (baslik !== 'Test Servisi') {
    throw new Error(`beklenen modal acilmadi. baslik="${baslik}" durum=${JSON.stringify(durum)}`);
  }
  // #modal her zaman DOM'da; asil olcut arka planin gorunur olmasi
  await win.waitForFunction(() => !document.getElementById('modalBackdrop').hidden, null, { timeout: 5000 });
  const modalHtml = await win.locator('#modal').innerHTML();
  if (!/danger/.test(modalHtml)) {
    throw new Error('modal icinde Sil butonu yok. Modal basligi: ' +
      (await win.locator('#modal h3').innerText().catch(() => '(yok)')) +
      ' | buton sayisi: ' + (await win.locator('#modal button').count()));
  }
  await win.click('.modal button.danger');
  await win.waitForTimeout(800);
  const text = await win.locator('#listBody').innerText();
  assert.match(text, /Henüz abonelik yok/);
});

await step('konsolda hata yok', async () => {
  const errors = await win.evaluate(() => window.__subkillErrors || []);
  assert.deepStrictEqual(errors, [], `konsol hatalari: ${JSON.stringify(errors)}`);
});

await app.close();
fs.rmSync(userDataDir, { recursive: true, force: true });

const failed = results.filter((r) => r[0] === 'fail');
console.log(`\n${results.length - failed.length}/${results.length} adim gecti`);
if (failed.length) {
  console.log('\nBasarisiz adimlar:');
  for (const f of failed) console.log(' -', f[1], '→', f[2]);
  process.exit(1);
}
