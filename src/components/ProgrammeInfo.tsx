import { useState } from 'react'
import { programmeAttribution, useSourceRegister } from '../credits/attribution.ts'
import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'
import { playbackLabel } from '../view/playback-label.ts'
import { programmeDate } from '../view/programme-date.ts'
import { formatDuration, formatElapsed, formatRange, padChannel } from '../utils/time.ts'
import { hasPicture } from '../session/session-channel.ts'
import { bookmarkFor, toggleBookmark, useBookmarks } from '../view/bookmarks-store.ts'
import { TimeSlider } from './TimeSlider.tsx'

export function shownDescription(programme: Programme): string | null {
  if (programme.mediaKind === 'audio' && programme.mediaUrl) return null
  // A clip's own text from its publisher's feed (Odysee, BitChute, Vimeo, archives) is not TVN's to show.
  if (programme.sourceRef?.startsWith('podcast:')) return null
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
  onSeek,
  favourite,
}: {
  channel: Channel
  programme: Programme
  startMs: number
  endMs: number
  now: number
  alert?: boolean
  /** What follows; `onPlay` makes its title a button that moves on to it now. */
  next?: { title: string; startMs: number; endMs: number; onPlay?: () => void }
  /** Playing because the viewer chose it in the Guide, not because it is on air. */
  picked?: boolean
  /** A viewing Guide chose it: green rather than gold, and Next is the Guide's next item (null when it is the last). */
  following?: { next: { title: string; channelNumber: number } | null; onNext?: () => void } | null
  /** Over the picture: clicking the time opens a slider to move through the programme. */
  onSeek?: (seconds: number) => void
  /** The channel's star: whether it is a favourite, and the press that changes it. */
  favourite?: { on: boolean; onToggle: () => void }
}) {
  const [sliding, setSliding] = useState(false)
  const bookmarks = useBookmarks()
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
  const clip = !stream && hasPicture(programme) ? bookmarkFor(channel, programme) : null
  const marked = clip !== null && bookmarks.some((saved) => saved.key === clip.key)

  return (
    <div className="info-main">
      <p className="info-kicker">
        {label ? <span className="info-net">{label}</span> : null}
        <span>{padChannel(channel.number)}</span>
        <span>{channel.name}</span>
        {favourite ? (
          <button
            type="button"
            className={favourite.on ? 'info-star is-on' : 'info-star'}
            aria-pressed={favourite.on}
            aria-label={favourite.on ? 'Remove this channel from Favourites' : 'Add this channel to Favourites'}
            title={favourite.on ? 'Favourite channel (A)' : 'Add to Favourites (A)'}
            onClick={(event) => {
              event.stopPropagation()
              favourite.onToggle()
            }}
          >
            {favourite.on ? '★' : '☆'}
          </button>
        ) : null}
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
      <div className="info-title-line">
        <h2 className="info-title">{programme.title}</h2>
        {clip ? (
          <button
            type="button"
            className={marked ? 'info-bookmark is-on' : 'info-bookmark'}
            aria-pressed={marked}
            aria-label={marked ? "Remove this clip's bookmark" : 'Bookmark this clip'}
            title={marked ? 'Bookmarked (D)' : 'Bookmark this clip (D)'}
            onClick={(event) => {
              event.stopPropagation()
              toggleBookmark(clip)
            }}
          >
            {marked ? '♥\uFE0E' : '♡'}
          </button>
        ) : null}
      </div>
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
        {stream ? null : <span className="info-clock">{formatRange(startMs, endMs)}</span>}
        {stream ? null : <span className="info-clock">{formatDuration(programme.durationSeconds)}</span>}
        {stream ? null : <span className="info-date">{programmeDate(programme)}</span>}
        {live && !stream && onSeek ? (
          <button
            type="button"
            className={sliding ? 'info-clock info-elapsed is-sliding' : 'info-clock info-elapsed'}
            title="Move through the programme"
            aria-expanded={sliding}
            onClick={(event) => {
              event.stopPropagation()
              setSliding((open) => !open)
            }}
          >
            {formatElapsed(elapsed)} / {formatElapsed(programme.durationSeconds)}
          </button>
        ) : live && !stream ? (
          <span className="info-clock">
            {formatElapsed(elapsed)} / {formatElapsed(programme.durationSeconds)}
          </span>
        ) : null}
        {status ? <span className={alert ? 'info-status is-alert' : 'info-status'}>{status}</span> : null}
      </p>
      {sliding && onSeek && live && !stream ? (
        <TimeSlider key={programme.id} elapsedSeconds={elapsed} durationSeconds={programme.durationSeconds} onSeek={onSeek} onDone={() => setSliding(false)} />
      ) : null}
      {description ? <p className="info-desc">{description}</p> : null}
      {following ? (
        <p className="info-next">
          <span className="info-net is-following">Guide next</span>
          {following.next ? <NextTitle title={following.next.title} onPlay={following.onNext} /> : <span className="info-next-title">End of Guide · back to Now</span>}
          {following.next ? <span className="info-next-time">{padChannel(following.next.channelNumber)}</span> : null}
        </p>
      ) : next && !stream ? (
        <p className="info-next">
          <span className="info-net">Next</span>
          <NextTitle title={next.title} onPlay={next.onPlay} />
          <span className="info-next-time">{formatRange(next.startMs, next.endMs)}</span>
        </p>
      ) : null}
    </div>
  )
}

/** The next clip's title, which plays it at once when there is a way to. */
function NextTitle({ title, onPlay }: { title: string; onPlay?: () => void }) {
  if (!onPlay) return <span className="info-next-title">{title}</span>
  return (
    <button
      type="button"
      className="info-next-title is-playable"
      title="Play this next"
      onClick={(event) => {
        event.stopPropagation()
        onPlay()
      }}
    >
      {title}
    </button>
  )
}
