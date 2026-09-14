<p align="center">
  <img src="assets/icon_256.png" width="96" alt="SubKill" />
</p>

<h1 align="center">SubKill</h1>

<p align="center">Aboneliklerini gör, gereksizini kes. Tamamen yerel çalışan masaüstü abonelik denetimi.</p>

---

Onlarca yapay zeka aracı, SaaS hesabı, API kredisi ve alan adı; her biri ayrı karttan,
ayrı tarihte, ayrı posta kutusuna. SubKill posta kutundaki makbuzları okuyup envanteri
kendisi kurar, sonra üç soruyu cevaplar:

1. Bu ay ve bu yıl ne ödeyeceğim, hangi karttan?
2. Hangi aboneliğim bir diğerinin aynı işini yapıyor?
3. Hangi aboneliğime aylardır girmedim?

## Öne çıkanlar

- **Gmail makbuz taraması** — IMAP üzerinden doğrudan bilgisayarından; servis adı, tutar,
  para birimi, periyot, yenileme tarihi ve kartın son dört hanesi çıkarılır.
- **Kullanım tespiti** — tarayıcı geçmişinden her servise en son ne zaman girdiğini bulur.
- **Çakışma analizi** — aynı kategorideki abonelikleri aylık yükleri ve son kullanım
  tarihleriyle yan yana koyar.
- **Kart yükü ve limit uyarısı** — hangi kartta o ay ne kadar birikiyor, limite ne kadar var.
- **Deneme takibi** — ücretsiz denemeler ücrete dönmeden önce uyarır.
- **Yenileme takvimi** — 12 aylık dağılım; yıllık kalemler düştükleri ayda görünür.
- **TCMB kuru** — TL karşılıkları güncel kurla; çevrimdışıyken son bilinen kur kullanılır.

## Gizlilik

Sunucu yok, hesap yok, telemetri yok. Envanter makinendeki tek bir JSON dosyasında durur.
Gmail bağlantısı doğrudan bilgisayarından kurulur; uygulama şifresi işletim sisteminin
güvenli kasasında (macOS Keychain / Windows DPAPI) saklanır, veri dosyasına yazılmaz.

Servislerin **parolaları saklanmaz**. Yalnızca "bu hesaba hangi adresle, hangi yöntemle
giriyorum" bilgisi tutulur.

## Kurulum

Hazır paketler [Releases](../../releases) sayfasında: macOS için `.dmg`, Windows için `.zip`.

### Kaynaktan çalıştırma

```bash
npm install
npm start
```

npm 10+ kurulum betiklerini engelliyorsa Electron ikilisini elle indir:

```bash
node node_modules/electron/install.js
```

### Paket üretme

```bash
npm run dist:mac   # macOS .dmg (yalnızca macOS'ta)
npm run dist:win   # Windows .zip
```

macOS paketi imzasız üretilir. İlk açılışta Gatekeeper uyarı verirse uygulamaya sağ tıklayıp
"Aç" seçilir.

## Gmail uygulama şifresi

1. Google hesabında iki adımlı doğrulama açık olmalı.
2. [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) adresinden
   16 haneli bir uygulama şifresi üret.
3. Uygulamanın Tarama sekmesine Gmail adresini ve bu şifreyi gir.

Hesap parolası çalışmaz ve istenmez.

## Testler

```bash
npm test
```

Para ayrıştırma, makbuz okuma, tarih çıkarma, çakışma tespiti, kart yükü ve takvim
hesaplarını kapsayan 24 test.

## Mimari

```
src/core/      Electron'dan bağımsız saf mantık (test edilebilir)
  catalog.js   servis kataloğu, kategori eşlemesi
  money.js     para birimi, periyot normalizasyonu, kur çevrimi
  parser.js    makbuz ayrıştırma
  insights.js  özet, takvim, çakışma, ölü abonelik, kart yükü
  store.js     yerel JSON deposu
src/services/  dış dünya (Gmail IMAP, tarayıcı geçmişi, TCMB kuru)
src/main.js    Electron ana süreç ve IPC yüzeyi
ui/            arayüz (vanilla JS, çerçeve yok)
web/           getsubkill.com landing sayfası ve e-posta toplama ucu
```

Ayrıntılı ürün kararları için [SPEC.md](SPEC.md).

## Lisans

MIT
