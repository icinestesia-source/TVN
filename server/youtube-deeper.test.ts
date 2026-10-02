import { describe, expect, it } from 'vitest'
import { continuationOf, discoverPlaylists, handleChannelRequest, PAGE_LIMIT, playlistOwnerFrom, playlistsFromChannelPage, resolveChannel } from './youtube-channel.ts'

const ARTIST = 'UCdeep00000000000000000a'
const OTHER = 'UCother0000000000000000b'

function video(id: string, clock = '4:00') {
  return {
    lockupViewModel: {
      contentId: id,
      contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
      contentImage: { thumbnailViewModel: { overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: clock } }] } }] } },
      metadata: { lockupMetadataViewModel: { title: { content: `Video ${id}` } } },
    },
  }
}

function batch(page: number) {
  return Array.from({ length: 100 }, (_, index) => video(`p${page}v${String(index).padStart(8, '0')}`))
}

function more(token: string) {
  return { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token } } } }
}

function header(owner: string) {
  return { header: { pageHeaderViewModel: { metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { commandRuns: [{ onTap: { innertubeCommand: { browseEndpoint: { browseId: owner } } } }] } }] }] } } } } }
}

const html = (data: unknown) => `<html><script>"INNERTUBE_CLIENT_VERSION":"2.20261001.00.00";var ytInitialData = ${JSON.stringify(data)};</script></html>`

/** An uploads list that never ends: every continuation names another. */
function endless() {
  const posts: { token: string; body: string }[] = []
  const read = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('https://www.youtube.com/youtubei/v1/browse')) {
      const body = JSON.parse(String(init?.body))
      posts.push({ token: body.continuation, body: String(init?.body) })
      const page = Number(String(body.continuation).slice(4))
      return Response.json({ onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [...batch(page), more(`page${page + 1}`)] } }] })
    }
    if (url.includes('/playlist?list=')) return new Response(html({ ...header(ARTIST), contents: [...batch(1), more('page2')] }))
    return new Response('{}')
  }) as typeof fetch
  return { read, posts }
}

describe('deeper keyless enumeration', () => {
  it('RECENT reads one listing page; ARCHIVE and ALL follow the continuation to a fixed cap', async () => {
    const recent = endless()
    const small = await resolveChannel(ARTIST, recent.read)
    expect(recent.posts).toHaveLength(0)
    expect(small.pages).toBe(1)
    expect(small.videos).toHaveLength(60)

    const archive = endless()
    const deep = await resolveChannel(ARTIST, archive.read, { wide: true })
    expect(archive.posts).toHaveLength(PAGE_LIMIT.wide - 1)
    expect(deep.pages).toBe(PAGE_LIMIT.wide)
    expect(deep.scanned).toBe(PAGE_LIMIT.wide * 100)
    expect(deep.videos.length).toBeGreaterThan(small.videos.length)
    expect(deep.videos.length).toBeLessThanOrEqual(400)
    expect(new Set(deep.videos.map((item) => item.id)).size).toBe(deep.videos.length)
  })

  it('continues as the page would, with its own client version and no key', async () => {
    const archive = endless()
    await resolveChannel(ARTIST, archive.read, { wide: true })
    expect(archive.posts[0].token).toBe('page2')
    expect(JSON.parse(archive.posts[0].body).context.client).toMatchObject({ clientName: 'WEB', clientVersion: '2.20261001.00.00' })
    expect(archive.posts[0].body).not.toMatch(/key/i)
  })

  it('stops where the list ends or a continuation fails, keeping what it read', async () => {
    const read = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith('https://www.youtube.com/youtubei')) return new Response('', { status: 429 })
      if (url.includes('/playlist?list=')) return new Response(html({ contents: [...batch(1), more('page2')] }))
      return new Response('{}')
    }) as typeof fetch
    const deep = await resolveChannel(ARTIST, read, { wide: true })
    expect(deep.pages).toBe(1)
    expect(deep.videos).toHaveLength(100)
  })

  it('finds the continuation token, the playlist owner and a channel’s playlists', () => {
    expect(continuationOf({ a: [video('x0000000001'), more('tok')] })).toBe('tok')
    expect(continuationOf({ a: [video('x0000000001')] })).toBeNull()
    expect(playlistOwnerFrom(header(ARTIST))).toBe(ARTIST)
    expect(playlistOwnerFrom({ contents: [] })).toBeNull()
    const listed = playlistsFromChannelPage({
      items: [
        { lockupViewModel: { contentId: 'PLofficial0000001', contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST', metadata: { lockupMetadataViewModel: { title: { content: 'Album' } } }, contentImage: { thumbnailBadgeViewModel: { text: '16 videos' } } } },
        { lockupViewModel: { contentId: `FL${ARTIST.slice(2)}`, contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST', metadata: { lockupMetadataViewModel: { title: { content: 'Favourites' } } } } },
        { gridPlaylistRenderer: { playlistId: 'PLlegacy00000001', title: { runs: [{ text: 'Old grid' }] }, videoCountText: { runs: [{ text: '7' }] } } },
        video('v0000000001'),
      ],
    })
    expect(listed).toEqual([
      { id: 'PLofficial0000001', title: 'Album', videos: 16 },
      { id: 'PLlegacy00000001', title: 'Old grid', videos: 7 },
    ])
  })
})

describe('playlist discovery', () => {
  const playlistsTab = html({
    metadata: { channelMetadataRenderer: { title: 'Deep Artist' } },
    items: [
      { lockupViewModel: { contentId: 'PLown00000000001', contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST', metadata: { lockupMetadataViewModel: { title: { content: 'Debut (Full Album)' } } } } },
      { lockupViewModel: { contentId: 'PLfan00000000001', contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST', metadata: { lockupMetadataViewModel: { title: { content: 'Fan mix' } } } } },
    ],
  })
  const read = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url === `https://www.youtube.com/channel/${ARTIST}/playlists`) return new Response(playlistsTab)
    if (url.includes('list=PLown')) return new Response(html({ ...header(ARTIST), contents: [video('o0000000001')] }))
    if (url.includes('list=PLfan')) return new Response(html({ ...header(OTHER), contents: [video('f0000000001')] }))
    return new Response('', { status: 404 })
  }) as typeof fetch

  it('lists a channel’s playlists, marking official only those its own header says it owns', async () => {
    const found = await discoverPlaylists(ARTIST, read)
    expect(found.title).toBe('Deep Artist')
    expect(found.playlists).toEqual([
      { id: 'PLown00000000001', title: 'Debut (Full Album)', videos: null, ownerId: ARTIST, official: true },
      { id: 'PLfan00000000001', title: 'Fan mix', videos: null, ownerId: OTHER, official: false },
    ])
  })

  it('is its own request mode, and never resolves or adds videos', async () => {
    const result = await handleChannelRequest(new URL(`http://tvn/api/channel?url=${ARTIST}&mode=playlists`), read)
    expect(result.status).toBe(200)
    expect(result.body).not.toHaveProperty('videos')
    expect((result.body as { playlists: unknown[] }).playlists).toHaveLength(2)
    expect((await handleChannelRequest(new URL('http://tvn/api/channel?url=https%3A%2F%2Fwww.youtube.com%2Fplaylist%3Flist%3DPLown00000000001&mode=playlists'), read)).status).toBe(400)
  })

  it('a resolved playlist carries its owner, so a curator can confirm it before adding', async () => {
    const list = await resolveChannel('https://www.youtube.com/playlist?list=PLown00000000001', ((input: string | URL | Request) =>
      String(input).includes('oembed') ? Promise.resolve(new Response('{}')) : read(input)) as typeof fetch)
    expect(list.ownerId).toBe(ARTIST)
  })
})
