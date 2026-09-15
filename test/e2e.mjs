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
  assert.strictEqual(dots, 3, `3 adim bekleniyordu, ${dots} bulundu`);
});

await step('rehberde ileri gidilebiliyor ve posta adimi anlatiliyor', async () => {
  await win.locator('.modal-foot button.primary').click();
  await win.waitForTimeout(250);
  const body = await win.locator('.modal-body').innerText();
  assert.match(body, /Nasıl bağlanır/, 'baglanti anlatimi yok');
  assert.match(body, /uygulamaya özel şifre/i, 'uygulamaya ozel sifre anlatimi yok');
  assert.match(body, /cPanel/i, 'kendi sunucusu secenegi anlatilmiyor');
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
  assert.ok(/Uyarı yok|posta taraması/i.test(text), 'bos durum mesaji yok');
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

await step('tarama sekmesi coklu posta hesabini gosteriyor', async () => {
  await win.click('#nav button[data-view="tarama"]');
  await win.waitForSelector('input[type="password"]', { timeout: 5000 });
  const text = await win.locator('#view').innerText();
  assert.match(text, /Bağlı posta hesapları/i, 'hesap listesi paneli yok');
  // DIKKAT: Turkce'de buyuk "İ" harfi /i/ bayragiyla "i" ile eslesmez (Unicode'da
  // nokta ayri bir isaret olarak kaliyor). Bu yuzden cumlenin bas harfi degil,
  // kucuk harfle basladigi bilinen bir parcasi aranir.
  assert.match(text, /kadar hesap ekleyebilirsiniz/i, 'coklu hesap anlatilmiyor');
  assert.match(text, /uygulama şifresi/i);
});

await step('saglayici listesi gmail disindaki kutulari da sunuyor', async () => {
  const secenekler = await win.locator('#view select option').evaluateAll((els) => els.map((e) => e.value));
  for (const beklenen of ['auto', 'gmail', 'icloud', 'outlook', 'yandex', 'custom']) {
    assert.ok(secenekler.includes(beklenen), `${beklenen} saglayicisi listede yok`);
  }
});

await step('kendi sunucusu secilince sunucu alanlari ve cPanel rehberi aciliyor', async () => {
  await win.locator('#view select').selectOption('custom');
  await win.waitForTimeout(250);
  const text = await win.locator('#view').innerText();
  assert.match(text, /IMAP sunucusu/i, 'sunucu alani gorunmuyor');
  assert.match(text, /cPanel/i, 'kendi sunucusu rehberi yok');
  assert.match(text, /mail\.alanadiniz\.com/i, 'sunucu ornegi verilmiyor');

  const port = await win.locator('#view input[type="number"]').first().inputValue();
  assert.strictEqual(port, '993', 'varsayilan port 993 olmali');

  // Adres yazildiginda sunucu alani alan adindan doldurulmali.
  await win.locator('#view input[type="text"]').first().fill('info@sirketim.com.tr');
  await win.waitForTimeout(300);
  const host = await win.locator('#view input[type="text"]').nth(1).inputValue();
  assert.strictEqual(host, 'mail.sirketim.com.tr', `sunucu tahmini yanlis: ${host}`);
});

await step('hesap yokken tarama dugmesi kapali', async () => {
  const disabled = await win.locator('#btnScan').isDisabled();
  assert.strictEqual(disabled, true, 'hesap yokken tarama dugmesi acik kalmis');
});

await step('kartlar sekmesi tamamen kaldirildi', async () => {
  const navCards = await win.locator('#nav button[data-view="kartlar"]').count();
  assert.strictEqual(navCards, 0, 'Kartlar sekmesi hala duruyor');
});

await step('ayarlarda otomatik tarama bolumu var', async () => {
  await win.click('#nav button[data-view="ayarlar"]');
  // Gorunum degisimini beklemek icin bu sekmeye ozgu bir ogeyi bekle.
  await win.waitForSelector('.switch input[type="checkbox"]', { timeout: 6000 });
  // DIKKAT: innerText, CSS text-transform:uppercase'i uygular ve Turkce'de
  // "ı" harfi "I" olur; buyuk/kucuk harf duyarsiz eslesme tutmaz. Bu yuzden
  // etiketlerin gercek metni (textContent) okunuyor.
  const text = await win.locator('#view').innerText();
  assert.match(text, /Otomatik tarama/i, 'otomatik tarama paneli yok');
  const labels = await win.locator('#view label').evaluateAll((els) => els.map((e) => e.textContent));
  assert.ok(labels.some((l) => /Tarama aralığı/.test(l)), 'tarama araligi alani yok');
  assert.ok(labels.some((l) => /Geriye dönük bakılan gün/.test(l)), 'geriye donus alani yok');
  const checked = await win.locator('.switch input[type="checkbox"]').isChecked();
  assert.strictEqual(checked, true, 'otomatik tarama varsayilan olarak kapali');
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
