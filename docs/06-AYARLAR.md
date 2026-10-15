# 06 — Ayarlar Kataloğu

Zod şeması `src/main/settings/schema.ts` bu dokümandan üretilir; varsayılanlar burada yazılı. UI'da "Basit" (ilk 3 bölüm) ve "Gelişmiş" (tümü) görünümü.

## 1. Genel
| Anahtar | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `language` | `'tr'\|'en'\|'fi'` | sistem dili (tr/en) | Arayüz dili |
| `theme` | `'system'\|'light'\|'dark'` | `system` | |
| `roots` | `string[]` | `[]` | Son seçilen kökler (hatırlanır) |
| `targetMode` | `'inPlace'\|'singleTarget'` | `inPlace` | Her kökün içinde düzenle / hepsini tek hedefe taşı |
| `targetRoot` | `string?` | — | `singleTarget` için hedef |
| `quarantineFolderName` | string | `Döndü Karantina` | Kök altında |
| `useOsTrashInsteadOfQuarantine` | bool | `false` | Kopya/kaynak temizliğinde OS çöpü |
| `removeEmptyFoldersCreatedByDondu` | bool | `true` | |
| `quarantineEmptySourceFolders` | bool | `false` | Kullanıcının boş kalan klasörlerini karantinaya al |

## 2. Tarama
| Anahtar | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `scan.includeHidden` | bool | `false` | Nokta dosyaları / gizli öznitelik |
| `scan.maxDepth` | int | `12` | |
| `scan.maxFileSizeForContentMB` | int | `200` | Üstünde içerik çıkarma yok |
| `scan.maxTextExcerptChars` | int | `1500` | |
| `scan.excludeGlobs` | `string[]` | sistem listesi + `**/node_modules/**`, `**/.git/**` | Kullanıcı ekleyebilir |
| `scan.treatProjectFoldersAsUnit` | bool | `true` | `.git`, `package.json` vb. içeren klasörler bütün |
| `scan.followBundles` | bool | `false` | Her zaman false; UI'da gösterilmez (güvenlik) |
| `scan.fileTypes` | nesne | hepsi açık | Türe göre aç/kapat: görsel, belge, tablo, sunum, metin, ses, video, arşiv, kurulum, kod, tasarım, kitap, diğer |
| `scan.minFileSizeKB` | int | `0` | Altındakiler "Çöp adayı" grubuna |
| `scan.hashWorkers` | int | `max(2, cpu-1)` | |

## 3. Fotoğraf & görsel analizi
| Anahtar | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `images.analyzeWithAI` | bool | `true` | Küçük görsel AI'a gider |
| `images.thumbnailMaxEdge` | `512\|768\|1024` | `768` | Token/maliyet ayarı |
| `images.groupBy` | `'year'\|'yearMonth'\|'event'` | `yearMonth` | `event`: 3 saatten uzun boşluklarda yeni etkinlik |
| `images.detectScreenshots` | bool | `true` | Ad kalıbı + boyut |
| `images.screenshotTarget` | string | `Ekran Görüntüleri/{Yıl}` | |
| `images.nearDuplicateThreshold` | int (hamming) | `8` | dHash |
| `images.keepHeicJpgSiblingsTogether` | bool | `true` | |
| `images.useExifDateForFolder` | bool | `true` | EXIF yoksa mtime |

## 4. Kopyalar
| Anahtar | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `dupes.enabled` | bool | `true` | |
| `dupes.keepPolicy` | `'preferredFolder'\|'oldest'\|'newest'\|'shortestPath'` | `preferredFolder` | |
| `dupes.preferredFolderOrder` | `string[]` | `[Belgeler, Fotoğraflar, Masaüstü, İndirilenler]` | |
| `dupes.action` | `'quarantine'\|'trash'\|'reportOnly'` | `quarantine` | |
| `dupes.minSizeKB` | int | `1` | |
| `dupes.includeNearDuplicateImages` | bool | `true` | Raporda ayrı grup; varsayılan **atla** |

## 5. Hassas dosyalar
| Anahtar | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `sensitive.enabled` | bool | `true` | Kapatılamaz; yalnızca kalıplar düzenlenir |
| `sensitive.neverSendToCloud` | bool | `true` | **Kilitli** (UI'da gri) |
| `sensitive.extraNamePatterns` | `string[]` | `[]` | |
| `sensitive.extraExtensions` | `string[]` | `[]` | |
| `sensitive.contentScan` | bool | `true` | TC/IBAN/kart/HETU regex |
| `sensitive.targetCategory` | string | `Belgeler/Kişisel & Kimlik` | |
| `sensitive.skipByDefault` | bool | `false` | true ise hassaslar planda "atla" |

## 6. Yeniden adlandırma
| Anahtar | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `rename.enabled` | bool | `false` | |
| `rename.template` | string | `{date}_{title}` | `{date}=YYYY-MM-DD`, `{title}` AI/belge başlığı (≤60 kr), `{orig}` |
| `rename.minConfidence` | number | `0.9` | |
| `rename.onlyGenericNames` | bool | `true` | Yalnızca `IMG_1234`, `Belge (3)`, `Untitled`, `Ekran Resmi…` gibi adlar |
| `rename.photos` | bool | `false` | Fotoğraf adlarına dokunma (varsayılan) |

## 7. Yapay zekâ
| Anahtar | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `ai.provider` | `'anthropic'\|'lmstudio'\|'none'` | `none` (onboarding'de seçtirilir) | |
| `ai.anthropic.model` | string | `claude-haiku-5-5` | |
| `ai.anthropic.apiKey` | gizli | — | `safeStorage` |
| `ai.anthropic.useBatchApi` | bool | `false` | %50 indirim, asenkron |
| `ai.anthropic.effort` | `'low'\|'medium'` | `low` | |
| `ai.lmstudio.baseUrl` | string | `http://localhost:1234/v1` | |
| `ai.lmstudio.model` | string | — | Listeden |
| `ai.lmstudio.vision` | bool | `false` | |
| `ai.mode` | `'uncertainOnly'\|'all'\|'metadataOnly'` | `uncertainOnly` | |
| `ai.ruleConfidenceThreshold` | number | `0.85` | Altındakiler AI'a |
| `ai.batchSize` | int | `12` | |
| `ai.maxUsdPerRun` | number | `1.00` | Tahmin aşarsa başlamaz |
| `ai.maxTokensPerRun` | int | `2_000_000` | |
| `ai.cacheEnabled` | bool | `true` | |
| `ai.learnFromCorrections` | bool | `true` | |

## 8. Rapor & uygulama
| Anahtar | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `report.lowConfidenceThreshold` | number | `0.6` | Altı "Gözden geçir" (varsayılan atla) |
| `report.exportIncludesExcerpts` | bool | `false` | |
| `apply.concurrency` | int | `1` | Sıralı; SSD'de 2 |
| `apply.verifyHashAfterCopy` | bool | `true` | Kapatılamaz farklı birimde |
| `apply.pauseOnFirstError` | bool | `true` | |
| `apply.doubleConfirmAbove` | int | `500` | Bu kadar öğeden fazlasında ikinci onay |

## 9. Geçmiş & veri
| Anahtar | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `history.keepRunsDays` | int | `365` | Günlük saklama |
| `history.quarantineReminderDays` | int | `30` | |
| `cache.thumbnails` | bool | `true` | |
| `logs.level` | `'error'\|'info'\|'debug'` | `info` | |

## 10. Kategoriler (varsayılan taksonomi — düzenlenebilir)

| id | Ad (TR) | Klasör şablonu | AI açıklaması / örnekler |
|---|---|---|---|
| `photos` | Fotoğraflar | `Fotoğraflar/{Yıl}/{Ay}` | Kamera/telefon fotoğrafı, EXIF'li |
| `screenshots` | Ekran Görüntüleri | `Ekran Görüntüleri/{Yıl}` | Ekran görüntüsü, ekran kaydı |
| `images_other` | Görseller | `Görseller` | İndirilen görsel, meme, logo, çizim |
| `docs_invoice` | Belgeler / Fatura & Makbuz | `Belgeler/Fatura ve Makbuz/{Yıl}` | fatura, fiş, makbuz, lasku, kuitti, invoice, receipt |
| `docs_contract` | Belgeler / Sözleşme | `Belgeler/Sözleşmeler` | kira, abonelik, sigorta poliçesi |
| `docs_official` | Belgeler / Resmi & Vergi | `Belgeler/Resmi/{Yıl}` | vergi, e-devlet, Kela, verohallinto, belediye |
| `docs_health` | Belgeler / Sağlık | `Belgeler/Sağlık` | rapor, reçete, tahlil |
| `docs_education` | Belgeler / Eğitim | `Belgeler/Eğitim` | ders notu, ödev, sertifika, diploma |
| `docs_work` | Belgeler / İş | `Belgeler/İş/{Yıl}` | sunum, rapor, CV, teklif |
| `docs_finance` | Belgeler / Banka & Finans | `Belgeler/Finans/{Yıl}` | ekstre, dekont, tiliote |
| `docs_personal_id` | Belgeler / Kişisel & Kimlik | `Belgeler/Kişisel` | kimlik, pasaport, ehliyet (hassas) |
| `docs_manual` | Belgeler / Kılavuz | `Belgeler/Kılavuzlar` | kullanım kılavuzu, garanti |
| `docs_other` | Belgeler / Diğer | `Belgeler/Diğer` | |
| `spreadsheets` | Tablolar | `Belgeler/Tablolar` | xlsx/numbers/csv (içerik belgeyse belge kategorisi öncelikli) |
| `presentations` | Sunumlar | `Belgeler/Sunumlar` | |
| `books` | Kitaplar & Makaleler | `Kitaplar` | epub, kitap PDF'i, makale |
| `videos` | Videolar | `Videolar/{Yıl}` | |
| `audio` | Müzik & Ses | `Müzik ve Ses` | mp3, m4a, sesli not |
| `design` | Tasarım & Kaynak | `Tasarım` | psd, ai, sketch, fig, font |
| `installers` | Yazılım & Kurulum | `Yazılım` | dmg, pkg, exe, msi, app |
| `archives` | Arşivler | `Arşivler` | zip, rar, 7z (içerik belliyse o kategori) |
| `code` | Kod & Projeler | `Projeler` | proje klasörleri, betikler |
| `junk` | Çöp adayları | `Döndü Karantina/Çöp adayları` | 0 bayt, .tmp, .part, .crdownload, eski kilit dosyaları — varsayılan **atla** |
| `uncertain` | Belirsiz | `Gözden Geçir` | güven düşük — varsayılan **atla** |

Kategori ekleme/silme/yeniden adlandırma UI'dan; şablonda `{Yıl} {Ay} {Kategori} {Kök}` değişkenleri. Taksonomi karması AI önbellek anahtarına girer.
