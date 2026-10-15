import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Plan, PlanItem } from '@shared/types'
import { thumbUrl } from '../../app/api'
import { Badge, Button, ConfidenceDots } from '../../components/ui'
import { patchItems } from './actions'
import { ItemRow } from './ItemRow'

/**
 * Photos/videos of one event shown as a single card (title, count, a strip of thumbnails);
 * expand to see or edit individual files (revision 1).
 */
export function EventCard({
  plan,
  items,
  editable,
  selected,
  onSelect,
}: {
  plan: Plan
  items: PlanItem[]
  editable: boolean
  selected: string | null
  onSelect: (id: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const first = items[0]!
  const on = items.filter((i) => i.enabled).length
  const thumbs = items.filter((i) => i.thumbPath).slice(0, 8)
  return (
    <li className="border-b border-line last:border-b-0">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[var(--accent)]"
          checked={on === items.length}
          ref={(el) => {
            if (el) el.indeterminate = on > 0 && on < items.length
          }}
          disabled={!editable}
          aria-label={t('report.include', { name: first.unitTitle ?? '' })}
          onChange={(e) =>
            void patchItems(
              items.map((i) => i.id),
              { enabled: e.target.checked },
            )
          }
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{first.unitTitle ?? t('report.event')}</span>
            <Badge tone="accent">{t('report.eventCount', { count: items.length })}</Badge>
            {first.source === 'ai' && <Badge tone="accent">AI</Badge>}
          </div>
          <div className="truncate text-[13px] text-muted">{first.reason}</div>
          {thumbs.length > 0 && (
            <div className="mt-2 flex gap-1.5">
              {thumbs.map((i) => (
                <img
                  key={i.id}
                  src={thumbUrl(i.thumbPath)}
                  alt=""
                  loading="lazy"
                  className="h-12 w-12 rounded object-cover"
                />
              ))}
            </div>
          )}
        </div>
        <ConfidenceDots value={first.confidence} label={t('report.confidence')} />
        <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t('report.hideFiles') : t('report.showFiles')}
        </Button>
      </div>
      {open && (
        <ul className="border-t border-line bg-bg/40">
          {items.map((it) => (
            <ItemRow
              key={it.id}
              plan={plan}
              item={it}
              editable={editable}
              selected={selected === it.id}
              onSelect={() => onSelect(it.id)}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
