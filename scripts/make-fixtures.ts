import os from 'node:os'
import path from 'node:path'
import { makeFixtures } from './fixtures/make'

/** npm run fixtures — creates a messy folder in the OS temp dir and prints its path. */
async function main(): Promise<void> {
  const dir = process.argv[2] ?? path.join(os.tmpdir(), `dondu-fixtures-${Date.now()}`, 'Masaüstü')
  const info = await makeFixtures(dir)
  console.log(`${info.files.length} files written`)
  console.log(info.dir)
}

void main()
