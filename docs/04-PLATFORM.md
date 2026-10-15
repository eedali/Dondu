# 04 — Platform: macOS ve Windows

Amaç: "izin, sınırlama" sürprizi yaşamamak. Her madde için **tespit → kullanıcıya gösterim → çözüm** üçlüsü uygulanır. Platform farkları yalnızca `src/main/core/platform/` altında yaşar (`PlatformAdapter` arayüzü: `checkAccess(root)`, `isCloudPlaceholder(path)`, `moveWithMetadata(src,dst)`, `trash(path)`, `reveal(path)`, `openPrivacySettings()`).

## 1. macOS

### 1.1 Erişim izinleri (TCC)
- Döndü **sandbox dışı** bir uygulamadır (App Store değil). Masaüstü / Belgeler / İndirilenler / Harici diskler / Ağ birimleri ilk erişimde macOS'un kendi izin diyaloğunu çıkarır; kullanıcı "İzin Verme" derse `EPERM` alınır.
- **Onboarding kontrolü:** seçilen her kök için `fs.opendir` + geçici dosya oluştur-sil testi. Başarısızsa ekran: "macOS bu klasöre erişime izin vermedi" + buton **Gizlilik ayarlarını aç** → `shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles')` (Tam Disk Erişimi) veya `?Privacy_FilesAndFolders`.
- Öneri metni: "Tam Disk Erişimi vermek tek seferlik ve en sorunsuz yoldur; istemezseniz yalnızca seçtiğiniz klasörler için izin isteyeceğiz."
- Klasör seçimi her zaman `dialog.showOpenDialog` ile (kullanıcı seçimi = otomatik erişim). Yol elle yazdırılmaz.
- `Info.plist`'e `NSDesktopFolderUsageDescription`, `NSDocumentsFolderUsageDescription`, `NSDownloadsFolderUsageDescription`, `NSRemovableVolumesUsageDescription`, `NSNetworkVolumesUsageDescription` (electron-builder `mac.extendInfo`). Metinler Türkçe/İngilizce.

### 1.2 Gatekeeper / imza
- macOS derlemesi GitHub Actions'ta, **imzasız/ad-hoc**. Apple Developer hesabı ($99/yıl) alınırsa notarization eklenir (`docs/07` Faz 5+).
- Apple Silicon'da imzasız binary **hiç açılmaz**; electron-builder `identity: null` ile ad-hoc imzalar; CI'da `codesign --verify --deep --strict` ile doğrulanır.
- İlk açılışta "geliştirici doğrulanamadı / hasarlı" uyarısı: çözüm (README'de ve DMG içindeki `OKU-BENİ.txt`'de): Terminal'de `xattr -dr com.apple.quarantine /Applications/Döndü.app` **veya** uygulamaya sağ tık → Aç. Uygulama adı dosya sisteminde ASCII tutulur: `Dondu.app`, görünen ad "Döndü" (`CFBundleDisplayName`).

### 1.3 Dosya sistemi tuzakları
- **Paketler klasördür:** `.app .pages .numbers .key .photoslibrary .rtfd .bundle .framework .pkg .xcodeproj .scriptterm .band (GarageBand) .logicx .fcpbundle .musiclibrary .tvlibrary` → `kind: 'bundle'`; ek olarak `Contents/Info.plist` içeren klasörler. İçine girilmez, bütün taşınır.
- **Finder meta verisi:** etiketler/yorumlar/renk `xattr`'da. Aynı birimde `rename` korur; farklı birimde `ditto src dst` (child_process) kullanılır, `fs.copyFile` değil.
- **NFD:** macOS dosya adlarını NFD döndürür ("ş" = s + birleştirici). DB'de NFC saklanır; karşılaştırma `normalize('NFC')` sonrası. Diske yazarken NFC verilir, APFS kabul eder.
- **Büyük/küçük harf duyarsız (APFS varsayılan):** yalnızca harf büyüklüğü değişen yeniden adlandırma `a → a.tmp-dondu → A` iki adımda.
- **iCloud Drive:** `~/Library/Mobile Documents/com~apple~CloudDocs` ve "Masaüstü & Belgeler" iCloud'daysa dosyalar `.<ad>.icloud` yer tutucu olabilir → `isCloudPlaceholder`, raporda "iCloud'da, indirilmemiş — atlandı" grubu; kullanıcı isterse "önce indir" (v2). Taşıma iCloud klasörü içinde kalırsa sorun yok; dışına taşımak dosyayı iCloud'dan çıkarır → raporda uyarı rozeti.
- **Fotoğraflar kitaplığı:** `.photoslibrary` paketine asla girilmez; raporda "Fotoğraflar uygulamasının kitaplığı — dokunulmadı".
- **Dosya kilitleri:** `uchg` bayrağı (`ls -lO`) → `EPERM`; raporda "Kilitli" rozeti, atla.
- **Time Machine / `.DocumentRevisions-V100` / `.Spotlight-V100` / `.fseventsd`:** dışlanır.
- **Kaldırılabilir / ağ birimleri:** `/Volumes/*` seçilebilir ama uyarı; ağ biriminde `rename` farklı birim gibi davranabilir → kopya+doğrula yolu.
- Harici diskte macOS `.Trashes`, `._*` AppleDouble dosyaları → dışla.

### 1.4 Çöp
`shell.trashItem(path)` → Finder çöpü (geri alınabilir, kullanıcı tanıyor). Varsayılan yine de **karantina klasörü**; çöp ayarla açılır.

## 2. Windows

### 2.1 Denetimli Klasör Erişimi (Ransomware koruması)
- Açıksa Belgeler/Resimler/Masaüstü'ne yazma **sessizce** `EPERM`/`EACCES` ile reddedilir.
- Onboarding testi (yaz-sil) başarısızsa ekran: "Windows Güvenliği bu klasöre yazmayı engelliyor" + adımlar: Windows Güvenliği → Virüs ve tehdit koruması → Fidye yazılımı koruması → Uygulamanın denetimli klasör erişimi → **Döndü'ye izin ver**. Buton: `shell.openExternal('windowsdefender://threat')` (Windows Güvenliği'ni açar).

### 2.2 Uzun yollar (>260 karakter)
- Uygulama manifestine `longPathAware` (electron-builder `win.requestedExecutionLevel` ile değil; `build/win/app.manifest` + `win.extraResources`/`electron-builder` `win.additionalManifest`… basit yol: tüm `fs` çağrılarında yol 240'ı aşarsa `\\?\` ön eki).
- Kayıt defteri `LongPathsEnabled` olmadan da `\\?\` ön eki çalışır. `path.win32.normalize` sonra ön ek.

### 2.3 OneDrive "İsteğe Bağlı Dosyalar"
- Belgeler/Masaüstü OneDrive'a yönlendirilmiş olabilir (`%OneDrive%`). Yer tutucu dosyalar okununca indirilir (yavaş, kota).
- Tespit: PowerShell `(Get-Item -LiteralPath p).Attributes` içinde `Offline` / `0x400000 (RecallOnDataAccess)` / `ReparsePoint`; toplu: `attrib /s` çıktısında `O` ve `U`. → `isCloudPlaceholder`, içerik çıkarılmaz, karma hesaplanmaz, raporda uyarı.

### 2.4 Diğer tuzaklar
- **Dosya kullanımda:** `EBUSY`/`EPERM` → "başka bir uygulamada açık", atla.
- **Yasak karakterler:** `< > : " / \ | ? *`, kontrol karakterleri; **ayrılmış adlar** `CON PRN AUX NUL COM1-9 LPT1-9` (uzantı olsa bile); sondaki nokta/boşluk silinir.
- **Büyük/küçük harf duyarsız (NTFS):** iki adımlı yeniden adlandırma.
- **Junction / symlink:** `lstat` → izlenmez.
- **Gizli / sistem dosyaları:** `attrib` ile `H`/`S` → gizli; `desktop.ini`, `Thumbs.db`, `$RECYCLE.BIN`, `System Volume Information` dışlanır.
- **Kullanıcı profili dışı sürücüler:** D:\ vb. seçilebilir; `C:\Windows`, `C:\Program Files*`, `%AppData%` seçilemez.
- **SmartScreen:** imzasız `.exe` kurulumda "Daha fazla bilgi → Yine de çalıştır". README'de anlatılır. (Kod imzası sertifikası v2.)
- **Çöp:** `shell.trashItem` Geri Dönüşüm Kutusu'na gönderir.
- **Antivirüs taraması** büyük taşımaları yavaşlatabilir; uygulama ilerleme hızı düşükse ipucu gösterir.

## 3. Her iki platform

- Seçilemeyen kökler: `/`, `/System`, `/Library`, `/Applications`, `/usr`, `/private`, `~/Library`, `C:\`, `C:\Windows`, `C:\Program Files*`, `C:\Users\<x>\AppData`. Ayrıca seçili kök başka seçili kökün altındaysa birleştirilir.
- Dosya adı sanitizer (`naming/sanitize.ts`): iki OS'un kesişimi; NFC; 200 karakter; boş ad → `adsiz`; uzantı korunur; çok noktalı uzantılar (`.tar.gz`) bilinir.
- Yollar DB'de `root + rel_path (posix ayraç)`; diske yazarken `path.join`.
- Taşıma öncesi `fs.stat` ile `dev` karşılaştırması: aynı `dev` → `rename`; farklı → kopya+doğrula.
- Zaman damgaları: kopya sonrası `fs.utimes` ile mtime korunur.
- Tek örnek (`app.requestSingleInstanceLock`); uygulama verisi `app.getPath('userData')` (mac: `~/Library/Application Support/Dondu`, win: `%AppData%\Dondu`).
- Güncelleme v1'de elle (GitHub Releases); `electron-updater` v2.

## 4. Onboarding "Sistem kontrolü" ekranı
Her kök için satır: ✔ Okuma · ✔ Yazma · ✔ Bulut durumu · ✔ Birim türü. Sorunlu satırda kısa açıklama + "Nasıl düzeltirim?" bağlantısı (uygulama içi yardım sayfası, platforma göre). Kontrol **Tara**'dan önce ve **Uygula**'dan hemen önce tekrar çalışır.
