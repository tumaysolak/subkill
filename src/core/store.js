'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeName } = require('./parser');

const EMPTY = {
  version: 1,
  settings: {
    base: 'TRY',
    rates: { TRY: 1, USD: 48.6, EUR: 56.1, GBP: 65.7 },
    ratesUpdatedAt: null,
    mailAccounts: [],
    autoScan: true,
    autoScanEveryHours: 24,
    autoScanLookbackDays: 14,
    lastAutoScanAt: null,
    dormantDays: 60,
    lookbackDays: 400
  },
  subscriptions: [],
  scans: []
};

function newId() {
  return crypto.randomUUID();
}

class Store {
  constructor(filePath) {
    this.file = filePath;
    this.data = null;
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = {
        ...EMPTY,
        ...parsed,
        settings: { ...EMPTY.settings, ...(parsed.settings || {}) }
      };
      // Eski surumlerin izleri temizleniyor: once tek bir gmailUser vardi,
      // sonra sadece Gmail tutan bir gmailAccounts listesi. Ikisi de artik
      // sunucu bilgisi tasiyan mailAccounts listesine goc ediyor.
      const st = this.data.settings;
      if (!Array.isArray(st.mailAccounts)) st.mailAccounts = [];
      if (Array.isArray(st.gmailAccounts)) {
        for (const a of st.gmailAccounts) {
          if (a && a.user && !st.mailAccounts.some((m) => m.user === a.user)) {
            st.mailAccounts.push({ ...a, provider: a.provider || 'gmail' });
          }
        }
      }
      delete st.gmailAccounts;
      if (st.gmailUser && !st.mailAccounts.some((a) => a.user === st.gmailUser)) {
        st.mailAccounts.push({ user: st.gmailUser, provider: 'gmail', addedAt: new Date().toISOString() });
      }
      delete st.gmailUser;
      // Saglayicisi yazilmamis kayitlar Gmail donemine ait.
      for (const a of st.mailAccounts) if (!a.provider) a.provider = 'gmail';
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Bozuk dosyayi ezme; yedekle ve temiz basla.
        try { fs.renameSync(this.file, `${this.file}.bozuk-${Date.now()}`); } catch (_) { /* yoksay */ }
      }
      this.data = JSON.parse(JSON.stringify(EMPTY));
      this.save();
    }
    return this.data;
  }

  save() {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file); // atomik yazim: yarim dosya kalmasin
    return true;
  }

  get() {
    if (!this.data) this.load();
    return this.data;
  }

  updateSettings(patch) {
    const d = this.get();
    d.settings = { ...d.settings, ...(patch || {}) };
    this.save();
    return d.settings;
  }

  listSubscriptions() {
    return this.get().subscriptions;
  }

  upsertSubscription(sub) {
    const d = this.get();
    if (sub.id) {
      const i = d.subscriptions.findIndex((s) => s.id === sub.id);
      if (i > -1) {
        d.subscriptions[i] = { ...d.subscriptions[i], ...sub, updatedAt: new Date().toISOString() };
        this.save();
        return d.subscriptions[i];
      }
    }
    // Onemli: yayilmis alanlar once gelmeli. Aksi halde cagiran taraftan gelen
    // "id: undefined" uretilen kimligi ezer ve kayit duzenlenemez/silinemez hale gelir.
    const created = {
      ...sub,
      id: sub.id || newId(),
      status: sub.status || 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    d.subscriptions.push(created);
    this.save();
    return created;
  }

  removeSubscription(id) {
    const d = this.get();
    const before = d.subscriptions.length;
    d.subscriptions = d.subscriptions.filter((s) => s.id !== id);
    this.save();
    return before !== d.subscriptions.length;
  }

  /* ---------------- posta hesaplari ---------------- */

  /**
   * Hesabi listeye ekler ya da var olani gunceller.
   * Sifre burada tutulmaz; o isletim sisteminin kasasinda durur.
   * @param {{user:string, provider?:string, host?:string, port?:number, secure?:boolean}} account
   */
  addMailAccount(account) {
    const d = this.get();
    const src = typeof account === 'string' ? { user: account } : (account || {});
    const addr = String(src.user || '').trim().toLowerCase();
    if (!addr) return d.settings.mailAccounts;

    const entry = {
      user: addr,
      provider: src.provider || 'gmail',
      host: src.host || null,
      port: Number(src.port) || 993,
      secure: src.secure !== false
    };
    const i = d.settings.mailAccounts.findIndex((a) => a.user === addr);
    if (i >= 0) {
      d.settings.mailAccounts[i] = { ...d.settings.mailAccounts[i], ...entry };
    } else {
      d.settings.mailAccounts.push({ ...entry, addedAt: new Date().toISOString() });
    }
    this.save();
    return d.settings.mailAccounts;
  }

  removeMailAccount(user) {
    const d = this.get();
    const addr = String(user || '').trim().toLowerCase();
    d.settings.mailAccounts = d.settings.mailAccounts.filter((a) => a.user !== addr);
    this.save();
    return d.settings.mailAccounts;
  }

  getMailAccount(user) {
    const addr = String(user || '').trim().toLowerCase();
    return this.get().settings.mailAccounts.find((a) => a.user === addr) || null;
  }

  /**
   * Iptal bildirimlerini uygular.
   *
   * Onemli: iptal maili, o servisin en son makbuzundan ESKIYSE yok sayilir.
   * Aksi halde iptal edip sonra tekrar abone olunan bir servis yanlislikla
   * iptal gorunur.
   */
  applyCancellations(cancellations) {
    const d = this.get();
    const applied = [];
    for (const c of cancellations || []) {
      const key = normalizeName(c.name);
      const sub = d.subscriptions.find((s) => normalizeName(s.name) === key);
      if (!sub || sub.status === 'cancelled') continue;
      if (c.cancelledAt && sub.lastCharge && c.cancelledAt < sub.lastCharge) continue;
      sub.status = 'cancelled';
      sub.cancelledAt = c.cancelledAt || new Date().toISOString().slice(0, 10);
      sub.cancelEvidence = c.evidence || '';
      sub.updatedAt = new Date().toISOString();
      applied.push({ name: sub.name, at: sub.cancelledAt });
    }
    if (applied.length) this.save();
    return applied;
  }

  /**
   * Tarama sonuclarini mevcut kayitlarla birlestirir.
   * Elle girilen alanlar (loginMethod, loginEmail, notes, monthlyLimit) korunur;
   * tarama sadece para ve tarih alanlarini tazeler.
   */
  mergeScanned(records) {
    const d = this.get();
    const result = { added: 0, updated: 0, items: [] };
    const PRESERVE = ['loginMethod', 'loginEmail', 'notes', 'lastUsedAt', 'plan'];

    for (const r of records || []) {
      // Ayni servis farkli yazilislarla gelebiliyor; sadelestirilmis adla eslesir.
      const key = normalizeName(r.name);
      const existing = d.subscriptions.find((s) => normalizeName(s.name) === key);
      if (!existing) {
        d.subscriptions.push({
          id: newId(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...r
        });
        result.added++;
        result.items.push({ name: r.name, action: 'eklendi' });
        continue;
      }
      const keep = {};
      for (const k of PRESERVE) if (existing[k]) keep[k] = existing[k];
      Object.assign(existing, r, keep, { updatedAt: new Date().toISOString() });
      result.updated++;
      result.items.push({ name: r.name, action: 'guncellendi' });
    }

    d.scans.unshift({ at: new Date().toISOString(), added: result.added, updated: result.updated });
    d.scans = d.scans.slice(0, 20);
    this.save();
    return result;
  }



  /** Tarayici gecmisinden gelen son kullanim tarihlerini isler. */
  applyUsage(usageByDomain) {
    const d = this.get();
    let touched = 0;
    for (const s of d.subscriptions) {
      if (!s.site) continue;
      const site = String(s.site).toLowerCase();
      const root = site.split('.').slice(-2).join('.');
      let best = null;
      for (const [domain, lastVisit] of Object.entries(usageByDomain || {})) {
        if (!matchesSite(domain, site, root)) continue;
        if (!best || lastVisit > best) best = lastVisit;
      }
      if (best && best !== s.lastUsedAt) { s.lastUsedAt = best; touched++; }
    }
    this.save();
    return touched;
  }

  export() {
    return JSON.parse(JSON.stringify(this.get()));
  }

  import(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('Gecersiz veri');
    this.data = { ...EMPTY, ...payload, settings: { ...EMPTY.settings, ...(payload.settings || {}) } };
    this.save();
    return this.data;
  }
}

/**
 * Ziyaret edilen alan adi bu servise mi ait?
 * Tam eslesme ya da tek seviyeli alt alan adi kabul edilir; boylece kullanicinin
 * kendi "proje.up.railway.app" dagitimlari Railway aboneligi sayilmaz.
 */
function matchesSite(domain, site, root) {
  const d = String(domain).toLowerCase().replace(/^www\./, '');
  if (d === site || d === root) return true;
  if (!d.endsWith('.' + root)) return false;
  const prefix = d.slice(0, -(root.length + 1));
  return !prefix.includes('.');
}

module.exports = { Store, EMPTY, newId, matchesSite };
