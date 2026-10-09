/** A programme as Edit Channel lists it, for ordering: only its id, title and upload day are read. */
export interface OrderedVideo {
  id: string
  title: string
  /** Upload or publication day (YYYY-MM-DD), when the source gave one. */
  published?: string
}

const titles = new Intl.Collator('en', { sensitivity: 'base', numeric: true, ignorePunctuation: true })
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A–Z by title, the way people read them (case and accents aside, 2 before 10); equal titles keep their order. */
export function alphabeticalVideos<T extends OrderedVideo>(videos: readonly T[]): T[] {
  return videos
    .map((video, index) => ({ video, index }))
    .sort((a, b) => titles.compare(a.video.title.trim(), b.video.title.trim()) || a.index - b.index)
    .map(({ video }) => video)
}

/** An unbiased shuffle (Fisher–Yates): every order is equally likely. */
export function shuffledVideos<T>(videos: readonly T[], random: () => number = Math.random): T[] {
  const out = [...videos]
  for (let index = out.length - 1; index > 0; index -= 1) {
    const pick = Math.floor(random() * (index + 1))
    ;[out[index], out[pick]] = [out[pick], out[index]]
  }
  return out
}

/**
 * A fresh running order drawn from every eligible programme: each source's programmes shuffled, then the
 * sources taken in turn, so one prolific source never crowds out the rest. `size` programmes are
 * scheduled from the top; the others follow, still eligible.
 */
export function rebuiltVideos<T extends { from?: string }>(videos: readonly T[], random: () => number = Math.random): T[] {
  const bySource = new Map<string, T[]>()
  for (const video of videos) {
    const key = video.from ?? ''
    bySource.set(key, [...(bySource.get(key) ?? []), video])
  }
  const queues = shuffledVideos([...bySource.values()].map((list) => shuffledVideos(list, random)), random)
  const out: T[] = []
  for (let round = 0; out.length < videos.length; round += 1) {
    for (const queue of queues) if (round < queue.length) out.push(queue[round])
  }
  return out
}

/** A programme of unknown length counts as this long when sources share the airtime. */
const UNKNOWN_LENGTH_SEC = 600

/**
 * Each source's share of the airtime, in percent, from the shares the viewer set: a source left unset takes an
 * equal part of what the set ones leave, and the shares are scaled to total 100. Sources at 0 are not scheduled.
 */
export function sourceShares(keys: readonly string[], set: ReadonlyMap<string, number>): Map<string, number> {
  const given = keys.filter((key) => set.has(key))
  const rest = keys.filter((key) => !set.has(key))
  const used = given.reduce((sum, key) => sum + Math.max(0, set.get(key) ?? 0), 0)
  const each = rest.length ? Math.max(0, 100 - used) / rest.length : 0
  const raw = new Map(keys.map((key) => [key, set.has(key) ? Math.max(0, set.get(key) ?? 0) : each]))
  const total = [...raw.values()].reduce((sum, value) => sum + value, 0)
  return new Map(keys.map((key) => [key, total > 0 ? ((raw.get(key) ?? 0) / total) * 100 : 0]))
}

/**
 * A running order that airs each source for its share of the time. Each source's programmes are shuffled, then
 * the source furthest behind its share airs next, by programme length. The schedule stops where a shared source
 * runs out, so the mix holds all the way round the loop; `scheduled` is how many programmes that is, and the rest
 * follow, eligible but not scheduled. `short` is the source that ran out while others still had programmes.
 */
export function sharedVideos<T extends { durationSec?: number }>(
  videos: readonly T[],
  sourceOf: (video: T) => string,
  set: ReadonlyMap<string, number>,
  random: () => number = Math.random,
): { videos: T[]; scheduled: number; short?: string } {
  const bySource = new Map<string, T[]>()
  for (const video of videos) {
    const key = sourceOf(video)
    bySource.set(key, [...(bySource.get(key) ?? []), video])
  }
  const keys = shuffledVideos([...bySource.keys()], random)
  const shares = sourceShares(keys, set)
  const queues = new Map(keys.map((key) => [key, shuffledVideos(bySource.get(key) ?? [], random)]))
  const airing = keys.filter((key) => (shares.get(key) ?? 0) > 0)
  if (airing.length === 0) return { videos: shuffledVideos(videos, random), scheduled: videos.length }
  const known = videos.map((video) => video.durationSec ?? 0).filter((seconds) => seconds > 0)
  const typical = known.length ? known.reduce((sum, seconds) => sum + seconds, 0) / known.length : UNKNOWN_LENGTH_SEC
  const length = (video: T) => (video.durationSec && video.durationSec > 0 ? video.durationSec : typical)
  const aired = new Map(airing.map((key) => [key, 0]))
  const taken = new Map(keys.map((key) => [key, 0]))
  const out: T[] = []
  let short: string | undefined
  for (;;) {
    const next = airing.reduce((best, key) => ((aired.get(key) ?? 0) / (shares.get(key) ?? 1) < (aired.get(best) ?? 0) / (shares.get(best) ?? 1) ? key : best))
    const queue = queues.get(next) ?? []
    const at = taken.get(next) ?? 0
    if (at >= queue.length) {
      if (airing.some((key) => (taken.get(key) ?? 0) < (queues.get(key)?.length ?? 0))) short = next
      break
    }
    out.push(queue[at])
    taken.set(next, at + 1)
    aired.set(next, (aired.get(next) ?? 0) + length(queue[at]))
  }
  const scheduled = out.length
  const left = keys.map((key) => (queues.get(key) ?? []).slice(taken.get(key) ?? 0))
  for (let round = 0; left.some((queue) => round < queue.length); round += 1) {
    for (const queue of left) if (round < queue.length) out.push(queue[round])
  }
  return { videos: out, scheduled, ...(short !== undefined ? { short } : {}) }
}

/** Newest first by upload day; programmes with no known day follow, and ties keep their order. */
export function latestVideos<T extends OrderedVideo>(videos: readonly T[]): T[] {
  const day = (video: T) => (video.published && DAY.test(video.published) ? video.published : null)
  return videos
    .map((video, index) => ({ video, index, day: day(video) }))
    .sort((a, b) => {
      if (a.day && b.day && a.day !== b.day) return a.day < b.day ? 1 : -1
      if (a.day && !b.day) return -1
      if (!a.day && b.day) return 1
      return a.index - b.index
    })
    .map(({ video }) => video)
}

interface PlayableProgramme {
  id: string
  videoId?: string | null
  sourceRef?: string
  publishedAt?: string
  durationSeconds: number
}

/**
 * What LATEST plays: the newest of the channel's programmes, as the schedule lists it, or built on its own when
 * the schedule leaves it out. A channel with no programmes of its own offers its newest scheduled programme.
 */
export function newestProgramme<V extends OrderedVideo, P extends PlayableProgramme>(pool: readonly V[], scheduled: readonly P[], build: (video: V) => P): P | null {
  const [video] = latestVideos(pool)
  if (video) {
    const found = scheduled.filter((programme) => programme.videoId === video.id || programme.sourceRef?.endsWith(`:${video.id}`))
    return found.find((programme) => !programme.id.endsWith('-r')) ?? found[0] ?? build(video)
  }
  const day = (programme: P) => programme.publishedAt?.slice(0, 10) ?? ''
  const dated = scheduled.filter((programme) => programme.durationSeconds > 0 && DAY.test(day(programme)))
  return dated.reduce<P | null>((best, programme) => (!best || day(programme) > day(best) ? programme : best), null)
}
