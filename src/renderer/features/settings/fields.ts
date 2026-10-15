/** Declarative settings form (docs/06). Labels/descriptions: i18n `settings.f.<key>.label|desc`. */
export type FieldDef =
  | { key: string; type: 'bool'; locked?: boolean }
  | { key: string; type: 'number'; min?: number; max?: number; step?: number }
  | { key: string; type: 'text'; placeholder?: string }
  | { key: string; type: 'select'; options: (string | number)[] }
  | { key: string; type: 'list' }

export type SectionId =
  | 'general'
  | 'scan'
  | 'images'
  | 'dupes'
  | 'sensitive'
  | 'rename'
  | 'ai'
  | 'apply'
  | 'data'
  | 'categories'

export const SIMPLE_SECTIONS: SectionId[] = ['general', 'scan', 'images', 'ai']

export const SECTIONS: { id: SectionId; fields: FieldDef[] }[] = [
  {
    id: 'general',
    fields: [
      { key: 'language', type: 'select', options: ['tr', 'en'] },
      { key: 'theme', type: 'select', options: ['system', 'light', 'dark'] },
      { key: 'targetMode', type: 'select', options: ['inPlace', 'singleTarget'] },
      { key: 'targetRoot', type: 'text' },
      { key: 'quarantineFolderName', type: 'text' },
      { key: 'useOsTrashInsteadOfQuarantine', type: 'bool' },
      { key: 'removeEmptyFoldersCreatedByDondu', type: 'bool' },
      { key: 'quarantineEmptySourceFolders', type: 'bool' },
    ],
  },
  {
    id: 'scan',
    fields: [
      { key: 'scan.includeHidden', type: 'bool' },
      { key: 'scan.maxDepth', type: 'number', min: 1, max: 64 },
      { key: 'scan.maxFileSizeForContentMB', type: 'number', min: 1, max: 10000 },
      { key: 'scan.maxTextExcerptChars', type: 'number', min: 100, max: 5000, step: 100 },
      { key: 'scan.treatProjectFoldersAsUnit', type: 'bool' },
      { key: 'scan.minFileSizeKB', type: 'number', min: 0, max: 100000 },
      { key: 'scan.hashWorkers', type: 'number', min: 0, max: 32 },
      { key: 'scan.excludeGlobs', type: 'list' },
    ],
  },
  {
    id: 'images',
    fields: [
      { key: 'images.analyzeWithAI', type: 'bool' },
      { key: 'images.thumbnailMaxEdge', type: 'select', options: [512, 768, 1024] },
      { key: 'images.groupBy', type: 'select', options: ['year', 'yearMonth', 'event'] },
      { key: 'images.detectScreenshots', type: 'bool' },
      { key: 'images.screenshotTarget', type: 'text' },
      { key: 'images.nearDuplicateThreshold', type: 'number', min: 0, max: 32 },
      { key: 'images.keepHeicJpgSiblingsTogether', type: 'bool' },
      { key: 'images.useExifDateForFolder', type: 'bool' },
    ],
  },
  {
    id: 'dupes',
    fields: [
      { key: 'dupes.enabled', type: 'bool' },
      {
        key: 'dupes.keepPolicy',
        type: 'select',
        options: ['preferredFolder', 'oldest', 'newest', 'shortestPath'],
      },
      { key: 'dupes.preferredFolderOrder', type: 'list' },
      { key: 'dupes.action', type: 'select', options: ['quarantine', 'trash', 'reportOnly'] },
      { key: 'dupes.minSizeKB', type: 'number', min: 0, max: 100000 },
      { key: 'dupes.includeNearDuplicateImages', type: 'bool' },
    ],
  },
  {
    id: 'sensitive',
    fields: [
      { key: 'sensitive.enabled', type: 'bool', locked: true },
      { key: 'sensitive.neverSendToCloud', type: 'bool', locked: true },
      { key: 'sensitive.contentScan', type: 'bool' },
      { key: 'sensitive.skipByDefault', type: 'bool' },
      { key: 'sensitive.extraNamePatterns', type: 'list' },
      { key: 'sensitive.extraExtensions', type: 'list' },
    ],
  },
  {
    id: 'rename',
    fields: [
      { key: 'rename.enabled', type: 'bool' },
      { key: 'rename.template', type: 'text' },
      { key: 'rename.minConfidence', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'rename.onlyGenericNames', type: 'bool' },
      { key: 'rename.photos', type: 'bool' },
    ],
  },
  { id: 'ai', fields: [] },
  {
    id: 'apply',
    fields: [
      { key: 'report.lowConfidenceThreshold', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'report.exportIncludesExcerpts', type: 'bool' },
      { key: 'apply.pauseOnFirstError', type: 'bool' },
      { key: 'apply.doubleConfirmAbove', type: 'number', min: 1, max: 100000 },
      { key: 'apply.verifyHashAfterCopy', type: 'bool', locked: true },
    ],
  },
  {
    id: 'data',
    fields: [
      { key: 'history.keepRunsDays', type: 'number', min: 1, max: 3650 },
      { key: 'history.quarantineReminderDays', type: 'number', min: 1, max: 3650 },
      { key: 'cache.thumbnails', type: 'bool' },
      { key: 'logs.level', type: 'select', options: ['error', 'info', 'debug'] },
    ],
  },
  { id: 'categories', fields: [] },
]

export const AI_FIELDS: FieldDef[] = [
  { key: 'ai.mode', type: 'select', options: ['uncertainOnly', 'all', 'metadataOnly'] },
  { key: 'ai.ruleConfidenceThreshold', type: 'number', min: 0, max: 1, step: 0.05 },
  { key: 'ai.batchSize', type: 'number', min: 1, max: 50 },
  { key: 'ai.maxUsdPerRun', type: 'number', min: 0, max: 100, step: 0.1 },
  { key: 'ai.maxTokensPerRun', type: 'number', min: 0, max: 100000000, step: 100000 },
  { key: 'ai.cacheEnabled', type: 'bool' },
  { key: 'ai.learnFromCorrections', type: 'bool' },
]

export const ANTHROPIC_FIELDS: FieldDef[] = [
  { key: 'ai.anthropic.model', type: 'text' },
  { key: 'ai.anthropic.effort', type: 'select', options: ['low', 'medium'] },
  { key: 'ai.anthropic.useBatchApi', type: 'bool' },
]

export const LMSTUDIO_FIELDS: FieldDef[] = [
  { key: 'ai.lmstudio.baseUrl', type: 'text' },
  { key: 'ai.lmstudio.vision', type: 'bool' },
]

export function getPath(obj: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
      obj,
    )
}

export function patchFor(key: string, value: unknown): Record<string, unknown> {
  const parts = key.split('.')
  const out: Record<string, unknown> = {}
  let cur = out
  parts.forEach((p, i) => {
    if (i === parts.length - 1) cur[p] = value
    else cur = (cur[p] = {}) as Record<string, unknown>
  })
  return out
}
