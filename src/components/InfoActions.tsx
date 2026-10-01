import type { KeyboardEvent } from 'react'
import { creditFor, EMPTY_REGISTER } from '../credits/provenance.ts'
import { mediaLibrary } from '../director/library.ts'
import { isLiveStream } from '../dynamic/stream.ts'
import { hasPicture, isSessionProgramme } from '../session/session-channel.ts'
import type { TvContextValue } from '../state/tv-context.ts'
import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'

export type HistoryActions = { canBack: boolean; canForward: boolean; onBack: () => void; onForward: () => void }

/** ← and → through the channels watched this session, the same in the Guide and over the picture. */
export function historyActions(tv: Pick<TvContextValue, 'canGoBack' | 'canGoForward' | 'dispatch'>): HistoryActions {
  return {
    canBack: tv.canGoBack,
    canForward: tv.canGoForward,
    onBack: () => tv.dispatch({ type: 'history-back' }),
    onForward: () => tv.dispatch({ type: 'history-forward' }),
  }
}

/** Enter and Space press the control rather than reaching the television (and tuning or confirming). */
function keepKey(event: KeyboardEvent<HTMLElement>) {
  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
}

/**
 * The information bar's actions, the same in the Guide and over the picture: the gold Watch (or Listen,
 * Play, Play now) only for what can be played, Prev and Next to step back and forth along the channel,
 * and ↗ to open the programme where its provider hosts it, when TVN has that address on record. ← and →
 * go back and forward through the channels watched, never along the channel numbers.
 */
export function InfoActions({
  channel,
  programme,
  live,
  onTune,
  onPrev,
  onNext,
  history,
}: {
  channel: Channel
  programme: Programme
  /** The programme is on air now. */
  live: boolean
  onTune: () => void
  /** Goes back to the programme before this one on the channel. */
  onPrev?: () => void
  /** Goes on to the programme after this one on the channel. */
  onNext?: () => void
  /** Back and Forward through the channels watched this session. */
  history?: HistoryActions
}) {
  const imported = isSessionProgramme(programme)
  const playable = hasPicture(programme)
  const stream = isLiveStream(programme)
  if (!live && !playable && !onPrev && !onNext && !history) return null
  // The original address comes from the programme's own record; local files and TVN cards have none.
  const original = creditFor(channel, programme, { library: mediaLibrary(), register: EMPTY_REGISTER }).originalUrl

  return (
    <div className={history ? 'info-actions has-history' : 'info-actions'}>
      {history ? (
        <button
          type="button"
          className="info-square"
          disabled={!history.canBack}
          title="Back — previous watched channel"
          aria-label="Back — previous watched channel"
          onKeyDown={keepKey}
          onClick={history.onBack}
        >
          ←
        </button>
      ) : null}
      {imported ? (
        <button type="button" className="tune-key" onClick={onTune}>
          Play now
        </button>
      ) : live ? (
        <button type="button" className="tune-key" onClick={onTune}>
          {stream && channel.mediaKind === 'audio' ? 'Listen' : 'Watch'}
        </button>
      ) : playable ? (
        <button type="button" className="tune-key" onClick={onTune}>
          Play
        </button>
      ) : null}
      {onPrev ? (
        <button type="button" className="tab" onKeyDown={keepKey} onClick={onPrev}>
          Prev
        </button>
      ) : null}
      {onNext ? (
        <button type="button" className="tab" onKeyDown={keepKey} onClick={onNext}>
          Next
        </button>
      ) : null}
      {original ? (
        <a
          className="info-square info-original"
          href={original}
          target="_blank"
          rel="noopener noreferrer"
          title="Open original"
          aria-label="Open original"
          onKeyDown={keepKey}
        >
          ↗
        </a>
      ) : null}
      {history ? (
        <button
          type="button"
          className="info-square"
          disabled={!history.canForward}
          title="Forward — next watched channel"
          aria-label="Forward — next watched channel"
          onKeyDown={keepKey}
          onClick={history.onForward}
        >
          →
        </button>
      ) : null}
    </div>
  )
}
