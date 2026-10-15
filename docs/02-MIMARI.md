# 02 — Mimari

## 1. Teknoloji kararları ve gerekçeleri

| Karar | Seçim | Neden | Elenen |
|---|---|---|---|
| Çatı | **Electron + electron-vite + React + TS** | Windows'ta geliştirilip macOS'a paketlenebilir (CI ile); dosya işleme için Node ekosistemi (pdf-parse, mammoth, exifr); Claude Code bu yığında çok verimli | Tauri (Rust araç zinciri + Windows'tan macOS'a derleme yok), PySide (paketleme ve UI kalitesi), .NET MAUI |
| Veritabanı | **better-sqlite3** (yedek: `sql.js`) | Günlük/undo için işlem güvenliği, 100k dosyada hızlı sorgu | JSON dosyaları (büyüyünce yavaş, atomiklik yok) |
| Karma | **hash-wasm** (xxh3 + blake3) | Native modül yok, hızlı | node:crypto sha256 (yavaş), native xxhash |
| Küçük görsel | **`nativeImage.createThumbnailFromPath`** | Sıfır bağımlılık; macOS'ta QuickLook (HEIC, PDF, Pages, video dahil), Windows'ta kabuk önizlemesi | sharp (native, HEIC için libheif gerekir) |
| Yapay zekâ | Sağlayıcı arayüzü + Anthropic SDK + LM Studio (fetch) | Değiştirilebilir, test edilebilir (sahte sağlayıcı) | LangChain vb. (gereksiz katman) |
| Durum (renderer) | Zustand | Küçük, IPC ile uyumlu | Redux |
| Stil | Tailwind + CSS değişkenleri (tema) | Hızlı, tutarlı | Component kütüphaneleri (görünüm tektipleşir) |
| Paketleme | electron-builder (dmg, nsis) + GitHub Actions matrix | macOS derlemesi Windows'ta yapılamaz; CI çözer | Electron Forge |

## 2. Süreç modeli

```
┌──────────────── Renderer (React) ────────────────┐
│  Onboarding │ Klasörler │ Tarama │ Rapor │ Uygula │ Geçmiş │ Ayarlar
└──────────────▲───────────────────────────────────┘
               │ window.dondu.*  (contextBridge, tip güvenli)
┌──────────────┴──────────── Preload ──────────────┐
└──────────────▲───────────────────────────────────┘
               │ ipcMain.handle / webContents.send (olaylar)
┌──────────────┴──────────── Main (Node) ──────────┐
│ Orchestrator ── Scanner ── Extractors ── Hasher   │
│      │            │ (worker_threads havuzu)       │
│      ├── Rules ── Dupes ── Sensitive              │
│      ├── AI (Provider: anthropic | lmstudio | none)│
│      ├── Planner ── Naming                        │
│      ├── Applier ── Journal ── Undo               │
│      └── Settings ── Secrets(safeStorage) ── DB   │
└──────────────────────────────────────────────────┘
```

- Renderer **hiçbir zaman** `fs`'e dokunmaz (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`).
- Uzun işler (tarama, karma, metin çıkarma, uygulama) `worker_threads` havuzunda; main süreç ilerlemeyi `scan:progress`, `apply:progress` olaylarıyla yayınlar.
- Tek bir **Orchestrator** durum makinesi: `idle → scanning → analyzing → planned → applying → done` (+ `cancelled`, `error`). UI yalnızca bu durumu yansıtır.

## 3. Veri modeli (SQLite)

Dosya: `app.getPath('userData')/dondu.sqlite`. Şema migrasyonları `src/main/db/migrations/NNN_*.sql`.

```sql
-- Her tarama bir oturum
scan_sessions(id TEXT PK, started_at, finished_at, roots_json, settings_snapshot_json, status)

-- Dosya envanteri (oturum başına)
files(
  id TEXT PK, session_id, root TEXT, rel_path TEXT, name, ext, kind /*file|dir|bundle|symlink*/,
  size INTEGER, mtime INTEGER, ctime INTEGER, mime TEXT,
  is_hidden INT, is_cloud_placeholder INT, is_locked INT,
  hash_fast TEXT, hash_full TEXT, phash TEXT,
  sensitive INT, sensitive_reason TEXT,
  rule_category TEXT, rule_confidence REAL,
  UNIQUE(session_id, root, rel_path))

-- Çıkarılan meta veri (JSON): exif, dimensions, pages, author, title, duration, archive_entries, text_excerpt, thumb_path
file_meta(file_id PK, json TEXT)

-- Yapay zekâ önbelleği: aynı içerik + aynı istem sürümü → tekrar ücret yok
ai_cache(content_key TEXT PK /*hash_full|prompt_version|provider|model*/, result_json, tokens_in, tokens_out, created_at)

-- Plan
plans(id TEXT PK, session_id, created_at, approved_at, status /*draft|approved|applying|applied|partial|undone*/, summary_json)
plan_items(
  id TEXT PK, plan_id, file_id,
  action /*move|rename|move_rename|quarantine|trash|skip|mkdir*/,
  source_path, target_path,
  category, subcategory, suggested_name,
  confidence REAL, reason TEXT, source /*rule|ai|user*/,
  enabled INT DEFAULT 1, user_edited INT DEFAULT 0, group_key TEXT)

-- Günlük (write-ahead): her satır bir fiziksel işlem
journal(
  id INTEGER PK AUTOINCREMENT, run_id TEXT, plan_id, item_id, seq INTEGER,
  op /*rename|copy|verify|remove_source|mkdir|rmdir_empty|trash*/,
  src TEXT, dst TEXT, size INTEGER, mtime INTEGER, hash TEXT,
  status /*pending|done|failed|undone*/, error TEXT,
  started_at, finished_at, undone_at)

runs(id TEXT PK, plan_id, kind /*apply|undo*/, started_at, finished_at, status, stats_json)

categories(id TEXT PK, name_tr, name_en, folder_template, description, examples_json, enabled INT, sort INT)
settings(key TEXT PK, value_json)
```

Notlar:
- `rel_path` NFC normalize edilmiş saklanır; diske yazarken platform ne verirse kabul edilir.
- `hash_full` yalnızca kopya adaylarında ve AI önbellek anahtarı gerekince hesaplanır (tembel).
- `thumb_path` userData altında `thumbs/<hash_fast>.jpg`; hassas dosyalarda thumb üretilmez.

## 4. Paylaşılan tipler (`src/shared/types.ts`) — çekirdek

```ts
export type FileKind = 'file' | 'dir' | 'bundle' | 'symlink';
export interface FileRecord { id: string; root: string; relPath: string; name: string; ext: string; kind: FileKind;
  size: number; mtime: number; ctime: number; mime?: string; isHidden: boolean; isCloudPlaceholder: boolean;
  hashFast?: string; hashFull?: string; phash?: string; sensitive: boolean; sensitiveReason?: string; }

export type PlanAction = 'move' | 'rename' | 'move_rename' | 'quarantine' | 'trash' | 'skip' | 'mkdir';
export interface PlanItem { id: string; fileId: string; action: PlanAction; sourcePath: string; targetPath: string;
  category: string; subcategory?: string; suggestedName?: string; confidence: number; reason: string;
  source: 'rule' | 'ai' | 'user'; enabled: boolean; userEdited: boolean; groupKey: string; }
export interface Plan { id: string; sessionId: string; status: PlanStatus; items: PlanItem[]; summary: PlanSummary; }

export interface AIClassifyInput { id: string; name: string; ext: string; sizeBytes: number; mtimeIso: string; kind: FileKind;
  metaSummary: string; textExcerpt?: string; imageJpegBase64?: string; }
export interface AIClassifyOutput { id: string; category: string; subcategory?: string; suggestedName?: string;
  dateHint?: string; confidence: number; sensitive: boolean; reason: string; }
```

## 5. IPC sözleşmesi (`src/shared/ipc.ts`)

Tüm kanallar `alan:fiil` biçiminde, istek/yanıt tipleri tek yerde:

| Kanal | Yön | Açıklama |
|---|---|---|
| `folders:pick` | R→M | Yerel klasör seçim diyaloğu; dönen yollar doğrulanır (sistem klasörü değil) |
| `scan:start` / `scan:cancel` | R→M | Oturum başlatır/iptal eder |
| `scan:progress` | M→R | `{found, analyzed, phase, currentPath}` |
| `plan:build` | R→M | Oturumdan plan üretir (AI dahilse önce `ai:estimate`) |
| `ai:estimate` | R→M | `{files, tokensIn, tokensOut, usd, provider}` |
| `plan:update` | R→M | Tek öğe/grup düzenleme (hedef, ad, enabled) |
| `plan:approve` | R→M | Taslak → onaylı (değişmez) |
| `plan:export` | R→M | HTML/MD/JSON |
| `apply:start` / `apply:pause` / `apply:cancel` | R→M | |
| `apply:progress` | M→R | `{done, total, currentItem, errors[]}` |
| `history:list` / `undo:run` / `undo:item` | R→M | |
| `settings:get` / `settings:set` / `secrets:set` | R→M | |
| `platform:check` | R→M | İzin/yazma testleri (bkz. 04) |
| `shell:reveal` | R→M | Finder/Explorer'da göster |

Preload'da `window.dondu` olarak tiplenmiş API: `dondu.scan.start(roots)`, `dondu.plan.update(...)` vb.

## 6. Boru hattı ayrıntıları

### 6.1 Scanner
- `fs.opendir` ile yinelemeli, `lstat` (symlink izlenmez).
- Dışlama: `.git`, `node_modules`, `Library`, `AppData`, `$RECYCLE.BIN`, `System Volume Information`, `.Trash`, `.DS_Store`, `Thumbs.db`, `desktop.ini`, `~$*.docx` (Office kilit), ayarlardaki ek kalıplar.
- Paket algılama (macOS): uzantı listesi + `Contents/Info.plist` varlığı → `kind: 'bundle'`, içine girilmez.
- Proje klasörü algılama: `.git`, `package.json`, `*.xcodeproj`, `Cargo.toml`, `.sln` içeren klasör → tek birim (`bundle` gibi ele alınır, kategori "Kod & Projeler").
- Bulut yer tutucu: macOS `.<ad>.icloud`; Windows'ta `attrib` çıktısında `O` (offline) / OneDrive kökü altı → `isCloudPlaceholder`.
- Sonuçlar DB'ye 500'lük partilerde yazılır.

### 6.2 Extractors (worker havuzu, tür başına bir modül)
- `image`: `exifr` (tarih, kamera, GPS var/yok, yön) + boyutlar + thumb (768 px, JPEG q80) + dHash.
- `pdf`: ilk 3 sayfa metni (≤1.500 kr), sayfa sayısı, başlık/yazar; metin yoksa `scanned: true` işareti (OCR v2).
- `docx/xlsx/pptx`: `mammoth` / SheetJS (ilk sayfa, ilk 30 satır) / pptx için zip içi `slide1.xml`.
- `txt/md/csv/json`: ilk 1.500 karakter.
- `audio/video`: `music-metadata` etiketleri; video için süre (ffprobe **yok**; `music-metadata` mp4 atomlarını okuyabiliyor, yetmezse yalnızca boyut/tarih) + thumb (`createThumbnailFromPath`).
- `archive`: `yauzl` ile ilk 50 giriş (zip); rar/7z için yalnızca ad.
- `apple-bundle`: `.pages/.numbers/.key` içindeki `preview.jpg`/`QuickLook/Thumbnail.jpg` → thumb; `Index/Document.iwa` metni çıkarılmaz (v2).
- Boyut üst sınırı (varsayılan 200 MB) üstündeki dosyalarda içerik çıkarılmaz; karma yalnızca kopya adayıysa.

### 6.3 Rules → AI → Planner

> **Revizyon 1:** "Konuya göre" biçimde akış: **birimler** (`core/organize`: derli toplu klasörler, etkinlikler, tekil dosyalar; ekran görüntüsü cihazı, ses efekti/müzik, oyun asset sinyalleri) → **anla** (AI, dosya modeli: başlık, konu, içerik türü) → **klasör mimarı** (AI, düzenleme modeli: konu öncelikli klasör ağacı) → planner (birim yerleşimleri; klasör birimi tek kalem olarak taşınır). AI'ın görmediği birimler kural yerleşimini kullanır. Aşağıdaki 1–4 adımları "Türe göre (klasik)" biçimde geçerlidir.
1. **Rules** her dosyaya `rule_category` + güven verir (ekran görüntüsü %95, kurulum dosyası %98, EXIF'li fotoğraf %95, fatura kelimesi geçen PDF %70 ...).
2. Güven ≥ eşik (varsayılan 0,85) ve "zengin analiz" kapalıysa AI'a gitmez.
3. Kalanlar partiler hâlinde (varsayılan 12 dosya/istek) sağlayıcıya; sonuç önbelleğe.
4. **Planner**: kategori → `folder_template` → hedef yol; `naming` ile ad; `dupes` ile karantina; `groupKey = hedef klasör`.

### 6.4 Applier
Bkz. `05-GUVENLIK-VE-GERI-ALMA.md`.

## 7. Dizin yapısı
`CLAUDE.md` §Repository layout bağlayıcıdır.

## 8. Hata yönetimi ve günlükleme
- `electron-log`; seviye ayarlanabilir; dosya `userData/logs/`. İçerik/alıntı/anahtar asla loglanmaz.
- Kullanıcıya gösterilen hatalar Türkçe ve eylem önerili ("Bu klasöre yazma izni yok → Ayarları aç").
- Her yakalanmamış hata `error` durumuna geçirir, yarım kalan `apply` varsa günlük tutarlılığı açılışta kontrol edilir (`pending` satırlar → kullanıcıya "yarım kalan işlem" diyaloğu: tamamla / geri al / incele).

## 9. Test stratejisi
- `tests/unit`: naming, sanitizer, rules, sensitive, dupes, planner, cost-estimator, journal/undo (temp dir).
- `tests/integration`: fixture klasöründe tam akış: scan → plan → apply → undo → ağaç başlangıçla **bire bir aynı** (hash karşılaştırmalı).
- AI sağlayıcı testleri sahte sağlayıcı (`FakeProvider`) ile; gerçek API testi yalnızca `DONDU_LIVE_AI=1` ile ve 3 dosyayla.
- CI: ubuntu'da lint+typecheck+test; etiketle macOS+Windows paketleme.
