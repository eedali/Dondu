import lockupLight from '../assets/logo/lockup-horizontal-light.svg'
import lockupDark from '../assets/logo/lockup-horizontal-on-dark.svg'

/** Horizontal brand lockup; swaps to the on-dark variant with the theme. */
export function Logo({ height = 22 }: { height?: number }): React.JSX.Element {
  return (
    <span className="inline-flex" aria-label="Döndü" role="img">
      <img src={lockupLight} alt="" style={{ height }} className="dondu-logo-light" />
      <img src={lockupDark} alt="" style={{ height }} className="dondu-logo-dark" />
    </span>
  )
}
