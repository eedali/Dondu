/**
 * Content kinds (revision 1). Topics are free text, but *what* a file is comes from this closed
 * list so the folder architect and the report stay consistent.
 */
export const CONTENT_KINDS = [
  'photo',
  'screenshot_phone',
  'screenshot_pc',
  'document_photo',
  'image',
  'document',
  'spreadsheet',
  'presentation',
  'video',
  'screen_recording',
  'music',
  'sound_effect',
  'voice_note',
  'game_asset',
  'design_asset',
  'font',
  'code',
  'installer',
  'archive',
  'ebook',
  'other',
] as const

export type ContentKind = (typeof CONTENT_KINDS)[number]

export function isContentKind(s: string): s is ContentKind {
  return (CONTENT_KINDS as readonly string[]).includes(s)
}
