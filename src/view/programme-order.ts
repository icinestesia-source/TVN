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
