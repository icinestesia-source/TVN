import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'
import { formatDuration, formatElapsed, formatRange, padChannel } from '../utils/time.ts'

export function shownDescription(programme: Programme): string | null {
  const text = programme.description?.trim()
  if (!text || text === programme.title) return null
  if (text === 'No programming available') return null
  if (text.startsWith('No playable source')) return null
  if (text.endsWith("The slot is the video's own duration.")) return null
  if (text.startsWith('Imported collection.')) return null
  return text
}

/** Only the viewer's own networks are named; a TVN channel needs no label. */
export function networkLabel(channel: Channel): string | null {
  return channel.origin === 'session' ? 'Session' : channel.number >= 1001 ? 'User' : null
}

/**
 * The programme block of the information bar, shared by the guide and the on-screen INFO display so
 * both read the same way.
 */
export function ProgrammeInfo({
  channel,
  programme,
  startMs,
  endMs,
  now,
  alert = false,
  next,
  picked = false,
}: {
  channel: Channel
  programme: Programme
  startMs: number
  endMs: number
  now: number
  alert?: boolean
  next?: { title: string; startMs: number; endMs: number }
  /** Playing because the viewer chose it in the Guide, not because it is on air. */
  picked?: boolean
}) {
  const stream = programme.liveStream !== undefined
  const live = now >= startMs && now < endMs
  const later = now < startMs
  const elapsed = Math.min(programme.durationSeconds, Math.max(0, (now - startMs) / 1000))
  const description = shownDescription(programme)
  const label = networkLabel(channel)
  // Airing now is what the bar shows by default, so it goes unsaid; only the exceptions are named.
  const status = picked ? 'From Guide · Now returns to air' : stream ? 'Live' : live ? null : later ? 'Later' : 'Already broadcast'

  return (
    <div className="info-main">
      <p className="info-kicker">
        {label ? <span className="info-net">{label}</span> : null}
        <span>{padChannel(channel.number)}</span>
        <span>{channel.name}</span>
      </p>
      <h2 className="info-title">{programme.title}</h2>
      <p className="info-time">
        {stream ? <span>{channel.mediaKind === 'audio' ? 'Live audio' : 'Live stream'}</span> : null}
        {stream ? null : <span>{formatRange(startMs, endMs)}</span>}
        {stream ? null : <span>{formatDuration(programme.durationSeconds)}</span>}
        {live && !stream ? (
          <span>
            {formatElapsed(elapsed)} / {formatElapsed(programme.durationSeconds)}
          </span>
        ) : null}
        {status ? <span className={alert ? 'info-status is-alert' : 'info-status'}>{status}</span> : null}
      </p>
      {description ? <p className="info-desc">{description}</p> : null}
      {next && !stream ? (
        <p className="info-next">
          <span className="info-net">Next</span>
          <span className="info-next-title">{next.title}</span>
          <span className="info-next-time">{formatRange(next.startMs, next.endMs)}</span>
        </p>
      ) : null}
    </div>
  )
}
