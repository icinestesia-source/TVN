import { programmeAttribution, useSourceRegister } from '../credits/attribution.ts'
import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'
import { playbackLabel } from '../view/playback-label.ts'
import { programmeDate } from '../view/programme-date.ts'
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

/** 1001+ channels carry the TVN brand ahead of their own name; 001–999, 000 TVN and 1000 Local Media need no label. */
export function networkLabel(channel: Channel): string | null {
  return channel.origin === 'session' || channel.origin === 'tvn' ? null : channel.number >= 1001 ? 'TVN' : null
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
  following = null,
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
  /** A viewing Guide chose it: green rather than gold, and Next is the Guide's next item (null when it is the last). */
  following?: { next: { title: string; channelNumber: number } | null } | null
}) {
  const stream = programme.liveStream !== undefined
  const live = now >= startMs && now < endMs
  const later = now < startMs
  const elapsed = Math.min(programme.durationSeconds, Math.max(0, (now - startMs) / 1000))
  const description = shownDescription(programme)
  const label = networkLabel(channel)
  const kind = playbackLabel(channel, programme)
  // Airing now, or picked from the Guide and playing, goes unsaid; a Guide slot at another time says when it is.
  const status = picked || following || stream || live ? null : later ? 'Later' : 'Already broadcast'
  const register = useSourceRegister()
  const by = programmeAttribution(programme, register)

  return (
    <div className="info-main">
      <p className="info-kicker">
        {label ? <span className="info-net">{label}</span> : null}
        <span>{padChannel(channel.number)}</span>
        <span>{channel.name}</span>
        {by ? (
          by.url ? (
            <a className="info-creator" href={by.url} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
              {by.text}
            </a>
          ) : (
            <span className="info-creator">{by.text}</span>
          )
        ) : null}
      </p>
      <h2 className="info-title">{programme.title}</h2>
      {programme.relay ? (
        <p className="info-relay">
          On {padChannel(programme.relay.channelNumber)}
          {programme.relay.channelName ? ` · ${programme.relay.channelName}` : ''} · chosen by TVN
        </p>
      ) : null}
      <p className="info-time">
        {/* Gold when the viewer picked it in the Guide: playing, but not what is on air now. */}
        <span className={following ? 'info-kind is-following' : picked ? 'info-kind is-picked' : 'info-kind'}>{kind}</span>
        {following ? <span className="info-following">Following Guide</span> : null}
        {stream ? null : <span>{formatRange(startMs, endMs)}</span>}
        {stream ? null : <span>{formatDuration(programme.durationSeconds)}</span>}
        {stream ? null : <span className="info-date">{programmeDate(programme)}</span>}
        {live && !stream ? (
          <span>
            {formatElapsed(elapsed)} / {formatElapsed(programme.durationSeconds)}
          </span>
        ) : null}
        {status ? <span className={alert ? 'info-status is-alert' : 'info-status'}>{status}</span> : null}
      </p>
      {description ? <p className="info-desc">{description}</p> : null}
      {following ? (
        <p className="info-next">
          <span className="info-net is-following">Guide next</span>
          <span className="info-next-title">{following.next ? following.next.title : 'End of Guide · back to Now'}</span>
          {following.next ? <span className="info-next-time">{padChannel(following.next.channelNumber)}</span> : null}
        </p>
      ) : next && !stream ? (
        <p className="info-next">
          <span className="info-net">Next</span>
          <span className="info-next-title">{next.title}</span>
          <span className="info-next-time">{formatRange(next.startMs, next.endMs)}</span>
        </p>
      ) : null}
    </div>
  )
}
