/**
 * IPC contract between main and renderer (docs/02 §5). Every channel is `domain:verb`.
 * Request/response types live here so both sides stay in sync.
 */
import type { DeepPartial, Settings } from './settings'
import type {
  AIEstimate,
  ApplyProgress,
  Category,
  FileMeta,
  FileRecord,
  JournalRow,
  PendingRecovery,
  Plan,
  PlanItemPatch,
  PreflightResult,
  RootCheck,
  RunRecord,
  ScanProgress,
  ScanSummary,
} from './types'

export interface PingResult {
  pong: true
  platform: string
  version: string
}

export interface AppInfo {
  version: string
  platform: string
  arch: string
  userData: string
  logsDir: string
  dbBackend: string
  isDev: boolean
}

export interface FolderPickResult {
  accepted: string[]
  rejected: { path: string; reason: 'system' | 'app' | 'missing' | 'not_dir' | 'nested' }[]
}

export interface PlanProgress {
  phase: 'rules' | 'ai' | 'organize' | 'planning' | 'done' | 'cancelled'
  done: number
  total: number
  message?: string
  /** Money spent so far in this build (cloud providers). */
  usd?: number
  startedAt: number
  /** Stopping is being processed (in-flight requests are being cut). */
  stopping?: boolean
}

export interface QuarantineInfo {
  root: string
  path: string
  runs: number
  bytes: number
  oldestDays: number
}

export interface SecretsStatus {
  anthropicApiKey: boolean
  encryptionAvailable: boolean
}

export interface AiTestResult {
  ok: boolean
  message: string
  model?: string
}

export interface UndoResult {
  runId: string
  undone: number
  skipped: number
  failed: number
  /** Files changed since apply; caller may retry with force. */
  changed: string[]
  trashed: string[]
}

/** Request/response channels (renderer → main, `ipcRenderer.invoke`). */
export interface IpcInvokeMap {
  'app:ping': { args: []; result: PingResult }
  'app:info': { args: []; result: AppInfo }
  'settings:get': { args: []; result: Settings }
  'settings:set': { args: [patch: DeepPartial<Settings>]; result: Settings }
  'settings:reset': { args: []; result: Settings }
  'secrets:status': { args: []; result: SecretsStatus }
  'secrets:set': { args: [key: 'anthropicApiKey', value: string | null]; result: SecretsStatus }
  'folders:pick': { args: []; result: FolderPickResult }
  'folders:validate': { args: [paths: string[]]; result: FolderPickResult }
  'platform:check': { args: [roots: string[]]; result: RootCheck[] }
  'platform:openPrivacy': {
    args: [pane: 'fullDisk' | 'filesAndFolders' | 'controlledFolders']
    result: void
  }
  'scan:start': { args: [roots: string[]]; result: { sessionId: string } }
  'scan:cancel': { args: []; result: void }
  'scan:summary': { args: [sessionId?: string]; result: ScanSummary | null }
  'categories:list': { args: []; result: Category[] }
  'categories:save': { args: [category: Category]; result: Category[] }
  'categories:remove': { args: [id: string]; result: Category[] }
  'categories:reset': { args: []; result: Category[] }
  'ai:estimate': { args: [sessionId: string]; result: AIEstimate }
  'ai:test': { args: []; result: AiTestResult }
  'ai:models': { args: []; result: string[] }
  'ai:anthropicModels': { args: []; result: { id: string; name: string; vision: boolean }[] }
  'plan:build': { args: [opts: { sessionId: string; useAI: boolean }]; result: Plan }
  'plan:cancel': { args: [mode: 'partial' | 'abort']; result: void }
  'plan:get': { args: [planId?: string]; result: Plan | null }
  'file:details': { args: [fileId: string]; result: { file: FileRecord; meta: FileMeta } | null }
  'plan:update': {
    args: [planId: string, itemIds: string[], patch: PlanItemPatch]
    result: Plan
  }
  'plan:approve': { args: [planId: string]; result: Plan }
  'plan:duplicate': { args: [planId: string]; result: Plan }
  'plan:export': {
    args: [planId: string, format: 'html' | 'md' | 'json']
    result: { path: string } | null
  }
  'plan:preflight': { args: [planId: string]; result: PreflightResult }
  'apply:start': {
    args: [planId: string, opts?: { skipItemIds?: string[] }]
    result: { runId: string }
  }
  'apply:pause': { args: []; result: void }
  'apply:resume': { args: [opts?: { skipFailed?: boolean }]; result: void }
  'apply:cancel': { args: []; result: void }
  'history:list': { args: []; result: RunRecord[] }
  'history:journal': { args: [runId: string]; result: JournalRow[] }
  'undo:run': { args: [runId: string, opts?: { force?: boolean }]; result: UndoResult }
  'undo:item': {
    args: [runId: string, itemId: string, opts?: { force?: boolean }]
    result: UndoResult
  }
  'recovery:pending': { args: []; result: PendingRecovery[] }
  'recovery:resolve': {
    args: [runId: string, action: 'complete' | 'undo' | 'ignore']
    result: void
  }
  'quarantine:list': { args: []; result: QuarantineInfo[] }
  'quarantine:trash': { args: [path: string]; result: { ok: boolean; message?: string } }
  'cache:clear': { args: []; result: { thumbs: number; ai: number } }
  'shell:reveal': { args: [path: string]; result: void }
  'shell:openLogs': { args: []; result: void }
}

export type InvokeChannel = keyof IpcInvokeMap
export type InvokeArgs<C extends InvokeChannel> = IpcInvokeMap[C]['args']
export type InvokeResult<C extends InvokeChannel> = IpcInvokeMap[C]['result']

/** Events pushed from main to renderer (`webContents.send`). */
export interface IpcEventMap {
  'scan:progress': ScanProgress
  'plan:progress': PlanProgress
  'apply:progress': ApplyProgress
  'app:error': { message: string }
}

export type EventChannel = keyof IpcEventMap

/** Normalised error passed across IPC (message is user-facing, already translated key or text). */
export interface IpcErrorShape {
  code: string
  message: string
}
