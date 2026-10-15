import fs from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import * as XLSX from 'xlsx'
import { makeIban, makePng, makeTcKimlik, makeWav, makeZip, withExif } from './binary'
import { JPEG_SAMPLES } from './jpeg-samples'

/**
 * Builds a messy "desktop" folder (≈80 entries) for scans and integration tests.
 * Everything is written under `dir` — never anywhere else.
 */
export interface FixtureInfo {
  dir: string
  files: string[]
  duplicates: [string, string][]
  bundles: string[]
  sensitive: string[]
}

const yearDate = (y: number, m = 6, d = 15): Date => new Date(Date.UTC(y, m - 1, d, 10, 30, 0))

/** pdf-lib standard fonts are WinAnsi only; transliterate Turkish letters for PDF text. */
const ansi = (s: string): string =>
  s
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'I')
    .replace(/ş/g, 's')
    .replace(/Ş/g, 'S')
    .replace(/ğ/g, 'g')
    .replace(/Ğ/g, 'G')

async function pdf(
  lines: string[],
  opts: { title?: string; author?: string; empty?: boolean } = {},
): Promise<Buffer> {
  const doc = await PDFDocument.create()
  if (opts.title) doc.setTitle(opts.title)
  if (opts.author) doc.setAuthor(opts.author)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([595, 842])
  if (opts.empty) {
    page.drawRectangle({ x: 50, y: 400, width: 495, height: 300, borderWidth: 2 })
  } else {
    lines.forEach((l, i) => page.drawText(ansi(l), { x: 50, y: 780 - i * 22, size: 13, font }))
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }))
}

async function docx(paragraphs: string[], title?: string): Promise<Buffer> {
  const d = new Document({
    title,
    creator: 'Fixture',
    sections: [{ children: paragraphs.map((p) => new Paragraph({ children: [new TextRun(p)] })) }],
  })
  return Buffer.from(await Packer.toBuffer(d))
}

function xlsx(rows: (string | number)[][], sheet = 'Sayfa1'): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet)
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

const jpeg = (i: number): Buffer => Buffer.from(JPEG_SAMPLES[i % JPEG_SAMPLES.length]!, 'base64')

const gradient = (seed: number, w = 120, h = 90) =>
  makePng(w, h, (x, y) => [(x * 2 + seed) % 256, (y * 3 + seed * 2) % 256, ((x + y) * seed) % 256])

/** A "screenshot": flat UI-like blocks. */
const screenshot = (seed: number) =>
  makePng(320, 200, (x, y) =>
    y < 24 ? [40, 44, 52] : x < 80 ? [230, 232, 236] : [250, 250, 250 - (seed % 20)],
  )

export async function makeFixtures(dir: string): Promise<FixtureInfo> {
  await fs.mkdir(dir, { recursive: true })
  const files: string[] = []
  const write = async (rel: string, data: Buffer | string, mtime?: Date): Promise<string> => {
    const abs = path.join(dir, ...rel.split('/'))
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, data)
    if (mtime) await fs.utimes(abs, mtime, mtime)
    files.push(rel)
    return rel
  }

  const tc = makeTcKimlik(42_123_456)
  const iban = makeIban('TR', '0006200119000006672315') // 22 chars BBAN → TR IBAN (26)
  const ibanFi = makeIban('FI', '21234560000785')

  // ---- photos (EXIF) ----------------------------------------------------------------
  const photo = (i: number, date: Date, gps = false) =>
    withExif(jpeg(i), { make: 'Apple', model: 'iPhone 13', date, gps })
  await write('IMG_1234.JPG', photo(0, new Date('2023-07-14T11:03:00')), yearDate(2023, 7, 14))
  await write(
    'IMG_1235.JPG',
    photo(1, new Date('2023-07-14T12:10:00'), true),
    yearDate(2023, 7, 14),
  )
  await write('IMG_2001.jpeg', photo(2, new Date('2021-12-24T19:00:00')), yearDate(2022, 1, 2))
  await write(
    'DSC_0042.jpg',
    withExif(jpeg(3), { make: 'NIKON', model: 'D3500', date: new Date('2019-05-01T09:00:00') }),
    yearDate(2019, 5, 1),
  )
  await write(
    'Tatil/plaj.jpg',
    photo(1, new Date('2024-08-03T15:00:00'), true),
    yearDate(2024, 8, 3),
  )
  await write(
    'Tatil/plaj (1).jpg',
    photo(1, new Date('2024-08-03T15:00:00'), true),
    yearDate(2024, 8, 4),
  ) // exact dup
  // HEIC + JPG sibling (fake HEIC bytes with ftyp box)
  const heic = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from('ftypheic\0\0\0\0mif1heic', 'ascii'),
    Buffer.alloc(2048, 7),
  ])
  await write('IMG_3001.HEIC', heic, yearDate(2024, 3, 9))
  await write('IMG_3001.JPG', photo(2, new Date('2024-03-09T10:00:00')), yearDate(2024, 3, 9))
  // NFD Turkish name (macOS style)
  await write(
    'Çiçek fotoğrafı.jpg'.normalize('NFD'),
    photo(3, new Date('2022-04-20T08:00:00')),
    yearDate(2022, 4, 20),
  )

  // ---- screenshots -------------------------------------------------------------------
  await write('Ekran Resmi 2024-03-12 14.22.31.png', screenshot(1), yearDate(2024, 3, 12))
  await write('Ekran Resmi 2024-03-12 14.25.02.png', screenshot(2), yearDate(2024, 3, 12))
  await write('Screenshot 2023-11-02 at 09.15.44.png', screenshot(3), yearDate(2023, 11, 2))
  await write('Näyttökuva 2025-01-08 kello 10.11.12.png', screenshot(4), yearDate(2025, 1, 8))
  await write('Bildschirmfoto 2022-06-01 um 12.00.00.png', screenshot(5), yearDate(2022, 6, 1))
  await write('Screen Shot 2021-02-02 at 1.02.03 PM.png', screenshot(6), yearDate(2021, 2, 2))

  // ---- other images (incl. near duplicates) -------------------------------------------
  await write('logo.png', gradient(10), yearDate(2020))
  await write('İndirilenler/logo-kopya.png', gradient(11), yearDate(2021)) // near-dup of logo.png
  await write(
    'meme.gif',
    Buffer.from(
      'GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;',
      'latin1',
    ),
    yearDate(2020),
  )
  await write(
    'çizim.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    yearDate(2022),
  )

  // ---- documents ------------------------------------------------------------------------
  await write(
    'Fatura - Elektrik Mart 2024.pdf',
    await pdf(
      ['ELEKTRIK FATURASI', 'Fatura No: 2024-03-118', 'Donem: Mart 2024', 'Toplam: 412,50 TL'],
      { title: 'Elektrik Faturası' },
    ),
    yearDate(2024, 4, 2),
  )
  await write(
    'lasku_2023_05.pdf',
    await pdf([
      'LASKU',
      'Helen Oy',
      'Laskun numero 55123',
      'Erapaiva 15.05.2023',
      'Yhteensa 48,20 EUR',
    ]),
    yearDate(2023, 5, 3),
  )
  await write(
    'receipt-amazon.pdf',
    await pdf(['Order receipt', 'Amazon.de', 'Total 19,99 EUR']),
    yearDate(2022, 11, 30),
  )
  await write(
    'Kira Sözleşmesi.pdf',
    await pdf(['KIRA SOZLESMESI', 'Kiraya veren: ...', 'Kiraci: ...', 'Baslangic: 01.09.2022']),
    yearDate(2022, 9, 1),
  )
  await write(
    'vuokrasopimus.pdf',
    await pdf(['VUOKRASOPIMUS', 'Vuokranantaja', 'Vuokralainen', 'Alkaa 1.1.2024']),
    yearDate(2024, 1, 2),
  )
  await write(
    'Verohallinto_verokortti_2024.pdf',
    await pdf(['Verohallinto', 'Verokortti 2024', 'Henkilotunnus ...']),
    yearDate(2024, 1, 20),
  )
  await write(
    'tahlil_sonuclari.pdf',
    await pdf(['TAHLIL SONUCLARI', 'Hemogram', 'Recete']),
    yearDate(2023, 2, 14),
  )
  await write(
    'Kullanım Kılavuzu - Bulaşık Makinesi.pdf',
    await pdf(['KULLANIM KILAVUZU', 'Garanti belgesi', 'Model XYZ-500']),
    yearDate(2020, 8, 8),
  )
  await write('scan0001.pdf', await pdf([], { empty: true }), yearDate(2021, 10, 10)) // no text → scanned
  await write(
    'makale-yapay-zeka.pdf',
    await pdf(['Abstract', 'This paper studies ...', 'References']),
    yearDate(2023, 3, 3),
  )
  await write(
    'Belge (3).pdf',
    await pdf(['Toplanti notlari', 'Proje teklifi', 'Butce']),
    yearDate(2024, 6, 1),
  )
  await write(
    'banka_bilgileri.pdf',
    await pdf(['Hesap bilgileri', `IBAN: ${iban}`]),
    yearDate(2023, 1, 1),
  )

  await write(
    'CV_2024.docx',
    await docx(['Özgeçmiş', 'Deneyim: Yazılım geliştirici', 'Eğitim: Lisans'], 'CV'),
    yearDate(2024, 2, 2),
  )
  await write(
    'Ödev - Tarih.docx',
    await docx(['Tarih ödevi', 'Osmanlı İmparatorluğu', 'Kaynakça']),
    yearDate(2021, 11, 11),
  )
  await write(
    'Untitled.docx',
    await docx(['Alışveriş listesi', 'süt, ekmek']),
    yearDate(2025, 1, 1),
  )
  await write(
    'Yeni Klasör/teklif_müşteri.docx',
    await docx(['Teklif', 'Fiyat teklifi', 'Geçerlilik 30 gün']),
    yearDate(2023, 9, 9),
  )

  await write(
    'bütçe 2024.xlsx',
    xlsx([
      ['Ay', 'Gelir', 'Gider'],
      ['Ocak', 3000, 2500],
      ['Şubat', 3100, 2700],
    ]),
    yearDate(2024, 3, 1),
  )
  await write(
    'envanter.xlsx',
    xlsx([
      ['Ürün', 'Adet'],
      ['Kalem', 12],
    ]),
    yearDate(2022, 7, 7),
  )
  await write('liste.csv', 'ad;soyad;telefon\nAli;Veli;0555\n', yearDate(2023, 4, 4))
  await write(
    'sunum.pptx',
    makeZip([
      {
        name: 'ppt/slides/slide1.xml',
        data: '<p:sld><a:t>Çeyrek sonuçları</a:t><a:t>2024 Q1</a:t></p:sld>',
      },
      { name: '[Content_Types].xml', data: '<Types/>' },
    ]),
    yearDate(2024, 4, 10),
  )

  // ---- text ---------------------------------------------------------------------------------
  await write('notlar.txt', 'Market: süt, yumurta\nToplantı perşembe 14:00\n', yearDate(2025, 2, 2))
  await write(
    'todo.md',
    '# Yapılacaklar\n- [ ] Vergi beyannamesi\n- [x] Araba bakımı\n',
    yearDate(2024, 12, 12),
  )
  await write('config.json', '{"theme":"dark"}', yearDate(2022))
  await write('Yeni Klasör/Eski/derin/çok derin/not.txt', 'eski not', yearDate(2019, 1, 1))

  // ---- sensitive ------------------------------------------------------------------------------
  const sensitive: string[] = []
  sensitive.push(await write('parolalar.txt', 'gmail: hunter2\nbanka: 1234\n', yearDate(2023)))
  sensitive.push(
    await write(
      'kimlik_fotokopisi.pdf',
      await pdf(['T.C. KIMLIK KARTI', 'Ad Soyad']),
      yearDate(2022),
    ),
  )
  sensitive.push(await write('musteri.txt', `Müşteri: Ahmet\nTC: ${tc}\n`, yearDate(2023)))
  sensitive.push(
    await write(
      'id_rsa',
      '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n',
      yearDate(2021),
    ),
  )
  sensitive.push(await write('fi-pankki.txt', `Tilitiedot\n${ibanFi}\n`, yearDate(2024)))
  sensitive.push('banka_bilgileri.pdf')

  // ---- audio / video ---------------------------------------------------------------------------
  await write('sesli not 12.wav', makeWav(1.5), yearDate(2024, 5, 5))
  await write('Müzik/şarkı.wav', makeWav(2, 523), yearDate(2020, 5, 5))
  await write(
    'video_2023.mp4',
    Buffer.concat([
      Buffer.from([0, 0, 0, 20]),
      Buffer.from('ftypisom\0\0\0\0isom', 'ascii'),
      Buffer.alloc(4096, 1),
    ]),
    yearDate(2023, 7, 7),
  )
  await write(
    'klip.mov',
    Buffer.concat([
      Buffer.from([0, 0, 0, 20]),
      Buffer.from('ftypqt  \0\0\0\0qt  ', 'ascii'),
      Buffer.alloc(2048, 3),
    ]),
    yearDate(2021, 7, 7),
  )

  // ---- archives / installers --------------------------------------------------------------------
  await write(
    'fotolar.zip',
    makeZip([
      { name: 'a.jpg', data: jpeg(0) },
      { name: 'b.jpg', data: jpeg(1) },
    ]),
    yearDate(2022, 2, 2),
  )
  await write(
    'yedek.zip',
    makeZip([
      { name: 'belgeler/fatura.pdf', data: 'x' },
      { name: 'belgeler/not.txt', data: 'y' },
    ]),
    yearDate(2020, 2, 2),
  )
  await write(
    'setup.exe',
    Buffer.concat([Buffer.from('MZ'), Buffer.alloc(4096, 9)]),
    yearDate(2023, 8, 8),
  )
  await write('Uygulama-1.2.dmg', Buffer.alloc(3000, 5), yearDate(2024, 8, 8))
  await write(
    'arsiv.tar.gz',
    Buffer.concat([Buffer.from([0x1f, 0x8b, 8, 0]), Buffer.alloc(500, 2)]),
    yearDate(2019, 9, 9),
  )

  // ---- junk ------------------------------------------------------------------------------------------
  await write('bos.txt', '', yearDate(2024))
  await write('indirme.crdownload', Buffer.alloc(100, 1), yearDate(2024))
  await write('film.part', Buffer.alloc(100, 2), yearDate(2024))
  await write('gecici.tmp', 'tmp', yearDate(2024))
  await write('.gizli_not.txt', 'gizli', yearDate(2024)) // hidden → skipped by default
  await write('.DS_Store', 'x') // excluded
  await write('~$rapor.docx', 'lock') // excluded (Office lock)

  // ---- duplicates in different folders ----------------------------------------------------------------
  const dupContent = await fs.readFile(path.join(dir, 'Fatura - Elektrik Mart 2024.pdf'))
  await write('İndirilenler/Fatura - Elektrik Mart 2024 (1).pdf', dupContent, yearDate(2024, 4, 3))
  await write(
    'Belgeler/eski/CV_2024 kopya.docx',
    await fs.readFile(path.join(dir, 'CV_2024.docx')),
    yearDate(2024, 2, 3),
  )
  await write(
    'İndirilenler/IMG_1234.JPG',
    await fs.readFile(path.join(dir, 'IMG_1234.JPG')),
    yearDate(2023, 8, 1),
  )

  // ---- bundles & project ------------------------------------------------------------------------------
  const bundles: string[] = []
  await write('Rapor.pages/Index/Document.iwa', Buffer.alloc(200, 4), yearDate(2023, 5, 5))
  await write('Rapor.pages/preview.jpg', jpeg(2), yearDate(2023, 5, 5))
  await write('Rapor.pages/Metadata/Properties.plist', '<plist/>', yearDate(2023, 5, 5))
  bundles.push('Rapor.pages')
  await write('Bütçe.numbers/Index/Document.iwa', Buffer.alloc(100, 4), yearDate(2022, 5, 5))
  bundles.push('Bütçe.numbers')
  await write('Fake.app/Contents/Info.plist', '<plist><dict/></plist>', yearDate(2021))
  await write('Fake.app/Contents/MacOS/Fake', 'binary', yearDate(2021))
  bundles.push('Fake.app')
  await write('proje/package.json', '{"name":"proje","version":"1.0.0"}', yearDate(2024, 9, 9))
  await write('proje/src/index.js', 'console.log("merhaba")\n', yearDate(2024, 9, 9))
  await write('proje/README.md', '# Proje\n', yearDate(2024, 9, 9))
  bundles.push('proje')

  // folder that only holds a file for structure
  await write(
    'Masaüstü Eski/kitap.epub',
    makeZip([{ name: 'mimetype', data: 'application/epub+zip' }]),
    yearDate(2018, 1, 1),
  )
  await write('Masaüstü Eski/font.ttf', Buffer.from([0, 1, 0, 0, 0, 10]), yearDate(2019, 1, 1))
  await write(
    'Masaüstü Eski/tasarim.psd',
    Buffer.concat([Buffer.from('8BPS'), Buffer.alloc(400)]),
    yearDate(2019, 1, 1),
  )
  await write('script.py', 'print("hi")\n', yearDate(2023))

  return {
    dir,
    files,
    duplicates: [
      ['Tatil/plaj.jpg', 'Tatil/plaj (1).jpg'],
      ['Fatura - Elektrik Mart 2024.pdf', 'İndirilenler/Fatura - Elektrik Mart 2024 (1).pdf'],
      ['CV_2024.docx', 'Belgeler/eski/CV_2024 kopya.docx'],
      ['IMG_1234.JPG', 'İndirilenler/IMG_1234.JPG'],
    ],
    bundles,
    sensitive,
  }
}
