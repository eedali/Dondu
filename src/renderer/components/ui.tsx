import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'

const cx = (...c: (string | false | null | undefined)[]): string => c.filter(Boolean).join(' ')

// ---------------------------------------------------------------- Button

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: 'sm' | 'md'
}): React.JSX.Element {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap',
        'disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-9 px-4 text-[15px]',
        variant === 'primary' &&
          'bg-accent text-on-accent hover:bg-accent-hover disabled:hover:bg-accent',
        variant === 'secondary' && 'border border-line bg-surface text-text hover:bg-surface-2',
        variant === 'ghost' && 'text-text hover:bg-surface-2',
        variant === 'danger' && 'border border-line bg-surface text-error hover:bg-error-soft',
        className,
      )}
    />
  )
}

// ---------------------------------------------------------------- Badge

type Tone = 'neutral' | 'accent' | 'warn' | 'error' | 'sensitive'

export function Badge({
  tone = 'neutral',
  children,
  title,
  className,
}: {
  tone?: Tone
  children: ReactNode
  title?: string
  className?: string
}): React.JSX.Element {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex h-5 items-center gap-1 rounded px-1.5 text-[12px] font-medium whitespace-nowrap',
        tone === 'neutral' && 'bg-surface-2 text-muted',
        tone === 'accent' && 'bg-accent-soft text-accent-text',
        tone === 'warn' && 'bg-warn-soft text-warn',
        tone === 'error' && 'bg-error-soft text-error',
        tone === 'sensitive' && 'bg-sensitive-soft text-sensitive',
        className,
      )}
    >
      {children}
    </span>
  )
}

// ---------------------------------------------------------------- Progress

export function Progress({
  value,
  max = 1,
  label,
}: {
  value: number
  max?: number
  label?: string
}): React.JSX.Element {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-150"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

/** Indeterminate thin bar (walking phase, total unknown). */
export function ProgressIndeterminate({ label }: { label?: string }): React.JSX.Element {
  return (
    <div
      role="progressbar"
      aria-label={label}
      className="dondu-indeterminate h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <div className="h-full w-1/3 rounded-full bg-accent" />
    </div>
  )
}

// ---------------------------------------------------------------- Dialog

export function Dialog({
  open,
  title,
  children,
  footer,
  onClose,
  width = 480,
}: {
  open: boolean
  title: string
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
  width?: number
}): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    first?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab' && ref.current) {
        const els = [
          ...ref.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input, select, textarea, [href]',
          ),
        ]
        if (!els.length) return
        const i = els.indexOf(document.activeElement as HTMLElement)
        if (e.shiftKey && i <= 0) {
          els[els.length - 1]?.focus()
          e.preventDefault()
        } else if (!e.shiftKey && i === els.length - 1) {
          els[0]?.focus()
          e.preventDefault()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus()
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"
      onMouseDown={onClose}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-full overflow-auto rounded-lg border border-line bg-surface shadow-lg"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-5">
          <h2 id={titleId} className="text-[17px] font-semibold">
            {title}
          </h2>
        </div>
        <div className="px-6 py-4">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-line px-6 py-3">{footer}</div>
        ) : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Toggle

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  description,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
  description?: string
}): React.JSX.Element {
  const id = useId()
  return (
    <div className={cx('flex items-start justify-between gap-6 py-2', disabled && 'opacity-50')}>
      <label htmlFor={id} className="min-w-0">
        <div className="text-[15px]">{label}</div>
        {description ? <div className="text-[13px] text-muted">{description}</div> : null}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-accent' : 'bg-line',
          disabled && 'cursor-not-allowed',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left]',
            checked ? 'left-[18px]' : 'left-0.5',
          )}
        />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- Field / Input / Select

export function Field({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-6 py-2">
      <div className="min-w-0 pt-1.5">
        <div className="text-[15px]">{label}</div>
        {description ? <div className="text-[13px] text-muted">{description}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return (
    <input
      {...rest}
      className={cx(
        'h-9 rounded-md border border-line bg-surface px-3 text-[15px] text-text placeholder:text-muted',
        'focus:border-accent focus:outline-none disabled:opacity-50',
        className,
      )}
    />
  )
}

export function Select({
  className,
  options,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  options: { value: string; label: string }[]
}): React.JSX.Element {
  return (
    <select
      {...rest}
      className={cx(
        'h-9 rounded-md border border-line bg-surface px-2 text-[15px] text-text focus:border-accent focus:outline-none',
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

// ---------------------------------------------------------------- Tabs

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: T; label: string; count?: number }[]
  value: T
  onChange: (id: T) => void
  label: string
}): React.JSX.Element {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            const i = tabs.findIndex((x) => x.id === value)
            if (e.key === 'ArrowRight') onChange(tabs[(i + 1) % tabs.length]!.id)
            if (e.key === 'ArrowLeft') onChange(tabs[(i - 1 + tabs.length) % tabs.length]!.id)
          }}
          className={cx(
            '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[15px]',
            t.id === value
              ? 'border-accent font-medium text-text'
              : 'border-transparent text-muted hover:text-text',
          )}
        >
          {t.label}
          {t.count !== undefined ? <span className="text-[13px] text-muted">{t.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- EmptyState / Card / Notice

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body?: string
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-line px-8 py-14 text-center">
      <div className="text-[17px] font-medium">{title}</div>
      {body ? <p className="mt-2 max-w-md text-muted">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

export function Card({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return <div className={cx('rounded-lg border border-line bg-surface', className)}>{children}</div>
}

export function Notice({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'warn' | 'error' | 'accent'
  children: ReactNode
}): React.JSX.Element {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'rounded-md px-4 py-3 text-[13px]',
        tone === 'neutral' && 'bg-surface-2 text-text',
        tone === 'accent' && 'bg-accent-soft text-text',
        tone === 'warn' && 'bg-warn-soft text-text',
        tone === 'error' && 'bg-error-soft text-text',
      )}
    >
      {children}
    </div>
  )
}

/** Confidence as three dots (●●● / ●●○ / ●○○). */
export function ConfidenceDots({
  value,
  label,
}: {
  value: number
  label: string
}): React.JSX.Element {
  const n = value >= 0.85 ? 3 : value >= 0.6 ? 2 : 1
  return (
    <span
      className="inline-flex gap-0.5"
      title={`${label}: ${Math.round(value * 100)}%`}
      aria-label={`${label}: ${Math.round(value * 100)}%`}
    >
      {[0, 1, 2].map((i) => (
        <span key={i} className={cx('h-1.5 w-1.5 rounded-full', i < n ? 'bg-accent' : 'bg-line')} />
      ))}
    </span>
  )
}

export { cx }
