'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/** Chrome/Edge/Brave profillerindeki History dosyalarinin yerleri. */
function historyPaths() {
  const home = os.homedir();
  const roots = [];
  if (process.platform === 'darwin') {
    roots.push(
      path.join(home, 'Library/Application Support/Google/Chrome'),
      path.join(home, 'Library/Application Support/BraveSoftware/Brave-Browser'),
      path.join(home, 'Library/Application Support/Microsoft Edge'),
      path.join(home, 'Library/Application Support/Arc/User Data')
    );
  } else if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData/Local');
    roots.push(
      path.join(local, 'Google/Chrome/User Data'),
      path.join(local, 'BraveSoftware/Brave-Browser/User Data'),
      path.join(local, 'Microsoft/Edge/User Data')
    );
  } else {
    roots.push(path.join(home, '.config/google-chrome'), path.join(home, '.config/chromium'));
  }

  const found = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let entries = [];
    try { entries = fs.readdirSync(root); } catch (_) { continue; }
    for (const e of entries) {
      if (e !== 'Default' && !/^Profile \d+$/.test(e)) continue;
      const p = path.join(root, e, 'History');
      if (fs.existsSync(p)) found.push(p);
    }
  }
  return found;
}

/** Chrome zamani: 1601-01-01'den bu yana mikrosaniye. */
function chromeTimeToISO(value) {
  const n = Number(value);
  if (!n) return null;
  const ms = n / 1000 - 11644473600000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

const QUERY = `SELECT url, last_visit_time, visit_count FROM urls WHERE last_visit_time > 0`;

/** node:sqlite varsa onu kullanir (hizli), yoksa sqlite3 CLI'ya, o da yoksa saf JS'e duser. */
async function readRows(dbPath) {
  try {
    // eslint-disable-next-line global-require
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return db.prepare(QUERY).all();
    } finally {
      db.close();
    }
  } catch (_) {
    // node:sqlite yok ya da acilamadi
  }

  try {
    const out = execFileSync('sqlite3', ['-separator', '', dbPath, QUERY], {
      encoding: 'utf8', maxBuffer: 256 * 1024 * 1024
    });
    return out.split('\n').filter(Boolean).map((line) => {
      const [url, last_visit_time, visit_count] = line.split('');
      return { url, last_visit_time, visit_count };
    });
  } catch (_) {
    // sqlite3 CLI yok (Windows'ta genelde yok)
  }

  // Son care: saf JS SQLite. Yavas ama her yerde, Windows dahil calisir.
  try {
    // eslint-disable-next-line global-require
    const initSqlJs = require('sql.js/dist/sql-asm.js');
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));
    try {
      const res = db.exec(QUERY);
      if (!res.length) return [];
      const cols = res[0].columns;
      return res[0].values.map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
    } finally {
      db.close();
    }
  } catch (err) {
    throw new Error('Tarayıcı geçmişi okunamadı. Chrome açıkken dosya kilitli olabilir; tarayıcıyı kapatıp tekrar deneyin.');
  }
}

function domainOfUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch (_) {
    return null;
  }
}

/**
 * Tum profillerdeki gecmisi okur, alan adi basina en son ziyaret tarihini dondurur.
 * @returns {{usage: Record<string,string>, profiles: number, rows: number}}
 */
async function collectUsage() {
  const paths = historyPaths();
  if (!paths.length) {
    return { usage: {}, profiles: 0, rows: 0, note: 'Tarayıcı profili bulunamadı.' };
  }

  const usage = {};
  const visits = {};
  let rows = 0;
  let ok = 0;
  const errors = [];

  for (const p of paths) {
    // Chrome dosyayi kilitler; kopya uzerinde calisilir.
    const tmp = path.join(os.tmpdir(), `subkill-history-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      fs.copyFileSync(p, tmp);
      for (const r of await readRows(tmp)) {
        rows++;
        const d = domainOfUrl(r.url);
        if (!d) continue;
        const iso = chromeTimeToISO(r.last_visit_time);
        if (!iso) continue;
        if (!usage[d] || iso > usage[d]) usage[d] = iso;
        visits[d] = (visits[d] || 0) + (Number(r.visit_count) || 1);
      }
      ok++;
    } catch (err) {
      errors.push(`${path.basename(path.dirname(p))}: ${err.message}`);
    } finally {
      try { fs.unlinkSync(tmp); } catch (_) { /* yoksay */ }
    }
  }

  return { usage, visits, profiles: ok, rows, errors };
}

module.exports = { historyPaths, chromeTimeToISO, domainOfUrl, collectUsage };
