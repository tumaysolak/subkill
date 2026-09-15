'use strict';

const test = require('node:test');
const assert = require('node:assert');
const providers = require('../src/core/providers');

test('bilinen saglayicilar adresten taniniyor', () => {
  assert.strictEqual(providers.resolve({ user: 'biri@gmail.com' }).provider, 'gmail');
  assert.strictEqual(providers.resolve({ user: 'biri@icloud.com' }).provider, 'icloud');
  assert.strictEqual(providers.resolve({ user: 'biri@yandex.com.tr' }).provider, 'yandex');
  assert.strictEqual(providers.resolve({ user: 'biri@outlook.com' }).provider, 'outlook');
});

test('gmail onayari kendi arama dilini ve tum mail kutusunu kullanir', () => {
  const cfg = providers.resolve({ user: 'biri@gmail.com' });
  assert.strictEqual(cfg.host, 'imap.gmail.com');
  assert.strictEqual(cfg.gmailSearch, true);
  assert.ok(cfg.mailboxes.includes('[Gmail]/All Mail'));
  assert.strictEqual(cfg.passwordKind, 'app');
});

test('bilinmeyen alan adi kendi sunucusu sayilir ve adaylar siralanir', () => {
  const cfg = providers.resolve({ user: 'info@sirketim.com.tr' });
  assert.strictEqual(cfg.provider, 'custom');
  assert.strictEqual(cfg.gmailSearch, false);
  assert.strictEqual(cfg.guessed, true);
  assert.deepStrictEqual(cfg.hosts, ['mail.sirketim.com.tr', 'imap.sirketim.com.tr', 'sirketim.com.tr']);
  assert.strictEqual(cfg.passwordKind, 'plain');
});

test('elle yazilan sunucu tahmini ezer ve tek aday birakir', () => {
  const cfg = providers.resolve({ user: 'info@sirketim.com.tr', host: 'srv12.hosting.com', port: 993 });
  assert.deepStrictEqual(cfg.hosts, ['srv12.hosting.com']);
  assert.strictEqual(cfg.host, 'srv12.hosting.com');
});

test('143 portu STARTTLS icin sifresiz acilir, 993 sifreli kalir', () => {
  assert.strictEqual(providers.resolve({ user: 'a@b.com', port: 143 }).secure, false);
  assert.strictEqual(providers.resolve({ user: 'a@b.com', port: 993 }).secure, true);
  // Kullanici acikca sifreli baglanti isterse port ne olursa olsun ona uyulur.
  assert.strictEqual(providers.resolve({ user: 'a@b.com', port: 143, secure: true }).secure, true);
});

test('saglayici listesi arayuz icin gerekli alanlari tasiyor', () => {
  const list = providers.list();
  const custom = list.find((p) => p.id === 'custom');
  assert.strictEqual(custom.needsHost, true);
  assert.ok(list.find((p) => p.id === 'gmail').appPasswordUrl);
  assert.ok(list.every((p) => p.label && typeof p.port === 'number'));
});
