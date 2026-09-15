'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');

const { Store } = require('./core/store');
const insights = require('./core/insights');
const money = require('./core/money');
const { CATEGORIES } = require('./core/catalog');

let store;
let win;

function userDataFile(name) {
  return path.join(app.getPath('userData'), name);
}

/* ---------- Posta sifresi: isletim sisteminin kasasinda ---------- */

// Her hesabin sifresi ayri dosyada; dosya adi adresin ozetinden turetiliyor
// ki adres dosya adina yazilmasin.
function secretTag(user) {
  return crypto.createHash('sha256').update(String(user).trim().toLowerCase()).digest('hex').slice(0, 16);
}

function secretPathFor(user) {
  return userDataFile(`mailbox-${secretTag(user)}.secret`);
}

function savePassword(user, plain) {
  if (!user || !plain) return false;
  if (!safeStorage.isEncryptionAvailable()) return false; // Kasa yoksa diske yazilmaz.
  fs.writeFileSync(secretPathFor(user), safeStorage.encryptString(plain));
  return true;
}

function readPassword(user) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(fs.readFileSync(secretPathFor(user)));
  } catch (_) {
    return null;
  }
}

function forgetPassword(user) {
  try { fs.unlinkSync(secretPathFor(user)); } catch (_) { /* yoksa sorun degil */ }
}


/**
 * Eski surumlerin kasa dosyalarini yeni adlariyla tasir.
 *  - gmail.secret          : tek hesapli donemden kalma, ilk hesaba yazilir
 *  - gmail-<ozet>.secret   : cok hesapli donemden kalma, adi degisiyor
 * Icerik acilmadan yeniden adlandirildigi icin kullanici sifreyi tekrar
 * girmek zorunda kalmaz.
 */
function migrateLegacySecret() {
  const accounts = store.get().settings.mailAccounts || [];

  for (const a of accounts) {
    const eski = userDataFile(`gmail-${secretTag(a.user)}.secret`);
    const yeni = secretPathFor(a.user);
    try {
      if (fs.existsSync(eski) && !fs.existsSync(yeni)) fs.renameSync(eski, yeni);
    } catch (_) { /* tasinamazsa kullanici sifreyi yeniden girer */ }
  }

  const legacy = userDataFile('gmail.secret');
  try {
    if (!fs.existsSync(legacy)) return;
    if (accounts.length && safeStorage.isEncryptionAvailable()) {
      const plain = safeStorage.decryptString(fs.readFileSync(legacy));
      if (plain) savePassword(accounts[0].user, plain);
    }
    fs.unlinkSync(legacy);
  } catch (_) { /* tasinamazsa kullanici sifreyi yeniden girer */ }
}

/* ---------- Gunluk otomatik tarama ---------- */

let autoScanTimer = null;

/**
 * Yeni makbuz geldi mi diye belirli araliklarla tum hesaplari tarar ve
 * sonucu kendiliginden uygular. Kisa bir geriye donus penceresi kullanir
 * (varsayilan 14 gun), boylece gunluk tarama hizli biter.
 */
async function runAutoScan(reason) {
  const st = store.get().settings;
  if (!st.autoScan) return { ok: false, skipped: 'kapali' };

  const accounts = (st.mailAccounts || []).filter((a) => readPassword(a.user));
  if (!accounts.length) return { ok: false, skipped: 'hesap yok' };

  const res = await scanAccounts(accounts.map((a) => a.user), {
    lookbackDays: st.autoScanLookbackDays || 14
  });
  if (!res.ok) return res;

  const merge = store.mergeScanned(res.records);
  const cancelled = store.applyCancellations(res.cancellations);
  store.updateSettings({ lastAutoScanAt: new Date().toISOString() });

  if (win && !win.isDestroyed()) {
    win.webContents.send('autoscan:done', {
      at: new Date().toISOString(),
      reason,
      added: merge.added,
      updated: merge.updated,
      cancelled: cancelled.length,
      accounts: accounts.length
    });
  }
  return { ok: true, added: merge.added, updated: merge.updated, cancelled };
}

function startAutoScan() {
  if (autoScanTimer) clearInterval(autoScanTimer);
  const check = async () => {
    const st = store.get().settings;
    if (!st.autoScan) return;
    const hours = Number(st.autoScanEveryHours) || 24;
    const last = st.lastAutoScanAt ? new Date(st.lastAutoScanAt).getTime() : 0;
    if (Date.now() - last < hours * 3600 * 1000) return;
    try { await runAutoScan('zamanlanmis'); } catch (err) { console.error('otomatik tarama', err.message); }
  };
  // Acilisin hemen ardindan degil, arayuz yerlesince bir kez bakilir.
  setTimeout(check, 45 * 1000);
  autoScanTimer = setInterval(check, 30 * 60 * 1000);
}

/** Verilen hesaplari sirayla tarar ve sonuclari birlestirir. */
async function scanAccounts(users, opts = {}) {
  const mail = require('./services/mail');
  const lookbackDays = opts.lookbackDays || store.get().settings.lookbackDays;
  const all = [];
  const cancellations = [];
  const perAccount = [];
  const errors = [];

  for (const user of users) {
    const account = store.getMailAccount(user) || { user };
    const pass = readPassword(user);
    if (!pass) { errors.push(`${user}: şifre kayıtlı değil`); continue; }
    try {
      const report = await mail.scan({
        ...account,
        password: pass,
        lookbackDays,
        onProgress: (p) => {
          if (win && !win.isDestroyed()) win.webContents.send('scan:progress', { ...p, user });
        }
      });
      all.push(...report.records);
      cancellations.push(...(report.cancellations || []));
      perAccount.push({ user, scanned: report.scanned, matched: report.matched, cancellations: (report.cancellations || []).length });
    } catch (err) {
      errors.push(`${user}: ${friendlyMailError(err, account)}`);
    }
  }

  if (!perAccount.length) return { ok: false, error: errors.join(' · ') || 'Taranacak hesap yok.' };

  const parser = require('./core/parser');
  return {
    ok: true,
    records: parser.consolidate(all),
    cancellations,
    perAccount,
    errors
  };
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
  store.load();
  migrateLegacySecret();
  createWindow();
  startAutoScan();

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
  // Sifreler kasada duruyor, veri dosyasinda degil; arayuzun "sifre kayitli mi"
  // bilgisine ihtiyaci oldugu icin burada isaretleniyor.
  const mailAccounts = (data.settings.mailAccounts || []).map((a) => ({
    ...a,
    hasPassword: Boolean(readPassword(a.user))
  }));
  return {
    settings: { ...data.settings, mailAccounts },
    subscriptions: data.subscriptions,
    scans: data.scans,
    categories: CATEGORIES,
    computed: {
      summary: insights.summary(data.subscriptions, opts),
      upcoming: insights.upcoming(data.subscriptions, 45, opts),
      trials: insights.trialsEnding(data.subscriptions, 14, opts),
      overlaps: insights.overlaps(data.subscriptions, opts),
      dormant: insights.dormant(data.subscriptions, data.settings.dormantDays, opts),
      alerts: insights.alerts(data.subscriptions, opts),
      calendar: insights.calendar(data.subscriptions, 12, opts)
    }
  };
}

ipcMain.handle('state:get', () => buildState());

ipcMain.handle('settings:save', (_e, patch) => {
  store.updateSettings(patch || {});
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

/* ---------- Posta hesaplari ---------- */

ipcMain.handle('subs:reset', () => {
  const d = store.get();
  d.subscriptions = [];
  d.scans = [];
  store.save();
  return { ok: true, state: buildState() };
});

ipcMain.handle('mail:providers', () => require('./core/providers').list());

ipcMain.handle('mail:accounts', () => {
  const st = store.get().settings;
  return (st.mailAccounts || []).map((a) => ({ ...a, hasPassword: Boolean(readPassword(a.user)) }));
});

ipcMain.handle('mail:addAccount', async (_e, creds) => {
  const mail = require('./services/mail');
  const user = String((creds && creds.user) || '').trim().toLowerCase();
  const pass = (creds && (creds.password || creds.appPassword)) || readPassword(user);
  if (!user || !pass) return { ok: false, error: 'E-posta adresi ve şifre gerekli.' };
  try {
    // Sunucu adresi tahmin edilmis olabilir; baglanti kurulan adres kaydediliyor
    // ki sonraki taramalarda adaylar bastan denenmesin.
    const res = await mail.testConnection({
      user,
      password: pass,
      provider: creds.provider,
      host: creds.host,
      port: creds.port,
      secure: creds.secure
    });
    if (creds.password || creds.appPassword) savePassword(user, creds.password || creds.appPassword);
    store.addMailAccount({ user, provider: res.provider, host: res.host, port: res.port, secure: res.secure });
    return { ok: true, ...res, state: buildState() };
  } catch (err) {
    return { ok: false, error: friendlyMailError(err, creds) };
  }
});

ipcMain.handle('mail:removeAccount', (_e, user) => {
  forgetPassword(user);
  store.removeMailAccount(user);
  return { ok: true, state: buildState() };
});

ipcMain.handle('mail:scan', async (_e, opts) => {
  const st = store.get().settings;
  const users = (opts && opts.users && opts.users.length)
    ? opts.users
    : (st.mailAccounts || []).map((a) => a.user);
  if (!users.length) return { ok: false, error: 'Önce en az bir posta hesabı eklenmeli.' };

  const res = await scanAccounts(users, opts || {});
  if (!res.ok) return res;
  return {
    ok: true,
    records: res.records,
    cancellations: res.cancellations,
    perAccount: res.perAccount,
    errors: res.errors,
    scanned: res.perAccount.reduce((a, b) => a + b.scanned, 0),
    matched: res.perAccount.reduce((a, b) => a + b.matched, 0)
  };
});

ipcMain.handle('mail:apply', (_e, payload) => {
  const records = Array.isArray(payload) ? payload : (payload && payload.records) || [];
  const cancellations = (payload && payload.cancellations) || [];
  const result = store.mergeScanned(records);
  const cancelled = store.applyCancellations(cancellations);
  return { ok: true, result, cancelled, state: buildState() };
});

ipcMain.handle('autoscan:run', async () => {
  const r = await runAutoScan('elle');
  return { ...r, state: buildState() };
});

/**
 * Ham IMAP hatasini kullanicinin anlayacagi bir cumleye cevirir.
 * Mesaj saglayiciya gore degisiyor: Gmail'de sorun neredeyse her zaman
 * uygulama sifresi, kendi sunucusunda ise sunucu adi ya da port.
 */
function friendlyMailError(err, account) {
  const msg = String((err && err.message) || err);
  const providers = require('./core/providers');
  const cfg = providers.resolve(account || {});
  const gmail = cfg.provider === 'gmail';
  const appSifre = cfg.passwordKind === 'app';

  if (/AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|AUTHENTICATE failed|Authentication failed/i.test(msg)) {
    if (gmail) return 'Gmail girişi reddedildi. Hesap parolası değil, Google "uygulama şifresi" gerekiyor (myaccount.google.com/apppasswords).';
    if (appSifre) return `${cfg.label} girişi reddedildi. Hesap parolası değil, uygulamaya özel şifre gerekiyor.`;
    return 'Giriş reddedildi. Kullanıcı adı genelde tam e-posta adresidir; şifre posta kutusunun kendi şifresidir.';
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) {
    return cfg.guessed
      ? `Sunucu bulunamadı. Denenen adresler: ${cfg.hosts.join(', ')}. Doğru adresi hosting panelinizdeki posta ayarlarından alıp Sunucu alanına yazın.`
      : `${cfg.host} adresi bulunamadı. Sunucu adresini kontrol edin.`;
  }
  if (/ETIMEDOUT|ECONNREFUSED|ECONNRESET|Connection timeout|closed unexpectedly/i.test(msg)) {
    return `${cfg.host || 'Sunucu'} bağlantısı kurulamadı. Port ${cfg.port} ve SSL ayarını kontrol edin; çoğu sunucuda 993 SSL, bazılarında 143 kullanılır.`;
  }
  if (/self.signed|certificate|CERT_/i.test(msg)) {
    return `${cfg.host} sertifikası doğrulanamadı. Hosting panelinde yazan sunucu adını birebir kullanın; alan adı yerine sunucunun kendi adı (örnek: srv12.hosting.com) gerekebilir.`;
  }
  if (/IMAP.*disabled|\[ALERT\]/i.test(msg)) {
    return gmail
      ? 'Gmail hesabında IMAP kapalı olabilir. Gmail ayarlarından IMAP erişimini açın.'
      : 'Sunucu IMAP erişimini reddetti. Posta kutusunda IMAP açık mı, panelden kontrol edin.';
  }
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
  'billingEmail', 'loginMethod', 'loginEmail', 'category',
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
