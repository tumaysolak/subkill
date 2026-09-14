'use strict';

/**
 * SubKill landing sunucusu.
 * Bagimlilik yok: statik dosya servisi + tek POST ucu (node:http + global fetch).
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.MAIL_FROM || 'SubKill <merhaba@getsubkill.com>';
const NOTIFY_TO = process.env.NOTIFY_TO || '';
const DOWNLOAD_MAC = process.env.DOWNLOAD_MAC || '';
const DOWNLOAD_MAC_INTEL = process.env.DOWNLOAD_MAC_INTEL || '';
const DOWNLOAD_WIN = process.env.DOWNLOAD_WIN || '';
const DOWNLOAD_WIN_ARM = process.env.DOWNLOAD_WIN_ARM || '';
const AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID || '';
const SITE_URL = process.env.SITE_URL || 'https://getsubkill.com';
// Cikis baglantisini imzalamak icin. Ayri bir sir tanimlanmazsa API anahtarindan turetilir.
const UNSUB_SECRET = process.env.UNSUB_SECRET || RESEND_API_KEY || 'subkill-local';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

// Tarayicinin kismi istekle (Range) cekebilecegi turler. Safari, Range
// yanitlamayan bir sunucudan videoyu hic oynatmiyor; Chrome oynatiyor ama
// ileri sarma calismiyor.
const RANGEABLE = new Set(['.mp4', '.webm']);

/* ---------- lead deposu ---------- */

function readLeads() {
  try {
    return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
  } catch (_) {
    return [];
  }
}

function saveLead(entry) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const leads = readLeads();
  if (leads.some((l) => l.email.toLowerCase() === entry.email.toLowerCase())) return false;
  leads.push(entry);
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2), 'utf8');
  return true;
}

/* ---------- posta ---------- */

async function sendMail({ to, subject, html, text, headers, replyTo }) {
  if (!RESEND_API_KEY) return { skipped: true };
  const payload = { from: FROM, to: [to], subject, html };
  // Duz metin alternatifi olmayan postalar spam filtrelerinde ceza aliyor.
  if (text) payload.text = text;
  if (replyTo) payload.reply_to = replyTo;
  if (headers) payload.headers = headers;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * Adresi Resend audience'ina yazar. Konteyner diski kalici olmadigi icin
 * asil lead listesi burasidir; yerel dosya yalnizca yedektir.
 */
async function addToAudience(email) {
  if (!RESEND_API_KEY || !AUDIENCE_ID) return { skipped: true };
  const res = await fetch(`https://api.resend.com/audiences/${AUDIENCE_ID}/contacts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, unsubscribed: false })
  });
  if (!res.ok && res.status !== 409) throw new Error(`Audience ${res.status}: ${await res.text()}`);
  return res.json().catch(() => ({}));
}

/* ---------- listeden cikis ---------- */

/** Adresi imzalar; boylece cikis baglantisi baskasinin adresi icin kullanilamaz. */
function unsubToken(email) {
  return crypto.createHmac('sha256', UNSUB_SECRET).update(email.toLowerCase()).digest('hex').slice(0, 24);
}

function unsubUrl(email) {
  return `${SITE_URL}/cikis?e=${encodeURIComponent(email)}&t=${unsubToken(email)}`;
}

/** Resend audience kaydini "unsubscribed" yapar. Kayit yoksa sessizce gecer. */
async function unsubscribeFromAudience(email) {
  if (!RESEND_API_KEY || !AUDIENCE_ID) return { skipped: true };
  const res = await fetch(`https://api.resend.com/audiences/${AUDIENCE_ID}/contacts/${encodeURIComponent(email)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ unsubscribed: true })
  });
  if (!res.ok && res.status !== 404) throw new Error(`Unsub ${res.status}: ${await res.text()}`);
  return res.json().catch(() => ({}));
}

function downloadEmailHtml(email) {
  const btn = (href, label, bg, fg) =>
    href ? `<a href="${href}" style="display:inline-block;background:${bg};color:${fg};padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600;margin:0 8px 8px 0">${label}</a>` : '';
  const mac = btn(`${SITE_URL}/indir/mac`, 'macOS (Apple Silicon)', '#ff3d57', '#fff')
    + btn(`${SITE_URL}/indir/mac-intel`, 'macOS (Intel)', '#1b2130', '#e7edf8');
  const win = btn(`${SITE_URL}/indir/windows`, 'Windows (x64)', '#1b2130', '#e7edf8');

  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;color:#1a1f2b;line-height:1.6">
    <h2 style="margin:0 0 6px">SubKill hazır.</h2>
    <p style="margin:0 0 18px;color:#5a6478">Kurulum dosyası aşağıda. Uygulama tamamen bilgisayarında çalışır, hiçbir veri bize gelmez.</p>
    <p style="margin:0 0 20px">${mac}${win}</p>
    <p style="margin:0 0 6px"><strong>İlk açılış</strong></p>
    <p style="margin:0 0 18px;color:#5a6478;font-size:14.5px">
      SubKill imzasız olduğu için işletim sistemi bir kez uyarı gösterir.
      <strong>macOS:</strong> simgeye sağ tıkla ve "Aç" de, çıkan pencerede yine "Aç"ı seç.
      <strong>Windows:</strong> SmartScreen uyarısında "Ek bilgi" &rarr; "Yine de çalıştır".
    </p>
    <p style="margin:0 0 10px"><strong>İlk üç adım</strong></p>
    <ol style="margin:0 0 20px;padding-left:18px;color:#3a4356">
      <li>Gmail sekmesinden uygulama şifreni gir ve makbuzları tara.</li>
      <li>Kartlarını ve aylık limitlerini tanımla.</li>
      <li>Kullanımı tara; aylardır girmediğin abonelikler işaretlensin.</li>
    </ol>
    <p style="margin:0 0 6px;color:#8892a6;font-size:13px">Bu postayı SubKill'i indirmek için adresini bıraktığın için aldın.</p>
    <p style="margin:0;color:#8892a6;font-size:13px">
      Yeni sürüm duyurularını istemiyorsan <a href="${unsubUrl(email)}" style="color:#8892a6">listeden çık</a>.
      SubKill &middot; <a href="${SITE_URL}" style="color:#8892a6">getsubkill.com</a>
    </p>
  </div>`;
}

/** HTML'siz istemciler ve spam filtreleri icin duz metin karsiligi. */
function downloadEmailText(email) {
  const lines = ['SubKill hazır.', '',
    'Kurulum dosyası aşağıda. Uygulama tamamen bilgisayarında çalışır, hiçbir veri bize gelmez.', ''];
  lines.push(`macOS (Apple Silicon): ${SITE_URL}/indir/mac`);
  lines.push(`macOS (Intel): ${SITE_URL}/indir/mac-intel`);
  lines.push(`Windows (x64): ${SITE_URL}/indir/windows`);
  lines.push('', 'İlk açılış',
    'SubKill imzasız olduğu için işletim sistemi bir kez uyarı gösterir.',
    'macOS: simgeye sağ tıkla ve "Aç" de, çıkan pencerede yine "Aç"ı seç.',
    'Windows: SmartScreen uyarısında "Ek bilgi" -> "Yine de çalıştır".',
    '', 'İlk üç adım',
    '1. Gmail sekmesinden uygulama şifreni gir ve makbuzları tara.',
    '2. Kartlarını ve aylık limitlerini tanımla.',
    '3. Kullanımı tara; aylardır girmediğin abonelikler işaretlensin.',
    '', "Bu postayı SubKill'i indirmek için adresini bıraktığın için aldın.",
    `Listeden çıkmak için: ${unsubUrl(email)}`,
    `SubKill - ${SITE_URL}`);
  return lines.join('\n');
}

function unsubPage(title, body) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${title} &mdash; SubKill</title><link rel="stylesheet" href="/style.css" /></head>
<body><main class="doc"><h1>${title}</h1><p>${body}</p>
<p style="margin-top:24px"><a href="/">Ana sayfaya dön</a></p></main></body></html>`;
}

/* ---------- istek isleme ---------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function json(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) { reject(new Error('Govde cok buyuk')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Kaba oran sinirlama: ayni IP'den dakikada 5 istek.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { count: 0, since: now };
  if (now - rec.since > 60000) { rec.count = 0; rec.since = now; }
  rec.count++;
  hits.set(ip, rec);
  if (hits.size > 5000) hits.clear();
  return rec.count > 5;
}

async function handleLead(req, res) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
  if (rateLimited(ip)) return json(res, 429, { ok: false, error: 'Cok fazla deneme. Birazdan tekrar deneyin.' });

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (_) {
    return json(res, 400, { ok: false, error: 'Gecersiz istek.' });
  }

  const email = String(payload.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json(res, 400, { ok: false, error: 'Gecerli bir e-posta adresi girin.' });
  if (payload.website) return json(res, 200, { ok: true }); // bal kupu: bot doldurur

  const entry = {
    email,
    platform: String(payload.platform || '').slice(0, 20),
    at: new Date().toISOString(),
    ref: String(payload.ref || '').slice(0, 120)
  };

  let isNew = true;
  try { isNew = saveLead(entry); } catch (err) { console.error('lead yazilamadi', err); }

  try { await addToAudience(email); } catch (err) { console.error('audience yazilamadi', err.message); }

  try {
    await sendMail({
      to: email,
      subject: 'SubKill indirme bağlantın',
      html: downloadEmailHtml(email),
      text: downloadEmailText(email),
      replyTo: 'merhaba@getsubkill.com',
      // Gmail ve Outlook toplu gonderende tek tikla cikis basligi bekliyor;
      // olmadiginda posta dogrudan spam klasorune dusuyor.
      headers: {
        'List-Unsubscribe': `<${unsubUrl(email)}>, <mailto:merhaba@getsubkill.com?subject=cikis>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
      }
    });
    if (NOTIFY_TO && isNew) {
      await sendMail({
        to: NOTIFY_TO,
        subject: `SubKill: yeni kayıt (${email})`,
        html: `<p>${email}</p><p>platform: ${entry.platform || '-'}</p><p>${entry.at}</p>`,
        text: `${email}\nplatform: ${entry.platform || '-'}\n${entry.at}`
      });
    }
  } catch (err) {
    console.error('posta gonderilemedi', err.message);
    return json(res, 200, { ok: true, mailed: false, message: 'Kaydedildi, indirme baglantisi kisa sure icinde gelecek.' });
  }

  return json(res, 200, { ok: true, mailed: true });
}

/** Tek tikla listeden cikis. GET insan icin sayfa doner, POST posta istemcisi icindir. */
async function handleUnsub(req, res) {
  const q = new URL(req.url, SITE_URL).searchParams;
  const email = String(q.get('e') || '').trim().toLowerCase();
  const token = String(q.get('t') || '');
  const valid = EMAIL_RE.test(email) && token && token === unsubToken(email);

  if (req.method === 'POST') {
    if (valid) { try { await unsubscribeFromAudience(email); } catch (err) { console.error('cikis', err.message); } }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }

  let title = 'Çıkış yapıldı';
  let body = `<strong>${email}</strong> adresi duyuru listesinden çıkarıldı. Bundan sonra SubKill duyurusu gönderilmeyecek.`;
  if (!valid) {
    title = 'Bağlantı geçersiz';
    body = 'Çıkış bağlantısı okunamadı. <a href="mailto:merhaba@getsubkill.com?subject=cikis">merhaba@getsubkill.com</a> adresine yazarsan listeden çıkarırız.';
  } else {
    try { await unsubscribeFromAudience(email); }
    catch (err) {
      console.error('cikis', err.message);
      title = 'Şimdi olmadı';
      body = 'Kayıt güncellenemedi. <a href="mailto:merhaba@getsubkill.com?subject=cikis">merhaba@getsubkill.com</a> adresine yazarsan elle çıkarırız.';
    }
  }
  res.writeHead(200, { 'Content-Type': MIME['.html'] });
  res.end(unsubPage(title, body));
}

/**
 * Indirme yonlendirmeleri.
 *
 * Neden: baglantilar dogrudan GitHub surum adresini gosterdiginde, surum
 * tarafinda bir sorun ciktigi anda hem sitedeki hem daha once gonderilmis
 * postalardaki baglantilar kiriliyor. Kendi alan adimizdan yonlendirince
 * hedef tek yerden degistirilebiliyor; ayrica posta tarayicilar baglantiyi
 * kendi alan adimizda gorunce daha az supheleniyor.
 */
const DOWNLOADS = {
  '/indir/mac': () => DOWNLOAD_MAC,
  '/indir/mac-intel': () => DOWNLOAD_MAC_INTEL,
  '/indir/windows': () => DOWNLOAD_WIN,
  '/indir/windows-arm': () => DOWNLOAD_WIN_ARM
};
const RELEASES_URL = 'https://github.com/tumaysolak/subkill/releases/latest';

function handleDownload(req, res, key) {
  const target = DOWNLOADS[key]() || RELEASES_URL;
  res.writeHead(302, { Location: target, 'Cache-Control': 'no-cache' });
  res.end();
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Yasak'); return; }

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, fallback) => {
        if (e2) { res.writeHead(404); res.end('Bulunamadi'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache, must-revalidate' });
        res.end(fallback);
      });
      return;
    }

    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    // HTML onbellege alinmamali: sayfa yeni bir medya dosyasina gectiginde
    // ziyaretci hala eski surumu gosteren HTML'i tutuyordu.
    const cache = ext === '.html' ? 'no-cache, must-revalidate' : 'public, max-age=86400';
    const headers = { 'Content-Type': type, 'Cache-Control': cache };

    if (RANGEABLE.has(ext)) headers['Accept-Ranges'] = 'bytes';

    const range = RANGEABLE.has(ext) ? String(req.headers.range || '') : '';
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      let start = m[1] === '' ? null : Number(m[1]);
      let end = m[2] === '' ? null : Number(m[2]);
      if (start === null) {
        // "son N bayt" biciminde istek
        const n = end === null ? 0 : end;
        start = Math.max(0, stat.size - n);
        end = stat.size - 1;
      } else if (end === null || end >= stat.size) {
        end = stat.size - 1;
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }
      headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      headers['Content-Length'] = end - start + 1;
      res.writeHead(206, headers);
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }

    headers['Content-Length'] = stat.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/lead') return handleLead(req, res);
  if (req.url === '/healthz') return json(res, 200, { ok: true });
  if ((req.url || '').startsWith('/cikis')) return handleUnsub(req, res);
  const dlKey = (req.url || '').split('?')[0];
  if (Object.prototype.hasOwnProperty.call(DOWNLOADS, dlKey)) return handleDownload(req, res, dlKey);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  return serveStatic(req, res);
});

server.listen(PORT, () => console.log(`SubKill landing ${PORT} portunda`));
