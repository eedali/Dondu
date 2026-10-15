/**
 * Minimal synchronous SQL driver interface. Repositories only talk to this, so the backend
 * (better-sqlite3 today, sql.js as a fallback) can be swapped without touching them.
 */
export type SqlValue = string | number | bigint | null | Uint8Array
export type SqlParams = SqlValue[] | Record<string, SqlValue>

export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface Statement<Row = unknown> {
  run(params?: SqlParams): RunResult
  get(params?: SqlParams): Row | undefined
  all(params?: SqlParams): Row[]
}

export interface SqlDb {
  exec(sql: string): void
  prepare<Row = unknown>(sql: string): Statement<Row>
  /** Runs `fn` inside a transaction (nested calls become savepoints). */
  transaction<T>(fn: () => T): T
  pragma(sql: string): unknown
  close(): void
}
