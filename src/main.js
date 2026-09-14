'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const { Store } = require('./core/store');
const insights = require('./core/insights');
const money = require('./core/money');
const { CATEGORIES } = require('./core/catalog');

let store;
let win;
let secretsFile;

function userDataFile(name) {
  return path.join(app.getPath('userData'), name);
}

/* ---------- Gmail uygulama sifresi: isletim sisteminin kasasinda ---------- */

function savePassword(plain) {
  if (!plain) return false;
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(secretsFile, safeStorage.encryptString(plain));
    return true;
  }
  return false; // Kasa yoksa sifre diske yazilmaz; her seferinde sorulur.
}

function readPassword() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(fs.readFileSync(secretsFile));
  } catch (_) {
    return null;
  }
}

/* ---------- Pencere ---------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: 'SubKill',
    backgroundColor: '#0d1117',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
}

app.whenReady().then(() => {
  store = new Store(userDataFile('subkill-data.json'));
  secretsFile = userDataFile('gmail.secret');
  store.load();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ---------- Durum ---------- */

function buildState() {
  const data = store.get();
  const opts = { rates: data.settings.rates, base: data.settings.base, dormantDays: data.settings.dormantDays };
  return {
    settings: data.settings,
    cards: data.cards,
    subscriptions: data.subscriptions,
    scans: data.scans,
    categories: CATEGORIES,
    computed: {
      summary: insights.summary(data.subscriptions, opts),
      upcoming: insights.upcoming(data.subscriptions, 45, opts),
      trials: insights.trialsEnding(data.subscriptions, 14, opts),
      overlaps: insights.overlaps(data.subscriptions, opts),
      dormant: insights.dormant(data.subscriptions, data.settings.dormantDays, opts),
      cardLoad: insights.cardLoad(data.subscriptions, data.cards, opts),
      alerts: insights.alerts(data.subscriptions, data.cards, opts),
      calendar: insights.calendar(data.subscriptions, 12, opts)
    }
  };
}

ipcMain.handle('state:get', () => buildState());

ipcMain.handle('settings:save', (_e, patch) => {
  store.updateSettings(patch || {});
  return buildState();
});

ipcMain.handle('cards:save', (_e, cards) => {
  store.setCards(cards);
  return buildState();
});

ipcMain.handle('sub:upsert', (_e, sub) => {
  store.upsertSubscription(sub);
  return buildState();
});

ipcMain.handle('sub:remove', (_e, id) => {
  store.removeSubscription(id);
  return buildState();
});

/* ---------- Gmail ---------- */

ipcMain.handle('gmail:hasPassword', () => Boolean(readPassword()));

ipcMain.handle('gmail:test', async (_e, creds) => {
  const gmail = require('./services/gmail');
  const pass = creds.appPassword || readPassword();
  try {
    const res = await gmail.testConnection({ user: creds.user, appPassword: pass });
    if (creds.appPassword) savePassword(creds.appPassword);
    store.updateSettings({ gmailUser: creds.user });
    return { ok: true, ...res };
  } catch (err) {
    return { ok: false, error: friendlyGmailError(err) };
  }
});

ipcMain.handle('gmail:scan', async (_e, creds) => {
  const gmail = require('./services/gmail');
  const pass = (creds && creds.appPassword) || readPassword();
  const user = (creds && creds.user) || store.get().settings.gmailUser;
  if (!user || !pass) return { ok: false, error: 'Önce Gmail adresi ve uygulama şifresi girilmeli.' };

  try {
    const report = await gmail.scan({
      user,
      appPassword: pass,
      lookbackDays: store.get().settings.lookbackDays,
      onProgress: (p) => { if (win && !win.isDestroyed()) win.webContents.send('scan:progress', p); }
    });
    return { ok: true, scanned: report.scanned, matched: report.matched, records: report.consolidated };
  } catch (err) {
    return { ok: false, error: friendlyGmailError(err) };
  }
});

ipcMain.handle('gmail:apply', (_e, records) => {
  const result = store.mergeScanned(records || []);
  return { ok: true, result, state: buildState() };
});

function friendlyGmailError(err) {
  const msg = String((err && err.message) || err);
  if (/AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed/i.test(msg)) {
    return 'Gmail girişi reddedildi. Hesap parolası değil, Google "uygulama şifresi" gerekiyor (myaccount.google.com/apppasswords).';
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED/i.test(msg)) return 'Gmail sunucusuna ulaşılamadı. İnternet bağlantısını kontrol edin.';
  if (/IMAP.*disabled|\[ALERT\]/i.test(msg)) return 'Gmail hesabında IMAP kapalı olabilir. Gmail ayarlarından IMAP erişimini açın.';
  return msg;
}

/* ---------- Kullanim ve kur ---------- */

ipcMain.handle('usage:scan', async () => {
  const chrome = require('./services/chromeHistory');
  try {
    const res = await chrome.collectUsage();
    const touched = store.applyUsage(res.usage);
    return { ok: true, profiles: res.profiles, rows: res.rows, matched: touched, errors: res.errors, state: buildState() };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('fx:refresh', async () => {
  const fx = require('./services/fx');
  try {
    const { rates, updatedAt } = await fx.fetchRates();
    const current = store.get().settings.rates;
    store.updateSettings({ rates: { ...current, ...rates }, ratesUpdatedAt: updatedAt });
    return { ok: true, rates, updatedAt, state: buildState() };
  } catch (err) {
    return { ok: false, error: `Kur güncellenemedi: ${String(err.message || err)}` };
  }
});

/* ---------- Disari / iceri aktarma ---------- */

ipcMain.handle('data:path', () => store.file);

ipcMain.handle('shell:open', (_e, url) => {
  if (/^https?:\/\//i.test(String(url))) shell.openExternal(url);
  return true;
});

ipcMain.handle('data:export', async () => {
  const { filePath, canceled } = await dialog.showSaveDialog(win, {
    title: 'Veriyi dışarı aktar',
    defaultPath: `subkill-yedek-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (canceled || !filePath) return { ok: false };
  fs.writeFileSync(filePath, JSON.stringify(store.export(), null, 2), 'utf8');
  return { ok: true, filePath };
});

ipcMain.handle('data:import', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog(win, {
    title: 'Veri dosyası seç',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (canceled || !filePaths.length) return { ok: false };
  try {
    store.import(JSON.parse(fs.readFileSync(filePaths[0], 'utf8')));
    return { ok: true, state: buildState() };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

const CSV_COLUMNS = [
  'name', 'plan', 'amount', 'currency', 'cycle', 'nextRenewal', 'lastCharge',
  'cardLast4', 'billingEmail', 'loginMethod', 'loginEmail', 'category',
  'site', 'lastUsedAt', 'status', 'trialEndsAt', 'notes'
];

function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

ipcMain.handle('data:exportCsv', async () => {
  const { filePath, canceled } = await dialog.showSaveDialog(win, {
    title: 'CSV olarak dışarı aktar',
    defaultPath: `subkill-abonelikler-${new Date().toISOString().slice(0, 10)}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (canceled || !filePath) return { ok: false };
  const data = store.get();
  const rows = [CSV_COLUMNS.join(';')];
  for (const s of data.subscriptions) rows.push(CSV_COLUMNS.map((c) => csvEscape(s[c])).join(';'));
  fs.writeFileSync(filePath, '﻿' + rows.join('\n'), 'utf8'); // BOM: Excel Turkce karakterleri dogru okusun
  return { ok: true, filePath };
});

function parseCsv(text) {
  const clean = String(text).replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const delimiter = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';

  const splitLine = (line) => {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === delimiter) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };

  const header = splitLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const obj = {};
    header.forEach((h, i) => { obj[h] = (cells[i] || '').trim(); });
    return obj;
  });
}

ipcMain.handle('data:importCsv', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog(win, {
    title: 'CSV dosyası seç',
    properties: ['openFile'],
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (canceled || !filePaths.length) return { ok: false };
  try {
    const rows = parseCsv(fs.readFileSync(filePaths[0], 'utf8'));
    const records = rows
      .filter((r) => r.name)
      .map((r) => ({
        ...r,
        amount: money.parseAmount(r.amount) || 0,
        currency: (r.currency || 'USD').toUpperCase(),
        cycle: r.cycle || 'monthly',
        status: r.status || 'active',
        source: 'csv'
      }));
    const result = store.mergeScanned(records);
    return { ok: true, result, state: buildState() };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});
