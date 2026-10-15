# 07 — Yol Haritası ve Claude Code İstemleri

Her faz, Claude Code'a (Claude masaüstü uygulaması → **Code** sekmesi → `D:\Work\Code\Dondu` klasörü) yapıştırılacak **tek bir istem** olarak tasarlandı. Faz bitince `STATUS.md` güncellenir, commit atılır; bir sonraki oturumda Claude Code `STATUS.md`'den devam eder.

Önerilen çalışma biçimi:
- Her fazı yeni bir oturumda başlat (bağlam temiz kalır).
- İzin modu: "Edits otomatik, komutlar sorsun" (ya da güvendiysen auto). `.claude/settings.json` npm/git komutlarını zaten izinli yapıyor, `git push` sorar.
- Faz bittiğinde `npm run dev` ile kendin de bak; beğenmediğin şeyi aynı oturumda düzelttir.
- "Kabul ölçütleri" karşılanmadan sonraki faza geçme.

---

## Faz 0 — İskelet (yarım gün)

**Hedef:** Boş ama çalışan uygulama, test/lint/CI altyapısı.

**Kabul ölçütleri:** `npm run dev` Türkçe başlıklı boş pencere açar; `npm run build` ve `npm run package` çalışır (`dist/` üretir); `npm test` en az 1 test geçer; `npm run lint` temiz; `.github/workflows/build.yml` yeşil (ubuntu ci işi).

**İstem:**
```
CLAUDE.md ve STATUS.md'yi oku, sonra docs/02-MIMARI.md'yi oku. Faz 0'ı uygula:

1. electron-vite (React + TypeScript şablonu) ile projeyi bu klasörde kur. Tailwind CSS, Zustand, react-i18next, zod, vitest, eslint + prettier ekle. TypeScript strict açık.
2. CLAUDE.md'deki dizin yapısını (src/main, src/preload, src/renderer, src/shared, tests, scripts) boş ama anlamlı dosyalarla oluştur (her klasörde kısa bir README veya index.ts).
3. package.json scriptleri tam olarak CLAUDE.md'deki adlarla: dev, build, package, test, test:watch, lint, typecheck, format, fixtures (fixtures şimdilik "not implemented" basabilir).
4. electron-builder yapılandırması: appId com.dondu.app, productName "Döndü", executableName/dosya adı "Dondu", mac: dmg (arm64 + x64), identity null, extendInfo ile NS*UsageDescription anahtarları (docs/04 §1.1); win: nsis x64. Çıktı dist/.
5. Pencere: contextIsolation true, nodeIntegration false, sandbox true; preload window.dondu.ping() örneği ile IPC tip zincirini (shared/ipc.ts) kur.
6. Renderer: tema değişkenleri (light/dark, CSS variables), i18n (tr.json kaynak, en.json ayna) ve "Döndü" başlıklı, docs/08-TASARIM.md'ye uygun boş bir yerleşim (sol gezinti: Klasörler, Tarama, Rapor, Geçmiş, Ayarlar).
7. vitest ile src/shared için 1 örnek test; eslint/prettier yapılandırması; .editorconfig.
8. Mevcut .github/workflows/build.yml'yi script adlarına göre doğrula/gerekirse düzelt.
9. npm run typecheck && npm run lint && npm test && npm run build çalıştır, hepsi geçsin. STATUS.md'yi güncelle, "chore: scaffold electron-vite app" commit'i at.

Dependency eklerken CLAUDE.md'deki yığından sapma; better-sqlite3'ü bu fazda ekleme (Faz 1).
```

---

## Faz 1 — Tarayıcı, çıkarıcılar, veritabanı (1–2 gün)

**Hedef:** Seçili klasörleri tarayıp envanteri SQLite'a yazan, ilerleme gösteren, hiçbir şeye dokunmayan tarama.

**Kabul ölçütleri:** `npm run fixtures` ~80 dosyalık dağınık bir temp klasör üretir (görsel, pdf, docx, xlsx, txt, zip, "proje" klasörü, sahte `.pages` paketi, 0 baytlık dosya, kopya çiftler, hassas adlı dosya); uygulamada bu klasör seçilip taranınca DB'de doğru `kind`, boyut, karma, thumb ve metin alıntısı oluşur; paketlerin içine girilmez; iptal çalışır; UI donmaz. `tests/integration/scan.test.ts` geçer.

**İstem:**
```
CLAUDE.md, STATUS.md, docs/02-MIMARI.md (§3, §5, §6.1, §6.2) ve docs/04-PLATFORM.md'yi oku. Faz 1'i uygula:

1. better-sqlite3 + migrasyon altyapısı (src/main/db). Şema docs/02 §3. Repository arayüzü (FileRepo, SessionRepo, ...) öyle yazılsın ki arka uç sql.js ile değiştirilebilsin. Native modül kurulumu için package.json'a "postinstall": "electron-builder install-app-deps" ekle; derleme başarısız olursa bana söyle, sql.js'e geçelim.
2. scripts/make-fixtures.ts: OS temp altında dağınık bir klasör üretir (bkz. kabul ölçütleri). PDF için pdf-lib, docx için "docx" paketi, görseller için küçük gömülü PNG/JPEG buffer'ları; EXIF gerekmez. Dosya mtime'larını farklı yıllara dağıt. Yolu stdout'a bas.
3. Scanner (src/main/core/scanner): opendir + lstat, dışlama listesi (docs/04 §3 ve docs/06 scan.excludeGlobs), paket/proje algılama, bulut yer tutucu işareti, NFC normalize, 500'lük partilerle DB'ye yazım, iptal (AbortSignal), ilerleme olayı.
4. Hash (hash-wasm): xxh3 fast (baş+son 64KB + boyut), blake3 full (tembel). worker_threads havuzu (piscina ya da kendi basit havuzun).
5. Extractors: image (exifr + nativeImage.createThumbnailFromPath + dHash), pdf (pdf-parse), docx (mammoth), xlsx (SheetJS ilk 30 satır), txt/md/csv/json, audio (music-metadata), zip (yauzl ilk 50 giriş), apple-bundle preview. Boyut sınırı ayarına uy. Hassas dosyada thumb/alıntı üretme (şimdilik sensitive=false, Faz 2'de dolacak; ama arayüzü hazırla).
6. Platform adaptörü iskeleti (src/main/core/platform): checkAccess(root) yaz-sil testi, isCloudPlaceholder, reveal, openPrivacySettings.
7. UI: Klasörler ekranı (klasör ekle/çıkar, sistem klasörü reddi, erişim kontrolü satırları), Tarama ekranı (ilerleme, bulunan/analiz edilen, iptal). Tarama sonunda basit envanter özeti (türe göre sayılar).
8. tests/integration/scan.test.ts: fixture üret → tara → DB'de beklenen kayıtları doğrula (paket içine girilmedi, kopyaların hash_full'ı eşit, thumb var).
9. typecheck/lint/test geç, STATUS.md güncelle, commit.
```

---

## Faz 2 — Kurallar, kopyalar, hassas, plan, rapor, uygula, geri al (AI'sız MVP) (2–3 gün)

**Hedef:** Yapay zekâ olmadan uçtan uca çalışan, güvenli ürün.

**Kabul ölçütleri:** Fixture klasörü için makul bir plan çıkar; rapor düzenlenebilir; onay olmadan "Uygula" yok; uygulama sonrası ağaç beklendiği gibi; **Geri al** ile ağaç bire bir eski hâline döner (round-trip testi geçer); kesinti simülasyonu testi geçer.

**İstem:**
```
CLAUDE.md, STATUS.md, docs/01 §4, docs/05-GUVENLIK-VE-GERI-ALMA.md (tamamı), docs/06-AYARLAR.md ve docs/03 §6 (hassas tespit) oku. Faz 2'yi uygula:

1. Settings: zod şeması + load/save (docs/06 varsayılanları), kategori taksonomisi DB'de (seed).
2. Rules (src/main/core/rules): uzantı → kategori tablosu; ekran görüntüsü algılama (ad kalıpları TR/EN/FI/DE + boyut); EXIF'li görsel → photos; kurulum/arşiv; "fatura/lasku/invoice" vb. anahtar kelimeler → docs_invoice; güven değerleri. Sensitive detector docs/03 §6 (TC kimlik kontrol basamağı, IBAN mod-97, Luhn, HETU) + testler.
3. Dupes: boyut → fast hash → full hash gruplama; dHash ile yakın kopya; keepPolicy; HEIC/JPG kardeş.
4. Naming: sanitize (iki OS kesişimi, ayrılmış adlar, NFC, 200 kr), çakışma eki, iki adımlı harf büyüklüğü yeniden adlandırma, şablon motoru ({Yıl},{Ay},{Kategori},{Kök},{date},{title},{orig}).
5. Planner: envanter + ayarlar + taksonomi → Plan (deterministik; groupKey = hedef klasör; düşük güven → uncertain/atla; hassas → ayrı grup; junk varsayılan atla).
6. Rapor UI: hedef klasöre göre gruplu liste, satırda thumb/simge, eski ad → yeni yol, kategori, gerekçe, güven rozeti; satır/grup düzenleme (hedef değiştir, ad düzelt, atla, hassas işaretle); filtreler; özet başlığı; "Gözden geçir" sekmesi; HTML/MD/JSON dışa aktarma. Onay akışı: özet → onay butonu → ikinci onay (sayılar) → plan 'approved'.
7. Applier: pre-flight (docs/05 §3), write-ahead journal, aynı birim rename / farklı birim copy+verify+remove_source(karantina), mkdir takibi, ilerleme, duraklat/iptal, hata politikası. macOS'ta farklı birim kopyası için ditto (platform adaptörü). Açılış toparlaması (pending satırlar).
8. Undo: run ve öğe bazında (docs/05 §5). Geçmiş ekranı: çalıştırmalar, istatistik, geri al butonu.
9. Testler: tests/integration/roundtrip.test.ts (hash haritası bire bir), fault-injection, çakışma, değişen kaynak, kök dışı red, harf büyüklüğü, NFC. Unit: rules, sensitive, dupes, naming, planner.
10. typecheck/lint/test geç; npm run dev ile fixture üzerinde tam akışı dene; STATUS.md güncelle; commit.
```

---

## Faz 3 — Yapay zekâ (1–2 gün)

**Hedef:** Anthropic Haiku 5.5 ve LM Studio sağlayıcıları, maliyet tahmini, önbellek, hassas-yerel kuralı.

**Kabul ölçütleri:** Ayarlar'da sağlayıcı seçilip "Bağlantıyı sına" geçer; plan öncesi tahmin ekranı doğru sayılar gösterir; `FakeProvider` ile testler geçer; `DONDU_LIVE_AI=1` ile 3 dosyalık gerçek çağrı JSON şemaya uygun döner; hassas dosya buluta gitmez (test).

**İstem:**
```
CLAUDE.md, STATUS.md, docs/03-YAPAY-ZEKA.md (tamamı) ve docs/prompts/ altındaki dosyaları oku. Faz 3'ü uygula:

1. AIProvider arayüzü, BatchRunner (partileme, eşzamanlılık, geri çekilme, iptal, ilerleme, önbellek), FakeProvider.
2. AnthropicProvider (@anthropic-ai/sdk): model claude-haiku-5-5; temperature/top_p/top_k YOK; effort "low"; sistem istemi cache_control ile; tool-use ile zorunlu JSON (docs/prompts/classify-schema.json); görsel bloklar; usage okuma; 429/529 geri çekilme; Batch API seçeneği (ayar). Anahtar safeStorage ile.
3. LMStudioProvider (fetch): /models listesi, /chat/completions + json_schema response_format, vision anahtarı, zaman aşımı, anlaşılır hata mesajları.
4. Cost estimator (docs/03 §7 formülü) + "ai:estimate" IPC + plan öncesi tahmin ekranı (dosya sayısı, token, $; limit aşımında başlatmama).
5. Girdi hazırlayıcı (docs/03 §5): meta özeti, alıntı kırpma, thumb base64; hassas dosyaları bulut sağlayıcıya göndermeyen sert kapı (unit test).
6. Planner'a AI sonuçlarını entegre et (rule vs ai güven birleştirme; source alanı). Düzeltmelerden öğrenme: corrections tablosu + istemde son 20 örnek.
7. Ayarlar → Yapay zekâ bölümü UI (sağlayıcı, anahtar, model, mod, limitler, test butonu). Geçmişte gerçek token/$ gösterimi.
8. Testler + typecheck/lint; STATUS.md; commit.
```

---

## Faz 4 — Ayarlar, onboarding, cila (1–2 gün)

**İstem:**
```
CLAUDE.md, STATUS.md, docs/06-AYARLAR.md, docs/08-TASARIM.md ve docs/04 §4'ü oku. Faz 4'ü uygula:

1. Ayarlar ekranı: Basit/Gelişmiş; tüm docs/06 anahtarları; kategori düzenleyici (ekle/sil/şablon); dışlama listesi; sıfırla.
2. Onboarding (ilk açılış): dil → sağlayıcı seçimi (Yok / Anthropic / LM Studio) → klasör seç → sistem kontrolü (docs/04 §4) → "Nasıl düzeltirim?" yardım sayfaları (macOS TCC, Gatekeeper; Windows Denetimli Klasör Erişimi, SmartScreen).
3. Boş durumlar, hata durumları, klavye gezinimi, dark mode gözden geçirme, Türkçe metin tutarlılığı (tr.json tam, en.json ayna).
4. Karantina hatırlatması, önbellek temizleme, log görüntüleme/Finder'da göster.
5. Performans: 20k dosyalık sentetik fixture ile tarama süresi ölçümü; gerekirse parti/worker ayarı.
6. Testler, STATUS.md, commit.
```

---

## Faz 5 — Paketleme ve Mac'te gerçek test (1 gün + gerçek kullanım)

**İstem:**
```
CLAUDE.md, STATUS.md ve docs/04-PLATFORM.md §1.2, §2.4 oku. Faz 5'i uygula:

1. electron-builder ayarlarını son hâline getir (icon'lar: build/icon.icns, build/icon.ico — basit, docs/08'deki logo fikri; "OKU-BENİ.txt" DMG içine, Gatekeeper talimatı ile).
2. CI: etiketle (v0.1.0) macOS + Windows paketleri Release'e yüklensin; CSC_IDENTITY_AUTO_DISCOVERY=false; codesign --verify adımı.
3. README'ye kurulum bölümü (Mac: DMG + xattr komutu; Windows: SmartScreen).
4. Sürüm: package.json 0.1.0, CHANGELOG.md başlat. Commit, etiket oluşturma komutunu bana ver (ben çalıştırırım).
```

Sonra: GitHub Release'ten DMG indir → eşin Mac'ine kur → `xattr -dr com.apple.quarantine /Applications/Dondu.app` → önce **küçük bir test klasöründe** (Masaüstü'ndeki 20 dosya) tam akış + geri alma → sonra gerçek kullanım. Bulduğun hataları Claude Code'a "Faz 5 düzeltmeleri" diye ver.

---

## Faz 6 — Sonrası (isteğe bağlı)

- İndirilenler için "Gelen kutusu" izleme modu (chokidar) — yine onaylı plan ile.
- Zamanlanmış tarama hatırlatması.
- OCR (tesseract.js) taranmış PDF/görsel belgeler için.
- Pages/Numbers içerik çıkarma (iwa).
- electron-updater ile güncelleme; Apple notarization + Windows kod imzası.
- Fince arayüz (`fi.json`).
- Video yakın-kopya (kare karması).
- "Neden burada?" — her dosya için AI gerekçesini genişletme.

## Zaman/Claude Code bütçesi notu

Fazlar küçük tutuldu çünkü uzun oturumlarda bağlam dolar ve kalite düşer. Her faz 2–5 oturumda biter. Oturum başına tek faz; faz içinde "önce X'i bitir, test et, commit at, sonra Y" diye yönlendirmek maliyeti düşürür.
