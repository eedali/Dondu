# 01 — Ürün Gereksinimleri (PRD)

## 1. Amaç

Döndü, dağınık bir bilgisayardaki dosyaları **kullanıcının seçtiği klasörler içinde** anlayıp düzenleyen bir masaüstü uygulamasıdır. Her dosyaya bakar, ne olduğunu çıkarır, nereye gitmesi gerektiğini önerir; bu öneriyi **düzenlenebilir bir rapor** olarak sunar ve **yalnızca onaydan sonra** uygular. Yapılan her işlem kayıt altındadır ve **geri alınabilir**.

Adı "Döndü": hem "dosyalar yerine döndü" hem de "yanlış olursa geri döndürülür".

## 2. Kullanıcılar

| Kullanıcı | Cihaz | Teknik seviye | Beklenti |
|---|---|---|---|
| Eş (birincil) | MacBook (muhtemelen Apple Silicon, iCloud Drive açık olabilir) | Düşük | Tek tıkla tarasın, anlaşılır Türkçe rapor versin, yanlış bir şey yapmasın, geri alınabilsin |
| Geliştirici | Windows PC | Yüksek | Aynı uygulama Windows'ta da çalışsın; ayarlar zengin olsun |

## 3. Temel akış (kullanıcı gözüyle)

1. **Klasör seç** — Masaüstü, İndirilenler, Belgeler gibi klasörleri ekle (çoklu). Sistem klasörleri seçilemez.
2. **Tara** — İlerleme çubuğu; kaç dosya bulundu, kaçı analiz edildi. Dosya sistemine dokunulmaz.
3. **Rapor** — "Şunları şöyle düzenleyeceğim" listesi. Hedef klasöre göre gruplanmış; her satırda: küçük görsel/simge, eski ad → yeni yol, kategori, kısa gerekçe, güven derecesi. Kullanıcı:
   - bir dosyayı atlayabilir (dokunma),
   - hedef klasörünü değiştirebilir,
   - adını düzeltebilir,
   - bir grubun tamamını başka yere yönlendirebilir,
   - "hassas" işaretleyebilir/kaldırabilir.
4. **Onayla** — Özet ("124 dosya taşınacak, 9 kopya karantinaya alınacak, 3 dosya hassas olduğu için atlanacak") + açık onay butonu. Onay olmadan hiçbir şey olmaz.
5. **Uygula** — İlerleme; hata olursa durur, nedenini söyler, kalanı sorar.
6. **Geçmiş / Geri al** — Her çalıştırma listelenir; tamamı veya tek bir dosya geri alınabilir.

## 4. İşlevsel gereksinimler

### 4.1 Tarama ve anlama
- Seçili köklerin altını yinelemeli tarar; sembolik bağlantıları izlemez; macOS paketlerini (`.app`, `.pages`, `.numbers`, `.key`, `.photoslibrary`, `.rtfd`, `.bundle`, `.framework`) **tek dosya** sayar, içine girmez.
- Her kayıt için: ad, uzantı, boyut, oluşturma/değiştirme tarihi, MIME (magic bytes), gizli mi, bulut yer tutucu mu (iCloud `.icloud`, OneDrive çevrimdışı).
- İçerik: görseller için küçük önizleme (en uzun kenar 768 px) ve EXIF (tarih, kamera, GPS var/yok, boyutlar); belgeler için ilk ~1.500 karakter metin + sayfa sayısı + yazar; ses/video için süre ve etiketler; arşivler için içindekiler listesi (ilk 50 giriş); klasörler için içindeki uzantı dağılımı.
- Hızlı karma (xxh3, baş+son 64 KB) → aynı boyut/karma adaylarında tam karma (BLAKE3). Görsellerde algısal karma (dHash) ile yakın kopya.
- Hassas dosya tespiti (uzantı, ad kalıbı, içerik regex'i — TC kimlik no, IBAN, kart no, Fin HETU, "parola/şifre/password/salasana").
- Kural motoru (uzantı, ad kalıbı, EXIF, ekran görüntüsü kalıpları) önce çalışır; yapay zekâ **yalnızca** kuralların emin olamadığı veya "zengin analiz" ayarının açık olduğu dosyalar için devreye girer.

### 4.2 Planlama

> **Revizyon 1 (Ekim 2026):** Klasörler artık **konuya göre** kurulur (Düğün, Oyun Geliştirme, Python Kursu…); bir konu klasöründe fotoğraf, video ve PDF birlikte durabilir. Türe göre klasörler ("Görseller", "Videolar") yalnızca "Türe göre (klasik)" biçiminde ya da yapay zekâ yokken kullanılır. Derli toplu mevcut klasörler (ses paketi, asset paketi, kurs) hiçbir zaman bölünmez; aynı zaman aralığındaki fotoğraf/videolar bir **etkinlik** olarak birlikte taşınır; ekran görüntüleri telefon/bilgisayar diye ayrılır; ses efektleri müzikle karışmaz. Ayrıntı: `03-YAPAY-ZEKA.md` §11.
- Varsayılan taksonomi (bkz. `06-AYARLAR.md` §Kategoriler) düzenlenebilir; yapay zekâ **kapalı listeden** kategori seçer (serbest metin klasör adı üretmez → tutarlı klasörler).
- Hedef şeması şablonla: `{Kök}/Belgeler/{Kategori}/{Yıl}`, `{Kök}/Fotoğraflar/{Yıl}/{Ay}` vb. Kullanıcı şablonu değiştirebilir.
- Hedef modu: (a) her kökün kendi içinde düzenle (varsayılan), (b) hepsini tek bir hedef köke taşı.
- Yeniden adlandırma varsayılan **kapalı**; açılırsa `{tarih}_{kısa-başlık}.{uz}` şablonu, güven eşiği altında ad değişmez.
- Kopyalar: "tutulan" seçimi politikaya göre (tercih edilen klasör sırası > en eski değiştirme tarihi); diğerleri `Döndü Karantina/<çalıştırma>/` altına. Hiçbir şey silinmez.
- Düşük güvenli öneriler ayrı "Gözden geçir" sekmesinde; varsayılan olarak **atla** işaretli.
- Plan deterministik ve tekrar üretilebilir (aynı girdi + aynı ayar → aynı plan); JSON olarak dışa aktarılabilir.

### 4.3 Rapor ve onay
- Rapor uygulama içinde; HTML/Markdown olarak dışa aktarılabilir.
- Filtre: kategori, güven, hassas, kopya, uzantı, boyut.
- Toplu düzenleme (grup hedefini değiştir, grup içinde tümünü atla).
- Onay butonu rapor açılıp özet görülmeden etkin olmaz; onayda sayılar bir kez daha gösterilir.
- Plan onaylandıktan sonra düzenlenemez; düzenlemek için kopyası oluşturulur (yeni taslak).

### 4.4 Uygulama
- Ön kontrol: kaynak hâlâ var mı ve boyut+mtime aynı mı; hedef dizin yazılabilir mi; disk alanı (farklı birimse); dosya kilitli mi.
- Her işlem günlüğe önce yazılır (write-ahead), sonra yapılır, sonra "tamam/hata" güncellenir.
- Aynı birimde `rename`; farklı birimde kopya → BLAKE3 doğrulama → kaynağı karantinaya/çöpe (asla doğrudan silme).
- Çakışmada ` (2)`, ` (3)` eki. Asla üzerine yazma.
- Duraklat/iptal; iptalde o ana kadar yapılanlar geçerli ve geri alınabilir.
- Boş kalan klasörler **yalnızca Döndü'nün o çalıştırmada oluşturduğu** klasörlerse kaldırılır; kullanıcının klasörlerine dokunulmaz (ayarla açılabilir: "boş kalan kaynak klasörleri karantinaya taşı").

### 4.5 Geri alma
- Çalıştırma bazında veya dosya bazında.
- Ters sırada; kaynak konum doluysa ` (geri alındı)` eki ile.
- Dosya o arada değiştiyse (boyut+mtime farklı) sorar: yine de geri al / atla.
- Geri alma da günlüğe yazılır (geri almanın geri alınması = yeniden uygulama).

### 4.6 Yapay zekâ
- Sağlayıcılar: **Anthropic Claude Haiku 5.5** (API anahtarı ile), **LM Studio** (yerel, OpenAI uyumlu), **Yok** (yalnızca kurallar).
- Her çalıştırmadan önce tahmini token/maliyet gösterilir; kullanıcı belirlediği üst sınırı aşan iş başlatılmaz.
- Sonuçlar içerik karması + istem sürümü ile önbelleklenir; ikinci tarama ücretsizdir.
- Hassas dosyalar buluta gitmez (ayar kapatılamaz; LM Studio ile yerel analiz serbest).
- "Yalnızca meta veri gönder" modu: içerik ve görsel göndermeden ad/uzantı/boyut/tarih ile sınıflandırma.

### 4.7 Ayarlar
Bkz. `06-AYARLAR.md`. Özet: taranan türler, boyut sınırları, dışlama listesi, görsel analizi aç/kapat ve çözünürlük, kopya politikası, hassas kalıpları, hedef şablonları, yeniden adlandırma, yapay zekâ sağlayıcı/anahtar/model/limit, dil, tema, günlük saklama süresi.

## 5. İşlevsel olmayan gereksinimler

- **Güvenlik:** Bölüm 4.4–4.5 kuralları mutlak. Veri kaybı senaryosu yok.
- **Gizlilik:** Buluta giden veri: dosya adı, meta veri, ≤1.500 karakter alıntı, küçük önizleme. Tam dosya asla gönderilmez. LM Studio modunda hiçbir şey makineyi terk etmez.
- **Performans:** 20.000 dosya / 50 GB'lık bir kök, orta sınıf bir laptopta 10 dakikanın altında taranmalı (karma ve metin çıkarma `worker_threads`'te). UI donmamalı.
- **Dayanıklılık:** Uygulama tarama/uygulama sırasında kapanırsa, açılışta yarım kalan çalıştırma algılanır ve günlükten toparlanır.
- **Platform:** macOS 13+ (Apple Silicon ve Intel), Windows 10/11 (x64). İzin/erişim sorunları onboarding'de önceden kontrol edilir ve kullanıcıya adım adım gösterilir (bkz. `04-PLATFORM.md`).
- **Dil:** Türkçe birincil, İngilizce ikincil; Fince için altyapı hazır (yalnızca `fi.json` eklenir).
- **Erişilebilirlik:** Klavye ile tüm akış; kontrast AA; sistem yazı tipi.

## 6. Kapsam dışı (v1)

- Bulut servislerini (Google Drive, Dropbox) API üzerinden düzenlemek — yalnızca yerel disk/eşitleme klasörü.
- Dosya içeriğini değiştirmek (sıkıştırma, format dönüştürme, OCR'lı PDF yazma).
- Çoklu kullanıcı / senkronizasyon.
- Otomatik (onaysız) düzenleme, arka planda sürekli izleme — v2 adayı.

## 7. Başarı ölçütleri

- Eşin Masaüstü + İndirilenler klasörü tek seferde taranıp, raporda en fazla %10 düzeltmeyle onaylanıp uygulanabiliyor.
- Hiçbir çalıştırmada dosya kaybı yok; geri alma %100 çalışıyor (fixture testleriyle kanıtlı).
- 50 dosyalık karışık bir masaüstü için Haiku 5.5 maliyeti 1 sentin altında (bkz. `03-YAPAY-ZEKA.md` §Maliyet).

## 8. Gözden kaçabilecek noktalar (bilinçli olarak kapsama alındı)

- macOS'ta `.pages`/`.numbers`/`.app` aslında klasördür → paket algılama şart.
- iCloud "Masaüstü ve Belgeler" senkronu açıksa dosyalar yer tutucu olabilir; dokunursan indirmeye başlar → atla ve uyar.
- Windows'ta Denetimli Klasör Erişimi (fidye yazılımı koruması) yazmayı sessizce engeller → onboarding testi.
- Finder etiketleri/yorumları (xattr) farklı birime kopyada kaybolur → macOS'ta `ditto` kullan.
- Dosya adında Türkçe karakterler macOS'ta NFD, Windows'ta NFC → karşılaştırmadan önce normalize et.
- Büyük/küçük harf duyarsız dosya sistemleri: `Foto.jpg → foto.jpg` iki adımda.
- Ekran görüntüleri çoğu masaüstünün yarısıdır; ad kalıbı dil bağımlı ("Ekran Resmi", "Screenshot", "Näyttökuva", "Bildschirmfoto").
- Aynı dosyanın `.HEIC` + `.JPG` çifti (iPhone aktarımı) kopya değildir; "kardeş" olarak gruplanır.
- Bir klasör aslında bir "proje"dir (içinde `.git`, `package.json`, `.xcodeproj`): içine girme, bütün olarak taşı veya atla.
- Kullanıcı tarama sırasında dosya ekler/siler → uygulama öncesi ön kontrol bunu yakalar.
- API anahtarı yanlış/limit dolu → yapay zekâ adımı atlanır, kurallarla plan yine çıkar; kullanıcı bilgilendirilir.
