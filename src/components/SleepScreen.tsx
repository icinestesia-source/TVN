import logo from '../assets/TVNolo.png'
import { BRAND } from './StartupScreen.tsx'

export const SLEEP_COPY = {
  title: 'TVN IS SLEEPING',
  note: 'STREAMING STOPPED AFTER A PERIOD WITHOUT USE · PRESS ANY KEY OR CLICK TO WAKE',
} as const

/** Replaces the whole television while asleep, so no player, tile or stream is left running. */
export function SleepScreen({ onWake }: { onWake: () => void }) {
  return (
    <div className="startup sleep" role="status" aria-live="polite" onClick={onWake}>
      <div className="startup-ident">
        <img className="startup-logo" src={logo} alt={BRAND} width={640} height={640} />
        <p className="startup-message">{SLEEP_COPY.title}</p>
        <p className="startup-note">{SLEEP_COPY.note}</p>
      </div>
    </div>
  )
}
