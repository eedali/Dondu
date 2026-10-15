import { openBetterSqlite } from '../../src/main/db/better-sqlite3'
import { createRepos, type Repos } from '../../src/main/db/repos'

export function memoryRepos(): Repos {
  return createRepos(openBetterSqlite(':memory:'))
}
