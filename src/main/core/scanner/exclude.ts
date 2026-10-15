/**
 * Tiny glob matcher for exclusion patterns (`**`, `*`, `?`). Patterns are matched
 * case-insensitively against posix-style paths relative to the root ("a/b/c.txt").
 * A pattern ending in `/**` also excludes the directory itself.
 */
export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slashAfter = glob[i + 2] === '/'
        re += slashAfter ? '(?:.*/)?' : '.*'
        i += slashAfter ? 2 : 1
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if ('\\^$+.()|{}[]'.includes(c)) re += '\\' + c
    else re += c
  }
  return new RegExp('^' + re + '$', 'i')
}

export class Excluder {
  private res: RegExp[]
  constructor(globs: string[]) {
    const all = new Set<string>()
    for (const g of globs) {
      const norm = g.replace(/\\/g, '/').trim()
      if (!norm) continue
      all.add(norm)
      if (norm.endsWith('/**')) all.add(norm.slice(0, -3)) // the directory itself
      if (!norm.startsWith('**/') && !norm.startsWith('/')) all.add('**/' + norm)
    }
    this.res = [...all].map(globToRegExp)
  }

  /** `rel` is the posix relative path of the entry (no leading slash). */
  excluded(rel: string): boolean {
    return this.res.some((r) => r.test(rel))
  }
}
