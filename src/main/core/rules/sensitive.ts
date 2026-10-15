/**
 * Sensitive file detector (docs/03 §6). Any single signal is enough. Pure functions only.
 */

export const SENSITIVE_EXTS = new Set([
  'key',
  'pem',
  'p12',
  'pfx',
  'kdbx',
  'kdb',
  'env',
  'ovpn',
  'ppk',
  'keychain',
  'keychain-db',
  'asc',
  'gpg',
  'wallet',
  'jks',
  'cer',
  'csr',
  'mobileconfig',
])

const SENSITIVE_NAMES = [
  'parola',
  'şifre',
  'sifre',
  'password',
  'passwd',
  'pwd',
  'pin',
  'iban',
  'kimlik',
  'nüfus',
  'nufus',
  'pasaport',
  'passport',
  'ehliyet',
  'vergi',
  'secret',
  'token',
  'api[_-]?key',
  'credential',
  'salasana',
  'henkilötunnus',
  'henkilotunnus',
  'verokortti',
  'tilinumero',
  'backup[ _-]?codes',
  'recovery',
  'wallet\\.dat',
  'id_rsa',
  'id_ed25519',
]

export interface SensitiveOptions {
  extraNamePatterns?: string[]
  extraExtensions?: string[]
  contentScan?: boolean
}

export interface SensitiveResult {
  sensitive: boolean
  reason?: string
}

/** Case folding that treats Turkish I/ı/İ and Latin I/i alike (PIN, pın, Pİn → pin). */
const lower = (s: string): string =>
  s.replace(/İ/g, 'i').replace(/I/g, 'i').toLowerCase().replace(/ı/g, 'i')

/** Short keywords that must stand alone ("pin" must not match "pinterest"). */
const WHOLE_WORD = new Set(['pin', 'pwd'])

function nameRegex(extra: string[]): RegExp {
  const prefix = [
    ...SENSITIVE_NAMES.filter((n) => !WHOLE_WORD.has(n)),
    ...extra.filter(Boolean).map(escapeUserPattern),
  ]
  const whole = [...WHOLE_WORD]
  // Keyword must start a word; Turkish/Finnish suffixes may follow (parolalar, kimliğim).
  return new RegExp(
    `(?:^|[^\\p{L}])(?:(${prefix.join('|')})|(${whole.join('|')})(?=$|[^\\p{L}]))`,
    'iu',
  )
}

function escapeUserPattern(p: string): string {
  return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---- validators -------------------------------------------------------------

/** Turkish national ID (TC Kimlik No) checksum. */
export function isValidTcKimlik(s: string): boolean {
  if (!/^[1-9]\d{10}$/.test(s)) return false
  const d = s.split('').map(Number)
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!
  const even = d[1]! + d[3]! + d[5]! + d[7]!
  const d10 = (((odd * 7 - even) % 10) + 10) % 10
  if (d10 !== d[9]) return false
  const d11 = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10
  return d11 === d[10]
}

/** IBAN mod-97 check. */
export function isValidIban(raw: string): boolean {
  const s = raw.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false
  const rearranged = s.slice(4) + s.slice(0, 4)
  let rem = 0
  for (const ch of rearranged) {
    const code = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch
    for (const digit of code) rem = (rem * 10 + Number(digit)) % 97
  }
  return rem === 1
}

/** Luhn check for card numbers (13–19 digits). */
export function isValidLuhn(digits: string): boolean {
  const s = digits.replace(/[\s-]/g, '')
  if (!/^\d{13,19}$/.test(s)) return false
  if (/^(\d)\1+$/.test(s)) return false
  let sum = 0
  let dbl = false
  for (let i = s.length - 1; i >= 0; i--) {
    let n = Number(s[i])
    if (dbl) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    dbl = !dbl
  }
  return sum % 10 === 0
}

/** Finnish personal identity code (HETU) incl. checksum. */
export function isValidHetu(s: string): boolean {
  const m = /^(\d{6})([-+ABCDEFYXWVU])(\d{3})([0-9A-Y])$/.exec(s.toUpperCase())
  if (!m) return false
  const chars = '0123456789ABCDEFHJKLMNPRSTUVWXY'
  const n = Number(m[1]! + m[3]!)
  return chars[n % 31] === m[4]
}

// ---- content scan -----------------------------------------------------------

export function scanContent(text: string): string | undefined {
  if (/-----BEGIN (RSA |EC |DSA |OPENSSH |ENCRYPTED |)PRIVATE KEY-----/.test(text))
    return 'özel anahtar (PEM)'
  if (/(password|passwd|şifre|sifre|parola|salasana)\s*[:=]\s*\S{3,}/iu.test(text))
    return 'parola içeriyor'
  for (const m of text.matchAll(/(?<!\d)[1-9]\d{10}(?!\d)/g)) {
    if (isValidTcKimlik(m[0])) return 'TC kimlik numarası'
  }
  for (const m of text.matchAll(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g)) {
    if (isValidIban(m[0])) return 'IBAN'
  }
  for (const m of text.matchAll(/(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])/g)) {
    if (isValidLuhn(m[0])) return 'kart numarası'
  }
  for (const m of text.matchAll(/\b\d{6}[-+ABCDEFYXWVU]\d{3}[0-9A-Y]\b/g)) {
    if (isValidHetu(m[0])) return 'henkilötunnus (HETU)'
  }
  return undefined
}

export function detectSensitive(
  input: { name: string; ext: string; text?: string; mime?: string; isBundle?: boolean },
  opts: SensitiveOptions = {},
): SensitiveResult {
  const ext = lower(input.ext)
  const extra = (opts.extraExtensions ?? []).map((e) => lower(e.replace(/^\./, '')))
  // `.key` is also Keynote (a zip or a bundle) — only plain .key files are key material.
  const keynote = ext === 'key' && (input.isBundle || input.mime === 'application/zip')
  if (!keynote && (SENSITIVE_EXTS.has(ext) || extra.includes(ext)))
    return { sensitive: true, reason: `.${ext} uzantısı` }
  if (lower(input.name) === 'wallet.dat') return { sensitive: true, reason: 'cüzdan dosyası' }
  const nm = nameRegex(opts.extraNamePatterns ?? []).exec(lower(input.name))
  if (nm) return { sensitive: true, reason: `adında “${nm[1] ?? nm[2]}” geçiyor` }
  if (opts.contentScan !== false && input.text) {
    const r = scanContent(input.text)
    if (r) return { sensitive: true, reason: r }
  }
  return { sensitive: false }
}
