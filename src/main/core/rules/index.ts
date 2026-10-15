import type { Settings } from '@shared/settings'
import type { FileMeta, FileRecord } from '@shared/types'
import type { Repos } from '../../db/repos'

/**
 * Deterministic rule classifier (docs/02 §6.3). Gives every file a category from the closed
 * taxonomy plus a confidence. Rules run before (and instead of, when confident) the AI.
 */

export interface RuleResult {
  category: string
  confidence: number
  reason: string
  /** Year/month the content is about (for {Yıl}/{Ay}); from EXIF, name or content. */
  date?: { year: number; month?: number }
}

/** Lowercase, Turkish-aware, accents folded ("Sözleşme" → "sozlesme"). */
export function fold(s: string): string {
  return s.toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const SCREENSHOT_RE =
  /^(ekran resmi|ekran goruntusu|screenshot|screen shot|nayttokuva|kuvakaappaus|bildschirmfoto|capture d.ecran|schermafbeelding|captura de pantalla|simulator screen shot|cleanshot|snip|snapshot)[\s_-]/
const SCREEN_RECORDING_RE =
  /^(ekran kaydi|screen recording|nayton tallennus|bildschirmaufnahme|kuvaruuduntallenne)/
const CAMERA_NAME_RE = /^(img|dsc|dscn|dscf|pxl|p\d{7}|mvimg|photo|foto|wp|gopr|dji)[_-]?\d/
const JUNK_EXTS = new Set([
  'tmp',
  'temp',
  'part',
  'crdownload',
  'download',
  'partial',
  'bak',
  'old',
])

type Kw = { cat: string; words: string[] }
/** Keyword lists (folded). Order matters: first strong hit wins. */
export const KEYWORDS: Kw[] = [
  {
    cat: 'docs_personal_id',
    words: [
      'kimlik',
      'pasaport',
      'passport',
      'ehliyet',
      'surucu belgesi',
      'henkilokortti',
      'ajokortti',
      'driver licen',
      'nufus cuzdani',
      'ikamet',
    ],
  },
  {
    cat: 'docs_invoice',
    words: [
      'fatura',
      'makbuz',
      'fis ',
      'fisi',
      'lasku',
      'kuitti',
      'invoice',
      'receipt',
      'rechnung',
      'quittung',
      'tositte',
      'odeme belgesi',
      'siparis ozeti',
      'order receipt',
    ],
  },
  {
    cat: 'docs_contract',
    words: [
      'sozlesme',
      'kira kontrat',
      'kontrat',
      'vuokrasopimus',
      'sopimus',
      'contract',
      'agreement',
      'police',
      'sigorta',
      'vakuutus',
      'abonelik',
      'tyosopimus',
    ],
  },
  {
    cat: 'docs_official',
    words: [
      'vergi',
      'e-devlet',
      'edevlet',
      'kela',
      'verohallinto',
      'verokortti',
      'belediye',
      'maistraatti',
      'migri',
      'oleskelulupa',
      'tax return',
      'beyanname',
      'resmi yazi',
      'noter',
      'tapu',
      'dvv',
      'poliisi',
    ],
  },
  {
    cat: 'docs_health',
    words: [
      'tahlil',
      'recete',
      'hastane',
      'saglik raporu',
      'doktor',
      'laboratuvar',
      'terveys',
      'resepti',
      'laboratory',
      'medical',
      'asi karti',
      'rokotus',
      'kanta',
      'epikriz',
    ],
  },
  {
    cat: 'docs_finance',
    words: [
      'ekstre',
      'hesap ozeti',
      'dekont',
      'tiliote',
      'bank statement',
      'kredi karti',
      'maas bordrosu',
      'palkkalaskelma',
      'banka',
      'yatirim',
      'portfoy',
    ],
  },
  {
    cat: 'docs_education',
    words: [
      'odev',
      'ders notu',
      'sinav',
      'sertifika',
      'diploma',
      'transkript',
      'universite',
      'homework',
      'certificate',
      'thesis',
      'tez ',
      'kurs',
      'lecture',
      'todistus',
    ],
  },
  {
    cat: 'docs_manual',
    words: [
      'kilavuz',
      'kullanim',
      'manual',
      'garanti',
      'warranty',
      'kayttoohje',
      'user guide',
      'instructions',
      'takuu',
    ],
  },
  {
    cat: 'docs_work',
    words: [
      'cv',
      'ozgecmis',
      'resume',
      'teklif',
      'proposal',
      'toplanti',
      'meeting',
      'is plani',
      'offer letter',
      'rapor',
      'report',
      'ansioluettelo',
      'tarjous',
    ],
  },
  { cat: 'books', words: ['abstract', 'isbn', 'references', 'kaynakca', 'chapter', 'bolum 1'] },
]

const wordHit = (text: string, w: string): boolean => {
  // Short keywords must be whole words to avoid "cv" in "cvs-…" or "fis" in "fisher".
  if (w.length <= 3) return new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`).test(text)
  return text.includes(w)
}

export function keywordCategory(
  name: string,
  excerpt: string | undefined,
): { cat: string; inName: boolean; inText: boolean; word: string } | null {
  const n = fold(name).replace(/[_.-]+/g, ' ')
  const t = excerpt ? fold(excerpt.slice(0, 1500)) : ''
  for (const k of KEYWORDS) {
    for (const w of k.words) {
      const inName = wordHit(n, w.trim())
      const inText = !!t && wordHit(t, w.trim())
      if (inName || inText) return { cat: k.cat, inName, inText, word: w.trim() }
    }
  }
  return null
}

/** Year (and month) found in a file name: 2023-05, 2023_05, "Mart 2024", 2024. */
export function dateFromName(name: string): { year: number; month?: number } | undefined {
  const n = fold(name)
  const now = new Date().getFullYear()
  const ym =
    /(?:^|[^0-9])((?:19|20)\d{2})[-_. ]?(0[1-9]|1[0-2])(?:[-_. ]?(?:[0-2]\d|3[01]))?(?:[^0-9]|$)/.exec(
      n,
    )
  if (ym) {
    const y = Number(ym[1])
    if (y >= 1990 && y <= now + 1) return { year: y, month: Number(ym[2]) }
  }
  const months = [
    'ocak',
    'subat',
    'mart',
    'nisan',
    'mayis',
    'haziran',
    'temmuz',
    'agustos',
    'eylul',
    'ekim',
    'kasim',
    'aralik',
  ]
  const my = new RegExp(`(${months.join('|')})\\s*((?:19|20)\\d{2})`).exec(n)
  if (my) return { year: Number(my[2]), month: months.indexOf(my[1]!) + 1 }
  const y = /(?:^|[^0-9])((?:19|20)\d{2})(?:[^0-9]|$)/.exec(n)
  if (y) {
    const yy = Number(y[1])
    if (yy >= 1990 && yy <= now + 1) return { year: yy }
  }
  return undefined
}

function exifDate(meta: FileMeta): { year: number; month: number } | undefined {
  if (!meta.exifDate) return undefined
  const m = /^(\d{4})[-:](\d{2})/.exec(meta.exifDate)
  if (!m) return undefined
  const year = Number(m[1])
  if (year < 1990) return undefined
  return { year, month: Number(m[2]) }
}

function mtimeDate(f: FileRecord): { year: number; month: number } {
  const d = new Date(f.mtime)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

export function classifyFile(f: FileRecord, meta: FileMeta, settings: Settings): RuleResult {
  const name = f.name
  const folded = fold(name)
  const ext = f.ext
  const mdate = mtimeDate(f)

  // Junk first: empty files, partial downloads, temp files.
  if (f.kind === 'file') {
    if (f.size === 0) return { category: 'junk', confidence: 0.95, reason: 'Boş dosya (0 bayt).' }
    if (JUNK_EXTS.has(ext))
      return { category: 'junk', confidence: 0.9, reason: `Geçici/yarım dosya (.${ext}).` }
    if (settings.scan.minFileSizeKB > 0 && f.size < settings.scan.minFileSizeKB * 1024)
      return { category: 'junk', confidence: 0.6, reason: 'Çok küçük dosya.' }
  }

  // Bundles and projects.
  if (f.kind === 'bundle') {
    if (meta.bundleType === 'project')
      return { category: 'code', confidence: 0.98, reason: 'Kod projesi klasörü (bütün olarak).' }
    if (ext === 'app')
      return { category: 'installers', confidence: 0.95, reason: 'macOS uygulaması.' }
    if (ext === 'key')
      return { category: 'presentations', confidence: 0.9, reason: 'Keynote sunumu.' }
    if (ext === 'numbers')
      return { category: 'spreadsheets', confidence: 0.85, reason: 'Numbers tablosu.' }
    if (ext === 'pages') {
      const kw = keywordCategory(name, undefined)
      if (kw)
        return {
          category: kw.cat,
          confidence: 0.8,
          reason: `Pages belgesi; adında “${kw.word}” geçiyor.`,
          date: dateFromName(name),
        }
      return { category: 'docs_other', confidence: 0.55, reason: 'Pages belgesi.' }
    }
    if (['xcodeproj', 'xcworkspace', 'playground'].includes(ext))
      return { category: 'code', confidence: 0.95, reason: 'Xcode projesi.' }
    if (['band', 'logicx'].includes(ext))
      return { category: 'audio', confidence: 0.9, reason: 'Müzik projesi.' }
    if (ext === 'fcpbundle' || ext === 'imovielibrary')
      return { category: 'videos', confidence: 0.85, reason: 'Video projesi.' }
    if (ext === 'rtfd') return { category: 'docs_other', confidence: 0.6, reason: 'RTFD belgesi.' }
    return { category: 'uncertain', confidence: 0.3, reason: 'Paket; içeriği bilinmiyor.' }
  }

  switch (f.family) {
    case 'image': {
      if (settings.images.detectScreenshots && SCREENSHOT_RE.test(folded + ' '))
        return {
          category: 'screenshots',
          confidence: 0.95,
          reason: 'Adı ekran görüntüsü kalıbına uyuyor.',
          date: dateFromName(name) ?? mdate,
        }
      const ex = exifDate(meta)
      if (ex || meta.camera)
        return {
          category: 'photos',
          confidence: 0.95,
          reason: meta.camera ? `EXIF’e göre ${meta.camera} fotoğrafı.` : 'EXIF tarihli fotoğraf.',
          date: (settings.images.useExifDateForFolder && ex) || dateFromName(name) || mdate,
        }
      if (['heic', 'heif', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raw'].includes(ext))
        return {
          category: 'photos',
          confidence: 0.85,
          reason: 'Kamera/telefon fotoğraf biçimi.',
          date: dateFromName(name) ?? mdate,
        }
      if (CAMERA_NAME_RE.test(folded))
        return {
          category: 'photos',
          confidence: 0.8,
          reason: 'Ad kamera fotoğrafı kalıbında.',
          date: dateFromName(name) ?? mdate,
        }
      if (ext === 'png' && meta.width && meta.height && isScreenSize(meta.width, meta.height))
        return {
          category: 'screenshots',
          confidence: 0.6,
          reason: 'Ekran çözünürlüğünde PNG.',
          date: mdate,
        }
      return {
        category: 'images_other',
        confidence: ['svg', 'gif', 'ico', 'webp'].includes(ext) ? 0.85 : 0.7,
        reason: 'Kamera bilgisi olmayan görsel.',
      }
    }
    case 'video':
      if (SCREEN_RECORDING_RE.test(folded))
        return {
          category: 'screenshots',
          confidence: 0.9,
          reason: 'Ekran kaydı.',
          date: dateFromName(name) ?? mdate,
        }
      return {
        category: 'videos',
        confidence: 0.92,
        reason: 'Video dosyası.',
        date: dateFromName(name) ?? mdate,
      }
    case 'audio':
      return {
        category: 'audio',
        confidence: 0.95,
        reason: meta.artist ? `Müzik (${meta.artist}).` : 'Ses dosyası.',
      }
    case 'installer':
      return { category: 'installers', confidence: 0.97, reason: `Kurulum dosyası (.${ext}).` }
    case 'archive': {
      const kw = keywordCategory(name, undefined)
      if (kw && kw.cat !== 'books')
        return {
          category: 'archives',
          confidence: 0.75,
          reason: `Arşiv; adında “${kw.word}” geçiyor.`,
        }
      return { category: 'archives', confidence: 0.9, reason: `Arşiv dosyası (.${ext}).` }
    }
    case 'code':
      return { category: 'code', confidence: 0.85, reason: 'Betik / kaynak kod.' }
    case 'design':
      return { category: 'design', confidence: 0.9, reason: 'Tasarım / yazı tipi dosyası.' }
    case 'book':
      return { category: 'books', confidence: 0.95, reason: 'E-kitap.' }
    case 'presentation':
      return {
        category: 'presentations',
        confidence: 0.9,
        reason: 'Sunum dosyası.',
        date: dateFromName(name),
      }
    default:
      break
  }

  // Documents, spreadsheets and text: keyword rules on name + excerpt.
  const kw = keywordCategory(name, meta.textExcerpt)
  const date = dateFromName(name)
  if (kw) {
    const both = kw.inName && kw.inText
    const confidence = both ? 0.92 : kw.inName ? 0.88 : 0.7
    const where = kw.inName ? 'adında' : 'içeriğinde'
    if (f.family === 'spreadsheet' && !kw.inName && kw.cat !== 'docs_finance')
      return { category: 'spreadsheets', confidence: 0.75, reason: 'Tablo dosyası.', date }
    return { category: kw.cat, confidence, reason: `Belgenin ${where} “${kw.word}” geçiyor.`, date }
  }
  if (f.family === 'spreadsheet')
    return { category: 'spreadsheets', confidence: 0.85, reason: 'Tablo dosyası.', date }
  if (ext === 'csv' || ext === 'tsv')
    return { category: 'spreadsheets', confidence: 0.75, reason: 'CSV tablo.', date }
  if (f.family === 'document') {
    if (meta.scanned)
      return {
        category: 'docs_other',
        confidence: 0.4,
        reason: 'Taranmış belge; metin okunamadı.',
        date,
      }
    return {
      category: 'docs_other',
      confidence: 0.55,
      reason: 'Belge; türü kurallarla belirlenemedi.',
      date,
    }
  }
  if (f.family === 'text')
    return { category: 'docs_other', confidence: 0.5, reason: 'Metin dosyası.', date }
  return { category: 'uncertain', confidence: 0.3, reason: 'Tür belirlenemedi.' }
}

function isScreenSize(w: number, h: number): boolean {
  const common = [
    [1920, 1080],
    [2560, 1440],
    [2880, 1800],
    [3024, 1964],
    [3456, 2234],
    [2560, 1600],
    [1440, 900],
    [1366, 768],
    [1280, 800],
    [3840, 2160],
    [1170, 2532],
    [1179, 2556],
    [1290, 2796],
    [1284, 2778],
    [1125, 2436],
    [828, 1792],
    [750, 1334],
    [1080, 2400],
    [1080, 1920],
  ]
  return common.some(([a, b]) => (w === a && h === b) || (w === b && h === a))
}

/** Rule pass over a whole session: stores rule_category / rule_confidence. */
export function classifySession(repos: Repos, sessionId: string, settings: Settings): void {
  const files = repos.files.bySession(sessionId)
  const metas = repos.files.metaBySession(sessionId)
  const updates = files
    .filter((f) => f.kind === 'file' || f.kind === 'bundle')
    .map((f) => {
      const r = classifyFile(f, metas.get(f.id) ?? {}, settings)
      return { id: f.id, patch: { ruleCategory: r.category, ruleConfidence: r.confidence } }
    })
  repos.files.updateMany(updates)
}

/** Generic name pattern for corrections: digits → #, lower-cased, extension stripped. */
export function namePattern(name: string): string {
  const stem = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name
  return fold(stem).replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 40)
}
