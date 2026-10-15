import { describe, expect, it } from 'vitest'
import {
  detectSensitive,
  isValidHetu,
  isValidIban,
  isValidLuhn,
  isValidTcKimlik,
  scanContent,
} from '../../src/main/core/rules/sensitive'
import { makeIban, makeTcKimlik } from '../../scripts/fixtures/binary'

describe('validators', () => {
  it('TC Kimlik checksum', () => {
    expect(isValidTcKimlik('10000000146')).toBe(true)
    expect(isValidTcKimlik(makeTcKimlik(987654))).toBe(true)
    expect(isValidTcKimlik('10000000147')).toBe(false)
    expect(isValidTcKimlik('01234567890')).toBe(false)
  })
  it('IBAN mod-97', () => {
    expect(isValidIban('TR330006100519786457841326')).toBe(true)
    expect(isValidIban('FI21 1234 5600 0007 85')).toBe(true)
    expect(isValidIban('DE89370400440532013000')).toBe(true)
    expect(isValidIban('TR330006100519786457841327')).toBe(false)
    expect(isValidIban(makeIban('TR', '0006200119000006672315'))).toBe(true)
  })
  it('Luhn', () => {
    expect(isValidLuhn('4111 1111 1111 1111')).toBe(true)
    expect(isValidLuhn('4111 1111 1111 1112')).toBe(false)
    expect(isValidLuhn('0000000000000')).toBe(false)
  })
  it('HETU', () => {
    expect(isValidHetu('131052-308T')).toBe(true)
    expect(isValidHetu('131052-308U')).toBe(false)
    expect(isValidHetu('010181A123Y')).toBe(false)
  })
})

describe('detectSensitive', () => {
  it('flags by extension, but not Keynote .key', () => {
    expect(detectSensitive({ name: 'server.pem', ext: 'pem' }).sensitive).toBe(true)
    expect(
      detectSensitive({ name: 'Sunum.key', ext: 'key', mime: 'application/zip' }).sensitive,
    ).toBe(false)
    expect(detectSensitive({ name: 'Sunum.key', ext: 'key', isBundle: true }).sensitive).toBe(false)
    expect(detectSensitive({ name: 'private.key', ext: 'key' }).sensitive).toBe(true)
  })
  it('flags by name keywords incl. Turkish suffixes, not substrings of other words', () => {
    expect(detectSensitive({ name: 'parolalar.txt', ext: 'txt' }).sensitive).toBe(true)
    expect(detectSensitive({ name: 'Kimlik Fotokopisi.pdf', ext: 'pdf' }).sensitive).toBe(true)
    expect(detectSensitive({ name: 'verokortti_2024.pdf', ext: 'pdf' }).sensitive).toBe(true)
    expect(detectSensitive({ name: 'PIN.txt', ext: 'txt' }).sensitive).toBe(true)
    expect(detectSensitive({ name: 'pinterest-ideas.txt', ext: 'txt' }).sensitive).toBe(false)
    expect(detectSensitive({ name: 'tatil.jpg', ext: 'jpg' }).sensitive).toBe(false)
    expect(
      detectSensitive({ name: 'ozel.txt', ext: 'txt' }, { extraNamePatterns: ['ozel'] }).sensitive,
    ).toBe(true)
  })
  it('flags by content', () => {
    expect(scanContent('-----BEGIN RSA PRIVATE KEY-----')).toBeTruthy()
    expect(scanContent('şifre: gizli123')).toBeTruthy()
    expect(scanContent(`TC no ${makeTcKimlik(1234)}`)).toBe('TC kimlik numarası')
    expect(scanContent('IBAN TR33 0006 1005 1978 6457 8413 26')).toBe('IBAN')
    expect(scanContent('Kart 4111-1111-1111-1111')).toBe('kart numarası')
    expect(scanContent('hetu 131052-308T')).toBe('henkilötunnus (HETU)')
    expect(scanContent('Fatura no 2024-03-118, toplam 412,50 TL')).toBeUndefined()
    expect(
      detectSensitive({ name: 'a.txt', ext: 'txt', text: 'şifre: x1234' }, { contentScan: false })
        .sensitive,
    ).toBe(false)
  })
})
