'use strict';

const CYCLES = {
  weekly: { label: 'Haftalık', perMonth: 4.345 },
  monthly: { label: 'Aylık', perMonth: 1 },
  quarterly: { label: '3 Aylık', perMonth: 1 / 3 },
  yearly: { label: 'Yıllık', perMonth: 1 / 12 },
  usage: { label: 'Kullanım bazlı', perMonth: 1 },
  onetime: { label: 'Tek seferlik', perMonth: 0 }
};

const CURRENCY_SYMBOLS = {
  USD: '$', EUR: '€', GBP: '£', TRY: '₺'
};

const DEFAULT_RATES = { TRY: 1, USD: 48.6, EUR: 56.1, GBP: 65.7 };

/**
 * "1.234,56" (TR) ve "1,234.56" (US) bicimlerini dogru ayristirir.
 */
function parseAmount(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = String(raw).trim().replace(/\s/g, '');
  s = s.replace(/[^\d.,-]/g, '');
  if (!s) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma > -1 && lastDot > -1) {
    // Hangisi sonda ise ondalik ayraci odur.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    const decimals = s.length - lastComma - 1;
    // "1,234" -> binlik ayraci; "12,99" -> ondalik
    if (decimals === 3 && /^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
  } else if (lastDot > -1) {
    const decimals = s.length - lastDot - 1;
    if (decimals === 3 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  }

  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function detectCurrency(text) {
  const t = String(text || '');
  if (/\bTRY\b|\bTL\b|₺|\bTurk Lirasi\b|\bTürk Lirası\b/i.test(t)) return 'TRY';
  if (/\bUSD\b|\bUS\$|\$\s?\d|\d\s?\$/i.test(t)) return 'USD';
  if (/\bEUR\b|€/i.test(t)) return 'EUR';
  if (/\bGBP\b|£/i.test(t)) return 'GBP';
  return null;
}

/** Aylik yuke cevirir (kendi para biriminde). */
function monthlyAmount(sub) {
  if (!sub) return 0;
  if (sub.status === 'cancelled') return 0;
  const cycle = CYCLES[sub.cycle] || CYCLES.monthly;
  const amount = Number(sub.amount) || 0;
  return amount * cycle.perMonth;
}

function convert(amount, from, to, rates) {
  const r = { ...DEFAULT_RATES, ...(rates || {}) };
  const a = Number(amount) || 0;
  const fromRate = r[from] || 1;
  const toRate = r[to] || 1;
  return (a * fromRate) / toRate;
}

/** Aylik yuk, hedef para biriminde (varsayilan TRY). */
function monthlyIn(sub, target = 'TRY', rates) {
  return convert(monthlyAmount(sub), sub.currency || 'USD', target, rates);
}

function yearlyIn(sub, target = 'TRY', rates) {
  if (sub && sub.cycle === 'onetime') return 0;
  return monthlyIn(sub, target, rates) * 12;
}

function formatMoney(amount, currency = 'TRY') {
  const n = Number(amount) || 0;
  const sym = CURRENCY_SYMBOLS[currency] || '';
  const s = n.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return currency === 'TRY' ? `${s} ₺` : `${sym}${s}`;
}

module.exports = {
  CYCLES, CURRENCY_SYMBOLS, DEFAULT_RATES,
  parseAmount, detectCurrency, monthlyAmount, convert, monthlyIn, yearlyIn, formatMoney
};
