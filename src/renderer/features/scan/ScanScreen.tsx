import { useTranslation } from 'react-i18next'
import { formatBytes } from '@shared/format'
import type { ScanSummary } from '@shared/types'
import { Layout } from '../../app/Layout'
import { StatusLine } from '../../app/StatusLine'
import { shortPath } from '../../app/api'
import { useApp } from '../../app/store'
import {
  Button,
  Card,
  EmptyState,
  Notice,
  Progress,
  ProgressIndeterminate,
} from '../../components/ui'
import { PlanStart } from '../plan/PlanStart'

export function ScanScreen(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const scanning = useApp((s) => s.scanning)
  const progress = useApp((s) => s.scanProgress)
  const summary = useApp((s) => s.summary)
  const roots = useApp((s) => s.settings?.roots ?? [])
  const startScan = useApp((s) => s.startScan)
  const cancelScan = useApp((s) => s.cancelScan)
  const setRoute = useApp((s) => s.setRoute)
  const locale = i18n.language === 'tr' ? 'tr-TR' : 'en-US'

  return (
    <Layout
      title={t('scan.title')}
      action={
        scanning ? (
          <Button onClick={() => void cancelScan()}>{t('scan.stop')}</Button>
        ) : summary ? (
          <Button onClick={() => void startScan()} disabled={!roots.length}>
            {t('scan.rescan')}
          </Button>
        ) : null
      }
      footer={
        <>
          <StatusLine />
          {!scanning && summary?.status === 'done' ? <PlanStart /> : null}
        </>
      }
    >
      {scanning ? (
        <Card className="px-6 py-6">
          <div className="mb-3 flex items-baseline justify-between">
            <div className="text-[17px] font-medium">
              {progress?.phase === 'walking' || !progress
                ? t('scan.phase.walking')
                : progress.phase === 'hashing'
                  ? t('scan.phase.hashing')
                  : t('scan.phase.analyzing')}
            </div>
            {progress && progress.phase !== 'walking' && progress.total > 0 ? (
              <div className="text-[13px] text-muted">
                {Math.round((progress.analyzed / progress.total) * 100)}%
              </div>
            ) : null}
          </div>
          {progress && progress.phase !== 'walking' && progress.total > 0 ? (
            <Progress value={progress.analyzed} max={progress.total} label={t('scan.title')} />
          ) : (
            <ProgressIndeterminate label={t('scan.title')} />
          )}
          <div className="mt-4 flex gap-10">
            <Stat label={t('scan.found')} value={(progress?.found ?? 0).toLocaleString(locale)} />
            <Stat
              label={t('scan.analyzed')}
              value={
                progress && progress.phase === 'analyzing'
                  ? `${progress.analyzed.toLocaleString(locale)} / ${progress.total.toLocaleString(locale)}`
                  : progress && progress.phase === 'hashing'
                    ? t('scan.allAnalyzed')
                    : '—'
              }
            />
          </div>
          <div className="mt-4 h-5 truncate font-mono text-[13px] text-muted" aria-live="off">
            {progress?.currentPath ? shortPath(progress.currentPath, 90) : ''}
          </div>
          <p className="mt-3 text-[13px] text-muted">{t('scan.readOnly')}</p>
        </Card>
      ) : summary ? (
        <SummaryView summary={summary} locale={locale} />
      ) : (
        <EmptyState
          title={t('scan.emptyTitle')}
          body={roots.length ? t('scan.emptyBody', { count: roots.length }) : t('scan.noFolders')}
          action={
            roots.length ? (
              <Button variant="primary" onClick={() => void startScan()}>
                {t('folders.scan')}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setRoute('folders')}>
                {t('nav.folders')}
              </Button>
            )
          }
        />
      )}
    </Layout>
  )
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <div className="text-[13px] text-muted">{label}</div>
      <div className="text-[22px] font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function SummaryView({
  summary,
  locale,
}: {
  summary: ScanSummary
  locale: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const fams = Object.entries(summary.byFamily).sort((a, b) => b[1].count - a[1].count)
  const max = Math.max(1, ...fams.map(([, v]) => v.count))
  return (
    <div className="flex flex-col gap-4">
      {summary.status === 'cancelled' && <Notice tone="warn">{t('scan.cancelled')}</Notice>}
      <Card className="px-6 py-5">
        <div className="flex flex-wrap gap-10">
          <Stat label={t('scan.files')} value={summary.totalFiles.toLocaleString(locale)} />
          <Stat label={t('scan.size')} value={formatBytes(summary.totalBytes, locale)} />
          <Stat label={t('scan.sensitive')} value={String(summary.sensitive)} />
          <Stat label={t('scan.bundles')} value={String(summary.bundles)} />
        </div>
      </Card>
      <Card className="px-6 py-5">
        <h2 className="mb-4 text-[17px] font-medium">{t('scan.byType')}</h2>
        <ul className="flex flex-col gap-2">
          {fams.map(([fam, v]) => (
            <li key={fam} className="grid grid-cols-[140px_1fr_120px] items-center gap-3">
              <span className="text-[15px]">{t(`family.${fam}`)}</span>
              <span className="h-2 overflow-hidden rounded-full bg-surface-2">
                <span
                  className="block h-full rounded-full bg-accent"
                  style={{
                    width: `${(v.count / max) * 100}%`,
                    opacity: 0.35 + 0.65 * (v.count / max),
                  }}
                />
              </span>
              <span className="text-right text-[13px] tabular-nums text-muted">
                {v.count.toLocaleString(locale)} · {formatBytes(v.bytes, locale)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      {summary.cloudPlaceholders > 0 && (
        <Notice tone="warn">{t('scan.cloudSkipped', { count: summary.cloudPlaceholders })}</Notice>
      )}
    </div>
  )
}
