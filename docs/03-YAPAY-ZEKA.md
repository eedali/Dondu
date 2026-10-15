# 03 — Yapay Zekâ Katmanı

## 1. İlkeler

1. Yapay zekâ **isteğe bağlı** bir katmandır: kural motoru tek başına kullanılabilir bir plan üretir. AI yalnızca belirsiz dosyalarda ve "zengin analiz" istendiğinde devreye girer.
2. Çıktı **kapalı listeden** kategori + kısa alt kategori + isteğe bağlı ad önerisi + güven + gerekçe. Serbest klasör adı üretilmez.
3. Dosyanın tamamı asla gönderilmez: ad, meta veri, ≤1.500 karakter alıntı, ≤768 px küçük görsel.
4. Hassas dosyalar buluta gitmez (bkz. §6).
5. Her çalıştırma öncesi maliyet tahmini; kullanıcı limiti aşılmaz.
6. Önbellek: `hash_full + PROMPT_VERSION + provider + model` → ikinci tarama bedava.

## 2. Sağlayıcı arayüzü

```ts
export interface AIProvider {
  readonly id: 'anthropic' | 'lmstudio' | 'none';
  readonly supportsVision: boolean;
  test(): Promise<{ ok: boolean; message: string; model?: string }>;
  estimate(batch: AIClassifyInput[]): { tokensIn: number; tokensOut: number; usd: number };
  classify(batch: AIClassifyInput[], signal: AbortSignal): Promise<AIClassifyOutput[]>;
}
```

- `BatchRunner`: partileme (varsayılan 12 dosya/istek; görselli dosyalarda 6), eşzamanlılık (Anthropic 3, LM Studio 1), üstel geri çekilme (429/529), iptal, ilerleme olayı, önbellek yazımı.
- `FakeProvider` testlerde deterministik çıktı üretir.

## 3. Anthropic — Claude Haiku 5.5

Doğrulanmış bilgiler (Claude Platform docs, Ekim 2026):
- Model kimliği: **`claude-haiku-5-5`** (tarih eki yok). 1M bağlam, 128K çıktı. Görsel girdi destekli.
- Fiyat (istem ≤100K token): **$0,10 / 1M girdi, $0,50 / 1M çıktı**. İstem >100K token olursa 5 katı ($0,50 / $2,50) → **tek istek asla 100K'yı geçmemeli** (zaten 12 dosyalık partiler ~15K token).
- Önbellek: 5 dk yazma $0,125/M, okuma $0,01/M; en az 512 token önbelleklenebilir → sistem istemi + kategori listesi `cache_control` ile işaretlenir.
- Batch API: %50 indirim (asenkron; genelde dakikalar içinde). Ayar: "Ekonomik mod (toplu istek)".
- **`temperature`, `top_p`, `top_k` gönderilmez** (400 hatası verir). Uyarlanabilir düşünme varsayılan açık → sınıflandırma için `effort: "low"`.
- Tokenizer öncekine göre ~%30 daha fazla token üretir; tahminlerde bu çarpan uygulanır.

İstek biçimi: `messages.create` + **tool use** ile zorunlu JSON (`tool_choice: {type:'tool', name:'classify_files'}`); araç şeması `docs/prompts/classify-schema.json`. Sistem istemi `docs/prompts/classify-system.md`. Görseller `image` içerik bloğu (base64 JPEG). Hata durumunda (geçersiz JSON, eksik id) o parti kurallarla devam eder ve raporda "AI yanıt vermedi" notu düşülür.

Anahtar: Ayarlar → Yapay zekâ → "Anthropic API anahtarı"; `safeStorage.encryptString` ile saklanır; "Bağlantıyı sına" butonu 1 tokenlik istek atar.

## 4. LM Studio (yerel)

- Varsayılan taban URL `http://localhost:1234/v1`; `GET /models` ile model listesi; `POST /chat/completions` ile `response_format: { type: 'json_schema', json_schema: {...} }`. Kullanıcı modeli listeden seçer.
- Görsel analiz için **görsel destekli model** gerekir (ör. Gemma 3, Qwen-VL, LLaVA). LM Studio model yeteneğini güvenilir bildirmediği için ayarda "Bu model görselleri anlıyor" anahtarı; kapalıysa görseller meta veri + EXIF ile sınıflandırılır.
- Eşzamanlılık 1, zaman aşımı 120 s, parti 6 dosya. Yavaş ama ücretsiz ve tamamen yerel.
- Sunucu kapalıysa anlaşılır mesaj: "LM Studio'da sunucu başlatılmamış (Developer → Start Server) ya da adres yanlış."
- Eşin Mac'inde LM Studio kuruluysa yerel; geliştiricinin PC'sindeki LM Studio'ya ağdan erişim (`http://192.168.x.x:1234`) de desteklenir ("Serve on Local Network" açık olmalı) — bu durumda veri yerel ağda dolaşır, kullanıcıya belirtilir.
- Yerel modellerde kategori adlarına uymama daha sık → çıktı Zod ile doğrulanır, kategori listede yoksa en yakın eşleşme (normalize edilmiş string benzerliği) ya da "Belirsiz".

## 5. Girdi hazırlama (her dosya için)

```
id: f_0042
name: IMG_4471.HEIC   ext: heic   size: 2.1 MB   modified: 2024-07-14
kind: file
meta: image 4032x3024, EXIF 2024-07-14 11:03, camera iPhone 13, GPS yes
[thumbnail attached]
```
Belgelerde `meta` satırına sayfa sayısı/yazar/başlık, ardından `excerpt:` ile alıntı. Klasörlerde `contents: 12 jpg, 3 png, 1 pdf; subfolders: 2`.

Küçük görsel: uzun kenar 768 px (ayarlanabilir 512/768/1024), JPEG kalite 80. Token ≈ (genişlik × yükseklik) / 750 → 768×576 için ~590 token.

## 6. Hassas dosyalar

**Tespit** (`src/main/core/rules/sensitive.ts`), herhangi biri yeterli:
- Uzantı: `.key .pem .p12 .pfx .kdbx .kdb .env .ovpn .ppk .keychain .asc .gpg wallet.dat .wallet .jks .crt(özel) .cer .csr .mobileconfig`
- Ad kalıbı (büyük/küçük duyarsız, TR/EN/FI): `parola, şifre, sifre, password, passwd, pwd, pin, iban, kimlik, nüfus, pasaport, passport, ehliyet, vergi, secret, token, api[_-]?key, credential, salasana, henkilötunnus, verokortti, tilinumero, backup codes, recovery`
- İçerik (alıntı üzerinde regex):
  - TC Kimlik No: `\b[1-9]\d{10}\b` + kontrol basamağı doğrulaması
  - IBAN: `\b(TR|FI|DE|...)\d{2}[A-Z0-9]{10,30}\b` + mod-97
  - Kart no: 13–19 hane + Luhn
  - Fin HETU: `\b\d{6}[-+ABCDEFYXWVU]\d{3}[0-9A-Y]\b`
  - "password:" / "şifre:" / "parola:" ardından değer
  - PEM başlığı `-----BEGIN (RSA |EC |)PRIVATE KEY-----`
- Yapay zekâ da `sensitive: true` döndürebilir (ör. kimlik fotoğrafı) → sonraki turlarda yerel kalır.

**Sonuç:** `sensitive = true` → buluta gitmez (kurallar/LM Studio), raporda kilit simgesi ve ayrı grup ("Hassas"), thumb ve alıntı diskte saklanmaz, hedef kategori varsayılan "Belgeler/Kişisel & Kimlik". Kullanıcı tek tek işareti kaldırabilir (o zaman bir sonraki taramada bulut serbest).

## 7. Maliyet tahmini — 50 karışık masaüstü nesnesi

Varsayım (tipik dağınık masaüstü): 20 görsel (fotoğraf + ekran görüntüsü), 12 belge (PDF/DOCX/Pages/XLSX), 8 metin/çeşitli, 6 arşiv/kurulum/video, 4 klasör. Kurallar hiçbir şeyi elemeden **hepsi** AI'a gönderiliyor (en kötü durum). Tokenizer çarpanı 1,3 uygulanmış.

| Kalem | Hesap | Token |
|---|---|---|
| Sistem istemi + kategori listesi (önbellekli) | 1 yazma + 4 okuma × ~1.200 | 1.200 yazma / 4.800 okuma |
| Görseller | 20 × (590 görsel + 120 meta) | 14.200 |
| Belgeler | 12 × (120 meta + ~580 alıntı) | 8.400 |
| Metin/çeşitli | 8 × 400 | 3.200 |
| Arşiv/kurulum/video | 6 × 200 | 1.200 |
| Klasörler | 4 × 200 | 800 |
| İstek başı sarmalama | 5 istek × 150 | 750 |
| **Girdi toplamı** | | **≈ 28.600 (yuvarlak 30.000)** |
| Çıktı (JSON) | 50 × ~120 + düşünme payı (`effort: low`) ~2.000 | **≈ 8.000** |

| Maliyet | Hesap | USD |
|---|---|---|
| Girdi | 30.000 × $0,10 / 1M | $0,0030 |
| Çıktı | 8.000 × $0,50 / 1M | $0,0040 |
| Önbellek yazma | 1.200 × $0,125 / 1M | $0,00015 |
| Önbellek okuma | 4.800 × $0,01 / 1M | $0,00005 |
| **Toplam (standart)** | | **≈ $0,007 → 1 sentin altında** |
| Toplam (Batch API, %50) | | ≈ $0,0035 |

Ölçekleme (aynı karışım, en kötü durum, standart fiyat):

| Dosya sayısı | Girdi token | Maliyet |
|---|---|---|
| 50 | ~30K | ~$0,007 |
| 500 | ~300K | ~$0,07 |
| 5.000 | ~3M | ~$0,70 |
| 20.000 | ~12M | ~$2,80 |

Gerçekte kural motoru ekran görüntülerinin, kurulum dosyalarının, EXIF'li fotoğrafların ve arşivlerin çoğunu AI'a göndermeden sınıflandırır → fiili maliyet bunun **1/3 – 1/2'si**. 1024 px görsel seçilirse görsel başına ~1.050 token → 50 dosya için yine ~1 sent. **Sonuç: maliyet tasarım kısıtı değil; asıl kısıtlar gizlilik, hız ve API hız limitleri.**

Uygulama içi tahmin aynı formülü kullanır (`src/main/core/ai/cost.ts`), gerçek kullanım `usage` alanından okunup "Bu çalıştırma: 31.420 girdi / 7.810 çıktı token, $0,0071" diye gösterilir ve geçmişe yazılır.

## 8. İstem sürümleme

`docs/prompts/classify-system.md` başındaki `PROMPT_VERSION` değişince önbellek anahtarı değişir (eski sonuçlar kullanılmaz). Kullanıcının kategori listesi veya örnekleri değişince de anahtar listeyi içerir (liste karması).

## 9. Düzeltmelerden öğrenme (v1'de basit)

Kullanıcı raporda bir öğenin kategorisini değiştirince `(ext, ad kalıbı, eski kategori → yeni kategori)` üçlüsü `corrections` tablosuna yazılır. Sonraki istemlerde "örnekler" bölümüne son 20 düzeltme eklenir (few-shot). Kural motoru da aynı uzantı+kalıp için güveni düşürür.

## 10. Ne zaman hangi mod?

| Durum | Öneri |
|---|---|
| Eşin Mac'i, internet var, gizlilik kaygısı normal | Anthropic Haiku 5.5 + "hassas yerel" (varsayılan) |
| Çok kişisel içerik / çevrimdışı | LM Studio (görselli model) |
| Hızlı ilk deneme | Yok (yalnızca kurallar) — zaten %60–70'ini doğru koyar |
