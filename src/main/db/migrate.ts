import type { SqlDb } from './driver'
import m001 from './migrations/001_init.sql?raw'

/** Ordered migrations. Never edit a shipped migration — add a new NNN_*.sql. */
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  { version: 1, name: '001_init', sql: m001 },
]

export function migrate(db: SqlDb): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const row = db.prepare<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_version').get()
  const current = row?.v ?? 0
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue
    db.transaction(() => {
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run([m.version])
    })
  }
  return MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0
}
