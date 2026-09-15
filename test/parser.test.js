'use strict';

const test = require('node:test');
const assert = require('node:assert');
const parser = require('../src/core/parser');
const money = require('../src/core/money');

test('parseAmount: TR ve US bicimleri', () => {
  assert.strictEqual(money.parseAmount('1.234,56'), 1234.56);
  assert.strictEqual(money.parseAmount('1,234.56'), 1234.56);
  assert.strictEqual(money.parseAmount('12,99'), 12.99);
  assert.strictEqual(money.parseAmount('12.99'), 12.99);
  assert.strictEqual(money.parseAmount('1,234'), 1234);
  assert.strictEqual(money.parseAmount('450'), 450);
  assert.strictEqual(money.parseAmount(''), null);
});

test('pickAmount: toplam etiketli tutari secer', () => {
  const t = 'Subtotal: $18.00\nTax: $2.00\nTotal: $20.00';
  const r = parser.pickAmount(t);
  assert.strictEqual(r.amount, 20);
  assert.strictEqual(r.currency, 'USD');
});

test('pickAmount: TL makbuzu', () => {
  const r = parser.pickAmount('Genel Toplam: 1.250,00 TL');
  assert.strictEqual(r.amount, 1250);
  assert.strictEqual(r.currency, 'TRY');
});

test('detectCycle: yillik ve aylik', () => {
  assert.strictEqual(parser.detectCycle('Billed annually'), 'yearly');
  assert.strictEqual(parser.detectCycle('$20.00 / month'), 'monthly');
  assert.strictEqual(parser.detectCycle('Yillik abonelik yenilendi'), 'yearly');
  assert.strictEqual(parser.detectCycle('pay-as-you-go usage'), 'usage');
});

test('parseDateFrom: dort bicim', () => {
  assert.strictEqual(parser.parseDateFrom('date 2026-03-15'), '2026-03-15');
  assert.strictEqual(parser.parseDateFrom('15.03.2026 tarihli'), '2026-03-15');
  assert.strictEqual(parser.parseDateFrom('March 15, 2026'), '2026-03-15');
  assert.strictEqual(parser.parseDateFrom('15 Mart 2026'), '2026-03-15');
});

test('addMonths ay sonu tasmasini engeller', () => {
  assert.strictEqual(parser.addMonths('2026-01-31', 1), '2026-02-28');
  assert.strictEqual(parser.addMonths('2026-03-15', 12), '2027-03-15');
});

test('projectRenewal periyoda gore ilerletir', () => {
  assert.strictEqual(parser.projectRenewal('2026-09-01', 'monthly'), '2026-10-01');
  assert.strictEqual(parser.projectRenewal('2026-09-01', 'yearly'), '2027-09-01');
  assert.strictEqual(parser.projectRenewal('2026-09-01', 'usage'), null);
});

test('parseReceipt: Anthropic aylik makbuzu', () => {
  const r = parser.parseReceipt({
    from: 'invoice+statements@anthropic.com',
    to: 'tumaysolak@gmail.com',
    subject: 'Your receipt from Anthropic',
    date: '2026-08-31T10:00:00Z',
    text: 'Receipt\nClaude Max 20x\nAmount paid: $200.00\nBilled monthly\nVisa ending in 2559'
  });
  assert.strictEqual(r.name, 'Anthropic Claude');
  assert.strictEqual(r.amount, 200);
  assert.strictEqual(r.currency, 'USD');
  assert.strictEqual(r.cycle, 'monthly');
  assert.strictEqual(r.category, 'llm_chat');
  assert.strictEqual(r.nextRenewal, '2026-09-30');
});

test('parseReceipt: Stripe uzerinden gelen makbuzda servis adi konudan cikar', () => {
  const r = parser.parseReceipt({
    from: 'receipts@stripe.com',
    subject: 'Your receipt from ManyChat',
    date: '2026-09-17T08:00:00Z',
    text: 'Total: $168.00\nBilled annually\ncard ending in 2559'
  });
  assert.strictEqual(r.name, 'ManyChat');
  assert.strictEqual(r.category, 'otomasyon');
  assert.strictEqual(r.cycle, 'yearly');
  assert.strictEqual(r.amount, 168);
});

test('parseReceipt: makbuz olmayan mail elenir', () => {
  const r = parser.parseReceipt({
    from: 'news@anthropic.com',
    subject: 'Yeni model duyurusu',
    date: '2026-09-01T08:00:00Z',
    text: 'Bugun yeni bir model yayinladik.'
  });
  assert.strictEqual(r, null);
});

test('parseReceipt: deneme suresi yakalanir', () => {
  const r = parser.parseReceipt({
    from: 'billing@manychat.com',
    subject: 'Your trial has started',
    date: '2026-09-03T08:00:00Z',
    text: 'Your free trial ends on September 17, 2026. Then you will be charged $15.00 per month.'
  });
  assert.strictEqual(r.status, 'trial');
  assert.strictEqual(r.trialEndsAt, '2026-09-17');
});

test('consolidate: ayni servisin makbuzlari birlesir, en yeni kazanir', () => {
  const rows = [
    { name: 'Notion', amount: 10, currency: 'USD', cycle: 'monthly', lastCharge: '2026-07-01' },
    { name: 'Notion', amount: 12, currency: 'USD', cycle: 'monthly', lastCharge: '2026-08-01' }
  ];
  const out = parser.consolidate(rows);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].amount, 12);
  assert.strictEqual(out[0].chargeCount, 2);
});

/* ---------------- iptal tespiti ---------------- */

test('iptal bildirimi taninir ve servis adi cikarilir', () => {
  const r = parser.parseCancellation({
    from: 'billing@runwayml.com',
    subject: 'Your subscription has been cancelled',
    text: 'Hi, your Runway subscription has been cancelled. No further charges.',
    date: new Date('2026-09-10T10:00:00Z')
  });
  assert.ok(r, 'iptal taninmadi');
  assert.strictEqual(r.name, 'Runway');
  assert.strictEqual(r.cancelledAt, '2026-09-10');
});

test('Turkce iptal bildirimi taninir', () => {
  const r = parser.parseCancellation({
    from: 'no-reply@spotify.com',
    subject: 'Aboneliğiniz iptal edildi',
    text: 'Spotify aboneliğiniz iptal edildi.',
    date: new Date('2026-08-01T00:00:00Z')
  });
  assert.ok(r);
  assert.strictEqual(r.name, 'Spotify');
});

test('"istediginiz zaman iptal edebilirsiniz" iptal sayilmaz', () => {
  const r = parser.parseCancellation({
    from: 'team@makenotion.com',
    subject: 'Notion aboneliğiniz başladı',
    text: 'Aboneliğiniz iptal edildi demiyoruz; istediğiniz zaman iptal edebilirsiniz.',
    date: new Date()
  });
  assert.strictEqual(r, null, 'pazarlama cumlesi iptal sayildi');
});

test('makbuz maili iptal olarak isaretlenmez', () => {
  const r = parser.parseCancellation({
    from: 'billing@apify.com',
    subject: 'Receipt from Apify',
    text: 'Total 49.00 USD paid on Sep 1, 2026.',
    date: new Date()
  });
  assert.strictEqual(r, null);
});
