import { describe, expect, it } from 'vitest'
import { memoryRepos } from '../helpers/db'

describe('db', () => {
  it('migrates and round-trips a file record', () => {
    const r = memoryRepos()
    r.sessions.create('s1', ['/root'], {})
    r.files.insertMany([
      {
        id: 'f1',
        sessionId: 's1',
        root: '/root',
        relPath: 'a/b.txt',
        name: 'b.txt',
        ext: 'txt',
        kind: 'file',
        family: 'text',
        size: 3,
        mtime: 1,
        ctime: 1,
        isHidden: false,
        isCloudPlaceholder: false,
        isLocked: false,
        sensitive: false,
      },
    ])
    r.files.setMeta('f1', { textExcerpt: 'abc' })
    expect(r.files.bySession('s1')[0]?.relPath).toBe('a/b.txt')
    expect(r.files.getMeta('f1').textExcerpt).toBe('abc')
    r.files.update('f1', { hashFull: 'h', sensitive: true })
    expect(r.files.get('f1')?.sensitive).toBe(true)
  })
})
