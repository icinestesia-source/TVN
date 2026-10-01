import type { AddedChannel } from './user-network.ts'

/** TVN's own lookup (a Netlify Function in production, the Vite server locally). It needs no key. */
export const CHANNEL_API = '/api/channel'

export interface LookUpOptions {
  /** An explicit RESCAN: skip every cache between here and YouTube, so the list is the current one. */
  fresh?: boolean
  now?: () => number
}

export async function lookUpChannel(link: string, read: typeof fetch = fetch, options: LookUpOptions = {}): Promise<AddedChannel> {
  let response: Response
  const query = `${CHANNEL_API}?url=${encodeURIComponent(link.trim())}`
  try {
    response = options.fresh
      ? await read(`${query}&refresh=${(options.now ?? Date.now)()}`, { cache: 'no-store' })
      : await read(query)
  } catch {
    throw new Error('TVN could not reach its channel lookup')
  }
  const body = (await response.json().catch(() => null)) as
    | { error?: unknown; channelId?: unknown; sourceType?: unknown; title?: unknown; videos?: unknown }
    | null
  if (!response.ok || !body) throw new Error(typeof body?.error === 'string' ? body.error : 'The channel could not be added')
  if (typeof body.channelId !== 'string' || !Array.isArray(body.videos)) throw new Error('The channel could not be added')
  const videos = body.videos.flatMap((row) => {
    const { id, title, durationSec } = (row ?? {}) as { id?: unknown; title?: unknown; durationSec?: unknown }
    return typeof id === 'string' && typeof title === 'string' && typeof durationSec === 'number' && durationSec > 0
      ? [{ id, title, durationSec: Math.round(durationSec) }]
      : []
  })
  if (videos.length === 0) throw new Error('That channel has no videos TVN can schedule')
  const sourceType =
    body.sourceType === 'youtube-channel' || body.sourceType === 'youtube-playlist'
      ? body.sourceType
      : body.channelId.startsWith('UC')
        ? 'youtube-channel'
        : 'youtube-playlist'
  return { channelId: body.channelId, sourceType, title: typeof body.title === 'string' && body.title ? body.title : body.channelId, videos }
}
