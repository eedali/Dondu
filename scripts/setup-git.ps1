<#
  Döndü — Git kurulum scripti (Windows / PowerShell 5.1 ve 7 ile uyumlu)

  Ne yapar:
   1. Git Credential Manager'ı etkinleştirir -> GitHub bir KEZ tarayıcıdan oturum açtırır,
      sonra her push'ta parola/token sormaz (Windows Kimlik Bilgisi Yöneticisi'nde saklanır).
   2. user.name / user.email ayarlı değilse sorar.
   3. Bu klasörde repo yoksa başlatır, "main" dalını ve origin'i ayarlar.
   4. İlk commit'i atar ve push eder.

  Kullanım (PowerShell, repo kökünde):
    Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
    .\scripts\setup-git.ps1

  Not: GitHub 2021'den beri git üzerinden hesap PAROLASI kabul etmez. "Password" diye sorduğunda
  aslında token ister; GCM bunu sizin yerinize halleder.
#>

$ErrorActionPreference = 'Continue'   # git'in stderr'e yazdığı bilgi mesajları hata sayılmasın
$Remote   = 'https://github.com/eedali/Dondu.git'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $RepoRoot

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "`nHATA: $msg" -ForegroundColor Red; exit 1 }

# 0. Git var mı?
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fail "Git bulunamadı. https://git-scm.com/download/win adresinden kurun (Git Credential Manager seçeneği işaretli olsun)."
}
Step "Git sürümü: $(git --version)"

# 1. Credential helper -> Git Credential Manager (Git for Windows ile gelir)
Step "Kimlik bilgisi yöneticisi ayarlanıyor (bir daha parola sormasın)"
$helper = (git config --global credential.helper 2>$null)
if ($helper -ne 'manager') {
  git config --global credential.helper manager
  Write-Host "credential.helper = manager olarak ayarlandı."
} else {
  Write-Host "credential.helper zaten 'manager'."
}
# Eski/yanlış GitHub kaydı varsa temizle (tekrar tekrar parola sorma sorununun en sık nedeni)
if (Get-Command git-credential-manager -ErrorAction SilentlyContinue) {
  Write-Host "Eski GitHub kimlik bilgisi (varsa) siliniyor..."
  "protocol=https`nhost=github.com`n" | git credential-manager erase 2>$null | Out-Null
}

# 2. Kullanıcı adı / e-posta
Step "Kimlik bilgileri (commit yazarlığı)"
$name  = (git config --global user.name  2>$null)
$email = (git config --global user.email 2>$null)
if (-not $name)  { $name = Read-Host "Git için adınız (örn. Bülent)"; git config --global user.name "$name" }
if (-not $email) {
  $email = Read-Host "Git için e-posta (Enter = bulent@ko48.com)"
  if (-not $email) { $email = 'bulent@ko48.com' }
  git config --global user.email "$email"
}
Write-Host "user.name=$name  user.email=$email"

# 3. Windows için faydalı ayarlar
Step "Windows ayarları"
git config --global core.longpaths true       # node_modules uzun yolları
git config --global core.autocrlf false       # satır sonlarını .gitattributes yönetir
git config --global init.defaultBranch main
git config --global pull.rebase false

# 4. Repo
Step "Repo hazırlanıyor: $RepoRoot"
if (-not (Test-Path (Join-Path $RepoRoot '.git'))) {
  git init | Out-Null
  git branch -M main
  Write-Host "Yeni repo başlatıldı (main)."
}
$origin = (git remote get-url origin 2>$null)
if (-not $origin) {
  git remote add origin $Remote
  Write-Host "origin -> $Remote"
} elseif ($origin -ne $Remote) {
  Write-Warning "origin şu an '$origin'. Beklenen: $Remote. Değiştirmek için: git remote set-url origin $Remote"
} else {
  Write-Host "origin zaten doğru: $origin"
}

# 5. İlk commit
Step "İlk commit"
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -m "chore: initial planning docs and repo skeleton" | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "Commit atılamadı (yukarıdaki git mesajına bakın)." }
  Write-Host "Commit atıldı."
} else {
  Write-Host "Commit edilecek değişiklik yok."
}

# 6. Push (ilk seferde GCM tarayıcı açar; sonraki push'lar sessiz)
Step "Push"
Write-Host "İLK seferde bir tarayıcı penceresi açılıp GitHub'a giriş isteyecek; onayladıktan sonra bir daha sormaz." -ForegroundColor Yellow
git push -u origin main
if ($LASTEXITCODE -ne 0) {
  Write-Warning "Push reddedildi. Uzak repoda zaten commit varsa (örn. GitHub'da README ile oluşturulduysa) birleştirmeyi deniyorum..."
  git pull origin main --no-rebase --allow-unrelated-histories
  if ($LASTEXITCODE -eq 0) { git push -u origin main }
  if ($LASTEXITCODE -ne 0) {
    Fail "Push yine başarısız. Elle deneyin: git pull origin main --allow-unrelated-histories ; git push -u origin main"
  }
}

Write-Host "`nTamam. Artık 'git push' parola sormadan çalışmalı." -ForegroundColor Green
Write-Host "Hâlâ sorarsa: Denetim Masası > Kimlik Bilgisi Yöneticisi > Windows Kimlik Bilgileri > 'git:https://github.com' kaydını silip tekrar push edin."
