/** Minimal inline icons (no emoji in product UI). */
export function CheckIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="text-accent">
      <circle cx="7" cy="7" r="7" fill="currentColor" opacity="0.15" />
      <path
        d="M4 7.2l2 2 4-4.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CrossIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="text-error">
      <circle cx="7" cy="7" r="7" fill="currentColor" opacity="0.15" />
      <path
        d="M4.8 4.8l4.4 4.4M9.2 4.8L4.8 9.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}
