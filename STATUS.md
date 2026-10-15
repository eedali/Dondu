# STATUS — Döndü

> Claude Code bu dosyayı her oturum başında okur, her iş parçasının sonunda günceller. Kısa tut; ayrıntı için commit geçmişi ve `docs/` var.

## Şu anki faz

**Faz 1 — Tarayıcı + veritabanı** (sırada)

## Yapıldı

- Tasarım dokümanları (`docs/01` … `docs/08`, `docs/prompts/`)
- Faz 0 — İskelet: electron-vite 6 + React 18 + TS strict + Tailwind 4 + Zustand + i18next + zod; vitest/eslint/prettier; electron-builder (dmg arm64+x64 ad-hoc, nsis x64); güvenli pencere (contextIsolation, sandbox); tipli IPC zinciri (`app:ping`); tema değişkenleri (light/dark); sol gezinti; logo (`logo/` → `src/renderer/assets/logo`, uygulama simgeleri `build/icon.*`, `scripts/make-icons.py`)

## Sırada

1. Faz 1: Tarayıcı, çıkarıcılar, veritabanı

## Bilinen sorunlar / açık kararlar

- Arayüz vurgu rengi logodan alındı (kobalt `#3D5AFE`, gece mavisi `#1A1F3A`); `docs/08` güncellendi.
- macOS derlemesi yalnızca GitHub Actions üzerinde; Mac'te ilk gerçek test Faz 5'te
- Geliştirme aracı: `DONDU_SCREENSHOT=<png> npm run dev` pencerenin görüntüsünü alıp kapanır (yalnızca paketlenmemiş uygulamada)

## Son güncelleme

2026-10-15 — Faz 0 tamamlandı
