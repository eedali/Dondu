# Changelog

Bu proje [Semantic Versioning](https://semver.org/lang/tr/) kullanır.

## [0.1.0] — 2026-10-15

İlk sürüm.

### Eklendi
- **Tarama** (salt okunur): seçili klasörler, dışlama listesi, gizli dosyalar, macOS paketleri ve kod projeleri tek birim, iCloud/OneDrive yer tutucuları atlanır, NFC adlar. Görsel/EXIF, PDF, Word, Excel, PowerPoint, metin, ses/video, zip ve iWork önizlemesi çıkarımı; küçük görseller; hızlı (xxh3) ve tam (BLAKE3) karma, dHash.
- **Kural motoru**: ekran görüntüleri (TR/EN/FI/DE), EXIF'li fotoğraflar, faturalar/sözleşmeler/resmi belgeler (TR/FI/EN anahtar kelimeler), kurulum dosyaları, arşivler, çöp adayları.
- **Hassas dosya tespiti**: TC kimlik, IBAN (mod-97), kart (Luhn), HETU, parola, özel anahtar; hassas dosyalar buluta gitmez, önizleme/alıntı saklanmaz.
- **Kopyalar**: birebir kopyalar karantinaya, çok benzer görseller ayrı grupta, HEIC/JPG kardeşleri birlikte.
- **Plan ve Rapor**: hedef klasöre göre gruplar, sekmeler (Plan, Gözden geçir, Kopyalar, Hassas, Atlananlar), satır/grup düzenleme, detay paneli, HTML/Markdown/JSON dışa aktarma.
- **Onaylı uygulama**: ön kontrol, write-ahead günlük, aynı diskte taşıma / farklı diskte kopyala + doğrula + karantina, asla üzerine yazmama (` (2)`), duraklat/iptal, ilk hatada dur.
- **Geri alma**: çalıştırma veya dosya bazında; değişmiş dosyada sorar; geri almanın geri alınması = yeniden uygulama; çökme sonrası açılışta toparlama.
- **Yapay zekâ** (isteğe bağlı): Claude Haiku 5.5 (Anthropic) veya LM Studio (yerel); maliyet tahmini ve üst sınır, önbellek, düzeltmelerden öğrenme.
- **Ayarlar** (Basit/Gelişmiş), kategori düzenleyici, ilk açılış sihirbazı, platforma özel yardım sayfaları, karantina hatırlatması.
- Türkçe ve İngilizce arayüz, açık/koyu tema, logo ve uygulama simgeleri.
