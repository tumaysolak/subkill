'use strict';

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const parser = require('../core/parser');

const GMAIL_QUERY_TERMS = [
  'receipt', 'invoice', 'subscription', 'renewal', 'payment received',
  'your plan', 'fatura', 'makbuz', 'abonelik', 'yenileme'
];

/**
 * Gmail'e IMAP ile baglanir. Sifre olarak Google "uygulama sifresi" beklenir;
 * hesap parolasi calismaz ve istenmez.
 */
async function connect({ user, appPassword }) {
  if (!user || !appPassword) throw new Error('Gmail adresi ve uygulama şifresi gerekli.');
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user, pass: String(appPassword).replace(/\s/g, '') },
    logger: false
  });
  await client.connect();
  return client;
}

async function testConnection(creds) {
  const client = await connect(creds);
  try {
    const lock = await client.getMailboxLock('INBOX');
    lock.release();
    return { ok: true, user: creds.user };
  } finally {
    await client.logout().catch(() => {});
  }
}

function sinceDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - (days || 400));
  return d;
}

/**
 * Makbuz adayi mailleri tarar ve abonelik kayitlarina cevirir.
 * @param {{user:string, appPassword:string, lookbackDays?:number, onProgress?:Function}} opts
 */
async function scan(opts) {
  const { user, appPassword, lookbackDays = 400, onProgress, maxMessages = 1200 } = opts;
  const client = await connect({ user, appPassword });
  const report = { scanned: 0, matched: 0, records: [], errors: [] };

  try {
    const lock = await client.getMailboxLock('[Gmail]/All Mail').catch(() => client.getMailboxLock('INBOX'));
    try {
      let uids = [];
      // Gmail'in kendi arama dili cok daha verimli; desteklenmezse standart IMAP'e duser.
      const gmailQuery = `newer_than:${lookbackDays}d (${GMAIL_QUERY_TERMS.map((t) => `"${t}"`).join(' OR ')})`;
      try {
        uids = await client.search({ gmraw: gmailQuery }, { uid: true });
      } catch (_) {
        uids = await client.search({ since: sinceDate(lookbackDays) }, { uid: true });
      }
      if (!uids || !uids.length) {
        uids = await client.search({ since: sinceDate(lookbackDays) }, { uid: true });
      }

      uids = uids.slice(-maxMessages);
      const total = uids.length;
      let i = 0;

      for await (const msg of client.fetch(uids, { uid: true, source: true }, { uid: true })) {
        i++;
        report.scanned++;
        if (onProgress && i % 25 === 0) onProgress({ done: i, total });
        try {
          const mail = await simpleParser(msg.source);
          const record = parser.parseReceipt({
            from: (mail.from && mail.from.text) || '',
            to: (mail.to && mail.to.text) || user,
            subject: mail.subject || '',
            date: mail.date || null,
            text: mail.text || stripHtml(mail.html || '')
          });
          if (record) { report.matched++; report.records.push(record); }
        } catch (err) {
          report.errors.push(String(err.message || err));
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

module.exports = { connect, testConnection, scan, stripHtml };
