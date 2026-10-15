import fs from 'node:fs'
import path from 'node:path'
import {
  defaultSettings,
  mergeSettings,
  settingsSchema,
  type DeepPartial,
  type Settings,
} from '@shared/settings'

/** JSON settings file in userData, validated with zod; atomic writes. */
export class SettingsStore {
  private current: Settings
  private listeners = new Set<(s: Settings) => void>()

  constructor(
    private file: string,
    initial?: Partial<Settings>,
  ) {
    this.current = this.load(initial)
  }

  private load(initial?: Partial<Settings>): Settings {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown
      const parsed = settingsSchema.safeParse(raw)
      if (parsed.success) return parsed.data
      // Keep a copy of the broken file and fall back to defaults merged with what is valid.
      fs.copyFileSync(this.file, `${this.file}.invalid-${Date.now()}`)
    } catch {
      /* first run or unreadable */
    }
    const s = initial
      ? mergeSettings(defaultSettings(), initial as DeepPartial<Settings>)
      : defaultSettings()
    this.write(s)
    return s
  }

  private write(s: Settings): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf8')
    fs.renameSync(tmp, this.file)
  }

  get(): Settings {
    return this.current
  }

  set(patch: DeepPartial<Settings>): Settings {
    this.current = mergeSettings(this.current, patch)
    this.write(this.current)
    for (const l of this.listeners) l(this.current)
    return this.current
  }

  reset(keep: (keyof Settings)[] = ['roots', 'language', 'onboardingDone']): Settings {
    const base = defaultSettings()
    const kept = Object.fromEntries(keep.map((k) => [k, this.current[k]])) as DeepPartial<Settings>
    this.current = mergeSettings(base, kept)
    this.write(this.current)
    for (const l of this.listeners) l(this.current)
    return this.current
  }

  onChange(fn: (s: Settings) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}
