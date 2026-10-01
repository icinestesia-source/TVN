import type { AddedChannel } from './user-network.ts'

/** TVN's own lookup (a Netlify Function in production, the Vite server locally). It needs no key. */
export const CHANNEL_API = '/api/channel'

export async function lookUpChannel(link: string, read: typeof fetch = fetch): Promise<AddedChannel> {
  let response: Response
  try {
    response = await read(`${CHANNEL_API}?url=${encodeURIComponent(link.trim())}`)
  } catch {
    throw new Error('TVN could not reach its channel lookup')
  }
  const body = (await response.json().catch(() => null)) as
    | { error?: unknown; channelId?: unknown; title?: unknown; videos?: unknown }
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
  return { channelId: body.channelId, title: typeof body.title === 'string' && body.title ? body.title : body.channelId, videos }
}
