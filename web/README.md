# SubKill landing

Bagimliliksiz Node sunucusu: statik sayfa + `/api/lead` ucu.

## Railway'de calistirma

Root directory: `web`
Start command: `npm start` (varsayilan)

### Ortam degiskenleri

| degisken | zorunlu | aciklama |
|---|---|---|
| `RESEND_API_KEY` | evet | Resend API anahtari. Yoksa adres kaydedilir ama posta gitmez. |
| `MAIL_FROM` | evet | Gonderen, ornek: `SubKill <merhaba@getsubkill.com>`. Alan adi Resend'de dogrulanmis olmali. |
| `NOTIFY_TO` | hayir | Her yeni kayitta bildirim gidecek adres. |
| `DOWNLOAD_MAC` | hayir | macOS .dmg baglantisi (GitHub Releases). |
| `DOWNLOAD_WIN` | hayir | Windows .zip baglantisi. |
| `DATA_DIR` | hayir | Lead dosyasinin klasoru. Railway'de kalici disk baglanmazsa her deploy'da sifirlanir; volume onerilir. |

### Kalici lead listesi

Railway'de bir volume olusturup `/data` yoluna baglayin ve `DATA_DIR=/data` verin.
Volume yoksa `NOTIFY_TO` tanimlayin; her kayit posta olarak da elinize gecer.

### Alan adi

Railway > Settings > Domains uzerinden `getsubkill.com` baglanir. Domain Railway'den
satin alindiysa DNS otomatik kurulur.

## Yerel deneme

```bash
cd web
RESEND_API_KEY=... MAIL_FROM="SubKill <merhaba@getsubkill.com>" npm start
# http://localhost:3000
```
