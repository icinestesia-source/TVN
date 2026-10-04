import { describe, expect, it } from 'vitest'
import { channelCacheControl, handleChannelRequest, parseChannelInput, resolveChannel } from './youtube-channel.ts'

const LIST = 'PL490JTer_zRIZbIlQUdavpI-yelTGVBgu'

function playlistPage(title: string, count: number): string {
  const data = {
    metadata: { playlistMetadataRenderer: { title } },
    contents: Array.from({ length: count }, (_, index) => ({
      lockupViewModel: {
        contentId: `pppppppppp${index + 1}`,
        contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
        contentImage: { thumbnailViewModel: { overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: '10:00' } }] } }] } },
        metadata: { lockupMetadataViewModel: { title: { content: `Episode ${index + 1}` } } },
      },
    })),
  }
  return `<html><script>var ytInitialData = ${JSON.stringify(data)};</script></html>`
}

describe('TVN 1.0.8: a YouTube playlist as a User Channel source', () => {
  it('recognises a playlist in watch and playlist links, whatever the parameter order', () => {
    for (const link of [
      `https://www.youtube.com/watch?v=V_H9_5dYT08&list=${LIST}`,
      `https://www.youtube.com/watch?list=${LIST}&v=V_H9_5dYT08`,
      `https://www.youtube.com/watch?v=V_H9_5dYT08&list=${LIST}&index=3&t=42s`,
      `https://www.youtube.com/playlist?list=${LIST}`,
      `https://www.youtube.com/playlist?si=abc&list=${LIST}`,
      `youtube.com/watch?v=V_H9_5dYT08&list=${LIST}`,
      `https://m.youtube.com/watch?v=V_H9_5dYT08&list=${LIST}`,
      `https://youtu.be/V_H9_5dYT08?list=${LIST}`,
    ]) {
      expect(parseChannelInput(link), link).toEqual({ kind: 'playlist', id: LIST })
    }
    expect(parseChannelInput('https://www.youtube.com/watch?v=V_H9_5dYT08')).toEqual({ kind: 'video', id: 'V_H9_5dYT08' })
    expect(parseChannelInput('https://www.youtube.com/channel/UCy8m1xxZpj6V8xtm-vtvzpg')).toEqual({ kind: 'channel', id: 'UCy8m1xxZpj6V8xtm-vtvzpg' })
    expect(parseChannelInput('https://www.youtube.com/@manjulaskitchen')).toEqual({ kind: 'handle', handle: 'manjulaskitchen' })
    expect(parseChannelInput('https://www.youtube.com/playlist?list=bogus')).toBeNull()
    expect(parseChannelInput('https://www.youtube.com/watch?v=V_H9_5dYT08&list=RDV_H9_5dYT08')).toEqual({ kind: 'video', id: 'V_H9_5dYT08', mix: 'RDV_H9_5dYT08' })
    expect(parseChannelInput('https://www.youtube.com/watch?v=V_H9_5dYT08&list=bogus')).toEqual({ kind: 'video', id: 'V_H9_5dYT08' })
  })

  it('enumerates only that playlist, never the uploader, under the playlist title, and says it is a playlist', async () => {
    const asked: string[] = []
    const read = (async (input: string | URL | Request) => {
      const url = String(input)
      asked.push(url)
      if (url.startsWith(`https://www.youtube.com/playlist?list=${LIST}`)) return new Response(playlistPage('Cooking Classics', 3))
      if (url.startsWith('https://www.youtube.com/oembed')) return new Response('{}')
      return new Response('', { status: 404 })
    }) as typeof fetch
    const found = await resolveChannel(`https://www.youtube.com/watch?v=V_H9_5dYT08&list=${LIST}`, read)
    expect(found).toMatchObject({ channelId: LIST, sourceType: 'youtube-playlist', title: 'Cooking Classics' })
    expect(found.videos.map((video) => video.id)).toEqual(['pppppppppp1', 'pppppppppp2', 'pppppppppp3'])
    const pages = asked.filter((url) => !url.startsWith('https://www.youtube.com/oembed') && !url.startsWith('https://www.youtube.com/watch?'))
    // The playlist's own page, and its own feed for upload days: never the uploader's.
    expect(pages).toEqual([`https://www.youtube.com/playlist?list=${LIST}`, `https://www.youtube.com/feeds/videos.xml?playlist_id=${LIST}`])
    // Videos the feed left undated are dated from their own watch pages, one read each.
    expect(asked.filter((url) => url.startsWith('https://www.youtube.com/watch?')).sort()).toEqual(
      ['pppppppppp1', 'pppppppppp2', 'pppppppppp3'].map((id) => `https://www.youtube.com/watch?v=${id}`),
    )
  })

  it('reports a channel link as a channel source', async () => {
    const CHANNEL = 'UCy8m1xxZpj6V8xtm-vtvzpg'
    const read = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith(`https://www.youtube.com/playlist?list=UU${CHANNEL.slice(2)}`)) return new Response(playlistPage('Uploads', 2))
      if (url.startsWith('https://www.youtube.com/oembed')) return new Response('{}')
      return new Response('', { status: 404 })
    }) as typeof fetch
    const { status, body } = await handleChannelRequest(new URL(`http://tvn/api/channel?url=${CHANNEL}`), read)
    expect(status).toBe(200)
    expect(body).toMatchObject({ channelId: CHANNEL, sourceType: 'youtube-channel' })
  })

  it('caches ordinary lookups but never an explicit RESCAN or a failure', () => {
    expect(channelCacheControl(new URL('http://tvn/api/channel?url=x'), 200)).toBe('public, max-age=900')
    expect(channelCacheControl(new URL('http://tvn/api/channel?url=x&refresh=1'), 200)).toBe('no-store')
    expect(channelCacheControl(new URL('http://tvn/api/channel?url=x'), 404)).toBe('no-store')
  })
})
