# STATUS — Döndü

> Claude Code bu dosyayı her oturum başında okur, her iş parçasının sonunda günceller. Kısa tut; ayrıntı için commit geçmişi ve `docs/` var.

## Şu anki faz

**Faz 2 — Kurallar, kopyalar, plan, rapor, uygula, geri al** (sırada)

## Yapıldı

- Tasarım dokümanları (`docs/01` … `docs/08`, `docs/prompts/`)
- Faz 0 — İskelet: electron-vite 6 + React 18 + TS strict + Tailwind 4 + Zustand + i18next + zod; vitest/eslint/prettier; electron-builder (dmg arm64+x64 ad-hoc, nsis x64); güvenli pencere (contextIsolation, sandbox); tipli IPC zinciri (`app:ping`); tema değişkenleri (light/dark); sol gezinti; logo (`logo/` → `src/renderer/assets/logo`, uygulama simgeleri `build/icon.*`, `scripts/make-icons.py`)

- Faz 1 — Tarayıcı + DB: better-sqlite3 (Electron ABI; testler `ELECTRON_RUN_AS_NODE` ile Electron'un Node'unda koşar), migrasyonlar, değiştirilebilir `SqlDb` arayüzü + repository'ler; `opendir+lstat` yürüyücü (dışlama globları, gizli, derinlik, paket/proje algılama, iCloud/OneDrive yer tutucu, NFC); worker_threads havuzu (`?nodeWorker`) ile içerik analizi; xxh3 hızlı + blake3 tam karma, dHash; çıkarıcılar (EXIF, PDF=pdfjs-dist, docx, xlsx, pptx, metin, ses/video, zip, iWork önizleme); hassas tespit (TC/IBAN/Luhn/HETU, ad, uzantı) — hassas dosyada alıntı/thumb saklanmaz; nativeImage küçük görsel + `dondu-thumb://` protokolü; Klasörler + Tarama ekranları; `npm run fixtures` (80 dosya)

## Sırada

1. Faz 2: naming, dupes, planner, rapor UI, applier + journal, undo, geçmiş

## Bilinen sorunlar / açık kararlar

- Arayüz vurgu rengi logodan alındı (kobalt `#3D5AFE`, gece mavisi `#1A1F3A`); `docs/08` güncellendi.
- macOS derlemesi yalnızca GitHub Actions üzerinde; Mac'te ilk gerçek test Faz 5'te
- Geliştirme araçları (yalnızca paketlenmemiş uygulama): `DONDU_SCREENSHOT=<png>` pencere görüntüsü alıp kapanır; `DONDU_USERDATA=<dir>` ayrı veri klasörü; `DONDU_DEV_ROOTS=<yol>` kökleri ayarlar; `DONDU_AUTOSCAN=1`, `DONDU_ROUTE=<ekran>`
- PDF için `pdf-parse` yerine doğrudan `pdfjs-dist` kullanıldı (pdf-parse v2 native `@napi-rs/canvas` istiyor)

## Son güncelleme

2026-10-15 — Faz 1 tamamlandı
