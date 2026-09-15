'use strict';

const test = require('node:test');
const assert = require('node:assert');
const insights = require('../src/core/insights');

const NOW = '2026-09-14T00:00:00Z';
const RATES = { TRY: 1, USD: 40, EUR: 44, GBP: 50 };
const OPTS = { now: NOW, rates: RATES, base: 'TRY' };

const subs = [
  { id: '1', name: 'Anthropic Claude', amount: 200, currency: 'USD', cycle: 'monthly', status: 'active', category: 'llm_chat', nextRenewal: '2026-09-30', lastUsedAt: '2026-09-13' },
  { id: '2', name: 'OpenAI ChatGPT', amount: 20, currency: 'USD', cycle: 'monthly', status: 'active', category: 'llm_chat', nextRenewal: '2026-09-20', lastUsedAt: '2026-04-01' },
  { id: '3', name: 'Notion', amount: 120, currency: 'USD', cycle: 'yearly', status: 'active', category: 'verimlilik', nextRenewal: '2026-09-18', lastUsedAt: '2026-09-10' },
  { id: '4', name: 'Runway', amount: 35, currency: 'USD', cycle: 'monthly', status: 'active', category: 'video', nextRenewal: '2026-10-05', lastUsedAt: '2026-01-05' },
  { id: '5', name: 'Eski Servis', amount: 15, currency: 'USD', cycle: 'monthly', status: 'cancelled', category: 'diger' },
  { id: '6', name: 'ManyChat', amount: 15, currency: 'USD', cycle: 'monthly', status: 'trial', category: 'otomasyon', trialEndsAt: '2026-09-17' }
];

test('summary: iptal edilmis abonelik toplama girmez', () => {
  const s = insights.summary(subs, OPTS);
  assert.strictEqual(s.count, 5);
  assert.strictEqual(s.total, 6);
  // 200 + 20 + 35 + 15 = 270 USD aylik + Notion 120/12 = 10 USD => 280 USD * 40 = 11200
  assert.strictEqual(Math.round(s.monthly), 11200);
  assert.strictEqual(Math.round(s.yearly), 134400);
});

test('upcoming: 30 gun icindekiler tarihe gore sirali', () => {
  const u = insights.upcoming(subs, 30, OPTS);
  const names = u.map((x) => x.sub.name);
  assert.deepStrictEqual(names, ['Notion', 'OpenAI ChatGPT', 'Anthropic Claude', 'Runway']);
});

test('trialsEnding: 7 gun icinde biten deneme yakalanir', () => {
  const t = insights.trialsEnding(subs, 7, OPTS);
  assert.strictEqual(t.length, 1);
  assert.strictEqual(t[0].sub.name, 'ManyChat');
  assert.strictEqual(t[0].inDays, 3);
});

test('overlaps: ayni kategorideki iki abonelik yakalanir', () => {
  const o = insights.overlaps(subs, OPTS);
  const chat = o.find((x) => x.category === 'llm_chat');
  assert.ok(chat, 'llm_chat cakismasi bulunmali');
  assert.strictEqual(chat.count, 2);
  // toplam 220 USD -> 8800 TRY, ucuz olan 20 USD -> 800; tasarruf 8000
  assert.strictEqual(Math.round(chat.potentialMonthlySaving), 8000);
});

test('overlaps: tek abonelikli kategori uyari uretmez', () => {
  const o = insights.overlaps(subs, OPTS);
  assert.ok(!o.find((x) => x.category === 'video'));
});

test('dormant: 60 gundur girilmeyenler onceliklendirilir', () => {
  const d = insights.dormant(subs, 60, OPTS);
  const names = d.map((x) => x.sub.name);
  assert.ok(names.includes('Runway'));
  assert.ok(names.includes('OpenAI ChatGPT'));
  assert.ok(!names.includes('Anthropic Claude'));
  assert.strictEqual(d[0].priority, 'yuksek');
});

test('alerts: kritik uyarilar en uste gelir', () => {
  const a = insights.alerts(subs, OPTS);
  assert.ok(a.length > 0);
  assert.strictEqual(a[0].level, 'kritik');
  assert.ok(a.some((x) => x.type === 'deneme'));
  assert.ok(a.some((x) => x.type === 'cakisma'));
  assert.ok(a.some((x) => x.type === 'olu'));
});

test('calendar: yillik kalem 12 ay sonra tekrar duser', () => {
  const cal = insights.calendar(subs, 14, OPTS);
  const sep26 = cal.find((c) => c.month === '2026-09');
  const sep27 = cal.find((c) => c.month === '2027-09');
  assert.ok(sep26.items.some((i) => i.sub.name === 'Notion'));
  assert.ok(sep27.items.some((i) => i.sub.name === 'Notion'));
});
