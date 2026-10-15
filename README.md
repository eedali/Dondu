# Döndü

Dağınık dosyaları **seçtiğin klasörler içinde** anlayıp düzenleyen masaüstü uygulaması (macOS + Windows). Her dosyaya bakar, ne olduğunu çıkarır, nereye gitmesi gerektiğini bir **rapor** olarak önerir; sen düzeltir ve onaylarsın; ancak ondan sonra uygular. Her işlem kayıt altındadır ve **geri alınabilir**. Hiçbir dosyayı silmez.

> Durum: planlama tamamlandı, kod henüz yok. Geliştirme Claude Code ile `docs/07-YOL-HARITASI.md`'deki fazlara göre yapılır.

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

## Kurulum (son kullanıcı) — Faz 5'te tamamlanacak

- **macOS:** GitHub Releases'tan `.dmg` indir, `Dondu.app`'i Uygulamalar'a sürükle. İmzasız olduğu için ilk açılışta Terminal'de `xattr -dr com.apple.quarantine /Applications/Dondu.app` çalıştır (veya sağ tık → Aç). İlk taramada macOS klasör izni soracak; "İzin ver" de veya Sistem Ayarları → Gizlilik ve Güvenlik → Tam Disk Erişimi'ne Döndü'yü ekle.
- **Windows:** `.exe` kurulum; SmartScreen uyarısında "Daha fazla bilgi → Yine de çalıştır". Belgeler/Masaüstü'ne yazamıyorsa Windows Güvenliği → Fidye yazılımı koruması → Döndü'ye izin ver.

## Lisans

Kişisel proje. (Lisans dosyası eklenmedi; açık kaynak yapılacaksa MIT önerilir.)
