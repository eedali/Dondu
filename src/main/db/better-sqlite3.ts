import Database from 'better-sqlite3'
import type { RunResult, SqlDb, SqlParams, Statement } from './driver'

/** better-sqlite3 backend. */
export function openBetterSqlite(file: string): SqlDb {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = FULL') // journal durability matters more than speed
  db.pragma('foreign_keys = ON')

  const cache = new Map<string, Database.Statement>()
  const stmt = (sql: string): Database.Statement => {
    let s = cache.get(sql)
    if (!s) {
      s = db.prepare(sql)
      cache.set(sql, s)
    }
    return s
  }
  const call = <T>(fn: (...a: unknown[]) => T, params?: SqlParams): T =>
    params === undefined ? fn() : Array.isArray(params) ? fn(...params) : fn(params)

  return {
    exec: (sql) => void db.exec(sql),
    prepare<Row>(sql: string): Statement<Row> {
      const s = stmt(sql)
      const reader = s.reader
      return {
        run: (p) => call(s.run.bind(s), p) as RunResult,
        get: (p) => (reader ? (call(s.get.bind(s), p) as Row | undefined) : undefined),
        all: (p) => (reader ? (call(s.all.bind(s), p) as Row[]) : []),
      }
    },
    transaction: (fn) => db.transaction(fn)(),
    pragma: (sql) => db.pragma(sql),
    close: () => db.close(),
  }
}
