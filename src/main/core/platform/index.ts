import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { RootCheck } from '@shared/types'
import { isInside, longPath, nfc } from './paths'

const exec = promisify(execFile)

/** Subset of Electron's `shell` we use; injected so core stays testable without Electron. */
export interface ShellLike {
  trashItem(p: string): Promise<void>
  showItemInFolder(p: string): void
  openExternal(url: string): Promise<void>
  openPath(p: string): Promise<string>
}

export type PrivacyPane = 'fullDisk' | 'filesAndFolders' | 'controlledFolders'

/** All platform differences live behind this interface (docs/04). */
export interface PlatformAdapter {
  readonly os: NodeJS.Platform
  isSystemFolder(p: string): boolean
  checkAccess(root: string): Promise<RootCheck>
  detectCloud(root: string): RootCheck['cloud']
  /** macOS `.Name.ext.icloud` → `Name.ext`; otherwise null. */
  cloudPlaceholderRealName(name: string): string | null
  /** Windows OneDrive online-only files under `root` (absolute paths, NFC). */
  cloudPlaceholders(root: string): Promise<Set<string>>
  /** Copies a file or bundle preserving metadata (ditto on macOS). Never overwrites. */
  copyWithMetadata(src: string, dst: string): Promise<void>
  trash(p: string): Promise<void>
  reveal(p: string): void
  openPrivacySettings(pane: PrivacyPane): Promise<void>
  longPath(p: string): string
}

let shellRef: ShellLike | null = null
export function setShell(shell: ShellLike): void {
  shellRef = shell
}

function systemFolders(platform: NodeJS.Platform): string[] {
  const home = os.homedir()
  if (platform === 'darwin')
    return [
      '/System',
      '/Library',
      '/Applications',
      '/usr',
      '/bin',
      '/sbin',
      '/private',
      '/etc',
      '/var',
      '/opt',
      '/cores',
      path.join(home, 'Library'),
    ]
  if (platform === 'win32') {
    const sys = process.env['SystemRoot'] ?? 'C:\\Windows'
    return [
      sys,
      process.env['ProgramFiles'] ?? 'C:\\Program Files',
      process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      process.env['ProgramData'] ?? 'C:\\ProgramData',
      path.join(home, 'AppData'),
      'C:\\$Recycle.Bin',
      'C:\\System Volume Information',
    ]
  }
  return ['/bin', '/boot', '/dev', '/etc', '/lib', '/proc', '/sys', '/usr', '/var', '/opt', '/root']
}

function isFsRoot(p: string, platform: NodeJS.Platform): boolean {
  const r = path.resolve(p)
  if (platform === 'win32') return /^[a-z]:\\?$/i.test(r) && r.toUpperCase().startsWith('C:')
  return r === '/'
}

function createAdapter(platform: NodeJS.Platform = process.platform): PlatformAdapter {
  const sys = systemFolders(platform)
  let extraForbidden: string[] = []

  const adapter: PlatformAdapter = {
    os: platform,

    isSystemFolder(p) {
      if (isFsRoot(p, platform)) return true
      if (platform === 'win32' && /^[a-z]:\\?$/i.test(path.resolve(p))) return false // D:\ is fine
      return [...sys, ...extraForbidden].some((s) => isInside(p, s))
    },

    detectCloud(root) {
      const r = nfc(root).toLowerCase()
      if (
        r.includes('mobile documents') ||
        r.includes('com~apple~clouddocs') ||
        r.includes('icloud')
      )
        return 'icloud'
      const od = [
        process.env['OneDrive'],
        process.env['OneDriveConsumer'],
        process.env['OneDriveCommercial'],
      ]
      if (
        od.some((o) => o && isInside(root, o)) ||
        /[\\/]onedrive( - [^\\/]+)?([\\/]|$)/i.test(root)
      )
        return 'onedrive'
      if (/[\\/]dropbox([\\/]|$)/i.test(root)) return 'dropbox'
      if (/[\\/](google drive|googledrive|my drive)([\\/]|$)/i.test(root)) return 'google'
      if (platform === 'darwin' && r.includes('/library/cloudstorage/')) return 'google'
      return 'none'
    },

    cloudPlaceholderRealName(name) {
      if (platform !== 'darwin' && !name.endsWith('.icloud')) return null
      const m = /^\.(.+)\.icloud$/.exec(name)
      return m ? (m[1] ?? null) : null
    },

    async cloudPlaceholders(root) {
      const out = new Set<string>()
      if (platform !== 'win32' || adapter.detectCloud(root) !== 'onedrive') return out
      try {
        // attrib /s lists every file with its attribute letters; O = offline (online-only).
        const { stdout } = await exec('attrib', ['/s', path.join(root, '*')], {
          maxBuffer: 256 * 1024 * 1024,
          windowsHide: true,
        })
        for (const line of stdout.split(/\r?\n/)) {
          const m = /^(.{18,21})\s*([A-Za-z]:\\.*)$/.exec(line)
          if (!m) continue
          const flags = m[1] ?? ''
          if (/[OU]/.test(flags.replace(/\s/g, ''))) out.add(nfc(m[2]!.trim()))
        }
      } catch {
        /* best effort */
      }
      return out
    },

    async checkAccess(root) {
      const res: RootCheck = {
        root,
        exists: false,
        read: false,
        write: false,
        cloud: adapter.detectCloud(root),
        volume: 'unknown',
        systemFolder: adapter.isSystemFolder(root),
      }
      if (platform === 'darwin') res.volume = root.startsWith('/Volumes/') ? 'removable' : 'local'
      else if (platform === 'win32') res.volume = root.startsWith('\\\\') ? 'network' : 'local'
      else res.volume = 'local'
      try {
        const st = await fs.stat(root)
        res.exists = st.isDirectory()
        if (!res.exists) {
          res.errorCode = 'ENOTDIR'
          return res
        }
      } catch (e) {
        res.errorCode = (e as NodeJS.ErrnoException).code ?? 'ERR'
        return res
      }
      try {
        const dir = await fs.opendir(root)
        await dir.read()
        await dir.close()
        res.read = true
      } catch (e) {
        res.errorCode = (e as NodeJS.ErrnoException).code ?? 'ERR'
        return res
      }
      // Write test: create and remove our own temp file (never a user file).
      const probe = path.join(root, `.dondu-write-test-${randomBytes(4).toString('hex')}`)
      try {
        const fh = await fs.open(probe, 'wx')
        await fh.close()
        await fs.unlink(probe)
        res.write = true
      } catch (e) {
        res.errorCode = (e as NodeJS.ErrnoException).code ?? 'ERR'
      }
      return res
    },

    async copyWithMetadata(src, dst) {
      try {
        await fs.access(dst)
        throw Object.assign(new Error(`Target exists: ${dst}`), { code: 'EEXIST' })
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
      if (platform === 'darwin') {
        // ditto keeps xattrs (Finder tags, comments), resource forks and ACLs.
        await exec('/usr/bin/ditto', [src, dst])
        return
      }
      const st = await fs.stat(src)
      await fs.cp(longPath(src), longPath(dst), {
        recursive: st.isDirectory(),
        errorOnExist: true,
        force: false,
        preserveTimestamps: true,
      })
      await fs.utimes(longPath(dst), st.atime, st.mtime)
    },

    async trash(p) {
      if (!shellRef) throw new Error('OS trash is not available in this context')
      await shellRef.trashItem(p)
    },

    reveal(p) {
      shellRef?.showItemInFolder(p)
    },

    async openPrivacySettings(pane) {
      if (!shellRef) return
      if (platform === 'darwin') {
        const anchor = pane === 'fullDisk' ? 'Privacy_AllFiles' : 'Privacy_FilesAndFolders'
        await shellRef.openExternal(
          `x-apple.systempreferences:com.apple.preference.security?${anchor}`,
        )
      } else if (platform === 'win32') {
        await shellRef.openExternal('windowsdefender://threat')
      }
    },

    longPath,
  }

  Object.defineProperty(adapter, 'forbid', {
    value: (dirs: string[]) => {
      extraForbidden = dirs
    },
  })
  return adapter
}

let current: PlatformAdapter = createAdapter()

export function platform(): PlatformAdapter {
  return current
}

/** Adds app-owned folders (userData) to the forbidden list. */
export function forbidFolders(dirs: string[]): void {
  ;(current as unknown as { forbid: (d: string[]) => void }).forbid(dirs)
}

/** Test hook. */
export function setPlatformForTests(p: PlatformAdapter | NodeJS.Platform): void {
  current = typeof p === 'string' ? createAdapter(p) : p
}

export { createAdapter }
