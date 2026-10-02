import type { MediaItem } from '../director/types.ts'

/**
 * The network-wide channel pools, kept between visits. Working them out takes seconds; a return visit to an
 * unchanged library reads them back instead. They are only used when the build and every item field the pool
 * calculation reads are the same, and they come back as positions in the same pool, so a restored pool holds
 * the very same items in the same order as a calculated one.
 */
export interface SavedPools {
  key: string
  count: number
  channels: Int32Array
  offsets: Int32Array
  positions: Int32Array
}

declare const __TVN_BUILD__: string | undefined
const BUILD = typeof __TVN_BUILD__ === 'string' ? __TVN_BUILD__ : 'dev'

function list(values: readonly (string | number)[] | undefined): string {
  return values?.length ? values.join(',') : ''
}

/** Every field the pool calculation reads, in pool order, under two independent 32-bit hashes. */
export function poolKey(items: readonly MediaItem[]): string {
  let first = 0x811c9dc5
  let second = 0x9747b28c
  const feed = (text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index)
      first = Math.imul(first ^ code, 0x01000193)
      second = Math.imul(second ^ code, 0x5bd1e995)
      second ^= second >>> 15
    }
    first = Math.imul(first ^ 0x1f, 0x01000193)
    second = Math.imul(second ^ 0x1f, 0x5bd1e995)
  }
  for (const item of items) {
    const extra = item as MediaItem & { sourceId?: string; externalId?: string | null; videoId?: string | null; userEditedMetadata?: string[] }
    feed(item.id)
    feed(item.title ?? '')
    feed(extra.sourceId ?? '')
    feed(String(item.durationSeconds))
    feed(item.programmeType ?? '')
    feed(list(item.topics))
    feed(list(item.subjects))
    feed(item.sport ?? '')
    feed(item.mediaKind ?? '')
    feed(extra.externalId ?? '')
    feed(extra.videoId ?? '')
    feed(item.playbackKind ?? '')
    feed(item.live ? '1' : '')
    feed(list(extra.userEditedMetadata))
    feed(list(item.explicitChannelIncludes))
    feed(list(item.explicitChannelExcludes))
    feed(list(item.eraChannels))
    feed(list(item.genreChannels))
    feed(list(item.curatedChannels))
  }
  const hex = (value: number) => (value >>> 0).toString(16).padStart(8, '0')
  return `${BUILD}:${items.length}:${hex(first)}${hex(second)}`
}

/** Positions of each channel's pool in `items`, or null if a pool holds an item that is not in `items`. */
export function encodePools(items: readonly MediaItem[], pools: ReadonlyMap<number, readonly MediaItem[]>): SavedPools | null {
  const position = new Map<MediaItem, number>()
  items.forEach((item, index) => position.set(item, index))
  const channels = new Int32Array(pools.size)
  const offsets = new Int32Array(pools.size + 1)
  let total = 0
  for (const pool of pools.values()) total += pool.length
  const positions = new Int32Array(total)
  let at = 0
  let channel = 0
  for (const [number, pool] of pools) {
    channels[channel] = number
    offsets[channel] = at
    for (const item of pool) {
      const found = position.get(item)
      if (found === undefined) return null
      positions[at] = found
      at += 1
    }
    channel += 1
  }
  offsets[channel] = at
  return { key: poolKey(items), count: items.length, channels, offsets, positions }
}

export function decodePools(items: readonly MediaItem[], saved: SavedPools): Map<number, MediaItem[]> | null {
  const pools = new Map<number, MediaItem[]>()
  for (let channel = 0; channel < saved.channels.length; channel += 1) {
    const pool: MediaItem[] = []
    for (let at = saved.offsets[channel]; at < saved.offsets[channel + 1]; at += 1) {
      const item = items[saved.positions[at]]
      if (!item) return null
      pool.push(item)
    }
    pools.set(saved.channels[channel], pool)
  }
  return pools
}

let waiting: SavedPools | null = null
let calculated: { items: readonly MediaItem[]; pools: ReadonlyMap<number, readonly MediaItem[]> } | null = null

/** Pools read back from the last visit, offered to the first calculation whose library matches them. */
export function offerSavedPools(saved: SavedPools | null): void {
  waiting = saved
}

/** The saved pools for `items`, if they match; a library that does not match drops them. */
export function takeSavedPools(items: readonly MediaItem[]): Map<number, MediaItem[]> | null {
  const saved = waiting
  if (!saved || saved.count !== items.length) return null
  waiting = null
  if (saved.key !== poolKey(items)) return null
  return decodePools(items, saved)
}

/** An empty library, as before the catalogue has loaded, is never worth keeping and must not replace kept pools. */
export function noteCalculatedPools(items: readonly MediaItem[], pools: ReadonlyMap<number, readonly MediaItem[]>): void {
  if (items.length > 0) calculated = { items, pools }
}

/** The most recently calculated pools, ready to keep; null when nothing new has been worked out since. */
export function poolsToKeep(): SavedPools | null {
  const latest = calculated
  calculated = null
  return latest ? encodePools(latest.items, latest.pools) : null
}

export function resetPoolCacheForTests(): void {
  waiting = null
  calculated = null
}

const DB_NAME = 'retrotv-pools'
const STORE = 'pools'
const RECORD = 'network'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the saved channel pools'))
  })
}

export async function readSavedPools(): Promise<SavedPools | null> {
  if (typeof indexedDB === 'undefined') return null
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(RECORD)
      request.onsuccess = () => {
        const value = request.result as SavedPools | undefined
        const sound =
          value &&
          typeof value.key === 'string' &&
          typeof value.count === 'number' &&
          value.channels instanceof Int32Array &&
          value.offsets instanceof Int32Array &&
          value.positions instanceof Int32Array &&
          value.offsets.length === value.channels.length + 1
        resolve(sound ? value : null)
      }
      request.onerror = () => reject(request.error ?? new Error('Could not read the saved channel pools'))
    })
  } finally {
    db.close()
  }
}

/** Keeps the pools worked out since the last save. Nothing to keep is not an error. */
export async function keepCalculatedPools(): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const saved = poolsToKeep()
  if (!saved) return
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).put(saved, RECORD)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not keep the channel pools'))
    })
  } finally {
    db.close()
  }
}
