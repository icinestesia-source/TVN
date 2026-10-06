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

/** One hold timer for the corner keys, kept across the bar's once-a-second renders. A held mouse button counts. */
let holdAction: () => void = () => {}
const cornerHold = createLongPress(() => holdAction(), undefined, undefined, true)
/** The green GUIDE key's own hold (the normal Guide while a Map plays), apart from the corners' timer. */
let guideHoldAction: () => void = () => {}
const guideHold = createLongPress(() => guideHoldAction(), undefined, undefined, true)
/** How the last press on a corner began: a touch hold also raises the context menu on some phones. */
let lastPointer = 'mouse'

function cornerKey(at: Corner, shortcut: ShortcutDefinition, context: ShortcutContext) {
  const available = shortcut.available(context)
  const className = `info-square info-corner is-${shortcut.id}`
  const action = available ? shortcut : null
  const pressed = action?.pressed?.(context)
  const scoped = action?.scoped?.(context) ?? false
  const hold = action?.hold
  const label = shortcut.labelOf?.(context) ?? shortcut.label
  // A right-click opens the key's menu; a key without one treats it as its hold.
  const menu = action?.menu ?? hold
  if (hold) holdAction = () => hold(context)
  return (
    <button
      key={at}
      type="button"
      className={`${className}${pressed ? ' is-on' : ''}${scoped ? ' is-scoped' : ''}${label.length > 4 ? ' is-long' : ''}`}
      disabled={!available}
      aria-pressed={pressed}
      aria-haspopup={action?.menu && !action.describe ? 'dialog' : undefined}
      title={available ? (action?.describe?.(context) ?? shortcut.title ?? shortcut.name) : shortcut.unavailable}
      aria-label={shortcut.name}
      onKeyDown={keepKey}
      onPointerDown={
        hold || menu
          ? (event) => {
              // The bar's own hold edits the channel; this one is the key's.
              event.stopPropagation()
              lastPointer = event.pointerType
              if (hold && event.button === 0) cornerHold.down(event)
            }
          : undefined
      }
      onPointerMove={hold ? (event) => cornerHold.move(event) : undefined}
      onPointerUp={hold ? cornerHold.up : undefined}
      onPointerCancel={hold ? cornerHold.cancel : undefined}
      onPointerLeave={hold ? cornerHold.cancel : undefined}
      onContextMenu={
        menu
          ? (event) => {
              event.preventDefault()
              event.stopPropagation()
              if (lastPointer !== 'mouse') {
                // The phone's own menu during a touch hold: the hold itself, once.
                const holding = cornerHold.holding()
                cornerHold.opened()
                if (holding && hold) hold(context)
                return
              }
              cornerHold.cancel()
              menu(context)
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
      {label}
    </button>
  )
}

/**
 * The information bar's controls, one 3×3 pad wherever the bar appears, in the Guide and over the picture.
 * The gold Guide key in the centre keeps the size of the Watch key it replaced, and its corners hold the
 * viewer's shortcuts. TV Surf (Space on a keyboard), labelled with the active User Network's name, surfs to another
 * channel on a click; a right-click or a hold switches it between surfing ALL and that network; ⚙ opens Settings:
 *
 *   REMOTE  ↑ CH+  ⛶
 *   ←      GUIDE   →
 *   ⚙       ↓ CH−  TVN
 *
 * ↑ and ↓ move back and forward through the channels watched; until ↑ has been used there is nowhere
 * forward to go, so ↓'s place holds MULTI. CH+ and CH− share their cells and step along the channel numbers. ← and → step back and forth along the channel's programmes (in the Guide they move
 * its cursor).
 */
export function InfoActions({
  programme,
  onPrev: programmePrev,
  onNext: programmeNext,
  history,
  corners,
  channels,
  following = false,
  guideSteps,
}: {
  channel: Channel
  programme: Programme
  /** A viewing Guide is choosing what plays: GUIDE reads green. */
  following?: boolean
  /** While following, ← and → move along the Guide instead of the channel's programmes. */
  guideSteps?: { onPrev: () => void; onNext: () => void }
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
  const onPrev = guideSteps?.onPrev ?? programmePrev
  const onNext = guideSteps?.onNext ?? programmeNext
  const context: ShortcutContext = {
    captionsAvailable: captionsAvailable(programme),
    fullscreenAvailable: fullscreenAvailable(),
    subtitles: corners.subtitles,
    remoteOpen: corners.remoteOpen,
    surfing: corners.surfing,
    randomScoped: corners.randomScoped,
    surfScopeName: corners.surfScopeName,
    toggleSurfScope: corners.toggleSurfScope,
    openRandomSettings: corners.openRandomSettings,
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
        title={guideSteps ? 'Previous item in the Guide' : 'Previous programme'}
        aria-label={guideSteps ? 'Previous item in the Guide' : 'Previous programme'}
        onKeyDown={keepKey}
        onClick={onPrev}
      >
        ←
      </button>
      <button
        type="button"
        className={following ? 'tune-key info-pad-guide is-following' : 'tune-key info-pad-guide'}
        aria-label={following ? 'Guide, TVN is following My Guide' : 'Guide'}
        title={following ? 'TVN is following a Map: click for its schedule · right-click or hold for the Guide' : undefined}
        onKeyDown={keepKey}
        onPointerDown={
          following
            ? (event) => {
                // The bar's own hold edits the channel; this one is the Guide key's.
                event.stopPropagation()
                lastPointer = event.pointerType
                guideHoldAction = () => corners.dispatch({ type: 'guide', listings: true })
                if (event.button === 0) guideHold.down(event)
              }
            : undefined
        }
        onPointerMove={following ? (event) => guideHold.move(event) : undefined}
        onPointerUp={following ? guideHold.up : undefined}
        onPointerCancel={following ? guideHold.cancel : undefined}
        onPointerLeave={following ? guideHold.cancel : undefined}
        onContextMenu={
          following
            ? (event) => {
                event.preventDefault()
                event.stopPropagation()
                if (lastPointer !== 'mouse') {
                  // The phone's own menu during a touch hold: the hold itself, once.
                  const holding = guideHold.holding()
                  guideHold.opened()
                  if (holding) corners.dispatch({ type: 'guide', listings: true })
                  return
                }
                guideHold.cancel()
                corners.dispatch({ type: 'guide', listings: true })
              }
            : undefined
        }
        onClick={() => {
          if (following && guideHold.swallowClick()) return
          corners.dispatch({ type: 'guide' })
        }}
      >
        Guide
      </button>
      <button
        type="button"
        className="info-square info-pad-side"
        disabled={!onNext}
        title={guideSteps ? 'Next item in the Guide' : 'Next programme'}
        aria-label={guideSteps ? 'Next item in the Guide' : 'Next programme'}
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
