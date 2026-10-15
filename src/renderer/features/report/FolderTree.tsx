import { useTranslation } from 'react-i18next'
import type { PlanItem } from '@shared/types'
import { cx } from '../../components/ui'
import { folderTree, type TreeNode } from './model'

/** Proposed target folders (revision 1): click a folder to see only what goes there. */
export function FolderTree({
  items,
  selected,
  onSelect,
}: {
  items: PlanItem[]
  selected: TreeNode | null
  onSelect: (n: TreeNode | null) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const nodes = folderTree(items)
  if (nodes.length <= 1) return null
  const multiRoot = new Set(nodes.map((n) => n.root)).size > 1
  return (
    <nav aria-label={t('report.tree')} className="sticky top-0 w-60 shrink-0 self-start">
      <div className="mb-2 text-[13px] font-medium text-muted">{t('report.tree')}</div>
      <ul className="flex max-h-[70vh] flex-col overflow-auto rounded-lg border border-line bg-surface py-1">
        <li>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={cx(
              'flex w-full items-center justify-between px-3 py-1 text-left text-[13px]',
              !selected ? 'bg-accent-soft font-medium text-accent-text' : 'hover:bg-surface-2',
            )}
          >
            <span>{t('report.allFolders')}</span>
          </button>
        </li>
        {nodes
          .filter((n) => n.depth > 0 || multiRoot)
          .map((n) => (
            <li key={n.key}>
              <button
                type="button"
                title={n.rel}
                aria-current={selected?.key === n.key ? 'true' : undefined}
                onClick={() => onSelect(n)}
                className={cx(
                  'flex w-full items-center justify-between gap-2 py-1 pr-3 text-left text-[13px]',
                  selected?.key === n.key
                    ? 'bg-accent-soft font-medium text-accent-text'
                    : 'hover:bg-surface-2',
                )}
                style={{ paddingLeft: 12 + (n.depth - (multiRoot ? 0 : 1)) * 14 }}
              >
                <span className="truncate">{n.name}</span>
                <span className="shrink-0 tabular-nums text-muted">{n.count}</span>
              </button>
            </li>
          ))}
      </ul>
    </nav>
  )
}
