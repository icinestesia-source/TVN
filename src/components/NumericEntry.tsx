import { listChannels } from '../data/catalogue.ts'
import { entryFace } from '../input/tuner.ts'

export function NumericEntry({ digits }: { digits: string }) {
  const numbers = listChannels().map((channel) => channel.number)
  return (
    <div className="numeric" role="status" aria-live="polite">
      <p className="numeric-kicker">Channel</p>
      <p className="numeric-value">{entryFace(digits, numbers)}</p>
    </div>
  )
}
