import { z } from 'zod'

/** Settings schema — generated from docs/06-AYARLAR.md. Defaults live here. */

export const FILE_TYPE_KEYS = [
  'image',
  'document',
  'spreadsheet',
  'presentation',
  'text',
  'audio',
  'video',
  'archive',
  'installer',
  'code',
  'design',
  'book',
  'other',
] as const

export const DEFAULT_EXCLUDE_GLOBS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/Library/**',
  '**/AppData/**',
  '**/$RECYCLE.BIN/**',
  '**/System Volume Information/**',
  '**/.Trash/**',
  '**/.Trashes/**',
  '**/.Spotlight-V100/**',
  '**/.fseventsd/**',
  '**/.DocumentRevisions-V100/**',
  '**/.TemporaryItems/**',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/desktop.ini',
  '**/~$*',
  '**/._*',
]

const fileTypes = z
  .object(Object.fromEntries(FILE_TYPE_KEYS.map((k) => [k, z.boolean().default(true)])))
  .default(Object.fromEntries(FILE_TYPE_KEYS.map((k) => [k, true])))

export const settingsSchema = z.object({
  language: z.enum(['tr', 'en', 'fi']).default('tr'),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  roots: z.array(z.string()).default([]),
  targetMode: z.enum(['inPlace', 'singleTarget']).default('inPlace'),
  targetRoot: z.string().optional(),
  quarantineFolderName: z.string().min(1).default('Döndü Karantina'),
  useOsTrashInsteadOfQuarantine: z.boolean().default(false),
  removeEmptyFoldersCreatedByDondu: z.boolean().default(true),
  quarantineEmptySourceFolders: z.boolean().default(false),
  onboardingDone: z.boolean().default(false),
  advancedSettings: z.boolean().default(false),

  scan: z
    .object({
      includeHidden: z.boolean().default(false),
      maxDepth: z.number().int().min(1).max(64).default(12),
      maxFileSizeForContentMB: z.number().int().min(1).default(200),
      maxTextExcerptChars: z.number().int().min(100).max(5000).default(1500),
      excludeGlobs: z.array(z.string()).default(DEFAULT_EXCLUDE_GLOBS),
      treatProjectFoldersAsUnit: z.boolean().default(true),
      followBundles: z.literal(false).default(false),
      fileTypes,
      minFileSizeKB: z.number().int().min(0).default(0),
      hashWorkers: z.number().int().min(0).max(32).default(0), // 0 = auto: max(2, cpu-1)
    })
    .prefault({}),

  images: z
    .object({
      analyzeWithAI: z.boolean().default(true),
      thumbnailMaxEdge: z.union([z.literal(512), z.literal(768), z.literal(1024)]).default(768),
      groupBy: z.enum(['year', 'yearMonth', 'event']).default('yearMonth'),
      detectScreenshots: z.boolean().default(true),
      screenshotTarget: z.string().default('Ekran Görüntüleri/{Cihaz}/{Yıl}'),
      nearDuplicateThreshold: z.number().int().min(0).max(32).default(8),
      keepHeicJpgSiblingsTogether: z.boolean().default(true),
      useExifDateForFolder: z.boolean().default(true),
    })
    .prefault({}),

  dupes: z
    .object({
      enabled: z.boolean().default(true),
      keepPolicy: z
        .enum(['preferredFolder', 'oldest', 'newest', 'shortestPath'])
        .default('preferredFolder'),
      preferredFolderOrder: z
        .array(z.string())
        .default(['Belgeler', 'Fotoğraflar', 'Masaüstü', 'İndirilenler']),
      action: z.enum(['quarantine', 'trash', 'reportOnly']).default('quarantine'),
      minSizeKB: z.number().int().min(0).default(1),
      includeNearDuplicateImages: z.boolean().default(true),
    })
    .prefault({}),

  sensitive: z
    .object({
      enabled: z.literal(true).default(true),
      neverSendToCloud: z.literal(true).default(true),
      extraNamePatterns: z.array(z.string()).default([]),
      extraExtensions: z.array(z.string()).default([]),
      contentScan: z.boolean().default(true),
      targetCategory: z.string().default('docs_personal_id'),
      skipByDefault: z.boolean().default(false),
    })
    .prefault({}),

  rename: z
    .object({
      enabled: z.boolean().default(false),
      template: z.string().default('{date}_{title}'),
      minConfidence: z.number().min(0).max(1).default(0.9),
      onlyGenericNames: z.boolean().default(true),
      photos: z.boolean().default(false),
    })
    .prefault({}),

  /** Revision 1: how folders are designed. */
  organize: z
    .object({
      /** topic: AI designs topic folders; type: classic folders by file type. */
      style: z.enum(['topic', 'type']).default('topic'),
      /** Coherent existing folders: move as a whole (AI decides where) or leave in place. */
      existingFolders: z.enum(['moveWhole', 'keep']).default('moveWhole'),
      /** Free-text hint for the folder architect ("I develop games", "wedding next month"). */
      hint: z.string().max(500).default(''),
      maxDepth: z.number().int().min(1).max(5).default(3),
      /** Never send image previews to a cloud provider (local LM Studio may still see them). */
      cloudImages: z.boolean().default(true),
    })
    .prefault({}),

  ai: z
    .object({
      provider: z.enum(['anthropic', 'lmstudio', 'none']).default('none'),
      anthropic: z
        .object({
          /** Model that looks at each file (cheap, vision). */
          model: z.string().default('claude-haiku-5-5'),
          /** Model that designs the folder tree (few calls; smarter pays off). */
          organizerModel: z.string().default('claude-sonnet-5-5'),
          useBatchApi: z.boolean().default(false),
          effort: z.enum(['low', 'medium']).default('low'),
        })
        .prefault({}),
      lmstudio: z
        .object({
          baseUrl: z.string().default('http://localhost:1234/v1'),
          model: z.string().default(''),
          vision: z.boolean().default(false),
        })
        .prefault({}),
      mode: z.enum(['uncertainOnly', 'all', 'metadataOnly']).default('uncertainOnly'),
      ruleConfidenceThreshold: z.number().min(0).max(1).default(0.85),
      batchSize: z.number().int().min(1).max(50).default(12),
      maxUsdPerRun: z.number().min(0).default(1),
      maxTokensPerRun: z.number().int().min(0).default(2_000_000),
      cacheEnabled: z.boolean().default(true),
      learnFromCorrections: z.boolean().default(true),
    })
    .prefault({}),

  report: z
    .object({
      lowConfidenceThreshold: z.number().min(0).max(1).default(0.6),
      exportIncludesExcerpts: z.boolean().default(false),
    })
    .prefault({}),

  apply: z
    .object({
      concurrency: z.number().int().min(1).max(4).default(1),
      verifyHashAfterCopy: z.literal(true).default(true),
      pauseOnFirstError: z.boolean().default(true),
      doubleConfirmAbove: z.number().int().min(1).default(500),
    })
    .prefault({}),

  history: z
    .object({
      keepRunsDays: z.number().int().min(1).default(365),
      quarantineReminderDays: z.number().int().min(1).default(30),
    })
    .prefault({}),

  cache: z.object({ thumbnails: z.boolean().default(true) }).prefault({}),
  logs: z.object({ level: z.enum(['error', 'info', 'debug']).default('info') }).prefault({}),
})

export type Settings = z.infer<typeof settingsSchema>

export function defaultSettings(): Settings {
  return settingsSchema.parse({})
}

/** Deep partial used by `settings:set`. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export function mergeSettings(base: Settings, patch: DeepPartial<Settings>): Settings {
  const merge = (a: unknown, b: unknown): unknown => {
    if (b === undefined) return a
    if (Array.isArray(b) || typeof b !== 'object' || b === null) return b
    const out: Record<string, unknown> = { ...(a as Record<string, unknown>) }
    for (const [k, v] of Object.entries(b)) out[k] = merge(out[k], v)
    return out
  }
  return settingsSchema.parse(merge(base, patch))
}
