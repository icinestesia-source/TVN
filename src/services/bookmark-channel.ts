import type { Programme } from '../types/programme.ts'
import type { ImportedVideo, StoredSource } from './channels-import.ts'
import { claimUserNumber } from './user-network.ts'

const YOUTUBE_ID = /^[0-9A-Za-z_-]{11}$/

const publicAddress = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

/**
 * A programme as the stored video a channel is built from: a YouTube video by its id, or a feed episode,
 * website or post by its public address. Local files, live streams and generated slates have nothing that
 * lasts beyond this visit, so they give nothing.
 */
export function clipVideo(programme: Programme): ImportedVideo | null {
  if (programme.liveStream !== undefined || programme.playback === 'generated' || programme.programmeType === 'generated') return null
  const durationSec = Math.round(programme.mediaDurationSeconds ?? programme.durationSeconds)
  if (!(durationSec > 0)) return null
  const published = programme.publishedAt && /^\d{4}-\d{2}-\d{2}$/.test(programme.publishedAt) ? { published: programme.publishedAt } : {}
  if (programme.videoId) {
    if (!YOUTUBE_ID.test(programme.videoId)) return null
    return { id: programme.videoId, title: programme.title, durationSec, ...published, ...(programme.playback === 'live' ? { live: true as const } : {}) }
  }
  const media = publicAddress(programme.mediaUrl)
  if (!media) return null
  const ref = programme.sourceRef?.replace(/^(?:podcast|website|post):/, '')
  const web = programme.programmeType === 'website' ? 'website' : programme.programmeType === 'social-post' ? 'post' : undefined
  const image = publicAddress(programme.thumbnail)
  const page = publicAddress(programme.episodeUrl)
  return {
    id: ref && ref !== programme.sourceRef ? ref : media,
    title: programme.title,
    durationSec,
    ...published,
    media,
    ...(web ? { web } : programme.mediaKind === 'video' ? { mediaKind: 'video' as const } : {}),
    ...(image ? { image } : {}),
    ...(page ? { page } : {}),
  }
}

/** A stored clip as it was saved, kept only when it is well formed and its address is public. */
export function readClipVideo(raw: unknown): ImportedVideo | undefined {
  const item = (raw ?? {}) as Record<string, unknown>
  if (typeof item.id !== 'string' || !item.id || typeof item.title !== 'string' || typeof item.durationSec !== 'number' || !(item.durationSec > 0)) return undefined
  if (item.media !== undefined && (typeof item.media !== 'string' || !publicAddress(item.media))) return undefined
  if (item.media === undefined && !YOUTUBE_ID.test(item.id)) return undefined
  const text = (key: string) => (typeof item[key] === 'string' && publicAddress(item[key] as string) ? { [key]: item[key] as string } : {})
  return {
    id: item.id,
    title: item.title,
    durationSec: item.durationSec,
    ...(typeof item.published === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.published) ? { published: item.published } : {}),
    ...(typeof item.media === 'string' ? { media: item.media } : {}),
    ...(item.mediaKind === 'video' ? { mediaKind: 'video' as const } : {}),
    ...(item.web === 'website' || item.web === 'post' ? { web: item.web } : {}),
    ...(item.live === true ? { live: true as const } : {}),
    ...text('image'),
    ...text('page'),
  }
}

export const CLIPS_PREFIX = 'clips:'

/**
 * Chosen clips as a new User Channel: one collection of exactly those clips, aired in the order given, on a
 * loop. The same clip twice is kept once.
 */
export function addClipsChannel(
  existing: readonly StoredSource[],
  channel: { name: string; videos: readonly ImportedVideo[] },
  now: number,
): { sources: StoredSource[]; number: number | null; status: 'added' | 'empty' | 'full' } {
  const sources = existing.map((source) => ({ ...source, videos: source.videos.slice() }))
  const seen = new Set<string>()
  const videos = channel.videos.filter((video) => !seen.has(video.id) && seen.add(video.id)).map((video) => ({ ...video }))
  if (videos.length === 0) return { sources, number: null, status: 'empty' }
  const number = claimUserNumber(sources)
  if (number === null) return { sources, number: null, status: 'full' }
  const name = channel.name.trim().slice(0, 80) || 'Bookmarks'
  sources.push({
    id: `${CLIPS_PREFIX}${now.toString(36)}-${number}`,
    name,
    videos,
    channelNumber: number,
    inLibrary: false,
    automatic: true,
    updatedAt: now,
    runningOrder: videos.map((video) => video.id),
    orderKind: 'manual',
    channelSources: [
      {
        id: 's1',
        kind: 'collection',
        url: '',
        ref: name,
        label: name,
        enabled: true,
        videos: videos.map((video) => ({ ...video })),
        status: { state: 'ready', playable: videos.length, checkedAt: now },
      },
    ],
  })
  return { sources, number, status: 'added' }
}
