import { useSyncExternalStore } from 'react'
import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'

/** The viewer's bookmarked clips, kept in this browser. */
export const BOOKMARKS_KEY = 'tvn.bookmarks.v1'
export const MAX_BOOKMARKS = 500

export interface Bookmark {
  /** The channel and programme together: one bookmark per clip on a channel. */
  key: string
  channelNumber: number
  channelName: string
  /** The video id where the programme has one, else its programme id: what PLAY looks the clip up by. */
  programmeId: string
  title: string
  durationSeconds: number
  savedAt: number
}

type Store = Pick<Storage, 'getItem' | 'setItem'>

function browserStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function bookmarkKey(channelNumber: number, programmeId: string): string {
  return `${channelNumber}:${programmeId}`
}

export function bookmarkFor(channel: Pick<Channel, 'number' | 'name'>, programme: Pick<Programme, 'id' | 'videoId' | 'title' | 'durationSeconds'>, now = Date.now()): Bookmark {
  const programmeId = programme.videoId ?? programme.id
  return {
    key: bookmarkKey(channel.number, programmeId),
    channelNumber: channel.number,
    channelName: channel.name,
    programmeId,
    title: programme.title,
    durationSeconds: programme.durationSeconds,
    savedAt: now,
  }
}

const isBookmark = (value: unknown): value is Bookmark => {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.key === 'string' &&
    typeof item.channelNumber === 'number' &&
    typeof item.channelName === 'string' &&
    typeof item.programmeId === 'string' &&
    typeof item.title === 'string' &&
    typeof item.durationSeconds === 'number' &&
    typeof item.savedAt === 'number'
  )
}

export function readBookmarks(store: Store | null = browserStore()): Bookmark[] {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(BOOKMARKS_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isBookmark).slice(0, MAX_BOOKMARKS) : []
  } catch {
    return []
  }
}

/** On, or off again: a new bookmark goes to the top of the list. */
export function toggledBookmarks(list: readonly Bookmark[], item: Bookmark): Bookmark[] {
  if (list.some((saved) => saved.key === item.key)) return list.filter((saved) => saved.key !== item.key)
  return [item, ...list].slice(0, MAX_BOOKMARKS)
}

let current: Bookmark[] | null = null
const listeners = new Set<() => void>()

function bookmarks(): Bookmark[] {
  current ??= readBookmarks()
  return current
}

function save(next: Bookmark[], store: Store | null = browserStore()) {
  current = next
  try {
    store?.setItem(BOOKMARKS_KEY, JSON.stringify(next))
  } catch {
    // Private browsing may refuse storage; the bookmarks then last as long as the page.
  }
  for (const listener of listeners) listener()
}

/** Bookmarks the clip, or removes its bookmark; true when it is now bookmarked. */
export function toggleBookmark(item: Bookmark): boolean {
  const next = toggledBookmarks(bookmarks(), item)
  save(next)
  return next.some((saved) => saved.key === item.key)
}

export function removeBookmark(key: string): void {
  save(bookmarks().filter((saved) => saved.key !== key))
}

export function isBookmarked(key: string): boolean {
  return bookmarks().some((saved) => saved.key === key)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useBookmarks(): readonly Bookmark[] {
  return useSyncExternalStore(subscribe, bookmarks, () => [])
}
