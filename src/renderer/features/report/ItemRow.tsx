import { useTranslation } from 'react-i18next'
import { categoryName } from '@shared/categories'
import type { Plan, PlanItem } from '@shared/types'
import { thumbUrl } from '../../app/api'
import { useApp } from '../../app/store'
import { Badge, ConfidenceDots, cx } from '../../components/ui'
import { patchItems } from './actions'
import { baseName, relTarget } from './model'

export function FileIcon({
  item,
  size = 32,
}: {
  item: PlanItem
  size?: number
}): React.JSX.Element {
  const url = thumbUrl(item.thumbPath)
  const ext = baseName(item.sourcePath).split('.').pop()?.slice(0, 4).toUpperCase() ?? ''
  if (url)
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        className="shrink-0 rounded object-cover"
        style={{ width: size, height: size }}
      />
    )
  return (
    <span
      aria-hidden
      className={cx(
        'flex shrink-0 items-center justify-center rounded text-[9px] font-semibold',
        item.sensitive ? 'bg-sensitive-soft text-sensitive' : 'bg-surface-2 text-muted',
      )}
      style={{ width: size, height: size }}
    >
      {item.sensitive ? <LockIcon /> : ext}
    </span>
  )
}

export function LockIcon(): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect x="2" y="5.5" width="8" height="5.5" rx="1.2" fill="currentColor" />
      <path d="M4 5.5V4a2 2 0 1 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

export function ItemRow({
  plan,
  item,
  editable,
  selected,
  onSelect,
}: {
  plan: Plan
  item: PlanItem
  editable: boolean
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const categories = useApp((s) => s.categories)
  const name = baseName(item.sourcePath)
  const target = item.action === 'skip' ? null : relTarget(plan, item)
  const off = !item.enabled || item.action === 'skip'
  return (
    <li
      className={cx(
        'grid grid-cols-[20px_32px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-4 py-2 last:border-b-0',
        selected ? 'bg-accent-soft' : 'hover:bg-surface-2',
        off && 'opacity-60',
      )}
    >
      <input
        type="checkbox"
        className="h-4 w-4 accent-[var(--accent)]"
        checked={item.enabled && item.action !== 'skip'}
        disabled={!editable || item.action === 'skip'}
        aria-label={t('report.include', { name })}
        onChange={(e) => void patchItems([item.id], { enabled: e.target.checked })}
      />
      <FileIcon item={item} />
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 text-left"
        aria-label={t('report.details', { name })}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate" title={item.sourcePath}>
            {name}
          </span>
          {target && (
            <>
              <span className="shrink-0 text-muted" aria-hidden>
                →
              </span>
              <span className="truncate font-mono text-[12px] text-muted" title={item.targetPath}>
                {target}
              </span>
            </>
          )}
        </div>
        <div className="truncate text-[13px] text-muted">{item.reason}</div>
      </button>
      <div className="flex shrink-0 items-center gap-2">
        {item.sensitive && (
          <Badge tone="sensitive">
            <LockIcon /> {t('report.sensitive')}
          </Badge>
        )}
        {item.flags.includes('duplicate') && (
          <Badge tone="warn">{t('report.flag.duplicate')}</Badge>
        )}
        {item.flags.includes('near_duplicate') && (
          <Badge tone="warn">{t('report.flag.near')}</Badge>
        )}
        {item.flags.includes('leaves_icloud') && (
          <Badge tone="warn">{t('report.flag.leavesIcloud')}</Badge>
        )}
        {item.source === 'ai' && <Badge tone="accent">AI</Badge>}
        {item.userEdited && <Badge>{t('report.edited')}</Badge>}
        <Badge>{categoryName(categories, item.category, i18n.language)}</Badge>
        <ConfidenceDots value={item.confidence} label={t('report.confidence')} />
      </div>
    </li>
  )
}
