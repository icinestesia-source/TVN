import type { KeyboardEvent } from 'react'
import type { TvContextValue } from '../state/tv-context.ts'
import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'
import { createLongPress } from '../view/channel-edit.ts'
import {
  captionsAvailable,
  fullscreenAvailable,
  SHORTCUTS,
  type ChannelActions,
  type Corner,
  type CornerActions,
  type ShortcutContext,
  type ShortcutDefinition,
} from '../view/info-shortcuts.ts'

export type HistoryActions = {
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
  /** Multi View is showing; MULTI holds ↓'s place until there is somewhere forward to go. */
  multiOn: boolean
  onMulti: () => void
}

/** ↑ and ↓ through the channels watched this session, the same in the Guide and over the picture. */
export function historyActions(tv: Pick<TvContextValue, 'canGoBack' | 'canGoForward' | 'multiviewMode' | 'dispatch'>): HistoryActions {
  return {
    canBack: tv.canGoBack,
    canForward: tv.canGoForward,
    onBack: () => tv.dispatch({ type: 'history-back' }),
    onForward: () => tv.dispatch({ type: 'history-forward' }),
    multiOn: tv.multiviewMode !== '1',
    onMulti: () => tv.dispatch({ type: 'multiview' }),
  }
}

/** Enter and Space press the control rather than reaching the television (and tuning or confirming). */
function keepKey(event: KeyboardEvent<HTMLElement>) {
  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
}

/** One hold timer for the corner keys, kept across the bar's once-a-second renders (every hold does the same). */
let holdAction: () => void = () => {}
const cornerHold = createLongPress(() => holdAction())

function cornerKey(at: Corner, shortcut: ShortcutDefinition, context: ShortcutContext) {
  const available = shortcut.available(context)
  const className = `info-square info-corner is-${shortcut.id}`
  const action = available ? shortcut : null
  const pressed = action?.pressed?.(context)
  const hold = action?.hold
  if (hold) holdAction = () => hold(context)
  return (
    <button
      key={at}
      type="button"
      className={pressed ? `${className} is-on` : className}
      disabled={!available}
      aria-pressed={pressed}
      aria-haspopup={hold ? 'dialog' : undefined}
      title={available ? (shortcut.title ?? shortcut.name) : shortcut.unavailable}
      aria-label={shortcut.name}
      onKeyDown={keepKey}
      onPointerDown={
        hold
          ? (event) => {
              // The bar's own hold edits the channel; this one is the key's.
              event.stopPropagation()
              cornerHold.down(event)
            }
          : undefined
      }
      onPointerMove={hold ? (event) => cornerHold.move(event) : undefined}
      onPointerUp={hold ? cornerHold.up : undefined}
      onPointerCancel={hold ? cornerHold.cancel : undefined}
      onPointerLeave={hold ? cornerHold.cancel : undefined}
      onContextMenu={
        hold
          ? (event) => {
              event.preventDefault()
              event.stopPropagation()
              cornerHold.opened()
              hold(context)
            }
          : undefined
      }
      onClick={
        action
          ? () => {
              if (hold && cornerHold.swallowClick()) return
              action.run(context)
            }
          : undefined
      }
    >
      {shortcut.label}
    </button>
  )
}

/**
 * The information bar's controls, one 3×3 pad wherever the bar appears, in the Guide and over the picture.
 * The gold Guide key in the centre keeps the size of the Watch key it replaced, and its corners hold the
 * viewer's shortcuts:
 *
 *   REMOTE  ↑ CH+  ⛶
 *   ←      GUIDE   →
 *   TVN     ↓ CH−  R
 *
 * ↑ and ↓ move back and forward through the channels watched; until ↑ has been used there is nowhere
 * forward to go, so ↓'s place holds MULTI. CH+ and CH− share their cells and step along the channel numbers. ← and → step back and forth along the channel's programmes (in the Guide they move
 * its cursor).
 */
export function InfoActions({
  programme,
  onPrev,
  onNext,
  history,
  corners,
  channels,
}: {
  channel: Channel
  programme: Programme
  /** Goes back to the programme before this one on the channel. */
  onPrev?: () => void
  /** Goes on to the programme after this one on the channel. */
  onNext?: () => void
  /** Back and Forward through the channels watched this session. */
  history: HistoryActions
  corners: CornerActions
  /** CH+ and CH−, beside ↑ and ↓. */
  channels: ChannelActions
}) {
  const context: ShortcutContext = {
    captionsAvailable: captionsAvailable(programme),
    fullscreenAvailable: fullscreenAvailable(),
    subtitles: corners.subtitles,
    remoteOpen: corners.remoteOpen,
    surfing: corners.surfing,
    openSettings: corners.openSettings,
    dispatch: corners.dispatch,
  }
  const corner = (at: Corner) => cornerKey(at, SHORTCUTS[corners.assignment[at]], context)

  return (
    <div className="info-actions info-pad has-history" role="group" aria-label="Programme controls">
      {corner('topLeft')}
      <div className="info-pad-split">
        <button
          type="button"
          className="info-square info-pad-up"
          disabled={!history.canBack}
          title="Previous watched channel"
          aria-label="Previous watched channel"
          onKeyDown={keepKey}
          onClick={history.onBack}
        >
          ↑
        </button>
        <button
          type="button"
          className="info-square info-pad-channel"
          title="Channel up"
          aria-label="Channel up"
          onKeyDown={keepKey}
          onClick={channels.onUp}
        >
          CH+
        </button>
      </div>
      {corner('topRight')}
      <button
        type="button"
        className="info-square info-pad-side"
        disabled={!onPrev}
        title="Previous programme"
        aria-label="Previous programme"
        onKeyDown={keepKey}
        onClick={onPrev}
      >
        ←
      </button>
      <button
        type="button"
        className="tune-key info-pad-guide"
        aria-label="Guide"
        onKeyDown={keepKey}
        onClick={() => corners.dispatch({ type: 'guide' })}
      >
        Guide
      </button>
      <button
        type="button"
        className="info-square info-pad-side"
        disabled={!onNext}
        title="Next programme"
        aria-label="Next programme"
        onKeyDown={keepKey}
        onClick={onNext}
      >
        →
      </button>
      {corner('bottomLeft')}
      <div className="info-pad-split">
        {history.canForward ? (
          <button
            type="button"
            className="info-square info-pad-down"
            title="Next watched channel"
            aria-label="Next watched channel"
            onKeyDown={keepKey}
            onClick={history.onForward}
          >
            ↓
          </button>
        ) : (
          <button
            type="button"
            className={history.multiOn ? 'info-square info-pad-multi is-on' : 'info-square info-pad-multi'}
            aria-pressed={history.multiOn}
            title="Multi View"
            aria-label="Multi View"
            onKeyDown={keepKey}
            onClick={history.onMulti}
          >
            Multi
          </button>
        )}
        <button
          type="button"
          className="info-square info-pad-channel"
          title="Channel down"
          aria-label="Channel down"
          onKeyDown={keepKey}
          onClick={channels.onDown}
        >
          CH−
        </button>
      </div>
      {corner('bottomRight')}
    </div>
  )
}
