# 08 — Arayüz ve Görsel Tasarım

## 1. Karakter

Sakin, güven veren, az konuşan. Döndü bir "temizlik aracı" değil, bir **asistan**: ne yapacağını önce söyler, izin ister, sonra yapar. Arayüz bu sırayı görünür kılar: her ekranda tek bir birincil eylem, geri dönüş yolu her zaman belli.

Anahtar kelimeler: boşluk, hiyerarşi, tek vurgu rengi, sistem yazı tipi, animasyon yok denecek kadar az (yalnızca ilerleme ve geçişler, 150 ms).

Yapılmayacaklar: gradyan, gölge yığını, emoji, "sihirli" ifadeler, aynı anda birden çok vurgu rengi, modal üstüne modal, kullanıcıyı korkutan kırmızılar (kırmızı yalnızca gerçek hata).

## 2. Renk ve tipografi

- Yazı: `-apple-system, "Segoe UI", system-ui, sans-serif`; mono: `ui-monospace, "SF Mono", Consolas` (yollar için).
- Ölçek: 13 / 15 (gövde) / 17 / 22 / 28. Satır yüksekliği 1,45.
> Güncelleme (Faz 0): Renkler `logo/` klasöründeki marka logosuna göre ayarlandı (gece mavisi `#1A1F3A`, kobalt `#3D5AFE`). Eski öneri (`#2F6F6A` yeşil-mavi) logo ile çatıştığı için bırakıldı.

- Işık tema: zemin `#F6F7FA` (hafif soğuk gri), yüzey `#FFFFFF`, metin `#1A1F3A` (logo gece mavisi), ikincil `#5F6478`, çizgi `#E3E5EC`.
- Koyu tema: zemin `#12141F`, yüzey `#1B1E2C`, metin `#ECEEF5`, ikincil `#9A9EB2`, çizgi `#2A2E40`.
- Vurgu (tek): **`#3D5AFE`** (logodaki kobalt kare — "yerine dönen parça"). Hover `#2F49E0`, açık tonda rozet zemini `#E8ECFF`; koyu temada vurgu `#5B74FF`.
- Durum: başarı vurgu rengiyle aynı; uyarı `#A9741B`; hata `#B3412F`; hassas (kilit) `#5B4C9C`.
- Her renk CSS değişkeni (`--bg`, `--surface`, `--text`, `--muted`, `--line`, `--accent`, ...) → Tailwind `theme.extend.colors` bu değişkenleri okur.

## 3. Yerleşim

```
┌──────────┬───────────────────────────────────────────┐
│ Döndü    │  Başlık                           [Eylem]  │
│          ├───────────────────────────────────────────┤
│ Klasörler│                                           │
│ Tarama   │           İçerik                           │
│ Rapor    │                                           │
│ Geçmiş   │                                           │
│ Ayarlar  │                                           │
│          ├───────────────────────────────────────────┤
│ (durum)  │  Alt çubuk: ilerleme / özet / birincil eylem│
└──────────┴───────────────────────────────────────────┘
```
- Sol gezinti 200 px, sabit. Mevcut adım vurgulu; yapılamayan adımlar gri (Rapor, tarama yokken).
- Alt çubuk her zaman "şimdi ne olacak"ı söyler: "3 klasör seçildi — Tara", "Tarama %42", "Plan hazır: 128 taşıma, 9 karantina — Gözden geçir".
- 8 px ızgara; içerik maksimum 960 px, ortalı.

## 4. Ekranlar

### 4.1 Onboarding (ilk açılış, 4 adım, tek sayfa kaydırmalı)
1. Dil. 2. "Dosyalarınızı nasıl anlayalım?" — üç kart: Yalnızca kurallar (ücretsiz, çevrimdışı) / Claude (hızlı, çok iyi, ~1 sent/50 dosya) / LM Studio (yerel, ücretsiz, yavaş). 3. Klasörler. 4. Sistem kontrolü (✔/✖ satırları + düzeltme yardımı).

### 4.2 Klasörler
Seçili kökler kart listesi (yol, dosya sayısı tahmini, erişim durumu). "Klasör ekle" birincil; sistem klasörü seçilirse kibar red metni.

### 4.3 Tarama
Büyük ilerleme halkası değil — ince yatay çubuk + iki sayı (bulundu / analiz edildi) + şu an işlenen yolun kısaltılmış hâli. "Durdur" ikincil buton. Bitince özet: türlere göre küçük çubuk grafik (tek renk tonları) ve "Planı oluştur".

### 4.4 Yapay zekâ tahmini (plan öncesi, yalnızca AI açıksa)
"214 dosya yapay zekâya gönderilecek · ~128.000 token · ~$0,03". Limit aşılırsa buton kapalı + öneri (görsel çözünürlüğünü düşür / yalnızca belirsizleri gönder).

### 4.5 Rapor
- Üst: özet şeridi (taşınacak / yeniden adlandırılacak / karantina / atlanacak / hassas) — tıklanınca filtre.
- Sekmeler: **Plan** · **Gözden geçir** (düşük güven) · **Kopyalar** · **Hassas** · **Atlananlar**.
- Gruplar: hedef klasör başlığı (ör. `Belgeler / Fatura ve Makbuz / 2024`, 23 dosya) + grup eylemleri (hedefi değiştir, tümünü atla). Grup katlanabilir.
- Satır: 32 px thumb/simge · ad (eski) · ok · yeni ad/yol (mono, kısaltılmış, hover'da tam) · kategori rozeti · güven (3 nokta: ●●●/●●○/●○○) · gerekçe (tek satır, gri) · satır menüsü (hedef, ad, atla, hassas, Finder'da göster).
- Satırda tıkla → sağda detay paneli: büyük thumb/alıntı, meta veri, AI gerekçesi, "Bu türü hep buraya koy" (düzeltme öğrenme).
- Alt çubuk: "Onayla ve uygula" birincil; yanında "Dışa aktar".

### 4.6 Onay diyaloğu
Başlık: "Uygulansın mı?" Üç satır: ne yapılacak (sayılar), **"Hiçbir dosya silinmez; her şey geri alınabilir."**, karantina klasörü yolu. Butonlar: Vazgeç / **Uygula**. 500+ öğede ikinci bir "Evet, 1.240 dosya" onayı.

### 4.7 Uygula
İlerleme çubuğu + şu anki dosya + geçen/kalan süre tahmini. Hata olursa liste sağda açılır, akış durur: "Atla ve devam" / "Durdur". Bitiş: özet + "Geçmiş'te gör" + "Geri al".

### 4.8 Geçmiş
Çalıştırma kartları (tarih, kökler, sayılar, durum). Açınca günlük tablosu (filtrelenebilir), "Tümünü geri al" ve satır başı "Geri al".

### 4.9 Ayarlar
Sol alt sekmeler (Genel, Tarama, Fotoğraflar, Kopyalar, Hassas, Adlandırma, Yapay zekâ, Rapor/Uygulama, Veri). Her alanın altında tek satır açıklama. "Gelişmiş" anahtarı.

## 5. Bileşenler

Kendi ince bileşen seti (`src/renderer/components`): Button (primary/secondary/ghost/danger), Badge, Progress, Table/Row, Dialog, Toggle, Select, Input, Tabs, EmptyState, Tooltip. Erişilebilirlik: odak halkası görünür, `aria-*`, Escape kapatır, Enter onaylar.

## 6. Metin tonu (TR)

Kısa, eylem odaklı, "siz" dili. Teknik terim yerine sonuç: "Bu klasöre yazamıyorum" değil, "macOS bu klasöre erişime izin vermedi — Ayarları açıp izin verebilirsiniz." Uyarılar sakin: "Dikkat: 3 dosya iCloud'da ve indirilmemiş; onlara dokunmadım."

## 7. Simge/logo

Logo hazır: `logo/` (svg + png; işaret, yatay/dikey kilit, açık/koyu/kobalt varyantları). Üç lacivert kare + yerine dönmekte olan eğik kobalt kare. Uygulama içinde `src/renderer/assets/logo/` (meta verisi ayıklanmış kopyalar) kullanılır; uygulama simgeleri `build/icon.png|icns|ico` ve `resources/icon.png`, `python scripts/make-icons.py` ile `logo/png/mark-color-1024.png`'den üretilir (beyaz yuvarlatılmış karo üzerinde işaret).
