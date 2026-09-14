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
