import { describe, expect, it } from 'vitest'
import { handleChannelRequest, LIST_PLAYLISTS, listChannelPlaylists, playlistGridContinuationOf } from './youtube-channel.ts'

const CHANNEL = 'UCsport0000000000000000a'
const html = (data: unknown) => `<html><script>"INNERTUBE_CLIENT_VERSION":"2.20261001.00.00";var ytInitialData = ${JSON.stringify(data)};</script></html>`
const lockup = (n: number) => ({
  lockupViewModel: {
    contentId: `PLsport${String(n).padStart(10, '0')}`,
    contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST',
    metadata: { lockupMetadataViewModel: { title: { content: `Games ${n}` } } },
  },
})
const more = (token: string) => ({ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token } } } })
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, index) => lockup(from + index))

/** A Playlists tab of 30, then pages of 30 through the tab's continuation; another section carries a token of its own. */
function tab(total: number) {
  const posts: string[] = []
  const read = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === `https://www.youtube.com/channel/${CHANNEL}/playlists`) {
      return new Response(
        html({
          metadata: { channelMetadataRenderer: { title: 'Classic Sports' } },
          contents: [{ gridRenderer: { items: [...range(0, Math.min(30, total)), ...(total > 30 ? [more('page-30')] : [])] } }, { itemSectionRenderer: { contents: [more('other-section')] } }],
        }),
      )
    }
    if (url.startsWith('https://www.youtube.com/youtubei/v1/browse')) {
      const token = JSON.parse(String(init?.body)).continuation as string
      posts.push(token)
      const from = Number(token.replace('page-', ''))
      if (!Number.isFinite(from)) return new Response(JSON.stringify({}))
      const to = Math.min(from + 30, total)
      return new Response(JSON.stringify({ onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [...range(from, to), ...(to < total ? [more(`page-${to}`)] : [])] } }] }))
    }
    return new Response('', { status: 404 })
  }) as typeof fetch
  return { read, posts }
}

describe('ADD CHANNELS lists every playlist on a channel’s Playlists tab', () => {
  it('follows the grid’s own continuation, not another section’s, to the end', async () => {
    const { read, posts } = tab(75)
    const found = await listChannelPlaylists(CHANNEL, read)
    expect(found.title).toBe('Classic Sports')
    expect(found.playlists).toHaveLength(75)
    expect(found.playlists[0]).toEqual({ id: 'PLsport0000000000', title: 'Games 0', videos: null })
    expect(new Set(found.playlists.map((playlist) => playlist.id)).size).toBe(75)
    expect(found.more).toBe(false)
    expect(posts).toEqual(['page-30', 'page-60'])
  })

  it('stops at its limit and says the tab goes on', async () => {
    const found = await listChannelPlaylists(CHANNEL, tab(400).read)
    expect(found.playlists).toHaveLength(LIST_PLAYLISTS.limit)
    expect(found.more).toBe(true)
  })

  it('a grid without more pages has no continuation', () => {
    expect(playlistGridContinuationOf({ items: range(0, 3) })).toBeNull()
    expect(playlistGridContinuationOf({ contents: [{ itemSectionRenderer: { contents: [more('other')] } }] })).toBeNull()
  })

  it('is its own request mode, and refuses a playlist link', async () => {
    const { read } = tab(5)
    const ok = await handleChannelRequest(new URL(`http://tvn/api/channel?url=${CHANNEL}&mode=list-playlists`), read)
    expect(ok.status).toBe(200)
    expect((ok.body as { playlists: unknown[] }).playlists).toHaveLength(5)
    const refused = await handleChannelRequest(new URL(`http://tvn/api/channel?url=${encodeURIComponent('https://www.youtube.com/playlist?list=PLsport0000000001')}&mode=list-playlists`), read)
    expect(refused.status).toBe(400)
  })
})
