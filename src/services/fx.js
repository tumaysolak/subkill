'use strict';

const https = require('node:https');

const TCMB_URL = 'https://www.tcmb.gov.tr/kurlar/today.xml';

function fetchText(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'SubKill/1.0' } }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('Zaman aşımı')); });
    req.on('error', reject);
  });
}

/** TCMB XML'inden doviz satis kurlarini cikarir. */
function parseTcmb(xml) {
  const rates = { TRY: 1 };
  const blocks = String(xml).split('<Currency ');
  for (const b of blocks) {
    const codeMatch = b.match(/CurrencyCode="([A-Z]{3})"/);
    if (!codeMatch) continue;
    const code = codeMatch[1];
    if (!['USD', 'EUR', 'GBP'].includes(code)) continue;
    const sell = b.match(/<ForexSelling>([\d.]+)<\/ForexSelling>/);
    const unitMatch = b.match(/<Unit>(\d+)<\/Unit>/);
    if (!sell) continue;
    const unit = unitMatch ? Number(unitMatch[1]) || 1 : 1;
    const value = Number(sell[1]) / unit;
    if (Number.isFinite(value) && value > 0) rates[code] = value;
  }
  return rates;
}

/**
 * Guncel kurlari ceker. Internet yoksa hata firlatir; uygulama son bilinen
 * kurlarla calismaya devam eder.
 */
async function fetchRates() {
  const xml = await fetchText(TCMB_URL);
  const rates = parseTcmb(xml);
  if (!rates.USD) throw new Error('Kur verisi okunamadı.');
  return { rates, updatedAt: new Date().toISOString(), source: 'TCMB' };
}

module.exports = { fetchRates, parseTcmb };
