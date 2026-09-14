'use strict';

/**
 * SubKill landing sunucusu.
 * Bagimlilik yok: statik dosya servisi + tek POST ucu (node:http + global fetch).
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.MAIL_FROM || 'SubKill <merhaba@getsubkill.com>';
const NOTIFY_TO = process.env.NOTIFY_TO || '';
const DOWNLOAD_MAC = process.env.DOWNLOAD_MAC || '';
const DOWNLOAD_WIN = process.env.DOWNLOAD_WIN || '';

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

async function sendMail({ to, subject, html }) {
  if (!RESEND_API_KEY) return { skipped: true };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: FROM, to: [to], subject, html })
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return res.json();
}

function downloadEmailHtml() {
  const mac = DOWNLOAD_MAC
    ? `<a href="${DOWNLOAD_MAC}" style="display:inline-block;background:#5b8cff;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600;margin:0 8px 8px 0">macOS icin indir</a>`
    : '';
  const win = DOWNLOAD_WIN
    ? `<a href="${DOWNLOAD_WIN}" style="display:inline-block;background:#232d3f;color:#e7edf8;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600;margin:0 8px 8px 0">Windows icin indir</a>`
    : '';

  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;color:#1a1f2b;line-height:1.6">
    <h2 style="margin:0 0 6px">SubKill hazir.</h2>
    <p style="margin:0 0 18px;color:#5a6478">Kurulum dosyasi asagida. Uygulama tamamen bilgisayarinda calisir, hicbir veri bize gelmez.</p>
    <p style="margin:0 0 20px">${mac}${win}</p>
    <p style="margin:0 0 10px"><strong>Ilk 3 adim</strong></p>
    <ol style="margin:0 0 20px;padding-left:18px;color:#3a4356">
      <li>Gmail sekmesinden uygulama sifreni gir ve makbuzlari tara.</li>
      <li>Kartlarini ve aylik limitlerini tanimla.</li>
      <li>Kullanimi tara - aylardir girmedigin abonelikler isaretlensin.</li>
    </ol>
    <p style="margin:0;color:#8892a6;font-size:13px">Bu postayi SubKill'i indirmek icin adresini biraktigin icin aldin.</p>
  </div>`;
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

  try {
    await sendMail({ to: email, subject: 'SubKill indirme baglantin', html: downloadEmailHtml() });
    if (NOTIFY_TO && isNew) {
      await sendMail({
        to: NOTIFY_TO,
        subject: `SubKill: yeni kayit (${email})`,
        html: `<p>${email}</p><p>platform: ${entry.platform || '-'}</p><p>${entry.at}</p>`
      });
    }
  } catch (err) {
    console.error('posta gonderilemedi', err.message);
    return json(res, 200, { ok: true, mailed: false, message: 'Kaydedildi, indirme baglantisi kisa sure icinde gelecek.' });
  }

  return json(res, 200, { ok: true, mailed: true });
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
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  return serveStatic(req, res);
});

server.listen(PORT, () => console.log(`SubKill landing ${PORT} portunda`));
