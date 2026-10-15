# Döndü

Dağınık dosyaları **seçtiğin klasörler içinde** anlayıp düzenleyen masaüstü uygulaması (macOS + Windows). Her dosyaya bakar, ne olduğunu çıkarır, nereye gitmesi gerektiğini bir **rapor** olarak önerir; sen düzeltir ve onaylarsın; ancak ondan sonra uygular. Her işlem kayıt altındadır ve **geri alınabilir**. Hiçbir dosyayı silmez.

> Durum: **v0.1.0** — Faz 0–5 uygulandı (tarama, kurallar, kopyalar, plan/rapor, onaylı uygulama, geri alma, yapay zekâ, ayarlar, onboarding). Ayrıntı: `STATUS.md`, değişiklikler: `CHANGELOG.md`.

## Bu klasörde ne var

| Yol | Ne işe yarar |
|---|---|
| `CLAUDE.md` | Claude Code'un her oturumda okuduğu kurallar (yığın, altın kurallar, dizin yapısı, komutlar) |
| `STATUS.md` | Hangi fazdayız, ne bitti, sırada ne var — Claude Code günceller |
| `docs/01-URUN-GEREKSINIMLERI.md` | Ürün gereksinimleri, akış, kapsam, gözden kaçabilecek noktalar |
| `docs/02-MIMARI.md` | Teknoloji kararları, süreç modeli, veri modeli, IPC, boru hattı |
| `docs/03-YAPAY-ZEKA.md` | Haiku 5.5 + LM Studio entegrasyonu, hassas dosya kuralı, **maliyet hesabı** |
| `docs/04-PLATFORM.md` | macOS/Windows izinleri, Gatekeeper, iCloud/OneDrive, dosya sistemi tuzakları |
| `docs/05-GUVENLIK-VE-GERI-ALMA.md` | Plan→Onay→Uygula, günlük (journal), geri alma algoritması, bütünlük testleri |
| `docs/06-AYARLAR.md` | Tüm ayarlar ve varsayılanları; kategori taksonomisi |
| `docs/07-YOL-HARITASI.md` | Fazlar ve **Claude Code'a yapıştırılacak istemler** |
| `docs/08-TASARIM.md` | Arayüz dili, ekranlar, renkler |
| `docs/prompts/` | Yapay zekâ sistem istemi ve JSON şeması |
| `.claude/settings.json` | Claude Code izinleri (npm/git serbest, `git push` sorar, `.env` okunamaz) |
| `.github/workflows/build.yml` | CI: her push'ta test; etiketle macOS + Windows paketi ve Release |
| `scripts/setup-git.ps1` | Git'i bir kez kurup **bir daha parola sordurmayan** script |
| `CHANGELOG.md` | Sürüm notları |
| `logo/` | Marka logosu (svg + png); uygulama simgeleri buradan üretilir |
| `src/`, `tests/` | Uygulama kodu ve testler |

## Başlangıç (Windows, geliştirici)

1. Bu klasörün içeriğini `D:\Work\Code\Dondu` içine kopyala.
2. Gerekli araçlar: [Git for Windows](https://git-scm.com/download/win) (Git Credential Manager seçili), [Node.js 22 LTS](https://nodejs.org). (better-sqlite3 için gerekirse Visual Studio Build Tools "Desktop development with C++"; önce denemeden kurma.)
3. PowerShell'de:
   ```powershell
   cd D:\Work\Code\Dondu
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   .\scripts\setup-git.ps1
   ```
   İlk push'ta tarayıcı açılır, GitHub'a bir kez giriş yaparsın; sonra `git push` parola sormaz.
4. Claude masaüstü uygulamasını aç → **Code** sekmesi → klasör olarak `D:\Work\Code\Dondu` seç.
5. `docs/07-YOL-HARITASI.md` → **Faz 0** istemini yapıştır. Faz bitince `npm run dev` ile bak, sonra Faz 1… Her faz için yeni oturum aç.

### Git neden parola soruyordu?

GitHub, git üzerinden hesap parolasını zaten kabul etmiyor; "password" diye sorduğunda token istiyor. Çözüm, token'ı Windows Kimlik Bilgisi Yöneticisi'nde saklayan **Git Credential Manager**: `git config --global credential.helper manager` (script bunu yapar). Hâlâ sorarsa: Denetim Masası → Kimlik Bilgisi Yöneticisi → Windows Kimlik Bilgileri → `git:https://github.com` kaydını sil, tekrar push et. Alternatif: `gh auth login` (GitHub CLI) veya SSH anahtarı.

## Yapay zekâ maliyeti (özet)

Claude Haiku 5.5: $0,10 / 1M girdi, $0,50 / 1M çıktı (istem ≤100K token). 50 karışık masaüstü dosyasının **tamamı** AI'a gönderilse bile ≈ **$0,007** (1 sentin altında); 5.000 dosya ≈ $0,70. Kural motoru çoğunu AI'sız sınıflandırdığı için gerçek maliyet daha düşük. Ayrıntı: `docs/03-YAPAY-ZEKA.md` §7. Hassas dosyalar hiçbir zaman buluta gitmez; LM Studio ile tamamen yerel çalışma mümkündür.

## Kurulum (son kullanıcı)

Paketler GitHub Releases'ta: https://github.com/eedali/Dondu/releases

### macOS (Apple Silicon ve Intel)

1. Mac'inize uygun `.dmg` dosyasını indirin: Apple Silicon (M1/M2/M3/M4) için `Dondu-x.y.z-arm64.dmg`, Intel için `Dondu-x.y.z-x64.dmg`.
2. DMG'yi açın, `Dondu.app`'i **Applications** (Uygulamalar) klasörüne sürükleyin. DMG içindeki `OKU-BENİ.txt` aynı adımları anlatır.
3. Döndü henüz Apple tarafından imzalanmadığı için ilk açılışta "geliştirici doğrulanamadı" ya da "hasarlı" uyarısı çıkabilir. Terminal'i açın ve şunu çalıştırın:
   ```bash
   xattr -dr com.apple.quarantine /Applications/Dondu.app
   ```
   Alternatif: Uygulamalar'da Dondu'ya sağ tık → **Aç** → **Aç**.
4. İlk taramada macOS klasör izni sorar: **İzin Ver**. Daha sorunsuz yol: Sistem Ayarları → Gizlilik ve Güvenlik → **Tam Disk Erişimi** → Döndü'yü ekleyin (uygulamadaki "Nasıl düzeltirim?" sayfası doğrudan bu ekranı açar).

### Windows 10/11 (x64)

1. `Dondu-Setup-x.y.z.exe` dosyasını indirip çalıştırın.
2. SmartScreen "Windows bilgisayarınızı korudu" derse: **Daha fazla bilgi** → **Yine de çalıştır** (kurulum dosyası henüz kod imzalı değil).
3. Belgeler/Masaüstü'ne yazamıyorsa: Windows Güvenliği → Virüs ve tehdit koruması → Fidye yazılımı koruması → **Uygulamanın denetimli klasör erişimine izin ver** → Dondu.exe'yi ekleyin.

### İlk kullanım önerisi

Önce küçük bir test klasöründe (ör. Masaüstü'ndeki 20 dosyanın kopyası) tam akışı deneyin: Tara → Planı oluştur → Rapor'u gözden geçir → Onayla ve uygula → Geçmiş → **Geri al**. Her şey yerine döndüğünü gördükten sonra gerçek klasörlerde kullanın.

## Geliştirme

```bash
npm ci
npm run dev        # uygulama (HMR)
npm test           # vitest (Electron'un Node'unda; better-sqlite3 Electron ABI'si için)
npm run typecheck && npm run lint
npm run fixtures   # OS temp klasöründe 80 dosyalık dağınık bir klasör üretir
npm run package    # bu işletim sistemi için dist/ altında paket
```

- macOS paketleri yalnızca GitHub Actions'ta üretilir: `v*` etiketi itilince CI macOS (arm64 + x64 DMG, ad-hoc imza + `codesign --verify`) ve Windows (NSIS) paketlerini Release'e yükler.
- Uygulama simgeleri `logo/` klasöründen `python scripts/make-icons.py` ile üretilir (`build/icon.*`).
- Yapay zekâ canlı testi: `DONDU_LIVE_AI=1 ANTHROPIC_API_KEY=... npm test` (3 dosya). Performans: `DONDU_BENCH=1 npm test` (20.000 dosya).

## Lisans

Kişisel proje. (Lisans dosyası eklenmedi; açık kaynak yapılacaksa MIT önerilir.)
