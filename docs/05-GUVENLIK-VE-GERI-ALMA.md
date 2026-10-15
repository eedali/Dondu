# 05 — Güvenlik, Günlük ve Geri Alma

## 1. Plan → Onay → Uygula modeli (Terraform benzeri)

```
[Tara] ──► Envanter (salt okunur)
           │
[Planla] ─► Plan taslağı (JSON; dosya sistemine dokunmaz)
           │  kullanıcı düzenler: hedef / ad / atla / grup
[Onayla] ─► Plan "approved" (artık değişmez; düzenlemek = yeni taslak)
           │
[Uygula] ─► Ön kontrol ──► Günlük (write-ahead) ──► İşlem ──► Doğrula ──► Günlük "done"
           │
[Geri al] ─► Günlüğü ters sırada oynat
```

Durum makinesi kodda zorlanır: `applier.run(plan)` yalnızca `plan.status === 'approved'` ise çalışır; aksi hâlde hata fırlatır (test edilir).

## 2. Plan öğesi → fiziksel işlemler

| PlanAction | Günlük işlemleri (seq sırası) |
|---|---|
| `mkdir` | `mkdir dst` (yalnızca yoksa; varsa `skipped`) |
| `move` / `rename` / `move_rename` (aynı birim) | `rename src dst` |
| aynı işlem (farklı birim) | `copy src dst` → `verify dst (blake3)` → `remove_source src` (= karantinaya `rename`, çöp ayarı açıksa `trash`) |
| `quarantine` (kopya) | `rename src <root>/Döndü Karantina/<run-id>/<rel_path>` |
| `trash` (ayar açıksa) | `trash src` (OS çöpü; geri alma sınırlı → raporda uyarı) |
| `rmdir_empty` | Yalnızca bu çalıştırmada Döndü'nün `mkdir` ile oluşturduğu ve boş kalan klasörler |

Hiçbir yerde `unlink`/`rm` yok. `remove_source` bile karantinaya taşımadır (ayarla çöp).

## 3. Ön kontrol (pre-flight) — hepsi geçmeden tek işlem yapılmaz

1. Kaynak var mı, `size` ve `mtime` tarama anındakiyle aynı mı → değilse öğe "değişmiş" olarak işaretlenir, kullanıcıya liste gösterilir (atla / yine de uygula).
2. Kaynak ve hedef `realpath` ile seçili köklerin içinde mi.
3. Hedef dizin oluşturulabilir/yazılabilir mi (geçici dosya testi, kök başına bir kez).
4. Çakışma: hedef varsa ek üretilir ` (2)`; plan içinde iki öğe aynı hedefe gidiyorsa ikinciye ek.
5. Farklı birimse boş alan ≥ toplam boyut × 1,1.
6. Kilit/kullanımda testi (`fs.open` `r+` dene, Windows'ta `EBUSY`).
7. Bulut yer tutucuları her zaman atlanır.

## 4. Günlük (journal) şeması ve yazım sırası

Her fiziksel işlem için:
1. `INSERT journal (status='pending', src, dst, size, mtime, hash?)` — **commit**
2. İşlem
3. `UPDATE status='done', finished_at` (veya `failed`, `error`)

Uygulama çökerse açılışta `pending` satırlar incelenir:
- `rename`: `dst` varsa ve `src` yoksa → aslında tamamlandı → `done`; ikisi de varsa → tuhaf, kullanıcıya göster.
- `copy`: `dst` varsa karma doğrula → eksikse `dst`'yi karantinaya al, `failed`.
- Kullanıcıya diyalog: "Yarım kalan işlem bulundu — Devam et / Geri al / İncele".

## 5. Geri alma algoritması

```
for row in journal where run_id = X and status='done' order by seq DESC:
  switch row.op:
    rename:   if exists(dst) and sizeMtime(dst)==row → rename(dst, src or src' (ek))
              else → sor (değişmiş / yok)
    copy+verify+remove_source: remove_source'u geri al (karantinadan src'ye rename), dst'yi karantinaya taşı
    mkdir:    rmdir if empty (Döndü oluşturduysa)
    trash:    OS çöpünden geri alma otomatik desteklenmez → kullanıcıya "Çöp'ten elle geri alın" + yol
    rmdir_empty: mkdir
  write journal row (run_id = undo-run, status 'undone' on original)
```

- Tek dosya geri alma: o öğeye ait satırlar ters sırada.
- Geri alma da bir `run` (kind='undo'); geçmişte görünür; geri almanın geri alınması = ilgili satırları yeniden uygulama.
- Kaynak konum doluysa `ad (geri alındı).uz`.

## 6. Bütünlük testleri (zorunlu, CI'da)

- **Round-trip:** fixture ağacı → tam karma haritası → scan → plan (her şey enabled) → apply → undo → yeni karma haritası **===** eski (yol + içerik). Ayrıca `Döndü Karantina` boş/yok.
- **Kesinti simülasyonu:** apply ortasında işlem fırlatır (`FaultInjector`), açılış toparlaması çalışır, undo yine round-trip sağlar.
- **Çakışma:** hedefte aynı ad var → ek, orijinal dokunulmadı.
- **Değişen kaynak:** apply öncesi dosya değiştirilir → öğe atlanır, rapor edilir.
- **Kök dışı:** plan öğesi kök dışına işaret ederse apply reddeder.
- **Harf büyüklüğü yeniden adlandırma:** `A.txt → a.txt` çalışır (duyarsız FS'de de).
- **NFD/NFC:** macOS'ta NFD adlı dosya NFC hedefe doğru taşınır, undo bulur.

## 7. Kullanıcıya görünen güvenlik mesajları

- Onay ekranı başlığı: "Döndü hiçbir dosyayı silmez. Kopyalar *Döndü Karantina* klasörüne gider; her şey Geçmiş'ten geri alınabilir."
- Uygulama sonu: "128 dosya taşındı, 2 atlandı (kilitli). Geri almak için Geçmiş → bu çalıştırma → Geri al."
- Karantina klasörü 30 gün sonra (ayar) "Karantinayı boşalt?" hatırlatması — boşaltma = OS çöpüne gönderme; yine doğrudan silme yok.

## 8. Gizlilik güvenliği

- Günlük/loglarda içerik yok; yalnızca yol, boyut, karma.
- Thumb ve alıntı önbelleği `userData/cache/`, "Önbelleği temizle" butonu; hassas dosyalar için üretilmez.
- API anahtarı `safeStorage` (macOS Keychain / Windows DPAPI); dışa aktarılmaz, logda maskeli.
- Dışa aktarılan rapor (HTML/MD) varsayılan olarak alıntı/thumb içermez (seçenekle açılır).
