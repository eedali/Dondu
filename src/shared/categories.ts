import type { Category } from './types'

/** Default taxonomy (docs/06 §10). Editable by the user; AI must pick from this closed list. */
const C = (
  id: string,
  nameTr: string,
  nameEn: string,
  folderTemplate: string,
  description: string,
  examples: string[] = [],
): Omit<Category, 'sort' | 'enabled' | 'builtin'> => ({
  id,
  nameTr,
  nameEn,
  folderTemplate,
  description,
  examples,
})

export const DEFAULT_CATEGORIES: Category[] = [
  C(
    'photos',
    'Fotoğraflar',
    'Photos',
    'Fotoğraflar/{Yıl}/{Ay}',
    'Kamera/telefon fotoğrafı, EXIF’li',
    ['IMG_1234.HEIC', 'DSC_0042.jpg'],
  ),
  C(
    'screenshots',
    'Ekran Görüntüleri',
    'Screenshots',
    'Ekran Görüntüleri/{Yıl}',
    'Ekran görüntüsü, ekran kaydı',
    ['Ekran Resmi 2024-03-12.png'],
  ),
  C('images_other', 'Görseller', 'Images', 'Görseller', 'İndirilen görsel, meme, logo, çizim'),
  C(
    'docs_invoice',
    'Belgeler / Fatura & Makbuz',
    'Documents / Invoices & Receipts',
    'Belgeler/Fatura ve Makbuz/{Yıl}',
    'fatura, fiş, makbuz, lasku, kuitti, invoice, receipt',
  ),
  C(
    'docs_contract',
    'Belgeler / Sözleşme',
    'Documents / Contracts',
    'Belgeler/Sözleşmeler',
    'kira, abonelik, sigorta poliçesi, vuokrasopimus',
  ),
  C(
    'docs_official',
    'Belgeler / Resmi & Vergi',
    'Documents / Official & Tax',
    'Belgeler/Resmi/{Yıl}',
    'vergi, e-devlet, Kela, verohallinto, belediye',
  ),
  C(
    'docs_health',
    'Belgeler / Sağlık',
    'Documents / Health',
    'Belgeler/Sağlık',
    'rapor, reçete, tahlil',
  ),
  C(
    'docs_education',
    'Belgeler / Eğitim',
    'Documents / Education',
    'Belgeler/Eğitim',
    'ders notu, ödev, sertifika, diploma',
  ),
  C(
    'docs_work',
    'Belgeler / İş',
    'Documents / Work',
    'Belgeler/İş/{Yıl}',
    'sunum, rapor, CV, teklif',
  ),
  C(
    'docs_finance',
    'Belgeler / Banka & Finans',
    'Documents / Banking & Finance',
    'Belgeler/Finans/{Yıl}',
    'ekstre, dekont, tiliote',
  ),
  C(
    'docs_personal_id',
    'Belgeler / Kişisel & Kimlik',
    'Documents / Personal & ID',
    'Belgeler/Kişisel',
    'kimlik, pasaport, ehliyet (hassas)',
  ),
  C(
    'docs_manual',
    'Belgeler / Kılavuz',
    'Documents / Manuals',
    'Belgeler/Kılavuzlar',
    'kullanım kılavuzu, garanti',
  ),
  C('docs_other', 'Belgeler / Diğer', 'Documents / Other', 'Belgeler/Diğer', 'diğer belgeler'),
  C(
    'spreadsheets',
    'Tablolar',
    'Spreadsheets',
    'Belgeler/Tablolar',
    'xlsx/numbers/csv (içerik belgeyse belge kategorisi öncelikli)',
  ),
  C('presentations', 'Sunumlar', 'Presentations', 'Belgeler/Sunumlar', 'pptx, key'),
  C('books', 'Kitaplar & Makaleler', 'Books & Papers', 'Kitaplar', 'epub, kitap PDF’i, makale'),
  C('videos', 'Videolar', 'Videos', 'Videolar/{Yıl}', 'video, ekran kaydı'),
  C('audio', 'Müzik & Ses', 'Music & Audio', 'Müzik ve Ses', 'mp3, m4a, sesli not'),
  C('design', 'Tasarım & Kaynak', 'Design & Assets', 'Tasarım', 'psd, ai, sketch, fig, font'),
  C(
    'installers',
    'Yazılım & Kurulum',
    'Software & Installers',
    'Yazılım',
    'dmg, pkg, exe, msi, app',
  ),
  C('archives', 'Arşivler', 'Archives', 'Arşivler', 'zip, rar, 7z (içerik belliyse o kategori)'),
  C('code', 'Kod & Projeler', 'Code & Projects', 'Projeler', 'proje klasörleri, betikler'),
  C(
    'junk',
    'Çöp adayları',
    'Junk candidates',
    'Döndü Karantina/Çöp adayları',
    '0 bayt, .tmp, .part, .crdownload, eski kilit dosyaları — varsayılan atla',
  ),
  C('uncertain', 'Belirsiz', 'Uncertain', 'Gözden Geçir', 'güven düşük — varsayılan atla'),
].map((c, i) => ({ ...c, sort: i * 10, enabled: true, builtin: true }))

export function categoryName(cats: Category[], id: string, lang: string): string {
  const c = cats.find((x) => x.id === id)
  if (!c) return id
  return lang === 'tr' ? c.nameTr : c.nameEn
}
