import fs from 'node:fs'
import path from 'node:path'

/** Minimal surface of Electron's safeStorage (injected for tests). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(enc: Buffer): string
}

export type SecretKey = 'anthropicApiKey'

/**
 * Secrets encrypted with the OS keychain (macOS Keychain / Windows DPAPI) via safeStorage.
 * Values are never logged and never leave the main process except to the provider SDK.
 */
export class SecretStore {
  constructor(
    private file: string,
    private storage: SafeStorageLike,
  ) {}

  private readAll(): Record<string, string> {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, string>
    } catch {
      return {}
    }
  }

  available(): boolean {
    return this.storage.isEncryptionAvailable()
  }

  has(key: SecretKey): boolean {
    return !!this.readAll()[key]
  }

  get(key: SecretKey): string | null {
    const enc = this.readAll()[key]
    if (!enc) return null
    try {
      return this.storage.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return null
    }
  }

  set(key: SecretKey, value: string | null): void {
    const all = this.readAll()
    if (value === null || value === '') delete all[key]
    else {
      if (!this.available()) throw new Error('OS encryption is not available')
      all[key] = this.storage.encryptString(value).toString('base64')
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(all), { encoding: 'utf8', mode: 0o600 })
  }
}

/** Masks a key for display/logging: sk-ant-…abcd */
export function maskSecret(v: string): string {
  return v.length <= 8 ? '••••' : `${v.slice(0, 6)}…${v.slice(-4)}`
}
