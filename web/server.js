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
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

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
  const mac = btn(DOWNLOAD_MAC, 'macOS (Apple Silicon)', '#ff3d57', '#fff')
    + btn(DOWNLOAD_MAC_INTEL, 'macOS (Intel)', '#1b2130', '#e7edf8');
  const win = btn(DOWNLOAD_WIN, 'Windows (x64)', '#1b2130', '#e7edf8');

  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;color:#1a1f2b;line-height:1.6">
    <h2 style="margin:0 0 6px">SubKill hazır.</h2>
    <p style="margin:0 0 18px;color:#5a6478">Kurulum dosyası aşağıda. Uygulama tamamen bilgisayarında çalışır, hiçbir veri bize gelmez.</p>
    <p style="margin:0 0 20px">${mac}${win}</p>
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
  if (DOWNLOAD_MAC) lines.push(`macOS (Apple Silicon): ${DOWNLOAD_MAC}`);
  if (DOWNLOAD_MAC_INTEL) lines.push(`macOS (Intel): ${DOWNLOAD_MAC_INTEL}`);
  if (DOWNLOAD_WIN) lines.push(`Windows (x64): ${DOWNLOAD_WIN}`);
  lines.push('', 'İlk üç adım',
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

function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Yasak'); return; }

  fs.readFile(file, (err, buf) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, fallback) => {
        if (e2) { res.writeHead(404); res.end('Bulunamadi'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(fallback);
      });
      return;
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/lead') return handleLead(req, res);
  if (req.url === '/healthz') return json(res, 200, { ok: true });
  if ((req.url || '').startsWith('/cikis')) return handleUnsub(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  return serveStatic(req, res);
});

server.listen(PORT, () => console.log(`SubKill landing ${PORT} portunda`));
