import { USER_NUMBER_START } from '../data/network.ts'
import { isLocalMediaNumber } from '../session/session-channel.ts'
import { TVN_CHANNEL_NUMBER } from '../tvn/tvn-channel.ts'

/**
 * Which Channel Editor a Guide channel opens. The viewer's own 1001+ channels are theirs outright;
 * curated 001–999 channels are edited as a change kept in this browser, over the shipped channel.
 * 000 TVN opens its own settings ('tvn'); 992–1000 Local Media open MEDIA for that channel ('local').
 */
export type EditorScope = 'user' | 'curated' | 'tvn' | 'local'

export function editorScope(channel: { number: number; origin?: string }): EditorScope | null {
  if (channel.origin === 'session') return isLocalMediaNumber(channel.number) ? 'local' : null
  if (channel.number === TVN_CHANNEL_NUMBER) return channel.origin === 'tvn' ? 'tvn' : null
  if (channel.number >= USER_NUMBER_START) return channel.origin === 'user-import' ? 'user' : null
  if (channel.number >= 1 && channel.number <= 999) return 'curated'
  return null
}

export const LONG_PRESS_MS = 550
const MOVE_TOLERANCE_PX = 10
/** The lift after a hold arrives well within this; a later click is an ordinary one. */
const HOLD_CLICK_MS = 1500

export interface PressPoint {
  pointerType: string
  clientX: number
  clientY: number
}

/**
 * A deliberate touch-and-hold on a channel. Holding opens the editor instead of tuning, and the click
 * the browser sends when the finger lifts is swallowed; a tap, a scroll or any mouse click is untouched.
 */
export function createLongPress(
  onLong: () => void,
  timers: { set: (run: () => void, ms: number) => number; clear: (id: number) => void } = {
    set: (run, ms) => Number(setTimeout(run, ms)),
    clear: (id) => clearTimeout(id),
  },
  delayMs = LONG_PRESS_MS,
  /** A held mouse button counts too (where a right-click means something else). */
  mouse = false,
) {
  let timer = 0
  let origin: { x: number; y: number } | null = null
  let firedAt = 0
  const cancel = () => {
    if (timer) timers.clear(timer)
    timer = 0
    origin = null
  }
  return {
    down(point: PressPoint) {
      cancel()
      firedAt = 0
      if (point.pointerType === 'mouse' && !mouse) return
      origin = { x: point.clientX, y: point.clientY }
      timer = timers.set(() => {
        timer = 0
        origin = null
        firedAt = Date.now()
        onLong()
      }, delayMs)
    },
    move(point: PressPoint) {
      if (!origin) return
      if (Math.hypot(point.clientX - origin.x, point.clientY - origin.y) > MOVE_TOLERANCE_PX) cancel()
    },
    up: cancel,
    cancel,
    /** A hold is under way and has not fired yet. */
    holding(): boolean {
      return origin !== null
    },
    /** The browser's own context menu fired; during a touch hold (Android does this) it is the same hold. */
    opened() {
      if (!origin) return
      cancel()
      firedAt = Date.now()
    },
    /** True once for the click that ends a hold, which must not tune. */
    swallowClick(): boolean {
      const swallow = firedAt !== 0 && Date.now() - firedAt < HOLD_CLICK_MS
      firedAt = 0
      return swallow
    },
  }
}
