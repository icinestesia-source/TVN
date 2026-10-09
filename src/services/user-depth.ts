import type { ImportedVideo } from './channels-import.ts'
import { spread } from './channel-curation.ts'

/**
 * Depth for User Network channels.
 *
 * A collection is one YouTube uploader's recent uploads, so a quiet uploader can arrive with one or two
 * videos. Such a channel keeps its own videos first and is topped up from that same uploader's earlier
 * uploads, never from another uploader, the curated network or the session channel.
 */
export const DEPTH_MIN_PROGRAMMES = 8
export const DEPTH_MIN_SECONDS = 3 * 3600
export const ARCHIVE_TARGET_PROGRAMMES = 16
export const ARCHIVE_TARGET_SECONDS = 6 * 3600
const ARCHIVE_LIMIT = 24

function secondsOf(videos: readonly ImportedVideo[]): number {
  return videos.reduce((sum, video) => sum + video.durationSec, 0)
}

export function needsDepth(videos: readonly ImportedVideo[]): boolean {
  return videos.length < DEPTH_MIN_PROGRAMMES || secondsOf(videos) < DEPTH_MIN_SECONDS
}

/**
 * Earlier uploads for a thin channel. `archive` is the uploader's playable back catalogue, newest first.
 * Recency is a weight: two picks come from the newest third for every one sampled across the older
 * rest, until the channel reaches depth. The picks keep their newest-first order.
 */
export function planArchive(own: readonly ImportedVideo[], archive: readonly ImportedVideo[]): ImportedVideo[] {
  if (!needsDepth(own)) return []
  const taken = new Set(own.map((video) => video.id))
  const pool = archive.filter((video) => !taken.has(video.id))
  const rank = new Map(pool.map((video, index) => [video.id, index]))
  const recentCount = Math.ceil(pool.length / 3)
  const recent = pool.slice(0, recentCount)
  const older = spread(pool.slice(recentCount))
  const picked: ImportedVideo[] = []
  let seconds = secondsOf(own)
  let r = 0
  let o = 0
  while (picked.length < ARCHIVE_LIMIT && (r < recent.length || o < older.length)) {
    if (own.length + picked.length >= ARCHIVE_TARGET_PROGRAMMES && seconds >= ARCHIVE_TARGET_SECONDS) break
    const takeOlder = (picked.length % 3 === 2 && o < older.length) || r >= recent.length
    const video = takeOlder ? older[o++] : recent[r++]
    picked.push(video)
    seconds += video.durationSec
  }
  return picked.sort((left, right) => (rank.get(left.id) ?? 0) - (rank.get(right.id) ?? 0))
}

export interface OrderEntry<T> {
  key: string
  item: T
  repeat: boolean
}

/** Spread `minor` evenly through `major`. */
function weave<T>(major: readonly T[], minor: readonly T[]): T[] {
  if (minor.length === 0) return major.slice()
  if (major.length === 0) return minor.slice()
  const out: T[] = []
  const step = major.length / minor.length
  let next = step / 2
  let placed = 0
  for (let index = 0; index < major.length; index += 1) {
    out.push(major[index])
    while (placed < minor.length && index + 1 >= next) {
      out.push(minor[placed])
      placed += 1
      next += step
    }
  }
  while (placed < minor.length) out.push(minor[placed++])
  return out
}

/** Swap an entry forward wherever the same programme would air twice in a row, including across the loop. */
function separate<T>(order: OrderEntry<T>[]): OrderEntry<T>[] {
  const out = order.slice()
  const n = out.length
  for (let pass = 0; pass < 2; pass += 1) {
    for (let index = 0; index < n; index += 1) {
      const nextIndex = (index + 1) % n
      if (n < 3 || out[index].key !== out[nextIndex].key) continue
      for (let offset = 2; offset < n; offset += 1) {
        const candidate = (nextIndex + offset) % n
        const before = out[(candidate - 1 + n) % n].key
        const after = out[(candidate + 1) % n].key
        const moving = out[nextIndex].key
        const incoming = out[candidate].key
        if (incoming === out[index].key || moving === before || moving === after) continue
        if (incoming === out[(nextIndex + 1) % n].key) continue
        ;[out[nextIndex], out[candidate]] = [out[candidate], out[nextIndex]]
        break
      }
    }
  }
  return out
}

/**
 * The channel's loop. Its own videos stay newest first, earlier uploads spread between them, and every
 * programme airs once a cycle: nothing repeats until everything has played.
 */
export function runningOrder<T>(own: readonly OrderEntry<T>[], archive: readonly OrderEntry<T>[]): OrderEntry<T>[] {
  return separate(own.length >= archive.length ? weave(own, archive) : weave(archive, own))
}
