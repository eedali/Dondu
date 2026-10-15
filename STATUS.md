# STATUS — Döndü

> Claude Code bu dosyayı her oturum başında okur, her iş parçasının sonunda günceller. Kısa tut; ayrıntı için commit geçmişi ve `docs/` var.

## Şu anki faz

**Faz 4 — Ayarlar, onboarding, cila** (sırada)

## Yapıldı

- Tasarım dokümanları (`docs/01` … `docs/08`, `docs/prompts/`)
- Faz 0 — İskelet: electron-vite 6 + React 18 + TS strict + Tailwind 4 + Zustand + i18next + zod; vitest/eslint/prettier; electron-builder (dmg arm64+x64 ad-hoc, nsis x64); güvenli pencere (contextIsolation, sandbox); tipli IPC zinciri (`app:ping`); tema değişkenleri (light/dark); sol gezinti; logo (`logo/` → `src/renderer/assets/logo`, uygulama simgeleri `build/icon.*`, `scripts/make-icons.py`)

- Faz 1 — Tarayıcı + DB: better-sqlite3 (Electron ABI; testler `ELECTRON_RUN_AS_NODE` ile Electron'un Node'unda koşar), migrasyonlar, değiştirilebilir `SqlDb` arayüzü + repository'ler; `opendir+lstat` yürüyücü (dışlama globları, gizli, derinlik, paket/proje algılama, iCloud/OneDrive yer tutucu, NFC); worker_threads havuzu (`?nodeWorker`) ile içerik analizi; xxh3 hızlı + blake3 tam karma, dHash; çıkarıcılar (EXIF, PDF=pdfjs-dist, docx, xlsx, pptx, metin, ses/video, zip, iWork önizleme); hassas tespit (TC/IBAN/Luhn/HETU, ad, uzantı) — hassas dosyada alıntı/thumb saklanmaz; nativeImage küçük görsel + `dondu-thumb://` protokolü; Klasörler + Tarama ekranları; `npm run fixtures` (80 dosya)

- Faz 2 — AI'sız MVP: ayarlar (zod + JSON + safeStorage), taksonomi seed'i; kural motoru (ekran görüntüsü TR/EN/FI/DE, EXIF, anahtar kelimeler TR/FI/EN, çöp, paket/proje); kopyalar (blake3 kesin, dHash yakın, HEIC/JPG kardeş, keepPolicy); naming (sanitize, şablon, ` (2)` çakışma, iki adımlı harf büyüklüğü); deterministik planner; Rapor (sekmeler, gruplar, satır/grup düzenleme, detay paneli, filtreler, HTML/MD/JSON dışa aktarma); onay akışı (ikinci onay, ön kontrol, değişen dosyaları atla); write-ahead journal ile applier (aynı birim rename, farklı birim kopya+blake3+karantina, mkdir takibi, boş kalan Döndü klasörlerini kaldırma, duraklat/iptal, ilk hatada dur); undo (çalıştırma/öğe, "(geri alındı)", değişen dosyada sor, undo'nun undo'su = yeniden uygula); açılış toparlaması + "yarım kalan işlem" diyaloğu; Geçmiş + karantina boşaltma (OS çöpü). Testler: round-trip, çökme, devam, çakışma, değişen kaynak, kök dışı, harf büyüklüğü, NFD/NFC, duraklat; birim: naming/rules/dupes/planner/sensitive

- Faz 3 — Yapay zekâ: `AIProvider` arayüzü; AnthropicProvider (`claude-haiku-5-5`, `temperature/top_p/top_k` yok, `output_config.effort`, zorunlu `classify_files` aracı, sistem istemi `cache_control`, base64 görseller, 429/529 → geri çekilme, Message Batches seçeneği); LmStudioProvider (fetch, `/models`, `json_schema`, anlaşılır hata); FakeProvider; BatchRunner (parti, eşzamanlılık, iptal, ilerleme, önbellek `hash|PROMPT_VERSION|provider|model|taksonomi|mod`); maliyet tahmini (docs/03 §7) + plan öncesi tahmin diyaloğu + limit; hassas kapısı (bulut sağlayıcıya ad bile gitmez); düzeltmelerden öğrenme (corrections → istem örnekleri + planner); Ayarlar ekranı (tüm docs/06 bölümleri, Basit/Gelişmiş, Yapay zekâ bölümü, bağlantı testi, kategori düzenleyici, önbellek/log). Geçmişte gerçek token/$.

## Sırada

1. Faz 4: onboarding, yardım sayfaları, boş/hata durumları, klavye, performans ölçümü

## Bilinen sorunlar / açık kararlar

- Arayüz vurgu rengi logodan alındı (kobalt `#3D5AFE`, gece mavisi `#1A1F3A`); `docs/08` güncellendi.
- macOS derlemesi yalnızca GitHub Actions üzerinde; Mac'te ilk gerçek test Faz 5'te
- Geliştirme araçları (yalnızca paketlenmemiş uygulama): `DONDU_SCREENSHOT=<png>` pencere görüntüsü alıp kapanır; `DONDU_USERDATA=<dir>` ayrı veri klasörü; `DONDU_DEV_ROOTS=<yol>` kökleri ayarlar; `DONDU_AUTOSCAN=1`, `DONDU_AUTOPLAN=1`, `DONDU_AUTOAPPLY=1`, `DONDU_ROUTE=<ekran>`
- Değişen kaynak dosyalar ön kontrolde yalnızca "atla" ile geçilebiliyor (doc "yine de uygula" seçeneği öneriyor; güvenlik için şimdilik yok)
- `apply.concurrency` ayarı okunuyor ama uygulama şimdilik hep sıralı (güvenli varsayılan)
- Diskteki ham ad NFC'den farklıysa (`rel_path_raw`) o yazımla taşınır; Windows'ta NFD adlar da çalışır
- Canlı API testi (`DONDU_LIVE_AI=1` + `ANTHROPIC_API_KEY`) bu makinede anahtar olmadığı için çalıştırılmadı; istek biçimi sahte fetch ile test edildi
- Haiku 5.5'te zorunlu `tool_choice` kabul ediliyor (düşünme o yanıtta atlanır); `strict: true` şemadaki `maxLength/pattern` yüzünden kullanılmadı, çıktı zod ile doğrulanıyor
- PDF için `pdf-parse` yerine doğrudan `pdfjs-dist` kullanıldı (pdf-parse v2 native `@napi-rs/canvas` istiyor)

## Son güncelleme

2026-10-15 — Faz 3 tamamlandı
