'use strict';

const dns = require('node:dns').promises;
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const parser = require('../core/parser');
const providers = require('../core/providers');

// Gmail'in kendi arama dilinde kullanilan terimler.
const QUERY_TERMS = [
  'receipt', 'invoice', 'subscription', 'renewal', 'payment received',
  'your plan', 'fatura', 'makbuz', 'abonelik', 'yenileme',
  // Iptal bildirimleri makbuz gibi gorunmedigi icin ayrica aranir.
  'cancelled', 'canceled', 'cancellation', 'sorry to see you go', 'iptal edildi'
];

// Standart IMAP sunucularinda govde aramasi (TEXT) indekssiz sunucularda cok
// yavas kaldigi icin yalnizca konu basligi taranir.
const SUBJECT_TERMS = [
  'receipt', 'invoice', 'subscription', 'renewal', 'payment', 'billing',
  'your plan', 'order confirmation', 'fatura', 'makbuz', 'abonelik',
  'yenileme', 'odeme', 'tahsilat', 'cancelled', 'canceled', 'cancellation',
  'iptal'
];

// Konusu makbuza benzemeyen mailler de makbuz olabilir (govdede tutar gecer).
// Bu yuzden son donem ayrica bastan sona taranir.
const RECENT_SWEEP_DAYS = 60;

function cleanPassword(value) {
  // Saglayicilar uygulama sifresini bosluklu gosteriyor; oldugu gibi
  // yapistirilabilsin diye bosluklar burada temizleniyor.
  return String(value || '').replace(/\s/g, '');
}

function isAuthError(err) {
  return /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|AUTHENTICATE failed|Authentication failed/i
    .test(String((err && err.message) || err));
}

/**
 * Posta kutusuna IMAP ile baglanir.
 *
 * Sunucu adresi belli degilse (kendi alan adi, cPanel gibi) adaylar sirayla
 * denenir. Sifre yanlissa denemeye devam etmenin anlami yok: o durumda
 * dogrudan hata firlatilir, yoksa ayni yanlis sifre ucuncu kez denenip
 * sunucuda gecici blok yiyebiliriz.
 *
 * @param {{user:string, password?:string, appPassword?:string, provider?:string,
 *          host?:string, port?:number, secure?:boolean}} account
 */
async function connect(account) {
  const cfg = providers.resolve(account);
  const pass = cleanPassword(account.password || account.appPassword);
  if (!cfg.user || !pass) throw new Error('E-posta adresi ve şifre gerekli.');
  if (!cfg.hosts.length) {
    throw new Error('IMAP sunucu adresi bulunamadı. Sunucu alanını elle doldurun (örnek: mail.alanadiniz.com).');
  }

  // Tahmin edilen adaylarin cogu hic var olmuyor. Once DNS'e sorulup olmayanlar
  // eleniyor; boylece yanlis tahmin saniyeler yerine aninda geciliyor.
  let hosts = cfg.hosts;
  if (hosts.length > 1) {
    const cozulen = [];
    for (const h of hosts) {
      try { await dns.lookup(h); cozulen.push(h); } catch (_) { /* bu aday yok */ }
    }
    if (!cozulen.length) {
      const err = new Error(`getaddrinfo ENOTFOUND ${hosts[0]}`);
      err.code = 'ENOTFOUND';
      throw err;
    }
    hosts = cozulen;
  }

  const single = hosts.length === 1;
  let lastErr = null;

  for (const host of hosts) {
    const client = new ImapFlow({
      host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass },
      logger: false,
      // Birden fazla aday denenirken kisa sure beklenir ki yanlis tahminler
      // kullaniciyi dakikalarca bekletmesin.
      connectionTimeout: single ? 30000 : 9000,
      greetingTimeout: single ? 16000 : 7000
    });
    try {
      await client.connect();
      return { client, cfg: { ...cfg, host } };
    } catch (err) {
      await client.logout().catch(() => {});
      lastErr = err;
      if (isAuthError(err)) throw err;
    }
  }
  throw lastErr || new Error('Posta sunucusuna bağlanılamadı.');
}

async function testConnection(account) {
  const { client, cfg } = await connect(account);
  try {
    const lock = await lockMailbox(client, cfg);
    lock.release();
    return { ok: true, user: cfg.user, provider: cfg.provider, host: cfg.host, port: cfg.port, secure: cfg.secure };
  } finally {
    await client.logout().catch(() => {});
  }
}

/** Onayarin sirasindaki ilk acilabilen kutuyu kilitler. */
async function lockMailbox(client, cfg) {
  let lastErr = null;
  for (const box of cfg.mailboxes) {
    try {
      return await client.getMailboxLock(box);
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  return client.getMailboxLock('INBOX');
}

function sinceDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - (days || 400));
  return d;
}

/**
 * Taranacak mailleri belirler.
 *
 * Gmail kendi arama dilini destekledigi icin tek sorguda hem konu hem govde
 * aranabiliyor. Diger sunucularda govde aramasi indeks olmadan cok yavas
 * calistigindan iki parcali gidiliyor: butun donem icin konu aramasi, artı
 * son donemin tamami. Boylece eski makbuzlar konudan, konusu makbuza
 * benzemeyen yeni makbuzlar da tarih araligindan yakalaniyor.
 */
async function findUids(client, cfg, lookbackDays) {
  const uniq = (list) => Array.from(new Set(list.filter((n) => Number.isFinite(n))));

  if (cfg.gmailSearch) {
    const gmailQuery = `newer_than:${lookbackDays}d (${QUERY_TERMS.map((t) => `"${t}"`).join(' OR ')})`;
    try {
      const uids = await client.search({ gmraw: gmailQuery }, { uid: true });
      if (uids && uids.length) return uniq(uids);
    } catch (_) { /* sunucu X-GM-RAW desteklemiyor, genel aramaya dusuluyor */ }
  }

  let found = [];
  try {
    const bySubject = await client.search(
      { since: sinceDate(lookbackDays), or: SUBJECT_TERMS.map((t) => ({ subject: t })) },
      { uid: true }
    );
    if (bySubject) found = found.concat(bySubject);
  } catch (_) { /* OR aramasini desteklemeyen sunucularda tarih aramasina dusuluyor */ }

  try {
    const recent = await client.search(
      { since: sinceDate(Math.min(lookbackDays, RECENT_SWEEP_DAYS)) },
      { uid: true }
    );
    if (recent) found = found.concat(recent);
  } catch (_) { /* yoksay */ }

  if (!found.length) {
    const all = await client.search({ since: sinceDate(lookbackDays) }, { uid: true });
    found = all || [];
  }

  return uniq(found).sort((a, b) => a - b);
}

/**
 * Makbuz adayi mailleri tarar ve abonelik kayitlarina cevirir.
 * @param {{user:string, password?:string, appPassword?:string, provider?:string,
 *          host?:string, port?:number, secure?:boolean, lookbackDays?:number,
 *          onProgress?:Function, maxMessages?:number}} opts
 */
async function scan(opts) {
  const { lookbackDays = 400, onProgress, maxMessages = 1200 } = opts;
  const { client, cfg } = await connect(opts);
  const report = {
    scanned: 0, matched: 0, records: [], cancellations: [], errors: [],
    user: cfg.user, host: cfg.host, provider: cfg.provider
  };

  try {
    const lock = await lockMailbox(client, cfg);
    try {
      let uids = await findUids(client, cfg, lookbackDays);
      uids = uids.slice(-maxMessages);
      const total = uids.length;
      let i = 0;

      if (total) {
        for await (const msg of client.fetch(uids, { uid: true, source: true }, { uid: true })) {
          i++;
          report.scanned++;
          if (onProgress && i % 25 === 0) onProgress({ done: i, total });
          try {
            const mail = await simpleParser(msg.source);
            const body = mail.text || stripHtml(mail.html || '');
            const record = parser.parseReceipt({
              from: (mail.from && mail.from.text) || '',
              to: (mail.to && mail.to.text) || cfg.user,
              subject: mail.subject || '',
              date: mail.date || null,
              text: body
            });
            if (record) {
              report.matched++;
              report.records.push(record);
            } else {
              // Makbuz degilse iptal bildirimi olabilir.
              const cancel = parser.parseCancellation({
                from: (mail.from && mail.from.text) || '',
                subject: mail.subject || '',
                date: mail.date || null,
                text: body
              });
              if (cancel) report.cancellations.push(cancel);
            }
          } catch (err) {
            report.errors.push(String(err.message || err));
          }
        }
      }
      if (onProgress) onProgress({ done: total, total });
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  report.consolidated = parser.consolidate(report.records);
  return report;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { connect, testConnection, scan, stripHtml, isAuthError, QUERY_TERMS, SUBJECT_TERMS };
