import { crc32, deflateSync } from 'node:zlib'

/** Minimal binary writers for fixtures: PNG, EXIF-in-JPEG, stored ZIP, WAV. Test-only code. */

const u32be = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n >>> 0)
  return b
}

function chunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, 'ascii')
  return Buffer.concat([u32be(data.length), t, data, u32be(crc32(Buffer.concat([t, data])))])
}

/** RGB PNG from a pixel callback. */
export function makePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y)
      const o = y * (width * 3 + 1) + 1 + x * 3
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Inserts an EXIF APP1 segment (Make, Model, DateTimeOriginal, optional GPS) into a JPEG. */
export function withExif(
  jpeg: Buffer,
  exif: { make: string; model: string; date: Date; gps?: boolean },
): Buffer {
  const ascii = (s: string): Buffer => Buffer.concat([Buffer.from(s, 'ascii'), Buffer.from([0])])
  const pad = (n: number): string => String(n).padStart(2, '0')
  const d = exif.date
  const dt = ascii(
    `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  )
  const make = ascii(exif.make)
  const model = ascii(exif.model)

  // Layout (little endian TIFF): header(8) | IFD0 | data | ExifIFD | data | GPS IFD | data
  const ifd0Count = exif.gps ? 4 : 3
  const ifd0Size = 2 + ifd0Count * 12 + 4
  const ifd0 = 8
  const makeOff = ifd0 + ifd0Size
  const modelOff = makeOff + make.length
  const exifIfdOff = modelOff + model.length
  const exifIfdSize = 2 + 1 * 12 + 4
  const dtOff = exifIfdOff + exifIfdSize
  const gpsIfdOff = dtOff + dt.length
  const gpsIfdSize = 2 + 4 * 12 + 4
  const latOff = gpsIfdOff + gpsIfdSize
  const lonOff = latOff + 24
  const total = exif.gps ? lonOff + 24 : gpsIfdOff
  const t = Buffer.alloc(total)
  t.write('II', 0, 'ascii')
  t.writeUInt16LE(42, 2)
  t.writeUInt32LE(ifd0, 4)
  const entry = (at: number, tag: number, type: number, count: number, value: number): void => {
    t.writeUInt16LE(tag, at)
    t.writeUInt16LE(type, at + 2)
    t.writeUInt32LE(count, at + 4)
    t.writeUInt32LE(value, at + 8)
  }
  t.writeUInt16LE(ifd0Count, ifd0)
  entry(ifd0 + 2, 0x010f, 2, make.length, makeOff)
  entry(ifd0 + 14, 0x0110, 2, model.length, modelOff)
  entry(ifd0 + 26, 0x8769, 4, 1, exifIfdOff)
  if (exif.gps) entry(ifd0 + 38, 0x8825, 4, 1, gpsIfdOff)
  t.writeUInt32LE(0, ifd0 + 2 + ifd0Count * 12)
  make.copy(t, makeOff)
  model.copy(t, modelOff)
  t.writeUInt16LE(1, exifIfdOff)
  entry(exifIfdOff + 2, 0x9003, 2, dt.length, dtOff)
  t.writeUInt32LE(0, exifIfdOff + 14)
  dt.copy(t, dtOff)
  if (exif.gps) {
    t.writeUInt16LE(4, gpsIfdOff)
    // LatitudeRef 'N', Latitude, LongitudeRef 'E', Longitude (rationals)
    t.writeUInt16LE(0x0001, gpsIfdOff + 2)
    t.writeUInt16LE(2, gpsIfdOff + 4)
    t.writeUInt32LE(2, gpsIfdOff + 6)
    t.write('N\0', gpsIfdOff + 10, 'ascii')
    entry(gpsIfdOff + 14, 0x0002, 5, 3, latOff)
    t.writeUInt16LE(0x0003, gpsIfdOff + 26)
    t.writeUInt16LE(2, gpsIfdOff + 28)
    t.writeUInt32LE(2, gpsIfdOff + 30)
    t.write('E\0', gpsIfdOff + 34, 'ascii')
    entry(gpsIfdOff + 38, 0x0004, 5, 3, lonOff)
    t.writeUInt32LE(0, gpsIfdOff + 50)
    const rat = (off: number, vals: number[]): void =>
      vals.forEach((v, i) => {
        t.writeUInt32LE(v, off + i * 8)
        t.writeUInt32LE(1, off + i * 8 + 4)
      })
    rat(latOff, [60, 10, 30])
    rat(lonOff, [24, 56, 15])
  }
  const header = Buffer.from('Exif\0\0', 'ascii')
  const len = header.length + t.length + 2
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, len >> 8, len & 0xff]), header, t])
  // after SOI (FFD8)
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)])
}

/** Stored (uncompressed) ZIP archive. */
export function makeZip(files: { name: string; data: Buffer | string }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8')
    const name = Buffer.from(f.name, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // utf8 names
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(crc >>> 0, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt32LE(crc >>> 0, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += 30 + name.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

/** Mono 16-bit PCM WAV with a sine tone. */
export function makeWav(seconds: number, freq = 440, rate = 8000): Buffer {
  const n = Math.round(seconds * rate)
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++)
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 8000), i * 2)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0, 'ascii')
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVEfmt ', 8, 'ascii')
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(rate, 24)
  h.writeUInt32LE(rate * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36, 'ascii')
  h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

/** Valid-looking TC Kimlik number (correct checksum). */
export function makeTcKimlik(seed: number): string {
  const d = String(100000000 + (seed % 899999999))
    .slice(0, 9)
    .split('')
    .map(Number)
  if (d[0] === 0) d[0] = 1
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!
  const even = d[1]! + d[3]! + d[5]! + d[7]!
  const d10 = (((odd * 7 - even) % 10) + 10) % 10
  const d11 = (d.reduce((a, b) => a + b, 0) + d10) % 10
  return d.join('') + d10 + d11
}

/** Valid IBAN for a country + BBAN (computes the check digits). */
export function makeIban(country: string, bban: string): string {
  const rearranged = bban + country + '00'
  let rem = 0
  for (const ch of rearranged) {
    const code = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch
    for (const digit of code) rem = (rem * 10 + Number(digit)) % 97
  }
  const check = String(98 - rem).padStart(2, '0')
  return country + check + bban
}
