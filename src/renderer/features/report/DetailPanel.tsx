import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatBytes } from '@shared/format'
import type { FileMeta, FileRecord, Plan, PlanItem } from '@shared/types'
import { api, thumbUrl } from '../../app/api'
import { useApp } from '../../app/store'
import { Button, Input, Select, Toggle } from '../../components/ui'
import { patchItems } from './actions'
import { FolderDialog } from './FolderDialog'
import { FileIcon } from './ItemRow'
import { baseName, relTarget } from './model'

/** Right-hand detail panel: preview, metadata, reasoning and per-item edits. */
export function DetailPanel({
  plan,
  item,
  editable,
  onClose,
}: {
  plan: Plan
  item: PlanItem
  editable: boolean
  onClose: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const categories = useApp((s) => s.categories)
  const [details, setDetails] = useState<{ file: FileRecord; meta: FileMeta } | null>(null)
  const [name, setName] = useState(baseName(item.targetPath))
  const [folderOpen, setFolderOpen] = useState(false)
  const locale = i18n.language === 'tr' ? 'tr-TR' : 'en-US'

  useEffect(() => {
    setName(baseName(item.targetPath))
    void api.invoke('file:details', item.fileId).then(setDetails)
  }, [item.fileId, item.targetPath])

  const meta = details?.meta
  const file = details?.file
  const url = item.sensitive ? undefined : thumbUrl(meta?.thumbPath)
  const movable = item.action !== 'skip' && item.action !== 'quarantine' && item.action !== 'trash'

  return (
    <aside
      className="sticky top-0 w-[340px] shrink-0 self-start rounded-lg border border-line bg-surface"
      aria-label={t('report.detailTitle')}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="font-medium">{t('report.detailTitle')}</span>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
      <div className="flex flex-col gap-3 px-4 py-4">
        {url ? (
          <img src={url} alt="" className="max-h-56 w-full rounded object-contain bg-surface-2" />
        ) : (
          <div className="flex justify-center py-2">
            <FileIcon item={item} size={64} />
          </div>
        )}
        <div className="selectable break-all text-[15px] font-medium">
          {baseName(item.sourcePath)}
        </div>
        <dl className="grid grid-cols-[96px_1fr] gap-x-2 gap-y-1 text-[13px]">
          <dt className="text-muted">{t('report.d.from')}</dt>
          <dd className="selectable break-all font-mono text-[12px]">{item.sourcePath}</dd>
          {item.action !== 'skip' && (
            <>
              <dt className="text-muted">{t('report.d.to')}</dt>
              <dd className="selectable break-all font-mono text-[12px]">
                {relTarget(plan, item)}
              </dd>
            </>
          )}
          {file && (
            <>
              <dt className="text-muted">{t('report.d.size')}</dt>
              <dd>{formatBytes(file.size, locale)}</dd>
              <dt className="text-muted">{t('report.d.modified')}</dt>
              <dd>{new Date(file.mtime).toLocaleDateString(locale)}</dd>
            </>
          )}
          {meta?.exifDate && (
            <>
              <dt className="text-muted">{t('report.d.taken')}</dt>
              <dd>{new Date(meta.exifDate).toLocaleString(locale)}</dd>
            </>
          )}
          {meta?.camera && (
            <>
              <dt className="text-muted">{t('report.d.camera')}</dt>
              <dd>{meta.camera}</dd>
            </>
          )}
          {meta?.width && meta.height && (
            <>
              <dt className="text-muted">{t('report.d.dims')}</dt>
              <dd>
                {meta.width}×{meta.height}
              </dd>
            </>
          )}
          {meta?.pages && (
            <>
              <dt className="text-muted">{t('report.d.pages')}</dt>
              <dd>{meta.pages}</dd>
            </>
          )}
          {meta?.durationSec !== undefined && (
            <>
              <dt className="text-muted">{t('report.d.duration')}</dt>
              <dd>{meta.durationSec} sn</dd>
            </>
          )}
          <dt className="text-muted">{t('report.d.reason')}</dt>
          <dd>{item.reason}</dd>
          <dt className="text-muted">{t('report.confidence')}</dt>
          <dd>
            {Math.round(item.confidence * 100)}% · {t(`report.source.${item.source}`)}
          </dd>
        </dl>
        {meta?.textExcerpt && !item.sensitive && (
          <blockquote className="selectable max-h-40 overflow-auto rounded bg-surface-2 px-3 py-2 text-[12px] text-muted">
            {meta.textExcerpt.slice(0, 600)}
          </blockquote>
        )}
        {meta?.archiveEntries && (
          <div className="max-h-32 overflow-auto rounded bg-surface-2 px-3 py-2 font-mono text-[12px] text-muted">
            {meta.archiveEntries.slice(0, 20).join('\n')}
          </div>
        )}

        {editable && (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <label className="text-[13px] text-muted" htmlFor="dondu-cat">
              {t('report.category')}
            </label>
            <Select
              id="dondu-cat"
              value={item.category}
              onChange={(e) => void patchItems([item.id], { category: e.target.value })}
              options={categories
                .filter((c) => c.enabled)
                .map((c) => ({ value: c.id, label: i18n.language === 'tr' ? c.nameTr : c.nameEn }))}
            />
            <p className="text-[12px] text-muted">{t('report.learnHint')}</p>
            {movable && (
              <>
                <label className="mt-1 text-[13px] text-muted" htmlFor="dondu-name">
                  {t('report.newName')}
                </label>
                <div className="flex gap-2">
                  <Input
                    id="dondu-name"
                    className="min-w-0 flex-1"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === 'Enter' && void patchItems([item.id], { suggestedName: name })
                    }
                  />
                  <Button
                    size="sm"
                    onClick={() => void patchItems([item.id], { suggestedName: name })}
                  >
                    {t('common.save')}
                  </Button>
                </div>
                <Button size="sm" onClick={() => setFolderOpen(true)}>
                  {t('report.changeTarget')}
                </Button>
              </>
            )}
            <Toggle
              label={t('report.include', { name: '' }).trim()}
              checked={item.enabled && item.action !== 'skip'}
              disabled={item.action === 'skip'}
              onChange={(v) => void patchItems([item.id], { enabled: v })}
            />
            <Toggle
              label={t('report.markSensitive')}
              description={t('report.markSensitiveHint')}
              checked={!!item.sensitive}
              onChange={(v) => void patchItems([item.id], { sensitive: v })}
            />
          </div>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void api.invoke('shell:reveal', item.sourcePath)}
        >
          {t('common.reveal')}
        </Button>
      </div>
      {folderOpen && (
        <FolderDialog
          plan={plan}
          items={[item]}
          initialRel={relTarget(plan, item).split('/').slice(0, -1).join('/')}
          onClose={() => setFolderOpen(false)}
        />
      )}
    </aside>
  )
}
