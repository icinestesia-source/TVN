import { useSyncExternalStore } from 'react'
import { readClipVideo } from '../services/bookmark-channel.ts'
import type { ImportedVideo } from '../services/channels-import.ts'
import type { Programme } from '../types/programme.ts'
import { bookmarkFor, type Bookmark } from './bookmarks-store.ts'

/**
 * Flags set on clips in the Guide timeline (right-click a clip). When a flagged clip comes on air TVN tunes
 * to its channel, and stays there until the next flag. Flags are kept once they have aired, marked fired so
 * none tunes twice, for the ⚑ tab to make channels from; only the viewer removes them.
 */
export const CLIP_FLAGS_KEY = 'tvn.clip-flags.v1'
export const MAX_CLIP_FLAGS = 1000

export interface ClipFlag {
  /** The channel and the clip's start: one flag per airing. */
  key: string
  channelNumber: number
  channelName: string
  title: string
  startMs: number
  endMs: number
  /** As a bookmark keeps them: what the flagged clip plays, so the ⚑ tab can make a channel of flagged clips. */
  programmeId?: string
  durationSeconds?: number
  video?: ImportedVideo
  /** Its moment has come: TVN tuned to it, or it passed while TVN was closed. */
  fired?: boolean
  /** Set where the viewer clicked inside the clip: the clip's own start, while `startMs` is the moment flagged. */
  clipStartMs?: number
}

/** The start of the clip a flag is on, wherever inside it the flag was set. */
export const flagClipStart = (flag: Pick<ClipFlag, 'startMs' | 'clipStartMs'>): number => flag.clipStartMs ?? flag.startMs

/** OPTIONS → Guide: a flag set from the clip's start (the default), or at the moment clicked inside it. */
export type FlagAt = 'start' | 'clicked'
export const FLAG_AT_KEY = 'tvn.flag-at.v1'

export function loadFlagAt(store: Store | null = browserStore()): FlagAt {
  try {
    return store?.getItem(FLAG_AT_KEY) === 'clicked' ? 'clicked' : 'start'
  } catch {
    return 'start'
  }
}

let flagAtNow: FlagAt | null = null
const flagAtListeners = new Set<() => void>()

export function flagAt(): FlagAt {
  flagAtNow ??= loadFlagAt()
  return flagAtNow
}

export function setFlagAt(mode: FlagAt, store: Store | null = browserStore()): void {
  flagAtNow = mode
  try {
    store?.setItem(FLAG_AT_KEY, mode)
  } catch {
    // A browser that keeps nothing still uses the choice for this visit.
  }
  for (const listener of flagAtListeners) listener()
}

export function useFlagAt(): FlagAt {
  return useSyncExternalStore(
    (listener) => {
      flagAtListeners.add(listener)
      return () => flagAtListeners.delete(listener)
    },
    flagAt,
    () => 'start',
  )
}

type Store = Pick<Storage, 'getItem' | 'setItem'>

function browserStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export const clipFlagKey = (channelNumber: number, startMs: number): string => `${channelNumber}@${startMs}`

/** A flag on a clip: from its start, or, given `atMs` inside it, from that moment (to the second). */
export function clipFlag(channel: { number: number; name: string }, programme: Programme, startMs: number, endMs: number, atMs?: number): ClipFlag {
  const { programmeId, durationSeconds, video } = bookmarkFor(channel, programme)
  const second = atMs === undefined ? startMs : Math.floor(atMs / 1000) * 1000
  const at = second > startMs && second < endMs ? second : startMs
  return {
    key: clipFlagKey(channel.number, at),
    channelNumber: channel.number,
    channelName: channel.name,
    title: programme.title,
    startMs: at,
    endMs,
    programmeId,
    durationSeconds,
    ...(video ? { video } : {}),
    ...(at !== startMs ? { clipStartMs: startMs } : {}),
  }
}

/** A flag as the bookmark a clips channel is made from. */
export function flagBookmark(flag: ClipFlag): Bookmark {
  return {
    key: flag.key,
    channelNumber: flag.channelNumber,
    channelName: flag.channelName,
    programmeId: flag.programmeId ?? flag.key,
    title: flag.title,
    durationSeconds: flag.durationSeconds ?? Math.round((flag.endMs - flag.startMs) / 1000),
    savedAt: flag.startMs,
    ...(flag.video ? { video: flag.video } : {}),
  }
}

const isFlag = (value: unknown): value is ClipFlag => {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.key === 'string' &&
    typeof item.channelNumber === 'number' &&
    typeof item.channelName === 'string' &&
    typeof item.title === 'string' &&
    typeof item.startMs === 'number' &&
    typeof item.endMs === 'number' &&
    item.endMs > item.startMs
  )
}

export function readClipFlags(store: Store | null = browserStore()): ClipFlag[] {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(CLIP_FLAGS_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(isFlag)
      .map(({ video, fired, ...rest }) => {
        const clip = readClipVideo(video)
        return { ...rest, ...(fired === true ? { fired } : {}), ...(clip ? { video: clip } : {}) }
      })
      .sort((a, b) => a.startMs - b.startMs)
      .slice(-MAX_CLIP_FLAGS)
  } catch {
    return []
  }
}

/** On, or off again. Flags stay in time order; one set on a clip already over is kept fired, for channels only. */
export function toggledFlags(list: readonly ClipFlag[], flag: ClipFlag, now: number): ClipFlag[] {
  // One flag to a clip: flagging a flagged clip again, wherever inside it, takes its flag off.
  const sameClip = (item: ClipFlag) => item.key === flag.key || (item.channelNumber === flag.channelNumber && flagClipStart(item) === flagClipStart(flag))
  if (list.some(sameClip)) return list.filter((item) => !sameClip(item))
  if (flag.endMs <= now) return [...list, { ...flag, fired: true }].sort((a, b) => a.startMs - b.startMs).slice(-MAX_CLIP_FLAGS)
  // Two flags at one moment cannot both be followed: the newer one takes it.
  return [...list.filter((item) => item.startMs !== flag.startMs || item.fired), flag].sort((a, b) => a.startMs - b.startMs).slice(-MAX_CLIP_FLAGS)
}

/**
 * At `now`: the flag to tune to (the latest newly arrived one still on air, if any), and every flag kept,
 * those whose moment has arrived marked fired. `changed` is false when nothing newly arrived.
 */
export function dueFlag(list: readonly ClipFlag[], now: number): { fire: ClipFlag | null; flags: ClipFlag[]; changed: boolean } {
  const arrived = list.filter((item) => !item.fired && item.startMs <= now)
  if (arrived.length === 0) return { fire: null, flags: [...list], changed: false }
  const onAir = arrived.filter((item) => item.endMs > now)
  const due = new Set(arrived.map((item) => item.key))
  return {
    fire: onAir.length ? onAir[onAir.length - 1] : null,
    flags: list.map((item) => (due.has(item.key) ? { ...item, fired: true } : item)),
    changed: true,
  }
}

let current: ClipFlag[] | null = null
const listeners = new Set<() => void>()

export function clipFlags(): ClipFlag[] {
  current ??= readClipFlags()
  return current
}

export function saveClipFlags(next: ClipFlag[], store: Store | null = browserStore()): void {
  current = next
  try {
    store?.setItem(CLIP_FLAGS_KEY, JSON.stringify(next))
  } catch {
    // Private browsing may refuse storage; the flags then last as long as the page.
  }
  for (const listener of listeners) listener()
}

export function removeClipFlags(keys: readonly string[] | 'all'): void {
  if (keys === 'all') return saveClipFlags([])
  const gone = new Set(keys)
  saveClipFlags(clipFlags().filter((item) => !gone.has(item.key)))
}

/** Flags the clip, or removes its flag; true when it is now flagged. */
export function toggleClipFlag(flag: ClipFlag, now = Date.now()): boolean {
  const next = toggledFlags(clipFlags(), flag, now)
  saveClipFlags(next)
  return next.some((item) => item.key === flag.key)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useClipFlags(): readonly ClipFlag[] {
  return useSyncExternalStore(subscribe, clipFlags, () => [])
}
