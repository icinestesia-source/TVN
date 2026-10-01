import type { MediaItem } from '../director/types.ts'
import { excludedProgramme, excludedTitle } from './exclusions.ts'

/**
 * Whether later non-user media may join the curated network.
 * User-network catalogues, built-in or imported, stay on 1001+.
 *
 * off / curated-defaults: shipped network media only.
 * allow-eligible: shipped network media, plus other non-user items.
 */
export type UserLibraryMode = 'off' | 'curated-defaults' | 'allow-eligible'

const KEY = 'retrotv.library-mode.v1'
let mode: UserLibraryMode = 'allow-eligible'

export function userLibraryMode(): UserLibraryMode {
  return mode
}

export function setUserLibraryMode(next: UserLibraryMode): void {
  mode = next
}

export function loadUserLibraryMode(): UserLibraryMode {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'off' || stored === 'curated-defaults' || stored === 'allow-eligible') return stored
  } catch {
    // Private mode still runs with the explicit default.
  }
  return 'allow-eligible'
}

export function saveUserLibraryMode(next: UserLibraryMode): void {
  setUserLibraryMode(next)
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // The in-memory choice still applies for this session.
  }
}

/** Space and religion programmes stay out of 000–999. */
export function blockedProgrammeTitle(title: string): boolean {
  return excludedTitle(title)
}

function userNetwork<T extends MediaItem>(item: T): boolean {
  const record = item as T & { provenance?: string; ingestedFrom?: string }
  return (
    record.provenance === 'built-in-user' ||
    record.provenance === 'user-imported' ||
    record.ingestedFrom === 'retrotv-user-network'
  )
}

function shipped<T extends MediaItem>(item: T): boolean {
  const record = item as T & { ingestedFrom?: string }
  return (
    item.id.startsWith('net:') ||
    Boolean(item.sourceRef?.startsWith('network:')) ||
    record.ingestedFrom === 'youtube-discovery'
  )
}

/** User-network media never enters 000–999. Off and curated-defaults keep shipped network media. */
const pools = new WeakMap<readonly MediaItem[], { mode: UserLibraryMode; pool: readonly MediaItem[] }>()

export function schedulingPool<T extends MediaItem>(items: readonly T[]): readonly T[] {
  const cached = pools.get(items)
  if (cached?.mode === mode) return cached.pool as readonly T[]
  const network = items.filter((item) => !userNetwork(item) && !excludedProgramme(item))
  const filtered = mode === 'allow-eligible' ? network : network.filter((item) => shipped(item))
  // User-network changes republish the library without changing 000–999; the unchanged pool keeps its
  // identity so the network-wide channel pools computed from it are not rebuilt.
  const pool = previousPool && previousPool.mode === mode && sameElements(previousPool.pool, filtered) ? previousPool.pool : filtered
  previousPool = { mode, pool }
  pools.set(items, { mode, pool })
  return pool as readonly T[]
}

let previousPool: { mode: UserLibraryMode; pool: readonly MediaItem[] } | null = null

function sameElements(current: readonly MediaItem[], next: readonly MediaItem[]): boolean {
  if (current.length !== next.length) return false
  for (let index = 0; index < current.length; index += 1) if (current[index] !== next[index]) return false
  return true
}
