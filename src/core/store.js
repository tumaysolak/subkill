'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const EMPTY = {
  version: 1,
  settings: {
    base: 'TRY',
    rates: { TRY: 1, USD: 48.6, EUR: 56.1, GBP: 65.7 },
    ratesUpdatedAt: null,
    gmailUser: '',
    dormantDays: 60,
    lookbackDays: 400
  },
  cards: [],
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
    const created = {
      id: sub.id || newId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'active',
      ...sub
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

  /**
   * Tarama sonuclarini mevcut kayitlarla birlestirir.
   * Elle girilen alanlar (loginMethod, loginEmail, notes, monthlyLimit) korunur;
   * tarama sadece para/tarih/kart alanlarini tazeler.
   */
  mergeScanned(records) {
    const d = this.get();
    const result = { added: 0, updated: 0, items: [] };
    const PRESERVE = ['loginMethod', 'loginEmail', 'notes', 'lastUsedAt', 'plan'];

    for (const r of records || []) {
      const existing = d.subscriptions.find(
        (s) => s.name.toLowerCase() === String(r.name).toLowerCase()
      );
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

  setCards(cards) {
    const d = this.get();
    d.cards = cards || [];
    this.save();
    return d.cards;
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
