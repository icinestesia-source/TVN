import { useSyncExternalStore } from 'react'
import { readClipVideo } from '../services/bookmark-channel.ts'
import type { ImportedVideo } from '../services/channels-import.ts'
import type { Programme } from '../types/programme.ts'
import { bookmarkFor, type Bookmark } from './bookmarks-store.ts'

/**
 * Flags set on clips in the Guide timeline (right-click or hold → Set flag). When a flagged clip comes on
 * air TVN tunes to its channel, and stays there until the next flag. A flag goes once its moment has
 * passed, with every flag before it, so going back to an older clip never pulls the viewer away again.
 */
export const CLIP_FLAGS_KEY = 'tvn.clip-flags.v1'
export const MAX_CLIP_FLAGS = 200

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

export function clipFlag(channel: { number: number; name: string }, programme: Programme, startMs: number, endMs: number): ClipFlag {
  const { programmeId, durationSeconds, video } = bookmarkFor(channel, programme)
  return {
    key: clipFlagKey(channel.number, startMs),
    channelNumber: channel.number,
    channelName: channel.name,
    title: programme.title,
    startMs,
    endMs,
    programmeId,
    durationSeconds,
    ...(video ? { video } : {}),
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
      .slice(0, MAX_CLIP_FLAGS)
      .map(({ video, ...rest }) => {
        const clip = readClipVideo(video)
        return clip ? { ...rest, video: clip } : rest
      })
      .sort((a, b) => a.startMs - b.startMs)
  } catch {
    return []
  }
}

/** On, or off again. Flags stay in time order; one already over cannot be set. */
export function toggledFlags(list: readonly ClipFlag[], flag: ClipFlag, now: number): ClipFlag[] {
  if (list.some((item) => item.key === flag.key)) return list.filter((item) => item.key !== flag.key)
  if (flag.endMs <= now) return [...list]
  // Two flags at one moment cannot both be followed: the newer one takes it.
  return [...list.filter((item) => item.startMs !== flag.startMs), flag].sort((a, b) => a.startMs - b.startMs).slice(0, MAX_CLIP_FLAGS)
}

/**
 * At `now`: the flag to tune to (the latest one already on air, if any), and the flags still to come.
 * Every flag whose moment has arrived is used up, the fired one included.
 */
export function dueFlag(list: readonly ClipFlag[], now: number): { fire: ClipFlag | null; rest: ClipFlag[] } {
  const arrived = list.filter((item) => item.startMs <= now)
  if (arrived.length === 0) return { fire: null, rest: [...list] }
  const onAir = arrived.filter((item) => item.endMs > now)
  return { fire: onAir.length ? onAir[onAir.length - 1] : null, rest: list.filter((item) => item.startMs > now) }
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
