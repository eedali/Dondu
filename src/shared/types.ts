/** Core domain types shared by main and renderer (docs/02 §4). */

export type FileKind = 'file' | 'dir' | 'bundle' | 'symlink'

/** Broad content family derived from extension / magic bytes. */
export type FileFamily =
  | 'image'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'text'
  | 'audio'
  | 'video'
  | 'archive'
  | 'installer'
  | 'code'
  | 'design'
  | 'book'
  | 'other'

export interface FileRecord {
  id: string
  sessionId: string
  root: string
  relPath: string
  /** On-disk spelling when it differs from the NFC `relPath` (e.g. NFD names on Windows). */
  relPathRaw?: string
  name: string
  ext: string
  kind: FileKind
  family: FileFamily
  size: number
  mtime: number
  ctime: number
  mime?: string
  isHidden: boolean
  isCloudPlaceholder: boolean
  isLocked: boolean
  hashFast?: string
  hashFull?: string
  phash?: string
  sensitive: boolean
  sensitiveReason?: string
  ruleCategory?: string
  ruleConfidence?: number
}

export interface FileMeta {
  width?: number
  height?: number
  exifDate?: string
  camera?: string
  hasGps?: boolean
  orientation?: number
  pages?: number
  title?: string
  author?: string
  durationSec?: number
  artist?: string
  album?: string
  archiveEntries?: string[]
  archiveEntryCount?: number
  textExcerpt?: string
  scanned?: boolean
  thumbPath?: string
  /** For directories / bundles: extension histogram of direct children. */
  contents?: Record<string, number>
  subfolders?: number
  bundleType?: 'apple' | 'project'
  error?: string
}

export type ScanPhase = 'walking' | 'analyzing' | 'hashing' | 'done' | 'cancelled' | 'error'

export interface ScanProgress {
  sessionId: string
  phase: ScanPhase
  found: number
  analyzed: number
  total: number
  currentPath?: string
  message?: string
}

export interface ScanSummary {
  sessionId: string
  roots: string[]
  startedAt: number
  finishedAt?: number
  status: 'running' | 'done' | 'cancelled' | 'error'
  totalFiles: number
  totalBytes: number
  byFamily: Record<string, { count: number; bytes: number }>
  cloudPlaceholders: number
  bundles: number
  sensitive: number
}

export type PlanStatus = 'draft' | 'approved' | 'applying' | 'applied' | 'partial' | 'undone'
export type PlanAction =
  'move' | 'rename' | 'move_rename' | 'quarantine' | 'trash' | 'skip' | 'mkdir'
export type ItemSource = 'rule' | 'ai' | 'user'

/** Why an item is flagged; drives report tabs. */
export type ItemFlag =
  | 'duplicate'
  | 'near_duplicate'
  | 'sibling'
  | 'sensitive'
  | 'cloud'
  | 'locked'
  | 'junk'
  | 'low_confidence'
  | 'leaves_icloud'
  | 'bundle'
  | 'project'
  | 'folder_unit'
  | 'event'

export interface PlanItem {
  id: string
  planId: string
  fileId: string
  action: PlanAction
  sourcePath: string
  targetPath: string
  category: string
  subcategory?: string
  suggestedName?: string
  confidence: number
  reason: string
  source: ItemSource
  enabled: boolean
  userEdited: boolean
  groupKey: string
  flags: ItemFlag[]
  /** For duplicates: id of the file that is kept. */
  duplicateOf?: string
  /** Revision 1: the unit (folder / event / file) this item belongs to and its title. */
  unitId?: string
  unitTitle?: string
  /** Free-text topic (AI) — used to remember the user's folder choices. */
  topic?: string
  /** Read-only display helpers (not stored). */
  size?: number
  thumbPath?: string
  sensitive?: boolean
}

export interface PlanSummary {
  total: number
  move: number
  rename: number
  quarantine: number
  trash: number
  skip: number
  sensitive: number
  duplicates: number
  review: number
  bytes: number
  /** Sub-folder name inside the quarantine folder for this plan. */
  quarantineLabel?: string
  ai?: { files: number; tokensIn: number; tokensOut: number; usd: number; failedBatches: number }
}

export interface Plan {
  id: string
  sessionId: string
  createdAt: number
  approvedAt?: number
  status: PlanStatus
  items: PlanItem[]
  summary: PlanSummary
  roots: string[]
}

export type PlanItemPatch = Partial<
  Pick<PlanItem, 'targetPath' | 'enabled' | 'category' | 'suggestedName' | 'sensitive'>
> & {
  /** Move every item into this folder (absolute), keeping each file name. */
  targetDir?: string
}

export interface AIClassifyInput {
  id: string
  name: string
  ext: string
  sizeBytes: number
  mtimeIso: string
  kind: FileKind
  metaSummary: string
  textExcerpt?: string
  imageJpegBase64?: string
}

export interface AIClassifyOutput {
  id: string
  category: string
  subcategory?: string
  suggestedName?: string
  dateHint?: string
  confidence: number
  sensitive: boolean
  reason: string
}

export interface AIEstimate {
  provider: 'anthropic' | 'lmstudio' | 'none'
  model?: string
  files: number
  cachedFiles: number
  withImages: number
  tokensIn: number
  tokensOut: number
  usd: number
  overLimit: boolean
  limitReason?: 'usd' | 'tokens'
}

export type JournalOp =
  'rename' | 'copy' | 'verify' | 'remove_source' | 'mkdir' | 'rmdir_empty' | 'trash'
export type JournalStatus = 'pending' | 'done' | 'failed' | 'undone' | 'skipped'

export interface JournalRow {
  id: number
  runId: string
  planId: string
  itemId: string | null
  seq: number
  op: JournalOp
  src: string
  dst: string
  size: number | null
  mtime: number | null
  hash: string | null
  status: JournalStatus
  error: string | null
  startedAt: number
  finishedAt: number | null
  undoneAt: number | null
}

export type RunKind = 'apply' | 'undo'
export type RunStatus = 'running' | 'paused' | 'done' | 'partial' | 'cancelled' | 'failed'

export interface RunStats {
  total: number
  done: number
  skipped: number
  failed: number
  bytes: number
  changed?: string[]
  errors?: { itemId: string | null; path: string; message: string }[]
  trashed?: string[]
}

export interface RunRecord {
  id: string
  planId: string
  kind: RunKind
  startedAt: number
  finishedAt?: number
  status: RunStatus
  stats: RunStats
  roots: string[]
  undoOf?: string
  ai?: { tokensIn: number; tokensOut: number; usd: number }
}

export interface ApplyProgress {
  runId: string
  kind: RunKind
  done: number
  total: number
  currentItem?: string
  status: RunStatus
  errors: { itemId: string | null; path: string; message: string }[]
  /** Set when the run stopped and waits for the user (pauseOnFirstError). */
  waiting?: boolean
}

export interface PreflightIssue {
  itemId: string
  path: string
  kind: 'changed' | 'missing' | 'outside_root' | 'locked' | 'cloud' | 'not_writable' | 'no_space'
  message?: string
}

export interface PreflightResult {
  ok: boolean
  issues: PreflightIssue[]
  /** Items that will be applied (enabled, not blocked). */
  runnable: number
}

export interface Category {
  id: string
  nameTr: string
  nameEn: string
  folderTemplate: string
  description: string
  examples: string[]
  enabled: boolean
  sort: number
  builtin: boolean
}

export interface RootCheck {
  root: string
  exists: boolean
  read: boolean
  write: boolean
  cloud: 'none' | 'icloud' | 'onedrive' | 'dropbox' | 'google'
  volume: 'local' | 'removable' | 'network' | 'unknown'
  systemFolder: boolean
  message?: string
  errorCode?: string
}

export interface PendingRecovery {
  runId: string
  planId: string
  pendingRows: number
  startedAt: number
}
