import { describe, expect, it } from 'vitest'
import {
  channelIdFromPage,
  handleChannelRequest,
  initialData,
  parseChannelInput,
  parseClock,
  resolveChannel,
  videosFromPlaylistPage,
} from './youtube-channel.ts'

const CHANNEL = 'UCy8m1xxZpj6V8xtm-vtvzpg'

function lockup(id: string, title: string, badge: string | null) {
  return {
    lockupViewModel: {
      contentId: id,
      contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
      contentImage: {
        thumbnailViewModel: {
          overlays: badge ? [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: badge } }] } }] : [],
        },
      },
      metadata: { lockupMetadataViewModel: { title: { content: title } } },
    },
  }
}

function pageWith(data: unknown, extra = ''): string {
  return `<html>${extra}<script>var ytInitialData = ${JSON.stringify(data)};</script></html>`
}

const playlist = pageWith({
  contents: [
    lockup('aaaaaaaaaa1', 'Newest upload', '12:00'),
    lockup('aaaaaaaaaa2', 'A short', '0:45'),
    lockup('aaaaaaaaaa3', 'Refused upload', '20:00'),
    lockup('aaaaaaaaaa4', 'A long film', '1:02:03'),
    lockup('aaaaaaaaaa5', 'No badge', null),
  ],
  sidebar: { videoOwnerRenderer: { title: { runs: [{ text: 'VintageVerse' }] } } },
})

function fakeFetch(pages: Record<string, { status?: number; body?: string }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    const key = Object.keys(pages).find((prefix) => url.startsWith(prefix))
    const page = key ? pages[key] : { status: 404, body: '' }
    return new Response(page.body ?? '', { status: page.status ?? 200 })
  }) as typeof fetch
}

describe('reading a pasted YouTube link', () => {
  it('recognises channel, handle, legacy and video links', () => {
    expect(parseChannelInput(`https://www.youtube.com/channel/${CHANNEL}`)).toEqual({ kind: 'channel', id: CHANNEL })
    expect(parseChannelInput(CHANNEL)).toEqual({ kind: 'channel', id: CHANNEL })
    expect(parseChannelInput('https://www.youtube.com/@VintageVerseTV/videos')).toEqual({ kind: 'handle', handle: 'VintageVerseTV' })
    expect(parseChannelInput('@VintageVerseTV')).toEqual({ kind: 'handle', handle: 'VintageVerseTV' })
    expect(parseChannelInput('youtube.com/@VintageVerseTV')).toEqual({ kind: 'handle', handle: 'VintageVerseTV' })
    expect(parseChannelInput('https://m.youtube.com/c/SomeName')).toEqual({ kind: 'path', path: '/c/SomeName' })
    expect(parseChannelInput('https://www.youtube.com/user/oldname')).toEqual({ kind: 'path', path: '/user/oldname' })
    expect(parseChannelInput('https://www.youtube.com/watch?v=Bu9SOZwn2Oo&t=10')).toEqual({ kind: 'video', id: 'Bu9SOZwn2Oo' })
    expect(parseChannelInput('https://youtu.be/Bu9SOZwn2Oo?si=x')).toEqual({ kind: 'video', id: 'Bu9SOZwn2Oo' })
    expect(parseChannelInput('https://www.youtube.com/shorts/Bu9SOZwn2Oo')).toEqual({ kind: 'video', id: 'Bu9SOZwn2Oo' })
  })

  it('rejects links that are not YouTube channels or videos', () => {
    for (const bad of ['', 'hello', 'https://example.com/@x', 'https://www.youtube.com/', 'https://www.youtube.com/watch?v=short', 'https://vimeo.com/123']) {
      expect(parseChannelInput(bad), bad).toBeNull()
    }
  })

  it('finds the owning channel on channel and watch pages', () => {
    expect(channelIdFromPage(`..."externalId":"${CHANNEL}"...`, 'channel')).toBe(CHANNEL)
    expect(channelIdFromPage(`<link rel="canonical" href="https://www.youtube.com/channel/${CHANNEL}">`, 'channel')).toBe(CHANNEL)
    const watch = `"channelId":"UCaaaaaaaaaaaaaaaaaaaaaa","videoDetails":{"videoId":"Bu9SOZwn2Oo","lengthSeconds":"645","channelId":"${CHANNEL}"}`
    expect(channelIdFromPage(watch, 'video')).toBe(CHANNEL)
    expect(channelIdFromPage('nothing here', 'channel')).toBeNull()
  })

  it('reads videos, titles and lengths from an uploads playlist page', () => {
    expect(parseClock('12:00')).toBe(720)
    expect(parseClock('1:02:03')).toBe(3723)
    expect(parseClock('LIVE')).toBe(0)
    const videos = videosFromPlaylistPage(initialData(playlist))
    expect(videos.map((video) => [video.id, video.durationSec])).toEqual([
      ['aaaaaaaaaa1', 720],
      ['aaaaaaaaaa2', 45],
      ['aaaaaaaaaa3', 1200],
      ['aaaaaaaaaa4', 3723],
      ['aaaaaaaaaa5', 0],
    ])
    const legacy = videosFromPlaylistPage({ x: [{ playlistVideoRenderer: { videoId: 'bbbbbbbbbb1', title: { runs: [{ text: 'Old layout' }] }, lengthSeconds: '600' } }] })
    expect(legacy).toEqual([{ id: 'bbbbbbbbbb1', title: 'Old layout', durationSec: 600 }])
  })
})

describe('resolving a channel without a key', () => {
  const pages = {
    'https://www.youtube.com/@VintageVerseTV': { body: pageWith({ metadata: { channelMetadataRenderer: { title: 'VintageVerse' } } }, `"externalId":"${CHANNEL}"`) },
    'https://www.youtube.com/watch?v=Bu9SOZwn2Oo': { body: `"videoDetails":{"videoId":"Bu9SOZwn2Oo","channelId":"${CHANNEL}"}` },
    [`https://www.youtube.com/playlist?list=UU${CHANNEL.slice(2)}`]: { body: playlist },
    'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Daaaaaaaaaa3': { status: 401 },
    'https://www.youtube.com/oembed': { body: '{}' },
  }

  it('keeps schedulable, embeddable uploads newest first, from a handle or a video link', async () => {
    for (const link of ['https://www.youtube.com/@VintageVerseTV', 'https://youtu.be/Bu9SOZwn2Oo', `https://www.youtube.com/channel/${CHANNEL}`]) {
      const channel = await resolveChannel(link, fakeFetch(pages))
      expect(channel.channelId).toBe(CHANNEL)
      expect(channel.title).toBe('VintageVerse')
      expect(channel.videos.map((video) => video.id)).toEqual(['aaaaaaaaaa1', 'aaaaaaaaaa4'])
      expect(channel.refused).toBe(1)
    }
  })

  it('answers with a plain error for bad links, missing channels and fully refused channels', async () => {
    expect(await handleChannelRequest(new URL('http://tvn/api/channel?url='), fakeFetch(pages))).toMatchObject({ status: 400 })
    expect(await handleChannelRequest(new URL('http://tvn/api/channel?url=https%3A%2F%2Fexample.com'), fakeFetch(pages))).toMatchObject({ status: 400 })
    expect(await handleChannelRequest(new URL('http://tvn/api/channel?url=%40nobody_here'), fakeFetch(pages))).toMatchObject({ status: 404 })
    const refusing = { ...pages, 'https://www.youtube.com/oembed': { status: 401 } }
    const result = await handleChannelRequest(new URL(`http://tvn/api/channel?url=${CHANNEL}`), fakeFetch(refusing))
    expect(result.status).toBe(422)
    expect(result.body).toEqual({ error: 'That channel does not allow its videos to play outside YouTube' })
  })
})

describe('a playlist as a channel source', () => {
  const LIST = 'PLabcdefghij1234'
  const listPage = pageWith({
    metadata: { playlistMetadataRenderer: { title: 'Saturday Films' } },
    contents: [lockup('cccccccccc1', 'First film', '1:30:00'), lockup('cccccccccc2', 'Trailer', '0:50'), lockup('cccccccccc3', 'Second film', '1:45:00')],
  })

  it('reads a public playlist link, and not mixes or personal lists', () => {
    expect(parseChannelInput(`https://www.youtube.com/playlist?list=${LIST}`)).toEqual({ kind: 'playlist', id: LIST })
    // A watch link inside a playlist names the playlist (TVN 1.0.8); Watch Later falls back to the video, and a Mix
    // keeps its seed video and is marked as a Mix (it is generated per viewer, never a durable playlist).
    expect(parseChannelInput(`https://www.youtube.com/watch?v=Bu9SOZwn2Oo&list=${LIST}`)).toEqual({ kind: 'playlist', id: LIST })
    expect(parseChannelInput('https://www.youtube.com/watch?v=Bu9SOZwn2Oo&list=RDBu9SOZwn2Oo')).toEqual({ kind: 'video', id: 'Bu9SOZwn2Oo', mix: 'RDBu9SOZwn2Oo' })
    expect(parseChannelInput('https://www.youtube.com/watch?v=Bu9SOZwn2Oo&list=WL')).toEqual({ kind: 'video', id: 'Bu9SOZwn2Oo' })
    expect(parseChannelInput('https://www.youtube.com/playlist?list=RDabcdefghij1234')).toEqual({ kind: 'mix', id: 'RDabcdefghij1234' })
    expect(parseChannelInput('https://www.youtube.com/playlist?list=WL')).toBeNull()
  })

  it('resolves its schedulable, embeddable videos under the playlist’s own title', async () => {
    const channel = await resolveChannel(
      `https://www.youtube.com/playlist?list=${LIST}`,
      fakeFetch({ [`https://www.youtube.com/playlist?list=${LIST}`]: { body: listPage }, 'https://www.youtube.com/oembed': { body: '{}' } }),
    )
    expect(channel).toMatchObject({ channelId: LIST, title: 'Saturday Films', scanned: 2, refused: 0 })
    expect(channel.videos.map((video) => video.id)).toEqual(['cccccccccc1', 'cccccccccc3'])
  })
})

const WIDE_ARTIST = 'UCdaft00000000000000000a'

describe('source modes', () => {
  it('the server keeps 60 recent uploads, or every embeddable upload the page lists for ARCHIVE and ALL', async () => {
    const lockups = Array.from({ length: 100 }, (_, index) => ({
      lockupViewModel: {
        contentId: `u${String(index).padStart(10, '0')}`,
        contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
        contentImage: { thumbnailViewModel: { overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: '4:00' } }] } }] } },
        metadata: { lockupMetadataViewModel: { title: { content: `Upload ${index}` } } },
      },
    }))
    const page = `<html><script>var ytInitialData = ${JSON.stringify({ contents: lockups })};</script></html>`
    const read = (async (input: string | URL | Request) =>
      new Response(String(input).includes('/playlist?list=UU') ? page : '{}', { status: 200 })) as typeof fetch
    expect((await resolveChannel(WIDE_ARTIST, read)).videos).toHaveLength(60)
    expect((await resolveChannel(WIDE_ARTIST, read, { wide: true })).videos).toHaveLength(100)
    const wide = await handleChannelRequest(new URL(`http://x/api/channel?url=${WIDE_ARTIST}&mode=all`), read)
    expect((wide.body as { videos: unknown[] }).videos).toHaveLength(100)
    const plain = await handleChannelRequest(new URL(`http://x/api/channel?url=${WIDE_ARTIST}&mode=bogus`), read)
    expect((plain.body as { videos: unknown[] }).videos).toHaveLength(60)
  })
})
