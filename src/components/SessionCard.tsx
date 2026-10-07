import { padChannel } from '../utils/time.ts'
import { SESSION_CHANNEL } from '../session/session-channel.ts'
import type { Channel } from '../types/channel.ts'

const BARS = ['#c4c4c4', '#c4c400', '#00c4c4', '#00c400', '#c400c4', '#c40000', '#0000c4']

export const SESSION_CARD_COPY = {
  title: 'Media',
  note: 'SELECT MEDIA IN THE GUIDE, THEN FOLDER OR FILES, TO PLAY MEDIA FROM THIS DEVICE',
} as const

/** A Local Media channel before anything is imported: a deliberate card, never a blank screen. */
export function SessionCard({ channel = SESSION_CHANNEL }: { channel?: Channel }) {
  return (
    <div className="test-card is-session">
      <div className="bars" aria-hidden="true">
        {BARS.map((color) => (
          <span key={color} style={{ background: color }} />
        ))}
      </div>
      <div className="card-disc" aria-hidden="true" />
      <div className="card-copy">
        <p className="card-number">{padChannel(channel.number)}</p>
        <p className="card-name">{channel.name}</p>
        <p className="card-title">{SESSION_CARD_COPY.title}</p>
        <p className="card-note">{SESSION_CARD_COPY.note}</p>
      </div>
    </div>
  )
}
