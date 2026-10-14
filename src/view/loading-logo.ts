/**
 * LOADING LOGO in Options: the logo on the loading screen pulses (the default), or spins like a fidget spinner
 * when the viewer flicks it, slowing to a stop round its centre. Kept in this browser.
 */
import { useSyncExternalStore } from 'react'

export type LoadingLogo = 'pulse' | 'spin'

export const LOADING_LOGO_KEY = 'tvn.loading-logo.v1'

type Store = Pick<Storage, 'getItem' | 'setItem'>

function browserStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadLoadingLogo(store: Store | null = browserStore()): LoadingLogo {
  try {
    return store?.getItem(LOADING_LOGO_KEY) === 'spin' ? 'spin' : 'pulse'
  } catch {
    return 'pulse'
  }
}

let current: LoadingLogo | null = null
const listeners = new Set<() => void>()

export function loadingLogo(): LoadingLogo {
  current ??= loadLoadingLogo()
  return current
}

export function setLoadingLogo(mode: LoadingLogo, store: Store | null = browserStore()): void {
  current = mode
  try {
    store?.setItem(LOADING_LOGO_KEY, mode)
  } catch {
    // A browser that keeps nothing still uses the choice for this visit.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLoadingLogo(): LoadingLogo {
  return useSyncExternalStore(subscribe, loadingLogo, () => 'pulse')
}

/** The pointer's angle round the centre, in degrees, clockwise from the right. */
export function pointerAngle(centre: { x: number; y: number }, point: { x: number; y: number }): number {
  return (Math.atan2(point.y - centre.y, point.x - centre.x) * 180) / Math.PI
}

/** The shortest turn from one angle to the next, so crossing ±180° is not read as a whole turn back. */
export function turnBetween(from: number, to: number): number {
  return ((((to - from + 180) % 360) + 360) % 360) - 180
}

/** The fastest a flick can set it spinning, in degrees a second: about five turns a second. */
export const SPIN_MAX = 1800
/** How quickly it slows: its speed falls by this share every second, so a hard flick runs for several seconds. */
export const SPIN_FRICTION = 0.55
/** Below this it has stopped. */
export const SPIN_REST = 8

/** The spin the logo leaves the finger with: the turn over the last moments of the drag, per second. */
export function releaseSpin(samples: readonly { angle: number; at: number }[], now: number, windowMs = 120): number {
  const recent = samples.filter((sample) => now - sample.at <= windowMs)
  if (recent.length < 2) return 0
  let turned = 0
  for (let index = 1; index < recent.length; index += 1) turned += turnBetween(recent[index - 1].angle, recent[index].angle)
  const seconds = (recent[recent.length - 1].at - recent[0].at) / 1000
  if (seconds <= 0) return 0
  return Math.max(-SPIN_MAX, Math.min(SPIN_MAX, turned / seconds))
}

/** Degrees a second of spin added by each pixel a trackpad swipe scrolls. */
export const WHEEL_GAIN = 3
const LINE_PX = 16

/**
 * A two-finger trackpad swipe (or a mouse wheel) pushes the spin: the fingers moving right or down turn it
 * clockwise, left or up anticlockwise. With natural scrolling, the Mac's default, the page reports those
 * moves as negative deltas. Each push adds to the spin already there, so the swipe's own momentum, which the
 * trackpad sends on after the fingers lift, keeps it going.
 */
export function wheelSpin(spin: number, wheel: { deltaX: number; deltaY: number; deltaMode: number }): number {
  const scale = wheel.deltaMode === 1 ? LINE_PX : wheel.deltaMode === 2 ? LINE_PX * 20 : 1
  const push = -(wheel.deltaX + wheel.deltaY) * scale * WHEEL_GAIN
  return Math.max(-SPIN_MAX, Math.min(SPIN_MAX, spin + push))
}

/** The spin after `seconds` more of friction; zero once it is too slow to see. */
export function slowedSpin(spin: number, seconds: number): number {
  const next = spin * Math.pow(1 - SPIN_FRICTION, seconds)
  return Math.abs(next) < SPIN_REST ? 0 : next
}
