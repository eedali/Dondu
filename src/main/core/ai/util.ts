/** setTimeout that ends early when the run is stopped (back-off and polling must not block a cancel). */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const t = setTimeout(done, ms)
    function done(): void {
      clearTimeout(t)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

const UNSUPPORTED = new Set([
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'pattern',
  'minItems',
  'maxItems',
  'uniqueItems',
])

/**
 * Structured outputs accept a JSON-schema subset: no numeric/string-length/array constraints and
 * every object needs `additionalProperties: false`. Constraints are still enforced client-side
 * (zod) after parsing.
 */
export function toStructuredSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toStructuredSchema)
  if (!schema || typeof schema !== 'object') return schema
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(schema)) {
    if (UNSUPPORTED.has(k)) continue
    out[k] =
      k === 'properties' && v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toStructuredSchema(pv)]))
        : toStructuredSchema(v)
  }
  if (out['type'] === 'object') out['additionalProperties'] = false
  return out
}
