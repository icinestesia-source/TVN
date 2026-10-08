import type { AddedChannel } from './user-network.ts'
import { calendarDate, videoCreator, type ImportedVideo } from './channels-import.ts'

/** TVN's own lookup (a Netlify Function in production, the Vite server locally). It needs no key. */
export const CHANNEL_API = '/api/channel'

export interface LookUpOptions {
  /** An explicit RESCAN: skip every cache between here and YouTube, so the list is the current one. */
  fresh?: boolean
  /** ARCHIVE or ALL: every embeddable video the source's page lists, not only the newest. */
  mode?: 'recent' | 'archive' | 'all'
  now?: () => number
}

export async function lookUpChannel(link: string, read: typeof fetch = fetch, options: LookUpOptions = {}): Promise<AddedChannel> {
  let response: Response
  const wide = options.mode === 'archive' || options.mode === 'all' ? `&mode=${options.mode}` : ''
  const query = `${CHANNEL_API}?url=${encodeURIComponent(link.trim())}${wide}`
  try {
    response = options.fresh
      ? await read(`${query}&refresh=${(options.now ?? Date.now)()}`, { cache: 'no-store' })
      : await read(query)
  } catch {
    throw new Error('TVN could not reach its channel lookup')
  }
  const body = (await response.json().catch(() => null)) as
    | { error?: unknown; channelId?: unknown; sourceType?: unknown; title?: unknown; videos?: unknown; listed?: unknown; next?: unknown; mix?: unknown }
    | null
  if (!response.ok || !body) throw new Error(typeof body?.error === 'string' ? body.error : 'The channel could not be added')
  if (typeof body.channelId !== 'string' || !Array.isArray(body.videos)) throw new Error('The channel could not be added')
  const videos = videosOf(body.videos)
  if (videos.length === 0) throw new Error('That channel has no videos TVN can schedule')
  const sourceType =
    body.sourceType === 'youtube-channel' || body.sourceType === 'youtube-playlist'
      ? body.sourceType
      : body.channelId.startsWith('UC')
        ? 'youtube-channel'
        : 'youtube-playlist'
  return {
    channelId: body.channelId,
    sourceType,
    title: typeof body.title === 'string' && body.title ? body.title : body.channelId,
    videos,
    ...pagingOf(body),
    ...mixOf(body.mix),
  }
}

const YOUTUBE_ID = /^[0-9A-Za-z_-]{11}$/

function mixOf(raw: unknown): { mix?: { list: string; seed: string } } {
  const { list, seed } = (raw ?? {}) as { list?: unknown; seed?: unknown }
  return typeof list === 'string' && /^RD[0-9A-Za-z_-]{2,64}$/.test(list) && typeof seed === 'string' && YOUTUBE_ID.test(seed) ? { mix: { list, seed } } : {}
}

function videosOf(rows: readonly unknown[]): ImportedVideo[] {
  return rows.flatMap((row) => {
    const { id, title, durationSec, published, creator, live } = (row ?? {}) as { id?: unknown; title?: unknown; durationSec?: unknown; published?: unknown; creator?: unknown; live?: unknown }
    const day = calendarDate(published)
    const by = videoCreator(creator)
    return typeof id === 'string' && typeof title === 'string' && typeof durationSec === 'number' && durationSec > 0
      ? [{ id, title, durationSec: Math.round(durationSec), ...(day ? { published: day } : {}), ...(by ? { creator: by } : {}), ...(live === true ? { live } : {}) }]
      : []
  })
}

function pagingOf(body: { listed?: unknown; next?: unknown }): { listed?: number; next?: string } {
  return {
    ...(typeof body.listed === 'number' && Number.isInteger(body.listed) && body.listed >= 0 ? { listed: body.listed } : {}),
    ...(typeof body.next === 'string' && body.next.length > 0 && body.next.length <= 3000 ? { next: body.next } : {}),
  }
}

/** The next batch of a YouTube source past where its last read stopped. */
export interface FoundBatch {
  videos: ImportedVideo[]
  listed?: number
  next?: string
}

export async function lookUpBatch(cursor: string, read: typeof fetch = fetch, signal?: AbortSignal): Promise<FoundBatch> {
  let response: Response
  try {
    response = await read(`${CHANNEL_API}?cursor=${encodeURIComponent(cursor)}`, signal ? { signal } : undefined)
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('TVN could not reach its channel lookup')
  }
  const body = (await response.json().catch(() => null)) as { error?: unknown; videos?: unknown; listed?: unknown; next?: unknown } | null
  if (!response.ok || !body || !Array.isArray(body.videos)) throw new Error(typeof body?.error === 'string' ? body.error : 'The next programmes could not be read')
  return { videos: videosOf(body.videos), ...pagingOf(body) }
}

export const playlistUrl = (id: string) => `https://www.youtube.com/playlist?list=${id}`

/** A YouTube channel's Playlists tab: ADD CHANNELS, or IMPORT asking one channel or one per playlist. */
export function isPlaylistsLink(link: string): boolean {
  return /^(https?:\/\/)?(www\.|m\.)?youtube\.com\/(@[\w.-]+|channel\/UC[\w-]{22}|c\/[^/?#]+|user\/[^/?#]+)\/playlists\/?([?#].*)?$/i.test(link.trim())
}

/** A YouTube channel or @handle, by which ADD CHANNELS may list its playlists. */
export function isYouTubeChannelLink(link: string): boolean {
  const text = link.trim()
  return /^@[\w.-]{3,}$/.test(text) || /^UC[\w-]{22}$/.test(text) || /^(https?:\/\/)?(www\.|m\.)?youtube\.com\/(@[\w.-]+|channel\/UC[\w-]{22}|c\/[^/?#]+|user\/[^/?#]+)(\/[\w-]*)?\/?([?#].*)?$/i.test(text)
}

/** Every playlist on a YouTube channel's Playlists tab, in its order, for ADD CHANNELS. Nothing is added. */
export async function lookUpChannelPlaylists(
  link: string,
  read: typeof fetch = fetch,
): Promise<{ title: string; playlists: { id: string; title: string; videos: number | null }[]; more: boolean }> {
  let response: Response
  try {
    response = await read(`${CHANNEL_API}?url=${encodeURIComponent(link.trim())}&mode=list-playlists`)
  } catch {
    throw new Error('TVN could not reach its channel lookup')
  }
  const body = (await response.json().catch(() => null)) as { error?: unknown; title?: unknown; playlists?: unknown; more?: unknown } | null
  if (!response.ok || !body || !Array.isArray(body.playlists)) throw new Error(typeof body?.error === 'string' ? body.error : 'No playlists were found')
  const playlists = body.playlists.flatMap((row) => {
    const { id, title, videos } = (row ?? {}) as Record<string, unknown>
    return typeof id === 'string' && typeof title === 'string' ? [{ id, title, videos: typeof videos === 'number' ? videos : null }] : []
  })
  return { title: typeof body.title === 'string' ? body.title : '', playlists, more: body.more === true }
}

/** A playlist a YouTube channel lists; `official` when that channel's own header owns it. */
export interface PlaylistFound {
  id: string
  title: string
  official: boolean
  videos: number | null
}

/** The playlists a channel lists, for a curator to choose from. Nothing is added. */
export async function lookUpPlaylists(link: string, read: typeof fetch = fetch): Promise<{ title: string; playlists: PlaylistFound[] }> {
  let response: Response
  try {
    response = await read(`${CHANNEL_API}?url=${encodeURIComponent(link.trim())}&mode=playlists`)
  } catch {
    throw new Error('TVN could not reach its channel lookup')
  }
  const body = (await response.json().catch(() => null)) as { error?: unknown; title?: unknown; playlists?: unknown } | null
  if (!response.ok || !body || !Array.isArray(body.playlists)) throw new Error(typeof body?.error === 'string' ? body.error : 'No playlists were found')
  const playlists = body.playlists.flatMap((row) => {
    const { id, title, official, videos } = (row ?? {}) as Record<string, unknown>
    return typeof id === 'string' && typeof title === 'string'
      ? [{ id, title, official: official === true, videos: typeof videos === 'number' ? videos : null }]
      : []
  })
  return { title: typeof body.title === 'string' ? body.title : '', playlists }
}
