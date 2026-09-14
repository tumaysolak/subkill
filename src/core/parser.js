'use strict';

const catalog = require('./catalog');
const money = require('./money');

/** Gonderen adresinden alan adini cikarir. */
function domainOf(address) {
  const m = String(address || '').match(/@([A-Za-z0-9.-]+)/);
  if (!m) return '';
  return m[1].toLowerCase().replace(/^(mail|email|e|no-?reply|notifications?|billing|invoice|receipts?)\./, '');
}

const RECEIPT_HINTS = [
  'receipt', 'invoice', 'payment', 'subscription', 'renewal', 'renewed', 'billing',
  'your plan', 'charged', 'order confirmation', 'thanks for your payment',
  'fatura', 'makbuz', 'odeme', 'ödeme', 'abonelik', 'yenileme', 'tahsilat', 'siparis'
];

const TRIAL_HINTS = ['trial', 'deneme', 'free trial', 'trial ends', 'deneme suresi'];

const CANCEL_HINTS = ['cancell', 'canceled', 'iptal edildi', 'subscription ended', 'aboneligi', 'refund'];

/** Mail bir odeme makbuzu adayi mi? */
function looksLikeReceipt(subject, body) {
  const t = `${subject || ''} ${String(body || '').slice(0, 2000)}`.toLowerCase();
  return RECEIPT_HINTS.some((h) => t.includes(h));
}

const AMOUNT_PATTERNS = [
  // $12.99 / €9,99 / ₺450,00
  /([$€£₺])\s?([\d][\d.,]*)/g,
  // 12.99 USD / 450,00 TL
  /([\d][\d.,]*)\s?(USD|EUR|GBP|TRY|TL)\b/gi,
  // USD 12.99
  /\b(USD|EUR|GBP|TRY|TL)\s?([\d][\d.,]*)/gi
];

const SYMBOL_TO_CURRENCY = { $: 'USD', '€': 'EUR', '£': 'GBP', '₺': 'TRY' };

/**
 * Metindeki tum para tutarlarini bulur. Toplam/total yakinindaki tutar oncelikli.
 */
function extractAmounts(text) {
  const t = String(text || '');
  const found = [];
  for (const re of AMOUNT_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t)) !== null) {
      let currency = null;
      let rawAmount = null;
      const a = m[1];
      const b = m[2];
      if (SYMBOL_TO_CURRENCY[a]) { currency = SYMBOL_TO_CURRENCY[a]; rawAmount = b; }
      else if (/^[A-Za-z]+$/.test(a)) { currency = a.toUpperCase() === 'TL' ? 'TRY' : a.toUpperCase(); rawAmount = b; }
      else { currency = String(b).toUpperCase() === 'TL' ? 'TRY' : String(b).toUpperCase(); rawAmount = a; }

      const amount = money.parseAmount(rawAmount);
      if (amount === null || amount <= 0) continue;
      const before = t.slice(Math.max(0, m.index - 60), m.index).toLowerCase();
      const priority = /(total|toplam|amount due|amount paid|grand total|genel toplam|tutar|odenen)/.test(before) ? 2 : 1;
      found.push({ amount, currency, priority, index: m.index });
    }
  }
  return found;
}

/** En olasi tutari secer: once "toplam" etiketli, sonra en buyuk. */
function pickAmount(text) {
  const all = extractAmounts(text);
  if (!all.length) return { amount: null, currency: null };
  const maxPriority = Math.max(...all.map((x) => x.priority));
  const pool = all.filter((x) => x.priority === maxPriority);
  pool.sort((a, b) => b.amount - a.amount);
  return { amount: pool[0].amount, currency: pool[0].currency };
}

const CYCLE_PATTERNS = [
  [/(yearly|annually|per year|\/\s?year|\/\s?yr|annual (?:plan|subscription|billing)|yillik|yıllık|senelik)/i, 'yearly'],
  [/(quarterly|per quarter|3\s?months|uc aylik|üç aylık|3 aylik)/i, 'quarterly'],
  [/(weekly|per week|\/\s?week|haftalik|haftalık)/i, 'weekly'],
  [/(monthly|per month|\/\s?month|\/\s?mo\b|aylik|aylık)/i, 'monthly'],
  [/(one[- ]?time|tek seferlik|one off)/i, 'onetime'],
  [/(usage|pay[- ]as[- ]you[- ]go|kullanim bazli|metered)/i, 'usage']
];

function detectCycle(text) {
  const t = String(text || '');
  for (const [re, cycle] of CYCLE_PATTERNS) if (re.test(t)) return cycle;
  return null;
}

const CARD_PATTERNS = [
  /(?:ending in|ending with|son(?:u)?\s|biten|\*{2,}|•{2,}|x{2,}|\.{4,})\s*(\d{4})\b/i,
  /\b(?:card|kart)\D{0,20}(\d{4})\b/i
];

function detectCardLast4(text) {
  const t = String(text || '');
  for (const re of CARD_PATTERNS) {
    const m = t.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

const DATE_PATTERNS = [
  // 2026-03-15
  /\b(20\d{2})-(\d{2})-(\d{2})\b/,
  // 15/03/2026 veya 15.03.2026
  /\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/,
  // March 15, 2026
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})\b/i,
  // 15 Mart 2026
  /\b(\d{1,2})\s+(Ocak|Subat|Şubat|Mart|Nisan|Mayis|Mayıs|Haziran|Temmuz|Agustos|Ağustos|Eylul|Eylül|Ekim|Kasim|Kasım|Aralik|Aralık)\s+(20\d{2})\b/i
];

const EN_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const TR_MONTHS = ['ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik'];

function normalizeTr(s) {
  return String(s).toLowerCase()
    .replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ı/g, 'i')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c');
}

function parseDateFrom(text) {
  const t = String(text || '');
  for (const re of DATE_PATTERNS) {
    const m = t.match(re);
    if (!m) continue;
    let y, mo, d;
    if (re === DATE_PATTERNS[0]) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if (re === DATE_PATTERNS[1]) { d = +m[1]; mo = +m[2]; y = +m[3]; }
    else if (re === DATE_PATTERNS[2]) { mo = EN_MONTHS.indexOf(m[1].toLowerCase()) + 1; d = +m[2]; y = +m[3]; }
    else { d = +m[1]; mo = TR_MONTHS.indexOf(normalizeTr(m[2])) + 1; y = +m[3]; }
    if (!y || !mo || !d || mo > 12 || d > 31) continue;
    const iso = new Date(Date.UTC(y, mo - 1, d));
    if (!Number.isNaN(iso.getTime())) return iso.toISOString().slice(0, 10);
  }
  return null;
}

/** "next billing / yenileme" ifadesinin yakinindaki tarihi arar. */
function detectNextRenewal(text) {
  const t = String(text || '');
  const cues = /(next (?:billing|payment|charge|invoice|renewal)[^.\n]{0,40}|renews on[^.\n]{0,40}|sonraki (?:odeme|fatura|yenileme)[^.\n]{0,40}|yenilenecek[^.\n]{0,40})/gi;
  let m;
  while ((m = cues.exec(t)) !== null) {
    const found = parseDateFrom(m[0]);
    if (found) return found;
  }
  return null;
}

function detectTrialEnd(text) {
  const t = String(text || '');
  const cues = /((?:trial|deneme)[^.\n]{0,60})/gi;
  let m;
  while ((m = cues.exec(t)) !== null) {
    const found = parseDateFrom(m[0]);
    if (found) return found;
  }
  return null;
}

function addMonths(isoDate, months) {
  const d = new Date(isoDate + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  // Ay sonu tasmasini engelle (31 Ocak + 1 ay = 28/29 Subat)
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

const CYCLE_MONTHS = { monthly: 1, yearly: 12, quarterly: 3, weekly: 0 };

/** Son odeme + periyot -> sonraki yenileme tahmini. */
function projectRenewal(lastChargeISO, cycle) {
  if (!lastChargeISO) return null;
  if (cycle === 'weekly') {
    const d = new Date(lastChargeISO + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString().slice(0, 10);
  }
  const months = CYCLE_MONTHS[cycle];
  if (!months) return null;
  return addMonths(lastChargeISO, months);
}

/** Konu satirindan servis adi tahmini (odeme araciligi mailleri icin). */
function serviceFromSubject(subject) {
  const s = String(subject || '').trim();
  if (!s) return null;
  const patterns = [
    /(?:receipt|invoice|payment)\s+(?:from|for)\s+([A-Za-z0-9 .&-]{2,40})/i,
    /your\s+([A-Za-z0-9 .&-]{2,40})\s+(?:subscription|receipt|invoice|plan)/i,
    /([A-Za-z0-9 .&-]{2,40})\s+(?:aboneligi|aboneliği|faturasi|faturası)/i
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m && m[1]) {
      const name = m[1].trim().replace(/\s+/g, ' ');
      if (name.length >= 2) return name;
    }
  }
  return null;
}

/**
 * Tek bir maili abonelik kaydina cevirir.
 * @param {{from:string, subject:string, date:string|Date, text:string, to?:string}} mail
 * @returns {object|null}
 */
function parseReceipt(mail) {
  if (!mail) return null;
  const subject = mail.subject || '';
  const body = mail.text || '';
  const haystack = `${subject}\n${body}`;
  if (!looksLikeReceipt(subject, body)) return null;

  const fromDomain = domainOf(mail.from);
  let entry = catalog.lookup(fromDomain);
  let name = entry ? entry.name : null;

  if (!name || catalog.isPaymentProcessor(fromDomain)) {
    const bySubject = serviceFromSubject(subject);
    if (bySubject) {
      const hit = catalog.lookup(bySubject);
      name = hit ? hit.name : bySubject;
      if (hit) entry = hit;
    }
  }
  if (!name) {
    const inBody = catalog.lookup(body.slice(0, 4000));
    if (inBody) { entry = inBody; name = inBody.name; }
  }
  if (!name) {
    if (!fromDomain || catalog.isPaymentProcessor(fromDomain)) return null;
    name = fromDomain.replace(/\.(com|net|org|io|ai|dev|app|co|tech|me)(\.[a-z]{2})?$/, '');
    name = name.split('.').pop();
    name = name.charAt(0).toUpperCase() + name.slice(1);
  }

  const { amount, currency } = pickAmount(haystack);
  const cycle = detectCycle(haystack) || 'monthly';
  const mailDate = mail.date ? new Date(mail.date) : null;
  const lastCharge = mailDate && !Number.isNaN(mailDate.getTime())
    ? mailDate.toISOString().slice(0, 10)
    : null;

  const nextRenewal = detectNextRenewal(haystack) || projectRenewal(lastCharge, cycle);
  const trialEndsAt = detectTrialEnd(haystack);
  const cancelled = CANCEL_HINTS.some((h) => haystack.toLowerCase().includes(h));

  return {
    name,
    plan: '',
    amount: amount === null ? 0 : amount,
    currency: currency || money.detectCurrency(haystack) || 'USD',
    cycle,
    lastCharge,
    nextRenewal,
    trialEndsAt,
    cardLast4: detectCardLast4(haystack),
    billingEmail: mail.to || '',
    category: entry ? entry.category : catalog.guessCategory(name),
    site: entry ? entry.site : catalog.siteFor(name),
    status: cancelled ? 'cancelled' : (trialEndsAt ? 'trial' : 'active'),
    source: 'gmail',
    loginMethod: '',
    loginEmail: '',
    notes: ''
  };
}

/**
 * Ayni servisin birden fazla makbuzunu tek kayda indirger; en yeni makbuz kazanir,
 * eksik alanlar eski makbuzlardan tamamlanir.
 */
function consolidate(records) {
  const byName = new Map();
  const sorted = [...records].filter(Boolean).sort((a, b) => String(a.lastCharge || '').localeCompare(String(b.lastCharge || '')));
  for (const r of sorted) {
    const key = r.name.toLowerCase();
    const prev = byName.get(key);
    if (!prev) { byName.set(key, { ...r, chargeCount: 1, history: [r.lastCharge].filter(Boolean) }); continue; }
    const merged = { ...prev };
    for (const [k, v] of Object.entries(r)) {
      if (v !== null && v !== undefined && v !== '' && !(k === 'amount' && v === 0)) merged[k] = v;
    }
    merged.chargeCount = (prev.chargeCount || 1) + 1;
    merged.history = [...(prev.history || []), r.lastCharge].filter(Boolean);
    byName.set(key, merged);
  }
  return [...byName.values()];
}

module.exports = {
  domainOf, looksLikeReceipt, extractAmounts, pickAmount, detectCycle,
  detectCardLast4, parseDateFrom, detectNextRenewal, detectTrialEnd,
  addMonths, projectRenewal, serviceFromSubject, parseReceipt, consolidate
};
