import { padChannel } from '../utils/time.ts'
import { SESSION_CHANNEL } from '../session/session-channel.ts'

const BARS = ['#c4c4c4', '#c4c400', '#00c4c4', '#00c400', '#c400c4', '#c40000', '#0000c4']

export const SESSION_CARD_COPY = {
  title: 'Import',
  note: 'SELECT IMPORT IN THE GUIDE, THEN FOLDER OR FILES, TO CREATE A TEMPORARY CHANNEL',
} as const

/** Channel 000 before anything is imported: a deliberate card, never a blank screen. */
export function SessionCard() {
  return (
    <div className="test-card is-session">
      <div className="bars" aria-hidden="true">
        {BARS.map((color) => (
          <span key={color} style={{ background: color }} />
        ))}
      </div>
      <div className="card-disc" aria-hidden="true" />
      <div className="card-copy">
        <p className="card-number">{padChannel(SESSION_CHANNEL.number)}</p>
        <p className="card-name">{SESSION_CHANNEL.name}</p>
        <p className="card-title">{SESSION_CARD_COPY.title}</p>
        <p className="card-note">{SESSION_CARD_COPY.note}</p>
      </div>
    </div>
  )
}
