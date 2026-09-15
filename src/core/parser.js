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

// Konu satirinda bunlardan biri varsa mail ciddi bir makbuz adayidir.
const SUBJECT_RECEIPT = /(receipt|invoice|fatura|makbuz|payment (received|confirmation|successful)|your payment|payment to|tahsilat|odeme (alindi|onayi)|ödeme (alındı|onayı)|subscription (renewed|confirmation|payment)|abonelik (yenilendi|odemesi)|has been (charged|renewed)|order confirmation|siparis onayi|sipariş onayı|billing statement|trial (has )?started|your trial|deneme (basladi|başladı|suresi basladi)|your .{0,20}(bill|invoice) is ready|faturan[ıi]z haz[ıi]r)/i;

// Govdede tutarla birlikte gecerse makbuz sayilir.
const BODY_RECEIPT = /(amount (paid|charged|due)|total (paid|charged|amount)|grand total|genel toplam|toplam tutar|odenen tutar|ödenen tutar|invoice (number|no|#)|fatura (no|numaras[ıi]))/i;

// Pazarlama/bulten isaretleri: bunlar varken ve makbuz kaniti yokken mail elenir.
const MARKETING_SIGNALS = /(campaign id|utm_campaign|unsubscribe from|% off|indirim|webinar|join us|new (classes|features)|newsletter|bulten|bülten|davetlisiniz|son bir haftaniz)/i;

// Ic yazismalar ve iletilen mailler makbuz degildir.
const FORWARDED_THREAD = /(^|\n)\s*(from:.{0,120}\n\s*sent:|-{3,}\s*forwarded message|ilet[ıi]len ileti)/i;

/**
 * Mail bir odeme makbuzu mu?
 *
 * Eskiden tek bir anahtar kelime yetiyordu ve "subscription" gecen her bulten
 * makbuz sayiliyordu. Gercek tarama sonucunda Grammarly kampanyasi LinkedIn
 * aboneligi, sirket ici bir yazisma Google Ads aboneligi olarak kaydedilmisti.
 * Artik konu satirinda net bir makbuz isareti ya da govdede tutar etiketiyle
 * birlikte bir kanit aranıyor; pazarlama isaretleri eleniyor.
 */
function looksLikeReceipt(subject, body) {
  const subj = String(subject || '');
  const text = String(body || '').slice(0, 6000);
  const hay = `${subj}\n${text}`;

  if (FORWARDED_THREAD.test(hay)) return false;

  const strongSubject = SUBJECT_RECEIPT.test(subj);
  const bodyEvidence = BODY_RECEIPT.test(hay);
  const hasMoney = extractAmounts(hay).length > 0;

  if (MARKETING_SIGNALS.test(hay) && !(strongSubject && (hasMoney || bodyEvidence))) return false;
  if (strongSubject) return true;
  return bodyEvidence && hasMoney;
}

// DIKKAT: para birimi kodlari buyuk harf aranir. Kucuk harfle de kabul
// edilince Ingilizce "Try it free" cumlesindeki "Try" TRY para birimi
// sayiliyor ve tutar 0 TRY olarak kaydediliyordu.
const AMOUNT_PATTERNS = [
  // $12.99 / €9,99 / ₺450,00
  /([$€£₺])\s?([\d][\d.,]*)/g,
  // 12.99 USD / 450,00 TL
  /([\d][\d.,]*)\s?(USD|EUR|GBP|TRY|TL)\b/g,
  // USD 12.99
  /\b(USD|EUR|GBP|TRY|TL)\s?([\d][\d.,]*)/g
];

// "1 USD = 49,11 TRY" gibi kur satirlari tutar degildir.
const FX_LINE = /(1\s*(USD|EUR|GBP)\s*=|exchange rate|doviz kuru|döviz kuru|kur:)/i;

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
      // Kur satirindaki sayilar odenen tutar degildir.
      const lineStart = t.lastIndexOf('\n', m.index) + 1;
      let lineEnd = t.indexOf('\n', m.index);
      if (lineEnd === -1) lineEnd = t.length;
      const line = t.slice(lineStart, Math.min(lineEnd, lineStart + 200));
      if (FX_LINE.test(line)) continue;

      const before = t.slice(Math.max(0, m.index - 60), m.index).toLowerCase();
      const priority = /(total|toplam|amount due|amount paid|amount charged|grand total|genel toplam|tutar|odenen|ödenen)/.test(before) ? 2 : 1;
      found.push({ amount, currency, priority, index: m.index });
    }
  }
  return found;
}

/**
 * Odenen tutari secer.
 *
 * Eski surumun hatasi: tum tutarlari para birimine bakmadan buyukluge gore
 * siraliyordu. Yabanci servislerin Turkiye'ye gelen makbuzlarinda hem
 * "$288.00" hem de karsiligi "₺14.144,91" yaziyor; sayisal olarak buyuk
 * oldugu icin her zaman lira karsiligi seciliyordu. Artik once para birimi
 * seciliyor, kiyaslama yalniz ayni birim icinde yapiliyor.
 */
function pickAmount(text) {
  const all = extractAmounts(text);
  if (!all.length) return { amount: null, currency: null };

  // 1) "Toplam / amount paid" etiketli tutarlar varsa yalniz onlara bak.
  const maxPriority = Math.max(...all.map((x) => x.priority));
  let pool = all.filter((x) => x.priority === maxPriority);

  // 2) Para birimini sec. Yabanci birim ile TRY birlikte geciyorsa, TRY
  //    cogu zaman cevrilmis karsiliktir; asil ucret yabanci birimdedir.
  const currencies = [...new Set(pool.map((x) => x.currency))];
  let currency = currencies[0];
  if (currencies.length > 1) {
    const foreign = currencies.filter((c) => c !== 'TRY');
    if (foreign.length === 1) {
      currency = foreign[0];
    } else {
      // Birden fazla yabanci birim varsa en sik geceni al.
      const counts = {};
      for (const x of pool) counts[x.currency] = (counts[x.currency] || 0) + 1;
      currency = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    }
  }

  pool = pool.filter((x) => x.currency === currency);
  pool.sort((a, b) => b.amount - a.amount);
  return { amount: pool[0].amount, currency };
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


/* ---------------- iptal tespiti ---------------- */

/**
 * Iptal/sonlandirma bildirimlerini tanir.
 *
 * Makbuz gibi gormedigi icin parseReceipt bunlari kaciriyordu: iptal
 * maillerinde genelde tutar yok. Burada ayri bir kontrol var. Yalniz
 * "iptal edebilirsiniz" gibi pazarlama cumlelerini iptal saymamak icin
 * kalip listesi dar tutuldu ve olumsuzlama filtreleri eklendi.
 */
const CANCEL_PATTERNS = [
  /\b(your|the)\s+(subscription|plan|membership)\s+(has been|was|is)\s+(cancell?ed|canceled|terminated|ended)\b/i,
  /\bsubscription\s+cancell?ation\s+(confirmed|confirmation|complete)\b/i,
  /\b(we'?re|we are)\s+sorry\s+to\s+see\s+you\s+go\b/i,
  /\byour\s+(subscription|plan)\s+will\s+not\s+renew\b/i,
  /\bauto[- ]?renew(al)?\s+(has been\s+)?(turned\s+off|disabled|cancell?ed)\b/i,
  /\bcancell?ation\s+(confirmation|receipt)\b/i,
  /\brefund(ed)?\s+(your|the)\s+(payment|subscription|purchase)\b/i,
  /\bacconelig[iı]niz\s+(iptal\s+edildi|sonland[iı]r[iı]ld[iı])\b/i,
  /\baboneli[gğ]iniz\s+(iptal\s+edildi|sonland[iı]r[iı]ld[iı]|sona\s+erdi)\b/i,
  /\biptal\s+(talebiniz|i[sş]leminiz)\s+(al[iı]nd[iı]|tamamland[iı]|onayland[iı])\b/i,
  /\büyeli[gğ]iniz\s+(iptal\s+edildi|sonland[iı]r[iı]ld[iı])\b/i
];

// Bu kaliplar gecen mailler iptal bildirimi degildir; pazarlama ya da
// "istediginiz zaman iptal edebilirsiniz" gibi bilgilendirme cumleleridir.
const NOT_CANCEL_PATTERNS = [
  /\bcancel\s+(any\s*time|anytime|at\s+any\s+time)\b/i,
  /\byou\s+can\s+cancel\b/i,
  /\bto\s+cancel[, ]/i,
  /\bistedi[gğ]iniz\s+(zaman|an)\s+iptal\b/i,
  /\biptal\s+etmek\s+i[cç]in\b/i
];

/**
 * @returns {null|{name:string, cancelledAt:string|null, evidence:string}}
 */

/**
 * Servis adlarini karsilastirmak icin sadelestirir.
 *
 * Ayni servis makbuzlarda farkli yazilabiliyor: "Eleven Labs Inc.",
 * "ElevenLabs", "Dcipher Analytics AB", "Dcipheranalytics". Sirket ekleri ve
 * bosluklar atilinca bunlar tek kayitta birlesiyor.
 */
// Servis adi olamayacak kelimeler. Turkce makbuzlarda konu satirindan
// "ek", "fatura", "odeme" gibi parcalar servis adi olarak cikabiliyordu.
const JUNK_NAMES = new Set([
  'ek', 'eki', 'fatura', 'faturasi', 'makbuz', 'odeme', 'ödeme', 'bilgi', 'bilgilendirme',
  'hesap', 'hesabi', 'abonelik', 'yenileme', 'receipt', 'invoice', 'payment', 'billing',
  'subscription', 'renewal', 'order', 'siparis', 'sipariş', 'mail', 'email', 'eposta',
  'noreply', 'no-reply', 'destek', 'support', 'info', 'video', 'test'
]);

function isJunkName(name) {
  const n = String(name || '').trim().toLowerCase();
  if (n.length < 3) return true;
  if (JUNK_NAMES.has(n)) return true;
  if (/^\d+$/.test(n)) return true;
  return false;
}

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(inc|llc|ltd|limited|gmbh|bv|ab|corp|corporation|co|company|a\.?s|as|sirketi|şirketi)\b/g, ' ')
    .replace(/[^a-z0-9ğüşıöç]+/g, '');
}

function parseCancellation(mail) {
  if (!mail) return null;
  const subject = mail.subject || '';
  const body = mail.text || '';
  const haystack = `${subject}\n${body}`.slice(0, 6000);

  const hit = CANCEL_PATTERNS.find((re) => re.test(haystack));
  if (!hit) return null;
  if (NOT_CANCEL_PATTERNS.some((re) => re.test(haystack))) return null;

  const fromDomain = domainOf(mail.from);
  let entry = catalog.lookup(fromDomain);
  let name = entry ? entry.name : null;

  if (!name || catalog.isPaymentProcessor(fromDomain)) {
    const bySubject = serviceFromSubject(subject);
    if (bySubject) {
      const hit2 = catalog.lookup(bySubject);
      name = hit2 ? hit2.name : bySubject;
    }
  }
  if (!name) {
    // Govdenin tamamina bakinca alt bilgideki baska markalar (ornegin bir
    // kampanya mailindeki LinkedIn baglantisi) servis adi sanilıyordu.
    const inBody = catalog.lookup(body.slice(0, 800));
    if (inBody) name = inBody.name;
  }
  if (!name) {
    if (!fromDomain || catalog.isPaymentProcessor(fromDomain)) return null;
    name = fromDomain.replace(/\.(com|net|org|io|ai|dev|app|co|tech|me)(\.[a-z]{2})?$/, '');
    name = name.split('.').pop();
    name = name.charAt(0).toUpperCase() + name.slice(1);
  }

  if (isJunkName(name)) return null;

  const d = mail.date ? new Date(mail.date) : null;
  return {
    name,
    cancelledAt: d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null,
    evidence: (haystack.match(hit) || [''])[0].slice(0, 160)
  };
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
    // Govdenin tamamina bakinca alt bilgideki baska markalar (ornegin bir
    // kampanya mailindeki LinkedIn baglantisi) servis adi sanilıyordu.
    const inBody = catalog.lookup(body.slice(0, 800));
    if (inBody) { entry = inBody; name = inBody.name; }
  }
  if (!name) {
    if (!fromDomain || catalog.isPaymentProcessor(fromDomain)) return null;
    name = fromDomain.replace(/\.(com|net|org|io|ai|dev|app|co|tech|me)(\.[a-z]{2})?$/, '');
    name = name.split('.').pop();
    name = name.charAt(0).toUpperCase() + name.slice(1);
  }

  if (isJunkName(name)) return null;

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
    // Fatura eki PDF olan makbuzlarda govdede tutar yok. Sifir yazip
    // toplamlari bozmak yerine isaretlenip kullaniciya sorulur.
    amountUnknown: amount === null,
    currency: currency || money.detectCurrency(haystack) || 'USD',
    cycle,
    lastCharge,
    nextRenewal,
    trialEndsAt,
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
    const key = normalizeName(r.name) || r.name.toLowerCase();
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
  parseCancellation,
  normalizeName,
  domainOf, looksLikeReceipt, extractAmounts, pickAmount, detectCycle,
  parseDateFrom, detectNextRenewal, detectTrialEnd,
  addMonths, projectRenewal, serviceFromSubject, parseReceipt, consolidate
};
