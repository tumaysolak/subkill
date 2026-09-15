# SubKill — Urun Spesifikasyonu

## Problem
Kullanici onlarca yapay zeka ve SaaS aboneligine sahip. Hangi servise ne zaman uye
oldugunu, yenilemenin ne zaman geldigini, faturanin hangi posta kutusuna dustugunu
takip edemiyor. Sonuc: unutulan yenilemeler, ayni isi yapan iki abonelik, aylardir
girilmemis ama odenmeye devam eden hesaplar ve sessizce bitmis oldugu halde listede
duran abonelikler.

## Cozum
Tamamen yerel calisan bir masaustu uygulamasi. Veri kullanicinin makinesinde durur,
hicbir sunucuya gitmez. Uygulama posta kutusundaki makbuzlari ve tarayici gecmisini
okuyarak envanteri kendisi kurar, sonra uc soruyu cevaplar:

1. Bu ay ve bu yil ne odeyecegim?
2. Hangi aboneligim bir digerinin ayni isini yapiyor?
3. Hangi aboneligime aylardir girmedim?
4. Hangi aboneligim sessizce bitmis ama hala listede duruyor?

## Kapsam disinda (bilincli kararlar)
- Sifre saklamak. Uygulama sadece **giris yontemini** tutar (hangi e-posta, Google ile
  giris mi, sifre yoneticisinde mi). Parolanin kendisi asla girilmez.
- Bulut senkronu. v1 tek makinede calisir; veri dosyasi kullanicinin kendi
  iCloud/Drive klasorune tasinabilir.
- Banka ve kredi karti entegrasyonu. Kart takibi bilincli olarak kapsam disinda;
  envanter yalnizca makbuzlardan kurulur.

## Veri modeli

### Subscription
| alan | tip | aciklama |
|---|---|---|
| id | string | uuid |
| name | string | servis adi (Anthropic Claude) |
| plan | string | plan adi (Max 20x) |
| amount | number | tutar |
| currency | string | USD / EUR / TRY / GBP |
| cycle | string | monthly / yearly / quarterly / weekly / usage / onetime |
| nextRenewal | ISO date | bir sonraki yenileme |
| lastCharge | ISO date | son gorulen odeme |
| billingEmail | string | faturanin dustugu adres |
| loginMethod | string | google / email / sso / apple / password-manager |
| loginEmail | string | giris icin kullanilan adres (sifre degil) |
| category | string | catalog kategorisi |
| site | string | servis alan adi (kullanim tespiti icin) |
| lastUsedAt | ISO date | tarayici gecmisinden veya elle |
| status | string | active / trial / cancelled / paused |
| trialEndsAt | ISO date | deneme bitisi |
| source | string | gmail / manual / csv |
| notes | string | |

### Card
| alan | tip |
|---|---|
| last4 | string |
| label | string |
| monthlyLimit | number (TRY) |

### Settings
currency base (TRY), fx rates, gmail hesabi, uyari esikleri.

## Motor kurallari

**Aylik normalizasyon**: yearly/12, quarterly/3, weekly*4.345, usage son 3 ayin
ortalamasi, onetime 0.

**Cakisma tespiti**: ayni `category` altinda 2+ `active` abonelik varsa uyari uretilir.
Tasarruf tahmini = en pahali olan haric kalanlarin aylik toplami degil, **en ucuz
olan haric** kalanlarin toplami degildir — kullanici hangisini tutacagina kendi karar
verir, uygulama sadece aylik yuku ve son kullanim tarihlerini yan yana koyar.

**Olu abonelik**: `lastUsedAt` > 60 gun once VEYA hic kayit yok VE status=active
→ "iptal aday". 90 gunu gecen "yuksek oncelik".


**Iptal tespiti**: iki kanal. (1) Posta kutusundaki iptal bildirimleri taninir;
"istediginiz zaman iptal edebilirsiniz" gibi pazarlama cumleleri elenir ve son
makbuzdan eski bir iptal maili yok sayilir. (2) Sessiz iptal: yenilemesi gecmis ama
yeni makbuzu gelmemis abonelikler isaretlenir (aylikta 45, yillikta 400 gun tolerans).

**Deneme bitisi**: trialEndsAt 7 gun icindeyse kirmizi uyari (unutulup ucrete donmesin).

## Gmail ayristirma
IMAP + Google uygulama sifresi. Konu/gonderen filtresi ile makbuz adaylarini toplar,
her mailden: gonderen alan adi → katalog eslesmesi → servis adi + kategori + site,
gövdeden tutar + para birimi + periyot + yenileme tarihi + deneme bitisi.
Ayni servisin birden fazla makbuzu varsa en yenisi kayda islenir, eskisi gecmis olur.
Odeme aracilari (Stripe, Paddle, PayPal) servis adi olarak kabul edilmez; bu
maillerde servis adi konu satirindan ve govde basliklarindan cikarilir.

## Landing (getsubkill.com)
Statik sayfa + tek POST ucu. Ziyaretci e-posta birakir, Resend ile indirme linki
gonderilir, adres yerel listeye yazilir. Railway uzerinde calisir.
