import type { TvCommand } from '../types/input.ts'

type ChannelStep = Extract<TvCommand, { type: 'channel-up' | 'channel-down' }>

/** Travel, in pixels, that makes one channel change: a trackpad scroll's summed movement, or a swipe's. */
export const WHEEL_STEP_PX = 60
export const SWIPE_MIN_PX = 50
/** A scroll whose events pause this long has ended; its trailing momentum never changes a second channel. */
export const WHEEL_REST_MS = 220
export const SWIPE_MAX_MS = 800

const LINE_PX = 16
const PAGE_PX = 400

/**
 * Scrolling over the picture changes channel, once per gesture: scrolling down (on a Mac trackpad, two
 * fingers swiped up) goes one channel back, scrolling up one channel on. Sideways scrolls and pinches
 * are left alone.
 */
export function createWheelStepper() {
  let travel = 0
  let lastAt = -Infinity
  let spent = false
  return (event: { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; timeStamp: number }): ChannelStep | null => {
    if (event.timeStamp - lastAt > WHEEL_REST_MS) {
      travel = 0
      spent = false
    }
    lastAt = event.timeStamp
    if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || spent) return null
    travel += event.deltaY * (event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? PAGE_PX : 1)
    if (Math.abs(travel) < WHEEL_STEP_PX) return null
    spent = true
    return travel > 0 ? { type: 'channel-down' } : { type: 'channel-up' }
  }
}

/** A quick, clearly vertical swipe on a touch screen: up goes one channel on, down one channel back (the reverse of a trackpad). */
export function swipeStep(start: { x: number; y: number; at: number }, end: { x: number; y: number; at: number }): ChannelStep | null {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (end.at - start.at > SWIPE_MAX_MS || Math.abs(dy) < SWIPE_MIN_PX || Math.abs(dy) < Math.abs(dx) * 1.5) return null
  return dy < 0 ? { type: 'channel-up' } : { type: 'channel-down' }
}
