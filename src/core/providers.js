'use strict';

/**
 * Posta sunucusu onayarlari.
 *
 * SubKill ilk surumlerde yalnizca Gmail'e baglaniyordu; sunucu adresi koda
 * gomuluydu. Artik her hesap kendi baglanti bilgisini tasiyor. Boylece hosting
 * uzerindeki kutular (cPanel, Plesk), kurumsal sunucular ve diger saglayicilar
 * da eklenebiliyor.
 *
 * Her onayar sunucuyu ve o sunucunun ozelliklerini soyler:
 *  - passwordKind 'app'   : hesap parolasi calismaz, uygulamaya ozel sifre gerekir
 *  - passwordKind 'plain' : posta kutusunun kendi sifresi kullanilir
 *  - gmailSearch          : Gmail'in X-GM-RAW arama dili destekleniyor mu
 *  - mailboxes            : sirayla denenecek kutu adlari
 */

const PROVIDERS = [
  {
    id: 'gmail',
    label: 'Gmail / Google Workspace',
    domains: ['gmail.com', 'googlemail.com'],
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    passwordKind: 'app',
    appPasswordUrl: 'https://myaccount.google.com/apppasswords',
    gmailSearch: true,
    mailboxes: ['[Gmail]/All Mail', 'INBOX'],
    hint: 'Hesap parolasi degil, 16 haneli Google uygulama sifresi gerekir.'
  },
  {
    id: 'icloud',
    label: 'iCloud Mail',
    domains: ['icloud.com', 'me.com', 'mac.com'],
    host: 'imap.mail.me.com',
    port: 993,
    secure: true,
    passwordKind: 'app',
    appPasswordUrl: 'https://account.apple.com/account/manage',
    mailboxes: ['INBOX'],
    hint: 'Apple Kimliginizden uygulamaya ozel sifre uretmeniz gerekir.'
  },
  {
    id: 'outlook',
    label: 'Outlook / Hotmail / Microsoft 365',
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'],
    host: 'outlook.office365.com',
    port: 993,
    secure: true,
    passwordKind: 'app',
    appPasswordUrl: 'https://account.microsoft.com/security',
    mailboxes: ['INBOX'],
    hint: 'Microsoft duz sifreyle IMAP girisini kapatti. Iki adimli dogrulamayi acip uygulama sifresi uretin; kurumsal hesaplarda yonetici IMAP erisimini acmis olmali.'
  },
  {
    id: 'yandex',
    label: 'Yandex Mail',
    domains: ['yandex.com', 'yandex.com.tr', 'yandex.ru', 'yandex.tr'],
    host: 'imap.yandex.com',
    port: 993,
    secure: true,
    passwordKind: 'app',
    appPasswordUrl: 'https://id.yandex.com/security/app-passwords',
    mailboxes: ['INBOX'],
    hint: 'Yandex ayarlarindan IMAP erisimini acip uygulama sifresi uretin.'
  },
  {
    id: 'yahoo',
    label: 'Yahoo Mail',
    domains: ['yahoo.com', 'yahoo.com.tr', 'ymail.com', 'rocketmail.com'],
    host: 'imap.mail.yahoo.com',
    port: 993,
    secure: true,
    passwordKind: 'app',
    appPasswordUrl: 'https://login.yahoo.com/account/security',
    mailboxes: ['INBOX'],
    hint: 'Yahoo hesap guvenligi sayfasindan uygulama sifresi uretin.'
  },
  {
    id: 'zoho',
    label: 'Zoho Mail',
    domains: ['zoho.com', 'zohomail.com'],
    host: 'imap.zoho.com',
    port: 993,
    secure: true,
    passwordKind: 'app',
    appPasswordUrl: 'https://accounts.zoho.com/home#security/apppassword',
    mailboxes: ['INBOX'],
    hint: 'Avrupa veri merkezindeki hesaplarda sunucu imap.zoho.eu olur.'
  },
  {
    id: 'custom',
    label: 'Kendi sunucum (cPanel, Plesk, kurumsal)',
    domains: [],
    host: null, // adresin alan adindan tahmin edilir
    port: 993,
    secure: true,
    passwordKind: 'plain',
    mailboxes: ['INBOX'],
    hint: 'cPanel kutularinda sifre, posta kutusunun kendi sifresidir. Sunucu genellikle mail.alanadiniz.com, port 993 SSL.'
  }
];

const CUSTOM = PROVIDERS[PROVIDERS.length - 1];

function domainOf(address) {
  const m = /@([^@\s>]+)/.exec(String(address || '').trim().toLowerCase());
  return m ? m[1].replace(/[>.,;]+$/, '') : '';
}

function byId(id) {
  return PROVIDERS.find((p) => p.id === id) || null;
}

/** Adresin alan adina gore bilinen bir saglayici var mi. */
function forAddress(address) {
  const d = domainOf(address);
  if (!d) return null;
  return PROVIDERS.find((p) => (p.domains || []).includes(d)) || null;
}

/**
 * Alan adindan olasi IMAP sunucularini sirayla tahmin eder.
 *
 * cPanel kurulumlarinda kutu neredeyse her zaman mail.<alanadi> uzerindedir;
 * bazi panellerde imap.<alanadi> ya da dogrudan <alanadi> kullanilir. Ucu de
 * sirayla denenir, ilk baglanan kabul edilir.
 */
function guessHosts(address) {
  const d = domainOf(address);
  if (!d) return [];
  return [`mail.${d}`, `imap.${d}`, d];
}

/**
 * Hesap kaydindan baglanti ayarini cikarir.
 * Kullanicinin elle yazdigi sunucu her zaman onceliklidir; yoksa saglayici
 * onayari, o da yoksa alan adi tahmini kullanilir.
 */
function resolve(account = {}) {
  const user = String(account.user || '').trim().toLowerCase();
  const explicit = String(account.host || '').trim().toLowerCase();
  const preset = byId(account.provider) || forAddress(user) || CUSTOM;
  const port = Number(account.port) || preset.port || 993;
  // 143 duz portu STARTTLS ile yukseltilir; imapflow bunu kendisi yapar.
  const secure = account.secure === undefined || account.secure === null
    ? (port !== 143 && preset.secure !== false)
    : Boolean(account.secure);
  const hosts = explicit
    ? [explicit]
    : (preset.host ? [preset.host] : guessHosts(user));

  return {
    user,
    provider: preset.id,
    label: preset.label,
    hosts,
    host: hosts[0] || '',
    port,
    secure,
    passwordKind: preset.passwordKind,
    appPasswordUrl: preset.appPasswordUrl || null,
    gmailSearch: Boolean(preset.gmailSearch),
    mailboxes: preset.mailboxes || ['INBOX'],
    guessed: !explicit && !preset.host
  };
}

/** Arayuze gonderilecek sade liste; fonksiyon ya da gizli alan tasimaz. */
function list() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    domains: p.domains || [],
    host: p.host,
    port: p.port,
    secure: p.secure !== false,
    passwordKind: p.passwordKind,
    appPasswordUrl: p.appPasswordUrl || null,
    needsHost: !p.host,
    hint: p.hint || ''
  }));
}

module.exports = { PROVIDERS, list, byId, forAddress, guessHosts, resolve, domainOf };
