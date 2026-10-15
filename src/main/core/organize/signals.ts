import type { FileMeta, FileRecord } from '@shared/types'
import { fold } from '../rules'
import { splitExt } from '../scanner/types'

/**
 * Cheap, local signals used before (and without) any AI: screenshot device, sound effect vs
 * music, game assets, generic/container folder names.
 */

const PHONE_SCREENS = [
  [1170, 2532],
  [1179, 2556],
  [1290, 2796],
  [1284, 2778],
  [1125, 2436],
  [828, 1792],
  [750, 1334],
  [1242, 2688],
  [1242, 2208],
  [1080, 2400],
  [1080, 1920],
  [1080, 2340],
  [1440, 3200],
  [1440, 3088],
  [1080, 2408],
  [720, 1600],
  [1206, 2622],
  [1320, 2868],
  [640, 1136],
]
const PC_SCREENS = [
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
  [1536, 864],
  [1680, 1050],
  [2736, 1824],
  [2256, 1504],
  [1920, 1200],
  [3440, 1440],
  [2560, 1080],
  [1600, 900],
  [2880, 1864],
  [3072, 1920],
]

const matches = (list: number[][], w: number, h: number): boolean =>
  list.some(([a, b]) => (w === a && h === b) || (w === b && h === a))

/** Desktop screenshot names (macOS, Windows, Linux, several languages). */
const PC_NAME_RE =
  /^(ekran resmi|ekran goruntusu|screen shot|screenshot \d{4}-\d{2}-\d{2}|screenshot from|bildschirmfoto|capture d.ecran|schermafbeelding|nayttokuva|kuvakaappaus|cleanshot|snip|snapshot)/
/** Phone screenshot names (Android, iOS share sheet, messengers). */
const PHONE_NAME_RE =
  /^(screenshot_\d{8}|screenshot_\d{4}-\d{2}-\d{2}|scr_\d{8}|simulator screen shot)/
const ANY_SCREENSHOT_RE =
  /^(screenshot|screen shot|ekran resmi|ekran goruntusu|nayttokuva|bildschirmfoto)/

/**
 * Is this image a screenshot, and from which device? Uses the name first, then the pixel size
 * (portrait tall = phone, landscape = computer). Catches iPhone screenshots named IMG_1234.PNG.
 */
export function screenshotDevice(f: FileRecord, meta: FileMeta): 'phone' | 'pc' | null {
  if (f.family !== 'image') return null
  const n = fold(f.name)
  const w = meta.width
  const h = meta.height
  const hasCamera = !!meta.camera
  if (PHONE_NAME_RE.test(n)) return 'phone'
  if (PC_NAME_RE.test(n)) {
    // Mac/Windows names, but a phone-shaped image was AirDropped from a phone.
    if (w && h && h / w >= 1.6) return 'phone'
    return 'pc'
  }
  if (ANY_SCREENSHOT_RE.test(n)) return w && h && h / w >= 1.6 ? 'phone' : 'pc'
  // Unnamed: a PNG without camera data at an exact screen resolution.
  if (!hasCamera && w && h && (f.ext === 'png' || f.ext === 'jpg' || f.ext === 'jpeg')) {
    if (matches(PHONE_SCREENS, w, h)) return 'phone'
    if (f.ext === 'png' && matches(PC_SCREENS, w, h)) return 'pc'
  }
  return null
}

const SFX_WORDS =
  /(^|[^a-z])(sfx|fx|click|clic|beep|blip|jump|hit|hurt|explosion|explode|coin|pickup|power ?up|laser|shoot|shot|swoosh|whoosh|woosh|impact|footstep|step|ui|button|hover|select|confirm|cancel|error|success|notification|notif|alert|pop|bonk|punch|swing|slash|zap|door|ding|chime|bubble|splash)([^a-z]|$)/
const VOICE_WORDS =
  /(sesli not|ses kaydi|voice|recording|kayit|memo|ptt-|aud-|whatsapp audio|yeni kayit|record)/

/** Sound effect vs music vs voice note (revision 1: "how will I tell my SFX apart?"). */
export function audioKind(f: FileRecord, meta: FileMeta): 'sound_effect' | 'voice_note' | 'music' {
  const n = fold(splitExt(f.name).stem)
  const d = meta.durationSec
  const tagged = !!(meta.artist || meta.album)
  if (!tagged && VOICE_WORDS.test(n)) return 'voice_note'
  if (!tagged && (f.ext === 'amr' || f.ext === 'opus')) return 'voice_note'
  if (!tagged && d !== undefined && d <= 10) return 'sound_effect'
  if (!tagged && SFX_WORDS.test(n.replace(/[_-]+/g, ' '))) return 'sound_effect'
  if (
    !tagged &&
    d === undefined &&
    f.size < 300 * 1024 &&
    ['wav', 'ogg', 'aiff', 'aif'].includes(f.ext)
  )
    return 'sound_effect'
  return 'music'
}

const GAME_EXTS = new Set([
  'unitypackage',
  'tres',
  'tscn',
  'godot',
  'tmx',
  'tsx_tiled',
  'ldtk',
  'aseprite',
  'ase',
  'pyxel',
  'fbx',
  'blend',
  'gltf',
  'glb',
  'dae',
  'uasset',
  'umap',
  'atlas',
  'spine',
  'skel',
])
const GAME_NAME_RE =
  /(^|[^a-z])(sprite|sprites|spritesheet|tileset|tilesheet|tiles|texture|textures|assets?|sfx|kenney|itch|unity|godot|unreal|pixel ?art|character|enemy|player|level|platformer|rpg|ui pack|game)([^a-z]|$)/

export function isGameAssetName(name: string): boolean {
  return GAME_NAME_RE.test(fold(name).replace(/[_-]+/g, ' '))
}

export function isGameAssetFile(f: FileRecord): boolean {
  return GAME_EXTS.has(f.ext)
}

/** Folder names that say nothing about their content: their files are sorted one by one. */
const GENERIC_DIR_RE =
  /^(yeni klasor|new folder|untitled folder|adsiz klasor|klasor|folder|temp|tmp|misc|diger|other|others|stuff|files|dosyalar|yeni|new|untitled|downloads?|indirilenler|desktop|masaustu|documents|belgeler|unsorted|karisik|eski|old|backup|yedek|\d+)( ?\(\d+\))?( \d+)?$/

/** Top-level "container" folders: never moved as a unit, but their sub-folders may be. */
const CONTAINER_DIR_RE =
  /^(belgeler|documents|dokumanlar|fotograflar|photos|pictures|resimler|gorseller|images|videolar|videos|muzik|music|muzik ve ses|ses efektleri|sesli notlar|ekran goruntuleri|screenshots|projeler|projects|yazilim|software|arsivler|archives|kitaplar|books|tasarim|design|oyun gelistirme|kurslar|courses|indirilenler|downloads|masaustu|desktop|etkinlikler|events|aile|family|is|work|okul|school|egitim)$/

export function isGenericDirName(name: string): boolean {
  return GENERIC_DIR_RE.test(fold(name).trim())
}

export function isContainerDirName(name: string): boolean {
  return CONTAINER_DIR_RE.test(fold(name).trim())
}

/** Capture time for event clustering: EXIF only, or a camera-style name (VID_…, IMG_…). */
export function captureTime(f: FileRecord, meta: FileMeta): number | undefined {
  if (meta.exifDate) {
    const t = Date.parse(meta.exifDate)
    if (Number.isFinite(t)) return t
  }
  if (
    (f.family === 'video' || f.family === 'image') &&
    /^(img|vid|pxl|mvimg|dsc|gopr|dji)[_-]?\d/.test(fold(f.name))
  )
    return f.mtime
  return undefined
}
