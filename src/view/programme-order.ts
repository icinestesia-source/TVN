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
