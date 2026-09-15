'use strict';

const money = require('./money');
const { CATEGORIES } = require('./catalog');

const DAY = 86400000;

function today(now) {
  return now ? new Date(now) : new Date();
}

function daysBetween(fromISO, now) {
  if (!fromISO) return null;
  const d = new Date(fromISO + (fromISO.length === 10 ? 'T00:00:00Z' : ''));
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((today(now).getTime() - d.getTime()) / DAY);
}

function daysUntil(isoDate, now) {
  if (!isoDate) return null;
  const d = new Date(isoDate + (isoDate.length === 10 ? 'T00:00:00Z' : ''));
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - today(now).getTime()) / DAY);
}

function isActive(sub) {
  return sub && (sub.status === 'active' || sub.status === 'trial');
}

/** Genel ozet: aylik/yillik yuk, adet, kategori ve para birimi dagilimi. */
function summary(subs, opts = {}) {
  const rates = opts.rates;
  const base = opts.base || 'TRY';
  const active = (subs || []).filter(isActive);

  let monthly = 0;
  let yearly = 0;
  const byCategory = {};
  const byCurrency = {};

  for (const s of active) {
    const m = money.monthlyIn(s, base, rates);
    monthly += m;
    yearly += money.yearlyIn(s, base, rates);

    const cat = s.category || 'diger';
    byCategory[cat] = (byCategory[cat] || 0) + m;

    const cur = s.currency || 'USD';
    byCurrency[cur] = (byCurrency[cur] || 0) + money.monthlyAmount(s);
  }

  return {
    base,
    count: active.length,
    total: (subs || []).length,
    monthly,
    yearly,
    byCategory,
    byCurrency
  };
}

/** Onumuzdeki N gun icinde yenilenecekler, tarihe gore sirali. */
function upcoming(subs, days = 30, opts = {}) {
  const now = opts.now;
  return (subs || [])
    .filter(isActive)
    .map((s) => ({ sub: s, inDays: daysUntil(s.nextRenewal, now) }))
    .filter((x) => x.inDays !== null && x.inDays >= 0 && x.inDays <= days)
    .sort((a, b) => a.inDays - b.inDays);
}

/** Denemesi bitmek uzere olanlar — unutulup ucrete donenler burada yakalanir. */
function trialsEnding(subs, days = 7, opts = {}) {
  const now = opts.now;
  return (subs || [])
    .filter((s) => s && s.trialEndsAt && s.status !== 'cancelled')
    .map((s) => ({ sub: s, inDays: daysUntil(s.trialEndsAt, now) }))
    .filter((x) => x.inDays !== null && x.inDays >= 0 && x.inDays <= days)
    .sort((a, b) => a.inDays - b.inDays);
}

/**
 * Ayni kategoride birden fazla aktif abonelik = potansiyel cakisma.
 * Karar kullanicinin; uygulama sadece yan yana koyar ve en az kullanilani isaretler.
 */
function overlaps(subs, opts = {}) {
  const rates = opts.rates;
  const base = opts.base || 'TRY';
  const now = opts.now;
  const groups = {};

  for (const s of (subs || []).filter(isActive)) {
    const cat = s.category || 'diger';
    (groups[cat] = groups[cat] || []).push(s);
  }

  const out = [];
  for (const [cat, list] of Object.entries(groups)) {
    if (list.length < 2) continue;
    const items = list.map((s) => ({
      sub: s,
      monthly: money.monthlyIn(s, base, rates),
      idleDays: daysBetween(s.lastUsedAt, now)
    })).sort((a, b) => b.monthly - a.monthly);

    const totalMonthly = items.reduce((acc, x) => acc + x.monthly, 0);
    const cheapest = Math.min(...items.map((x) => x.monthly));
    out.push({
      category: cat,
      categoryLabel: CATEGORIES[cat] || cat,
      items,
      count: items.length,
      totalMonthly,
      // Tek bir servise inilirse en fazla bu kadar aylik tasarruf olur.
      potentialMonthlySaving: totalMonthly - cheapest
    });
  }
  return out.sort((a, b) => b.potentialMonthlySaving - a.potentialMonthlySaving);
}

/**
 * Uzun suredir girilmemis abonelikler. lastUsedAt yoksa "hic kayit yok" sayilir
 * ve ilk odemeden bu yana gecen sure olcut alinir.
 */
function dormant(subs, thresholdDays = 60, opts = {}) {
  const rates = opts.rates;
  const base = opts.base || 'TRY';
  const now = opts.now;
  const out = [];

  for (const s of (subs || []).filter(isActive)) {
    const idle = daysBetween(s.lastUsedAt, now);
    const knownUsage = idle !== null;
    if (knownUsage && idle < thresholdDays) continue;

    const monthly = money.monthlyIn(s, base, rates);
    if (monthly <= 0) continue;

    out.push({
      sub: s,
      idleDays: idle,
      knownUsage,
      monthly,
      yearly: monthly * 12,
      priority: !knownUsage ? 'bilinmiyor' : (idle >= thresholdDays * 1.5 ? 'yuksek' : 'orta')
    });
  }

  const rank = { yuksek: 0, orta: 1, bilinmiyor: 2 };
  return out.sort((a, b) => (rank[a.priority] - rank[b.priority]) || (b.monthly - a.monthly));
}

function monthKey(date) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Sessiz iptaller: yenileme tarihi gecmis ama yeni makbuz gelmemis abonelikler.
 *
 * Iptal maili her zaman gelmez ya da posta kutusunda bulunamaz. Bu durumda
 * tek kanit, beklenen yenilemenin gerceklesmemis olmasidir. Yanlis alarm
 * vermemek icin donem uzunlugu kadar ek sure taninir: aylik abonelikte
 * yenileme uzerinden 45 gun, yillik abonelikte 400 gun gecmis olmali.
 */
function silentlyEnded(subs, opts = {}) {
  const now = today(opts.now);
  const GRACE = { monthly: 45, weekly: 21, quarterly: 120, yearly: 400, usage: 60, onetime: null };

  return (subs || []).filter(isActive).map((s) => {
    const grace = GRACE[s.cycle];
    if (!grace) return null;
    // Son kanit: varsa son makbuz, yoksa beklenen yenileme tarihi.
    const anchor = s.lastCharge || s.nextRenewal;
    if (!anchor) return null;
    const since = daysBetween(new Date(anchor + 'T00:00:00Z'), now);
    if (since < grace) return null;
    return {
      sub: s,
      daysSince: since,
      anchor,
      yearly: money.yearlyIn(s, opts.base || 'TRY', opts.rates)
    };
  }).filter(Boolean).sort((a, b) => b.daysSince - a.daysSince);
}

/** Tum uyarilari tek listede, onceligine gore siralar. */
function alerts(subs, opts = {}) {
  const base = opts.base || 'TRY';
  const out = [];

  for (const t of trialsEnding(subs, 7, opts)) {
    out.push({
      level: 'kritik',
      type: 'deneme',
      title: `${t.sub.name} denemesi ${t.inDays} gün içinde bitiyor`,
      detail: 'İptal etmezsen ücretli plana geçer.',
      sub: t.sub
    });
  }


  for (const e of silentlyEnded(subs, opts)) {
    out.push({
      level: 'uyari',
      type: 'sessiz-iptal',
      title: `${e.sub.name} yenilenmemiş görünüyor`,
      detail: `Son hareket ${e.daysSince} gün önce (${e.anchor}). Beklenen yenileme gelmediğine göre abonelik bitmiş olabilir; listeden düşürmek için kontrol et.`,
      sub: e.sub
    });
  }

  for (const d of dormant(subs, opts.dormantDays || 60, opts)) {
    if (d.priority === 'bilinmiyor') continue;
    out.push({
      level: d.priority === 'yuksek' ? 'uyari' : 'bilgi',
      type: 'olu',
      title: `${d.sub.name} ${d.idleDays} gündür kullanılmadı`,
      detail: `Yılda ${money.formatMoney(d.yearly, base)} ödeniyor. İptal adayı.`,
      sub: d.sub
    });
  }

  for (const o of overlaps(subs, opts)) {
    if (o.potentialMonthlySaving <= 0) continue;
    out.push({
      level: 'bilgi',
      type: 'cakisma',
      title: `${o.categoryLabel}: ${o.count} ayrı abonelik`,
      detail: `${o.items.map((i) => i.sub.name).join(', ')}. Tek servise inersen ayda ${money.formatMoney(o.potentialMonthlySaving, base)} kalir.`
    });
  }

  for (const u of upcoming(subs, 7, opts)) {
    out.push({
      level: 'bilgi',
      type: 'yenileme',
      title: `${u.sub.name} ${u.inDays} gün içinde yenileniyor`,
      detail: money.formatMoney(u.sub.amount, u.sub.currency),
      sub: u.sub
    });
  }

  const rank = { kritik: 0, uyari: 1, bilgi: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

/** 12 aylik yenileme takvimi: hangi ay ne kadar odeme var. */
function calendar(subs, months = 12, opts = {}) {
  const rates = opts.rates;
  const base = opts.base || 'TRY';
  const start = today(opts.now);
  const out = [];

  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const key = monthKey(d);
    let total = 0;
    const items = [];
    for (const s of (subs || []).filter(isActive)) {
      if (s.cycle === 'monthly' || s.cycle === 'usage' || s.cycle === 'weekly') {
        const amt = money.monthlyIn(s, base, rates);
        total += amt;
        items.push({ sub: s, amount: amt, recurring: true });
      } else if (s.nextRenewal) {
        // Yillik/3 aylik kalemleri periyoduna gore ileri tarihlere yansit.
        const step = s.cycle === 'yearly' ? 12 : s.cycle === 'quarterly' ? 3 : 0;
        if (!step) continue;
        let cursor = s.nextRenewal;
        for (let k = 0; k < 40; k++) {
          const ck = monthKey(new Date(cursor + 'T00:00:00Z'));
          if (ck === key) {
            const amt = money.convert(Number(s.amount) || 0, s.currency || 'USD', base, rates);
            total += amt;
            items.push({ sub: s, amount: amt, recurring: false });
            break;
          }
          if (ck > key) break;
          const next = require('./parser').addMonths(cursor, step);
          if (!next || next === cursor) break;
          cursor = next;
        }
      }
    }
    out.push({ month: key, total, items: items.sort((a, b) => b.amount - a.amount) });
  }
  return out;
}

module.exports = {
  daysBetween, daysUntil, isActive, summary, upcoming, trialsEnding,
  overlaps, dormant, silentlyEnded, alerts, calendar, monthKey
};
