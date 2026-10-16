/**
 * PLAYBACK in Options, off unless the viewer turns it on. While it is on, unpausing a clip continues from
 * the moment it was paused. While it is off, unpausing rejoins wherever the Guide timeline has moved on to.
 * Kept in this browser.
 */
import { useSyncExternalStore } from 'react'
import type { Programme } from '../types/programme.ts'

export const RESUME_FROM_PAUSE_KEY = 'tvn.resume-from-pause.v1'

type Store = Pick<Storage, 'getItem' | 'setItem'>

function browserStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadResumeFromPause(store: Store | null = browserStore()): boolean {
  try {
    return store?.getItem(RESUME_FROM_PAUSE_KEY) === 'on'
  } catch {
    return false
  }
}

let current: boolean | null = null
const listeners = new Set<() => void>()

export function resumeFromPause(): boolean {
  current ??= loadResumeFromPause()
  return current
}

export function setResumeFromPause(on: boolean, store: Store | null = browserStore()): void {
  current = on
  try {
    store?.setItem(RESUME_FROM_PAUSE_KEY, on ? 'on' : 'off')
  } catch {
    // A browser that keeps nothing still holds the choice for this visit.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useResumeFromPause(): boolean {
  return useSyncExternalStore(subscribe, resumeFromPause, () => false)
}

/** Where a paused clip was, so unpausing can rejoin it instead of the Guide. */
export interface PausedClip {
  channelNumber: number
  programme: Programme
  /** Seconds into the clip when pause was pressed. */
  seconds: number
  slot?: { startMs: number; endMs: number }
}

let held: PausedClip | null = null

export function holdPausedClip(clip: PausedClip | null): void {
  held = clip
}

export function takePausedClip(): PausedClip | null {
  const clip = held
  held = null
  return clip
}

/**
 * Seconds to rejoin on unpause, when Playback is on and this channel is the one that was paused.
 * Null follows the Guide timeline.
 */
export function unpauseSeconds(enabled: boolean, clip: PausedClip | null, channelNumber: number): number | null {
  if (!enabled || !clip || clip.channelNumber !== channelNumber) return null
  if (!Number.isFinite(clip.seconds) || clip.seconds < 0) return null
  return clip.seconds
}
