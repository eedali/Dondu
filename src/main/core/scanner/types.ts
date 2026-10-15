import type { FileFamily } from '@shared/types'

/** macOS packages that are directories but must be treated as a single file (docs/04 §1.3). */
export const BUNDLE_EXTS = new Set([
  'app',
  'pages',
  'numbers',
  'key',
  'photoslibrary',
  'rtfd',
  'bundle',
  'framework',
  'pkg',
  'xcodeproj',
  'xcworkspace',
  'scriptterm',
  'band',
  'logicx',
  'fcpbundle',
  'musiclibrary',
  'tvlibrary',
  'imovielibrary',
  'aplibrary',
  'plugin',
  'kext',
  'prefpane',
  'qlgenerator',
  'mdimporter',
  'playground',
  'sparsebundle',
])

/** Any of these inside a folder marks it as a code project (treated as a unit). */
export const PROJECT_MARKERS = [
  '.git',
  'package.json',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'pom.xml',
  'build.gradle',
  'Gemfile',
  'composer.json',
  'CMakeLists.txt',
]
export const PROJECT_MARKER_EXTS = ['xcodeproj', 'sln', 'csproj', 'xcworkspace']

const FAMILY_BY_EXT: Record<string, FileFamily> = {}
const add = (family: FileFamily, exts: string): void => {
  for (const e of exts.split(/\s+/).filter(Boolean)) FAMILY_BY_EXT[e] = family
}
add(
  'image',
  'jpg jpeg png gif heic heif webp bmp tif tiff svg ico raw cr2 cr3 nef arw dng orf rw2 avif jfif',
)
add('document', 'pdf doc docx odt rtf pages wpd xps oxps md5 rtfd')
add('spreadsheet', 'xls xlsx xlsm ods numbers tsv')
add('presentation', 'ppt pptx pps ppsx odp key')
add('text', 'txt md markdown csv json xml yaml yml log ini cfg conf toml html htm srt vtt tex nfo')
add('audio', 'mp3 m4a aac wav flac ogg oga opus wma aiff aif amr caf mid midi')
add('video', 'mp4 mov m4v avi mkv wmv webm mpg mpeg 3gp mts m2ts flv')
add('archive', 'zip rar 7z tar gz tgz bz2 xz tbz2 txz zst cab lz lzma iso')
add('installer', 'dmg pkg mpkg exe msi msix appx appxbundle app apk deb rpm')
add(
  'code',
  'js mjs cjs ts tsx jsx py rb go rs java kt swift c h cpp hpp cs php sh ps1 bat cmd sql ipynb lua r scala dart vue svelte',
)
add(
  'design',
  'psd ai sketch fig xd indd afdesign afphoto afpub eps ttf otf woff woff2 blend obj fbx stl c4d',
)
add('book', 'epub mobi azw azw3 djvu fb2 cbz cbr')
// keychain/certs etc. stay 'other'; sensitive detector handles them.

/** Multi-dot extensions that must be kept together. */
const MULTI_EXT = ['tar.gz', 'tar.bz2', 'tar.xz', 'tar.zst', 'user.js', 'd.ts']

export function splitExt(name: string): { stem: string; ext: string } {
  const lower = name.toLowerCase()
  for (const m of MULTI_EXT) {
    if (lower.endsWith('.' + m) && lower.length > m.length + 1)
      return { stem: name.slice(0, -(m.length + 1)), ext: m }
  }
  const i = name.lastIndexOf('.')
  if (i <= 0 || i === name.length - 1) return { stem: name, ext: '' }
  return { stem: name.slice(0, i), ext: name.slice(i + 1).toLowerCase() }
}

export function familyOf(ext: string, mime?: string): FileFamily {
  const last = ext.includes('.') ? (ext.split('.').pop() ?? ext) : ext
  const f = FAMILY_BY_EXT[ext] ?? FAMILY_BY_EXT[last]
  if (f) return f
  if (mime) {
    if (mime.startsWith('image/')) return 'image'
    if (mime.startsWith('audio/')) return 'audio'
    if (mime.startsWith('video/')) return 'video'
    if (mime === 'application/pdf') return 'document'
    if (mime.startsWith('text/')) return 'text'
    if (/zip|x-7z|x-rar|gzip|x-tar|x-bzip/.test(mime)) return 'archive'
  }
  return 'other'
}

export const TEXT_EXTS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'xml',
  'yaml',
  'yml',
  'log',
  'ini',
  'cfg',
  'conf',
  'toml',
  'html',
  'htm',
  'srt',
  'vtt',
  'tex',
  'nfo',
  'rtf',
  'env',
])
