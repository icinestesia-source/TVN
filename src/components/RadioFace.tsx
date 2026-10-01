import { onScreen } from '../player/manual.ts'
import type { Channel } from '../types/channel.ts'
import { useClock } from '../utils/use-clock.ts'
import { formatClock, formatElapsed, padChannel } from '../utils/time.ts'

export function RadioFace({ channel, compact = false }: { channel: Channel; compact?: boolean }) {
  const now = useClock(1000)
  const snap = onScreen(channel, now)
  const current = snap.current
  const stream = current.programme.liveStream !== undefined
  const progress = stream ? 100 : Math.min(100, (current.elapsedSeconds / current.programme.durationSeconds) * 100)
  const artwork = current.programme.thumbnail

  return (
    <div className={compact ? 'radio is-compact' : 'radio'}>
      <div className="radio-bars" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      {artwork ? <img className="radio-art" src={artwork} alt="" /> : <div className="radio-mark">{channel.logo}</div>}
      <p className="radio-number">{padChannel(channel.number)}</p>
      <p className="radio-name">{channel.name}</p>
      {!compact ? (
        <>
          <p className="radio-title">{current.programme.title}</p>
          {current.programme.caption ? <p className="radio-caption">{current.programme.caption}</p> : null}
          {stream ? null : (
            <p className="radio-next">
              Next {formatClock(snap.next.startMs)} {snap.next.programme.title}
            </p>
          )}
          <p className="radio-elapsed">{stream ? 'Live' : formatElapsed(current.elapsedSeconds)}</p>
        </>
      ) : (
        <p className="radio-title">{current.programme.title}</p>
      )}
      <div className="radio-progress" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
    </div>
  )
}
