'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, matchesSite } = require('../src/core/store');

function tmpStore() {
  const file = path.join(os.tmpdir(), `subkill-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const s = new Store(file);
  s.load();
  return { store: s, file };
}

test('matchesSite: kendi dagitimlarini servis sayimaz', () => {
  assert.strictEqual(matchesSite('railway.app', 'railway.app', 'railway.app'), true);
  assert.strictEqual(matchesSite('www.railway.app', 'railway.app', 'railway.app'), true);
  assert.strictEqual(matchesSite('app.heygen.com', 'app.heygen.com', 'heygen.com'), true);
  assert.strictEqual(matchesSite('heygen.com', 'app.heygen.com', 'heygen.com'), true);
  assert.strictEqual(matchesSite('monk-crm-production.up.railway.app', 'railway.app', 'railway.app'), false);
  assert.strictEqual(matchesSite('baskaservis.com', 'railway.app', 'railway.app'), false);
});

test('store: kayit ekler, gunceller, siler', () => {
  const { store, file } = tmpStore();
  const created = store.upsertSubscription({ name: 'Notion', amount: 10, currency: 'USD', cycle: 'monthly' });
  assert.ok(created.id);
  store.upsertSubscription({ id: created.id, amount: 12 });
  assert.strictEqual(store.listSubscriptions()[0].amount, 12);
  assert.strictEqual(store.removeSubscription(created.id), true);
  assert.strictEqual(store.listSubscriptions().length, 0);
  fs.unlinkSync(file);
});

test('id: undefined gonderilse bile kayda kimlik atanir', () => {
  const { store, file } = tmpStore();
  // Arayuz, yeni kayitta payload'a id: undefined koyabiliyordu; kimlik kaybolmamali
  const created = store.upsertSubscription({ id: undefined, name: 'Kimliksiz', amount: 5, currency: 'USD', cycle: 'monthly' });
  assert.ok(created.id, 'kimlik uretilmedi');
  assert.strictEqual(store.listSubscriptions()[0].id, created.id);
  assert.strictEqual(store.removeSubscription(created.id), true, 'kayit silinemedi');
  fs.unlinkSync(file);
});

test('mergeScanned: elle girilen alanlar tarama ile ezilmez', () => {
  const { store, file } = tmpStore();
  store.upsertSubscription({
    name: 'Anthropic Claude', amount: 100, currency: 'USD', cycle: 'monthly',
    loginMethod: 'google', loginEmail: 'ben@ornek.com', notes: 'is hesabi', lastUsedAt: '2026-09-01'
  });

  store.mergeScanned([{
    name: 'Anthropic Claude', amount: 200, currency: 'USD', cycle: 'monthly',
    cardLast4: '2559', loginMethod: '', loginEmail: '', notes: '', lastUsedAt: null
  }]);

  const s = store.listSubscriptions()[0];
  assert.strictEqual(s.amount, 200, 'tutar tarama ile tazelenir');
  assert.strictEqual(s.cardLast4, '2559');
  assert.strictEqual(s.loginMethod, 'google', 'elle girilen giris yontemi korunur');
  assert.strictEqual(s.notes, 'is hesabi', 'not korunur');
  assert.strictEqual(s.lastUsedAt, '2026-09-01', 'son kullanim korunur');
  fs.unlinkSync(file);
});

test('applyUsage: son kullanim tarihini isler', () => {
  const { store, file } = tmpStore();
  store.upsertSubscription({ name: 'Railway', site: 'railway.app', amount: 5, currency: 'USD', cycle: 'usage' });
  const touched = store.applyUsage({
    'monk-crm-production.up.railway.app': '2026-09-14',
    'railway.app': '2026-08-01'
  });
  assert.strictEqual(touched, 1);
  assert.strictEqual(store.listSubscriptions()[0].lastUsedAt, '2026-08-01');
  fs.unlinkSync(file);
});

test('bozuk dosya uygulamayi kilitlemez', () => {
  const file = path.join(os.tmpdir(), `subkill-bozuk-${Date.now()}.json`);
  fs.writeFileSync(file, '{ bu gecerli json degil');
  const s = new Store(file);
  const data = s.load();
  assert.deepStrictEqual(data.subscriptions, []);
  fs.unlinkSync(file);
  for (const f of fs.readdirSync(os.tmpdir())) {
    if (f.startsWith(path.basename(file) + '.bozuk-')) fs.unlinkSync(path.join(os.tmpdir(), f));
  }
});

/* ---------------- posta hesaplari ve iptal ---------------- */

test('birden fazla posta hesabi eklenip kaldirilabilir', () => {
  const { store } = tmpStore();
  store.addMailAccount({ user: 'BiRi@Gmail.com', provider: 'gmail' });
  store.addMailAccount({ user: 'ikinci@gmail.com', provider: 'gmail' });
  store.addMailAccount({ user: 'biri@gmail.com', provider: 'gmail' }); // ayni adres tekrar eklenmemeli
  assert.deepStrictEqual(
    store.get().settings.mailAccounts.map((a) => a.user),
    ['biri@gmail.com', 'ikinci@gmail.com']
  );
  store.removeMailAccount('biri@gmail.com');
  assert.deepStrictEqual(store.get().settings.mailAccounts.map((a) => a.user), ['ikinci@gmail.com']);
});

test('kendi sunucusundaki kutu sunucu bilgisiyle saklanir', () => {
  const { store } = tmpStore();
  store.addMailAccount({ user: 'Info@Sirketim.com.tr', provider: 'custom', host: 'mail.sirketim.com.tr', port: 993, secure: true });
  const acc = store.getMailAccount('info@sirketim.com.tr');
  assert.strictEqual(acc.host, 'mail.sirketim.com.tr');
  assert.strictEqual(acc.port, 993);
  assert.strictEqual(acc.provider, 'custom');

  // Ayni adres yeniden eklenirse sunucu bilgisi guncellenir, kayit ikizlenmez.
  store.addMailAccount({ user: 'info@sirketim.com.tr', provider: 'custom', host: 'imap.sirketim.com.tr', port: 143, secure: false });
  assert.strictEqual(store.get().settings.mailAccounts.length, 1);
  const yeni = store.getMailAccount('info@sirketim.com.tr');
  assert.strictEqual(yeni.host, 'imap.sirketim.com.tr');
  assert.strictEqual(yeni.port, 143);
  assert.strictEqual(yeni.secure, false);
});

test('eski gmailAccounts listesi mailAccounts olarak aciliyor', () => {
  const file = path.join(os.tmpdir(), `subkill-goc-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    settings: { gmailUser: 'tek@gmail.com', gmailAccounts: [{ user: 'eski@gmail.com', addedAt: '2026-01-01' }] },
    subscriptions: [],
    scans: []
  }), 'utf8');

  const store = new Store(file);
  store.load();
  const st = store.get().settings;
  assert.deepStrictEqual(st.mailAccounts.map((a) => a.user), ['eski@gmail.com', 'tek@gmail.com']);
  assert.ok(st.mailAccounts.every((a) => a.provider === 'gmail'), 'eski kayitlar gmail olarak isaretlenmeli');
  assert.strictEqual(st.gmailAccounts, undefined);
  assert.strictEqual(st.gmailUser, undefined);
  fs.unlinkSync(file);
});

test('iptal bildirimi aboneligi iptal olarak isaretler', () => {
  const { store } = tmpStore();
  store.upsertSubscription({ name: 'Runway', amount: 35, currency: 'USD', cycle: 'monthly', status: 'active', lastCharge: '2026-08-01' });
  const applied = store.applyCancellations([{ name: 'runway', cancelledAt: '2026-09-10', evidence: 'cancelled' }]);
  assert.strictEqual(applied.length, 1);
  const sub = store.get().subscriptions.find((s) => s.name === 'Runway');
  assert.strictEqual(sub.status, 'cancelled');
  assert.strictEqual(sub.cancelledAt, '2026-09-10');
});

test('son makbuzdan eski iptal maili yok sayilir', () => {
  const { store } = tmpStore();
  // Kullanici iptal etmis, sonra tekrar abone olmus: iptal maili eski kalir.
  store.upsertSubscription({ name: 'Runway', amount: 35, currency: 'USD', cycle: 'monthly', status: 'active', lastCharge: '2026-09-01' });
  const applied = store.applyCancellations([{ name: 'Runway', cancelledAt: '2026-06-10' }]);
  assert.strictEqual(applied.length, 0, 'eski iptal maili uygulandi');
  assert.strictEqual(store.get().subscriptions[0].status, 'active');
});
