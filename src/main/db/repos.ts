import type {
  Category,
  FileFamily,
  FileKind,
  FileMeta,
  FileRecord,
  ItemFlag,
  JournalOp,
  JournalRow,
  JournalStatus,
  Plan,
  PlanAction,
  PlanItem,
  PlanStatus,
  PlanSummary,
  RunKind,
  RunRecord,
  RunStats,
  RunStatus,
} from '@shared/types'
import type { SqlDb } from './driver'
import { migrate } from './migrate'

const b = (v: boolean | undefined): number => (v ? 1 : 0)
const parse = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------- sessions

export interface SessionRow {
  id: string
  startedAt: number
  finishedAt?: number
  roots: string[]
  status: string
}

export class SessionRepo {
  constructor(private db: SqlDb) {}

  create(id: string, roots: string[], settingsSnapshot: unknown): void {
    this.db
      .prepare(
        'INSERT INTO scan_sessions (id, started_at, roots_json, settings_snapshot_json, status) VALUES (?, ?, ?, ?, ?)',
      )
      .run([id, Date.now(), JSON.stringify(roots), JSON.stringify(settingsSnapshot), 'running'])
  }

  finish(id: string, status: string): void {
    this.db
      .prepare('UPDATE scan_sessions SET finished_at = ?, status = ? WHERE id = ?')
      .run([Date.now(), status, id])
  }

  get(id: string): SessionRow | undefined {
    const r = this.db
      .prepare<{
        id: string
        started_at: number
        finished_at: number | null
        roots_json: string
        status: string
      }>('SELECT * FROM scan_sessions WHERE id = ?')
      .get([id])
    return r
      ? {
          id: r.id,
          startedAt: r.started_at,
          finishedAt: r.finished_at ?? undefined,
          roots: parse(r.roots_json, []),
          status: r.status,
        }
      : undefined
  }

  latest(): SessionRow | undefined {
    const r = this.db
      .prepare<{ id: string }>(
        "SELECT id FROM scan_sessions WHERE status = 'done' ORDER BY started_at DESC LIMIT 1",
      )
      .get()
    return r ? this.get(r.id) : undefined
  }

  /** Drops old sessions (their files cascade) except `keep`. */
  prune(keep: string[]): void {
    const placeholders = keep.map(() => '?').join(',') || "''"
    const old = this.db
      .prepare<{ id: string }>(`SELECT id FROM scan_sessions WHERE id NOT IN (${placeholders})`)
      .all(keep)
    for (const { id } of old) {
      const used = this.db
        .prepare<{ n: number }>(
          "SELECT COUNT(*) AS n FROM plans WHERE session_id = ? AND status NOT IN ('draft')",
        )
        .get([id])
      if ((used?.n ?? 0) > 0) continue // keep sessions behind applied plans (undo needs file ids)
      this.db.prepare('DELETE FROM plans WHERE session_id = ?').run([id])
      this.db.prepare('DELETE FROM scan_sessions WHERE id = ?').run([id])
    }
  }
}

// ---------------------------------------------------------------- files

interface FileDbRow {
  id: string
  session_id: string
  root: string
  rel_path: string
  name: string
  ext: string
  kind: string
  family: string
  size: number
  mtime: number
  ctime: number
  mime: string | null
  is_hidden: number
  is_cloud_placeholder: number
  is_locked: number
  hash_fast: string | null
  hash_full: string | null
  phash: string | null
  sensitive: number
  sensitive_reason: string | null
  rule_category: string | null
  rule_confidence: number | null
}

const toFile = (r: FileDbRow): FileRecord => ({
  id: r.id,
  sessionId: r.session_id,
  root: r.root,
  relPath: r.rel_path,
  name: r.name,
  ext: r.ext,
  kind: r.kind as FileKind,
  family: r.family as FileFamily,
  size: r.size,
  mtime: r.mtime,
  ctime: r.ctime,
  mime: r.mime ?? undefined,
  isHidden: !!r.is_hidden,
  isCloudPlaceholder: !!r.is_cloud_placeholder,
  isLocked: !!r.is_locked,
  hashFast: r.hash_fast ?? undefined,
  hashFull: r.hash_full ?? undefined,
  phash: r.phash ?? undefined,
  sensitive: !!r.sensitive,
  sensitiveReason: r.sensitive_reason ?? undefined,
  ruleCategory: r.rule_category ?? undefined,
  ruleConfidence: r.rule_confidence ?? undefined,
})

export class FileRepo {
  constructor(private db: SqlDb) {}

  insertMany(files: FileRecord[]): void {
    const st = this.db.prepare(
      `INSERT OR REPLACE INTO files (id, session_id, root, rel_path, name, ext, kind, family, size, mtime, ctime, mime,
        is_hidden, is_cloud_placeholder, is_locked, hash_fast, hash_full, phash, sensitive, sensitive_reason,
        rule_category, rule_confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    this.db.transaction(() => {
      for (const f of files) {
        st.run([
          f.id,
          f.sessionId,
          f.root,
          f.relPath,
          f.name,
          f.ext,
          f.kind,
          f.family,
          f.size,
          f.mtime,
          f.ctime,
          f.mime ?? null,
          b(f.isHidden),
          b(f.isCloudPlaceholder),
          b(f.isLocked),
          f.hashFast ?? null,
          f.hashFull ?? null,
          f.phash ?? null,
          b(f.sensitive),
          f.sensitiveReason ?? null,
          f.ruleCategory ?? null,
          f.ruleConfidence ?? null,
        ])
      }
    })
  }

  update(
    id: string,
    patch: Partial<
      Pick<
        FileRecord,
        | 'mime'
        | 'family'
        | 'hashFast'
        | 'hashFull'
        | 'phash'
        | 'sensitive'
        | 'sensitiveReason'
        | 'ruleCategory'
        | 'ruleConfidence'
        | 'isLocked'
      >
    >,
  ): void {
    const cols: Record<string, string> = {
      mime: 'mime',
      family: 'family',
      hashFast: 'hash_fast',
      hashFull: 'hash_full',
      phash: 'phash',
      sensitive: 'sensitive',
      sensitiveReason: 'sensitive_reason',
      ruleCategory: 'rule_category',
      ruleConfidence: 'rule_confidence',
      isLocked: 'is_locked',
    }
    const sets: string[] = []
    const vals: (string | number | null)[] = []
    for (const [k, v] of Object.entries(patch)) {
      const col = cols[k]
      if (!col) continue
      sets.push(`${col} = ?`)
      vals.push(typeof v === 'boolean' ? b(v) : ((v as string | number | undefined) ?? null))
    }
    if (!sets.length) return
    this.db.prepare(`UPDATE files SET ${sets.join(', ')} WHERE id = ?`).run([...vals, id])
  }

  updateMany(updates: { id: string; patch: Parameters<FileRepo['update']>[1] }[]): void {
    this.db.transaction(() => {
      for (const u of updates) this.update(u.id, u.patch)
    })
  }

  get(id: string): FileRecord | undefined {
    const r = this.db.prepare<FileDbRow>('SELECT * FROM files WHERE id = ?').get([id])
    return r ? toFile(r) : undefined
  }

  bySession(sessionId: string): FileRecord[] {
    return this.db
      .prepare<FileDbRow>('SELECT * FROM files WHERE session_id = ? ORDER BY root, rel_path')
      .all([sessionId])
      .map(toFile)
  }

  count(sessionId: string): number {
    return (
      this.db
        .prepare<{ n: number }>('SELECT COUNT(*) AS n FROM files WHERE session_id = ?')
        .get([sessionId])?.n ?? 0
    )
  }

  setMeta(fileId: string, meta: FileMeta): void {
    this.db
      .prepare('INSERT OR REPLACE INTO file_meta (file_id, json) VALUES (?, ?)')
      .run([fileId, JSON.stringify(meta)])
  }

  setMetaMany(rows: { fileId: string; meta: FileMeta }[]): void {
    this.db.transaction(() => {
      for (const r of rows) this.setMeta(r.fileId, r.meta)
    })
  }

  getMeta(fileId: string): FileMeta {
    const r = this.db
      .prepare<{ json: string }>('SELECT json FROM file_meta WHERE file_id = ?')
      .get([fileId])
    return parse<FileMeta>(r?.json, {})
  }

  metaBySession(sessionId: string): Map<string, FileMeta> {
    const rows = this.db
      .prepare<{ file_id: string; json: string }>(
        'SELECT m.file_id, m.json FROM file_meta m JOIN files f ON f.id = m.file_id WHERE f.session_id = ?',
      )
      .all([sessionId])
    return new Map(rows.map((r) => [r.file_id, parse<FileMeta>(r.json, {})]))
  }
}

// ---------------------------------------------------------------- plans

interface PlanItemDbRow {
  id: string
  plan_id: string
  file_id: string
  action: string
  source_path: string
  target_path: string
  category: string
  subcategory: string | null
  suggested_name: string | null
  confidence: number
  reason: string
  source: string
  enabled: number
  user_edited: number
  group_key: string
  flags_json: string
  duplicate_of: string | null
}

const toItem = (r: PlanItemDbRow): PlanItem => ({
  id: r.id,
  planId: r.plan_id,
  fileId: r.file_id,
  action: r.action as PlanAction,
  sourcePath: r.source_path,
  targetPath: r.target_path,
  category: r.category,
  subcategory: r.subcategory ?? undefined,
  suggestedName: r.suggested_name ?? undefined,
  confidence: r.confidence,
  reason: r.reason,
  source: r.source as PlanItem['source'],
  enabled: !!r.enabled,
  userEdited: !!r.user_edited,
  groupKey: r.group_key,
  flags: parse<ItemFlag[]>(r.flags_json, []),
  duplicateOf: r.duplicate_of ?? undefined,
})

export class PlanRepo {
  constructor(private db: SqlDb) {}

  save(plan: Plan): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO plans (id, session_id, created_at, approved_at, status, summary_json, roots_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run([
          plan.id,
          plan.sessionId,
          plan.createdAt,
          plan.approvedAt ?? null,
          plan.status,
          JSON.stringify(plan.summary),
          JSON.stringify(plan.roots),
        ])
      this.db.prepare('DELETE FROM plan_items WHERE plan_id = ?').run([plan.id])
      const st = this.db.prepare(
        `INSERT INTO plan_items (id, plan_id, file_id, action, source_path, target_path, category, subcategory,
          suggested_name, confidence, reason, source, enabled, user_edited, group_key, flags_json, duplicate_of, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      plan.items.forEach((it, i) =>
        st.run([
          it.id,
          plan.id,
          it.fileId,
          it.action,
          it.sourcePath,
          it.targetPath,
          it.category,
          it.subcategory ?? null,
          it.suggestedName ?? null,
          it.confidence,
          it.reason,
          it.source,
          b(it.enabled),
          b(it.userEdited),
          it.groupKey,
          JSON.stringify(it.flags),
          it.duplicateOf ?? null,
          i,
        ]),
      )
    })
  }

  get(id: string): Plan | undefined {
    const p = this.db
      .prepare<{
        id: string
        session_id: string
        created_at: number
        approved_at: number | null
        status: string
        summary_json: string
        roots_json: string
      }>('SELECT * FROM plans WHERE id = ?')
      .get([id])
    if (!p) return undefined
    const items = this.db
      .prepare<PlanItemDbRow>('SELECT * FROM plan_items WHERE plan_id = ? ORDER BY sort')
      .all([id])
      .map(toItem)
    return {
      id: p.id,
      sessionId: p.session_id,
      createdAt: p.created_at,
      approvedAt: p.approved_at ?? undefined,
      status: p.status as PlanStatus,
      summary: parse<PlanSummary>(p.summary_json, {} as PlanSummary),
      roots: parse(p.roots_json, []),
      items,
    }
  }

  latestId(): string | undefined {
    return this.db
      .prepare<{ id: string }>('SELECT id FROM plans ORDER BY created_at DESC LIMIT 1')
      .get()?.id
  }

  setStatus(id: string, status: PlanStatus, approvedAt?: number): void {
    if (approvedAt !== undefined)
      this.db
        .prepare('UPDATE plans SET status = ?, approved_at = ? WHERE id = ?')
        .run([status, approvedAt, id])
    else this.db.prepare('UPDATE plans SET status = ? WHERE id = ?').run([status, id])
  }

  updateItem(item: PlanItem): void {
    this.db
      .prepare(
        `UPDATE plan_items SET action = ?, target_path = ?, category = ?, suggested_name = ?, enabled = ?,
          user_edited = ?, group_key = ?, flags_json = ?, reason = ?, source = ?, confidence = ? WHERE id = ?`,
      )
      .run([
        item.action,
        item.targetPath,
        item.category,
        item.suggestedName ?? null,
        b(item.enabled),
        b(item.userEdited),
        item.groupKey,
        JSON.stringify(item.flags),
        item.reason,
        item.source,
        item.confidence,
        item.id,
      ])
  }

  updateSummary(id: string, summary: PlanSummary): void {
    this.db
      .prepare('UPDATE plans SET summary_json = ? WHERE id = ?')
      .run([JSON.stringify(summary), id])
  }
}

// ---------------------------------------------------------------- runs + journal

interface JournalDbRow {
  id: number
  run_id: string
  plan_id: string
  item_id: string | null
  seq: number
  op: string
  src: string
  dst: string
  size: number | null
  mtime: number | null
  hash: string | null
  status: string
  error: string | null
  started_at: number
  finished_at: number | null
  undone_at: number | null
}

const toJournal = (r: JournalDbRow): JournalRow => ({
  id: r.id,
  runId: r.run_id,
  planId: r.plan_id,
  itemId: r.item_id,
  seq: r.seq,
  op: r.op as JournalOp,
  src: r.src,
  dst: r.dst,
  size: r.size,
  mtime: r.mtime,
  hash: r.hash,
  status: r.status as JournalStatus,
  error: r.error,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  undoneAt: r.undone_at,
})

export class JournalRepo {
  constructor(private db: SqlDb) {}

  /** Write-ahead: insert a pending row and return its id (committed immediately). */
  begin(row: {
    runId: string
    planId: string
    itemId: string | null
    seq: number
    op: JournalOp
    src: string
    dst: string
    size?: number | null
    mtime?: number | null
    hash?: string | null
  }): number {
    const r = this.db
      .prepare(
        `INSERT INTO journal (run_id, plan_id, item_id, seq, op, src, dst, size, mtime, hash, status, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run([
        row.runId,
        row.planId,
        row.itemId,
        row.seq,
        row.op,
        row.src,
        row.dst,
        row.size ?? null,
        row.mtime ?? null,
        row.hash ?? null,
        Date.now(),
      ])
    return Number(r.lastInsertRowid)
  }

  finish(
    id: number,
    status: 'done' | 'failed' | 'skipped',
    error?: string,
    extra?: { size?: number; mtime?: number; hash?: string; dst?: string },
  ): void {
    this.db
      .prepare(
        `UPDATE journal SET status = ?, error = ?, finished_at = ?,
          size = COALESCE(?, size), mtime = COALESCE(?, mtime), hash = COALESCE(?, hash), dst = COALESCE(?, dst)
         WHERE id = ?`,
      )
      .run([
        status,
        error ?? null,
        Date.now(),
        extra?.size ?? null,
        extra?.mtime ?? null,
        extra?.hash ?? null,
        extra?.dst ?? null,
        id,
      ])
  }

  markUndone(id: number): void {
    this.db
      .prepare("UPDATE journal SET status = 'undone', undone_at = ? WHERE id = ?")
      .run([Date.now(), id])
  }

  markDone(id: number): void {
    this.db
      .prepare("UPDATE journal SET status = 'done', undone_at = NULL, finished_at = ? WHERE id = ?")
      .run([Date.now(), id])
  }

  byRun(runId: string): JournalRow[] {
    return this.db
      .prepare<JournalDbRow>('SELECT * FROM journal WHERE run_id = ? ORDER BY seq, id')
      .all([runId])
      .map(toJournal)
  }

  pending(): JournalRow[] {
    return this.db
      .prepare<JournalDbRow>("SELECT * FROM journal WHERE status = 'pending' ORDER BY run_id, seq")
      .all()
      .map(toJournal)
  }

  get(id: number): JournalRow | undefined {
    const r = this.db.prepare<JournalDbRow>('SELECT * FROM journal WHERE id = ?').get([id])
    return r ? toJournal(r) : undefined
  }

  maxSeq(runId: string): number {
    return (
      this.db
        .prepare<{ s: number | null }>('SELECT MAX(seq) AS s FROM journal WHERE run_id = ?')
        .get([runId])?.s ?? 0
    )
  }
}

export class RunRepo {
  constructor(private db: SqlDb) {}

  create(run: RunRecord): void {
    this.db
      .prepare(
        `INSERT INTO runs (id, plan_id, kind, started_at, finished_at, status, stats_json, roots_json, undo_of, ai_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run([
        run.id,
        run.planId,
        run.kind,
        run.startedAt,
        run.finishedAt ?? null,
        run.status,
        JSON.stringify(run.stats),
        JSON.stringify(run.roots),
        run.undoOf ?? null,
        run.ai ? JSON.stringify(run.ai) : null,
      ])
  }

  update(id: string, status: RunStatus, stats: RunStats, finished = false): void {
    this.db
      .prepare('UPDATE runs SET status = ?, stats_json = ?, finished_at = ? WHERE id = ?')
      .run([status, JSON.stringify(stats), finished ? Date.now() : null, id])
  }

  get(id: string): RunRecord | undefined {
    const r = this.db
      .prepare<{
        id: string
        plan_id: string
        kind: string
        started_at: number
        finished_at: number | null
        status: string
        stats_json: string
        roots_json: string
        undo_of: string | null
        ai_json: string | null
      }>('SELECT * FROM runs WHERE id = ?')
      .get([id])
    if (!r) return undefined
    return {
      id: r.id,
      planId: r.plan_id,
      kind: r.kind as RunKind,
      startedAt: r.started_at,
      finishedAt: r.finished_at ?? undefined,
      status: r.status as RunStatus,
      stats: parse<RunStats>(r.stats_json, { total: 0, done: 0, skipped: 0, failed: 0, bytes: 0 }),
      roots: parse(r.roots_json, []),
      undoOf: r.undo_of ?? undefined,
      ai: r.ai_json ? parse(r.ai_json, undefined) : undefined,
    }
  }

  list(limit = 200): RunRecord[] {
    return this.db
      .prepare<{ id: string }>('SELECT id FROM runs ORDER BY started_at DESC LIMIT ?')
      .all([limit])
      .map((r) => this.get(r.id))
      .filter((r): r is RunRecord => !!r)
  }

  pruneOlderThan(ts: number): void {
    const old = this.db
      .prepare<{ id: string }>('SELECT id FROM runs WHERE started_at < ?')
      .all([ts])
    this.db.transaction(() => {
      for (const { id } of old) {
        this.db.prepare('DELETE FROM journal WHERE run_id = ?').run([id])
        this.db.prepare('DELETE FROM runs WHERE id = ?').run([id])
      }
    })
  }
}

// ---------------------------------------------------------------- categories, cache, corrections

export class CategoryRepo {
  constructor(private db: SqlDb) {}

  all(): Category[] {
    return this.db
      .prepare<{
        id: string
        name_tr: string
        name_en: string
        folder_template: string
        description: string
        examples_json: string
        enabled: number
        sort: number
        builtin: number
      }>('SELECT * FROM categories ORDER BY sort, id')
      .all()
      .map((r) => ({
        id: r.id,
        nameTr: r.name_tr,
        nameEn: r.name_en,
        folderTemplate: r.folder_template,
        description: r.description,
        examples: parse(r.examples_json, []),
        enabled: !!r.enabled,
        sort: r.sort,
        builtin: !!r.builtin,
      }))
  }

  upsert(c: Category): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO categories (id, name_tr, name_en, folder_template, description, examples_json, enabled, sort, builtin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run([
        c.id,
        c.nameTr,
        c.nameEn,
        c.folderTemplate,
        c.description,
        JSON.stringify(c.examples),
        b(c.enabled),
        c.sort,
        b(c.builtin),
      ])
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM categories WHERE id = ? AND builtin = 0').run([id])
  }

  seed(defaults: Category[]): void {
    const n = this.db.prepare<{ n: number }>('SELECT COUNT(*) AS n FROM categories').get()?.n ?? 0
    if (n > 0) return
    this.db.transaction(() => defaults.forEach((c) => this.upsert(c)))
  }

  reset(defaults: Category[]): void {
    this.db.transaction(() => {
      this.db.exec('DELETE FROM categories')
      defaults.forEach((c) => this.upsert(c))
    })
  }
}

export class AiCacheRepo {
  constructor(private db: SqlDb) {}

  get(key: string): { result: unknown; tokensIn: number; tokensOut: number } | undefined {
    const r = this.db
      .prepare<{
        result_json: string
        tokens_in: number
        tokens_out: number
      }>('SELECT result_json, tokens_in, tokens_out FROM ai_cache WHERE content_key = ?')
      .get([key])
    return r
      ? { result: parse(r.result_json, null), tokensIn: r.tokens_in, tokensOut: r.tokens_out }
      : undefined
  }

  set(key: string, result: unknown, tokensIn: number, tokensOut: number): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO ai_cache (content_key, result_json, tokens_in, tokens_out, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run([key, JSON.stringify(result), tokensIn, tokensOut, Date.now()])
  }

  clear(): void {
    this.db.exec('DELETE FROM ai_cache')
  }

  count(): number {
    return this.db.prepare<{ n: number }>('SELECT COUNT(*) AS n FROM ai_cache').get()?.n ?? 0
  }
}

export interface Correction {
  ext: string
  namePattern: string
  oldCategory: string
  newCategory: string
  createdAt: number
}

export class CorrectionRepo {
  constructor(private db: SqlDb) {}

  add(c: Omit<Correction, 'createdAt'>): void {
    this.db
      .prepare(
        'INSERT INTO corrections (ext, name_pattern, old_category, new_category, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run([c.ext, c.namePattern, c.oldCategory, c.newCategory, Date.now()])
  }

  recent(limit = 20): Correction[] {
    return this.db
      .prepare<{
        ext: string
        name_pattern: string
        old_category: string
        new_category: string
        created_at: number
      }>('SELECT * FROM corrections ORDER BY created_at DESC, id DESC LIMIT ?')
      .all([limit])
      .map((r) => ({
        ext: r.ext,
        namePattern: r.name_pattern,
        oldCategory: r.old_category,
        newCategory: r.new_category,
        createdAt: r.created_at,
      }))
  }
}

// ---------------------------------------------------------------- aggregate

export interface Repos {
  db: SqlDb
  sessions: SessionRepo
  files: FileRepo
  plans: PlanRepo
  journal: JournalRepo
  runs: RunRepo
  categories: CategoryRepo
  aiCache: AiCacheRepo
  corrections: CorrectionRepo
}

export function createRepos(db: SqlDb): Repos {
  migrate(db)
  return {
    db,
    sessions: new SessionRepo(db),
    files: new FileRepo(db),
    plans: new PlanRepo(db),
    journal: new JournalRepo(db),
    runs: new RunRepo(db),
    categories: new CategoryRepo(db),
    aiCache: new AiCacheRepo(db),
    corrections: new CorrectionRepo(db),
  }
}
