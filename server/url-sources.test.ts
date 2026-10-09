import { describe, expect, it } from 'vitest'
import { webmSeconds } from './media-probe.ts'
import { resolveFeed } from './podcast-feed.ts'
import { firstVariant, isSignedUrl, readMediaPlaylist, resolveUrlSource } from './url-sources.ts'
import { refusal } from './web-read.ts'

type Route = (url: string, init?: RequestInit) => Response | null
const reader = (route: Route) => (async (url: string | URL, init?: RequestInit) => route(String(url), init) ?? new Response('', { status: 404 })) as typeof fetch
const body = (text: string, type: string, headers: Record<string, string> = {}, status = 200) => new Response(text, { status, headers: { 'content-type': type, ...headers } })

const VIMEO_RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Vimeo / Example Picks</title><description>Short films</description>
<item><title>First Film</title><pubDate>Fri, 02 Oct 2026 16:00:44 -0400</pubDate><link>https://vimeo.com/channels/examplepicks/1111111</link><guid>tag:vimeo,2026-10-02:clip1111111</guid><media:content medium="video" duration="141"><media:player url="https://player.vimeo.com/video/1111111?h=abc"/><media:thumbnail url="https://i.vimeocdn.com/video/1.jpg"/></media:content></item>
<item><title>Teaser</title><link>https://vimeo.com/channels/examplepicks/2222222</link><media:content medium="video" duration="12"/></item>
</channel></rss>`

const ODYSEE_RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title><![CDATA[Example on Odysee]]></title>
<item><title><![CDATA[A Post]]></title><link>https://odysee.com/a-post:aaaa</link><guid>https://odysee.com/a-post:aaaa</guid><enclosure url="https://odysee.com/$/rss/media/a-post/aaaa/1.md" length="10" type="text/markdown"/></item>
<item><title><![CDATA[A Film]]></title><link>https://odysee.com/a-film:bbbb1234</link><guid>https://odysee.com/a-film:bbbb1234</guid><pubDate>Fri, 29 May 2026 10:00:00 GMT</pubDate><enclosure url="https://odysee.com/$/rss/media/a-film/bbbb1234/2.mp4" length="3619212" type="video/mp4"/><itunes:duration>413</itunes:duration></item>
</channel></rss>`

const BITCHUTE_RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Example Chute</title><description>Videos</description>
<item><title>Clip One</title><link>https://api.bitchute.com/embed/AbCdEf123/</link><guid>AbCdEf123</guid><pubDate>Tue, 24 Jun 2025 20:06:23 +0000</pubDate></item>
<item><title>Clip Gone</title><link>https://api.bitchute.com/embed/GoNe456789/</link><guid>GoNe456789</guid></item>
</channel></rss>`

describe('Vimeo through its public oEmbed record and RSS', () => {
  const route: Route = (url) => {
    if (url.startsWith('https://vimeo.com/api/oembed.json')) {
      return url.includes('1111111') ? body(JSON.stringify({ title: 'First Film', duration: 141, upload_date: '2026-09-21 10:00:00', thumbnail_url: 'https://i.vimeocdn.com/video/1.jpg', author_url: 'https://vimeo.com/someone' }), 'application/json') : null
    }
    if (url === 'https://vimeo.com/channels/examplepicks/videos/rss') return body(VIMEO_RSS, 'application/rss+xml')
    return null
  }

  it('reads one public video as a single programme played through the Vimeo player', async () => {
    for (const address of ['https://vimeo.com/1111111', 'https://player.vimeo.com/video/1111111', 'https://vimeo.com/channels/examplepicks/1111111']) {
      const found = await resolveFeed(address, reader(route))
      expect(found).toMatchObject({ provider: 'vimeo', form: 'video', feedUrl: 'https://vimeo.com/1111111', title: 'First Film', website: 'https://vimeo.com/someone' })
      expect(found.episodes).toEqual([expect.objectContaining({ id: 'vimeo-1111111', durationSec: 141, published: '2026-09-21', media: 'https://player.vimeo.com/video/1111111', type: 'video/vimeo' })])
    }
  })

  it('reads a channel as a collection, without trailers and without the private-link hash', async () => {
    const found = await resolveFeed('https://vimeo.com/channels/examplepicks', reader(route))
    expect(found).toMatchObject({ provider: 'vimeo', form: 'collection', title: 'Example Picks', listed: 2, unplayable: 1 })
    expect(found.episodes[0]).toMatchObject({ media: 'https://player.vimeo.com/video/1111111', published: '2026-10-02', durationSec: 141 })
    expect(JSON.stringify(found)).not.toContain('h=abc')
  })

  it('refuses private links, removed videos and pages with no public feed', async () => {
    await expect(resolveFeed('https://vimeo.com/1111111/0a1b2c3d4e', reader(route))).rejects.toThrow(/private Vimeo link/)
    await expect(resolveFeed('https://player.vimeo.com/video/1111111?h=0a1b2c', reader(route))).rejects.toThrow(/private Vimeo link/)
    await expect(resolveFeed('https://vimeo.com/9999999', reader(route))).rejects.toThrow(/private, removed, or does not allow embedding/)
    await expect(resolveFeed('https://vimeo.com/showcase/123', reader(route))).rejects.toThrow(/no public feed/)
  })
})

describe('Odysee and BitChute through their public feeds', () => {
  it('reads an Odysee channel, keeping its videos and storing the stable odysee.com media address', async () => {
    const route: Route = (url) => (url === 'https://odysee.com/$/rss/@Example:1' ? body(ODYSEE_RSS, 'application/rss+xml') : null)
    const found = await resolveFeed('https://odysee.com/@Example:1', reader(route))
    expect(found).toMatchObject({ provider: 'odysee', form: 'collection', title: 'Example', feedUrl: 'https://odysee.com/@Example:1' })
    expect(found.episodes).toEqual([expect.objectContaining({ title: 'A Film', durationSec: 413, published: '2026-05-29', media: 'https://odysee.com/$/rss/media/a-film/bbbb1234/2.mp4' })])
  })

  it('finds one Odysee video in its channel feed, by its short claim', async () => {
    const route: Route = (url) => {
      if (url === 'https://odysee.com/$/rss/@Example:1') return body(ODYSEE_RSS, 'application/rss+xml')
      return null
    }
    const found = await resolveFeed('https://odysee.com/@Example:1/a-film:b', reader(route))
    expect(found).toMatchObject({ provider: 'odysee', form: 'video', title: 'A Film' })
    await expect(resolveFeed('https://odysee.com/@Example:1/elsewhere:c', reader(route))).rejects.toThrow(/older than its channel's public feed reaches/)
  })

  it('reads a BitChute channel through its RSS and each embed page’s plain file; one with no file is left out', async () => {
    const route: Route = (url) => {
      if (url === 'https://api.bitchute.com/feeds/rss/channel/examplechute/') return body(BITCHUTE_RSS, 'application/rss+xml')
      if (url === 'https://api.bitchute.com/embed/AbCdEf123/') return body('<title>Clip One</title><video><source src="https://seed1.bitchute.com/x/AbCdEf123.mp4" type="video/mp4" /></video>', 'text/html')
      if (url === 'https://api.bitchute.com/embed/GoNe456789/') return body('<title>Gone</title><p>removed</p>', 'text/html')
      return null
    }
    const found = await resolveFeed('https://www.bitchute.com/channel/examplechute/', reader(route))
    expect(found).toMatchObject({ provider: 'bitchute', form: 'collection', listed: 2, unplayable: 1 })
    expect(found.episodes).toEqual([expect.objectContaining({ id: 'bitchute-AbCdEf123', media: 'https://seed1.bitchute.com/x/AbCdEf123.mp4', durationSec: 0, published: '2025-06-24' })])
    const one = await resolveFeed('https://www.bitchute.com/video/AbCdEf123/', reader(route))
    expect(one).toMatchObject({ form: 'video', title: 'Clip One', feedUrl: 'https://www.bitchute.com/video/AbCdEf123/' })
  })
})

describe('direct media, HLS and DASH, by what the server says they are', () => {
  const MASTER = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"\nlow/index.m3u8\n'
  const VOD = '#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:10.0,\na.ts\n#EXTINF:10.0,\nb.ts\n#EXTINF:15.5,\nc.ts\n#EXT-X-ENDLIST\n'
  const LIVE = '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:100\n#EXTINF:6.0,\n100.ts\n#EXTINF:6.0,\n101.ts\n'

  it('tells an HLS recording from a live HLS stream by its playlist, not its address', async () => {
    const vod = await resolveFeed('https://cdn.example.net/films/live.m3u8', reader((url) => (url.endsWith('/live.m3u8') ? body(MASTER, 'application/vnd.apple.mpegurl') : url.endsWith('/low/index.m3u8') ? body(VOD, 'application/vnd.apple.mpegurl') : null)))
    expect(vod).toMatchObject({ provider: 'hls', form: 'video' })
    expect(vod.episodes[0]).toMatchObject({ durationSec: 36, media: 'https://cdn.example.net/films/live.m3u8', type: 'video/hls' })
    const live = await resolveFeed('https://cdn.example.net/vod/master.m3u8', reader((url) => (url.endsWith('/master.m3u8') ? body(MASTER, 'application/x-mpegURL') : url.endsWith('/low/index.m3u8') ? body(LIVE, 'application/x-mpegURL') : null)))
    expect(live).toMatchObject({ provider: 'hls', form: 'live', episodes: [], live: { url: 'https://cdn.example.net/vod/master.m3u8', media: 'video', format: 'hls' } })
  })

  it('refuses DRM-protected HLS, DASH, signed links and ingest addresses with the reason', async () => {
    const drm = '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://key",KEYFORMAT="com.apple.streamingkeydelivery"\n#EXTINF:10,\na.ts\n#EXT-X-ENDLIST\n'
    await expect(resolveFeed('https://cdn.example.net/drm.m3u8', reader(() => body(drm, 'application/vnd.apple.mpegurl')))).rejects.toThrow(/DRM-protected/)
    await expect(resolveFeed('https://cdn.example.net/show.mpd', reader(() => body('<?xml version="1.0"?><MPD type="static">', 'application/dash+xml')))).rejects.toThrow(/DASH \(\.mpd\) streams are not supported yet/)
    await expect(resolveFeed('https://cdn.example.net/film.mp4?Expires=1&Signature=abc&Key-Pair-Id=k', reader(() => body('x', 'video/mp4', { 'content-range': 'bytes 0-0/1000' }, 206)))).rejects.toThrow(/signed, expiring link/)
    await expect(resolveFeed('rtmp://live.example.com/app/streamkey', reader(() => null))).rejects.toThrow(/ingest address/)
    await expect(resolveFeed('rtmps://live.example.com:443/app', reader(() => null))).rejects.toThrow(/ingest address/)
  })

  it('reads a seekable file as one programme, an Icecast stream as live, and refuses a file that cannot be joined mid-way', async () => {
    const mp3 = new Uint8Array(4096)
    mp3.set([0xff, 0xfb, 0x90, 0x64], 0)
    mp3.set([0xff, 0xfb, 0x90, 0x64], 417)
    const file = await resolveFeed('https://cdn.example.net/talks/the_long_talk.mp3', reader(() => new Response(mp3, { status: 206, headers: { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-4095/4800000' } })))
    expect(file).toMatchObject({ provider: 'direct', form: 'video', title: 'the long talk' })
    expect(file.episodes[0]).toMatchObject({ durationSec: 300, type: 'audio/mpeg' })
    const radio = await resolveFeed('https://ice.example.net/groove-128', reader(() => body('ID3', 'audio/mpeg', { 'icy-name': 'Groove' })))
    expect(radio).toMatchObject({ provider: 'direct', form: 'live', title: 'Groove', live: { media: 'audio', format: 'direct' } })
    await expect(resolveFeed('https://cdn.example.net/film.mp4', reader(() => body('x', 'video/mp4', { 'content-length': '1000' })))).rejects.toThrow(/cannot send part of a file/)
  })

  const parse = () => {
    throw new Error('not a feed')
  }

  it('keeps a radio station by the address given, even when it redirects each listener to a signed node', async () => {
    const node = 'https://node7.example.net/STATION.mp3?token=abc'
    const read = (async () => Object.defineProperty(body('ID3', 'audio/mpeg', { 'icy-name': 'Station FM' }), 'url', { value: node })) as unknown as typeof fetch
    const radio = await resolveUrlSource(new URL('https://radio.example.net/api/livestream-redirect/STATION.mp3'), read, 60, parse, async () => null)
    expect(radio).toMatchObject({ form: 'live', title: 'Station FM', feedUrl: 'https://radio.example.net/api/livestream-redirect/STATION.mp3', live: { url: 'https://radio.example.net/api/livestream-redirect/STATION.mp3', media: 'audio', format: 'direct' } })
    expect(JSON.stringify(radio)).not.toContain('token')
    const file = (async () => Object.defineProperty(body('x', 'video/mp4', { 'content-range': 'bytes 0-0/1000' }, 206), 'url', { value: 'https://cdn.example.net/film.mp4?Signature=abc' })) as unknown as typeof fetch
    await expect(resolveUrlSource(new URL('https://cdn.example.net/film'), file, 60, parse, async () => null)).rejects.toThrow(/signed, expiring link/)
  })

  it('reads a station whose server answers in a way fetch refuses, by following its redirects and reading the reply head', async () => {
    const start = 'https://stream.example.de/tomorrowland/mp3-128/'
    const node = 'https://edge.example.net/station-mp3-128?sABC=1'
    const read = (async (url: string | URL, init?: RequestInit) => {
      if (init?.redirect === 'manual' && String(url) === start) return new Response(null, { status: 302, headers: { location: node } })
      throw new TypeError('fetch failed')
    }) as typeof fetch
    const peeked: string[] = []
    const radio = await resolveUrlSource(new URL(start), read, 60, parse, async (url) => {
      peeked.push(url.toString())
      return { type: 'audio/mpeg', name: '', icy: false }
    })
    expect(peeked).toEqual([node])
    expect(radio).toMatchObject({ form: 'live', title: 'tomorrowland', feedUrl: start, live: { url: start, media: 'audio', format: 'direct' } })
    expect(await resolveUrlSource(new URL(start), read, 60, parse, async () => null)).toBeNull()
    expect(await resolveUrlSource(new URL(start), read, 60, parse, async () => ({ type: 'text/html', name: '', icy: false }))).toBeNull()
  })
})

describe('the pieces', () => {
  it('reads playlists, variants, WebM lengths and signed addresses', () => {
    expect(readMediaPlaylist('#EXTM3U\n#EXTINF:4,\na\n#EXT-X-ENDLIST')).toMatchObject({ live: false, durationSec: 4, drm: false })
    expect(readMediaPlaylist('#EXTM3U\n#EXT-X-PLAYLIST-TYPE:EVENT\n#EXTINF:4,\na')).toMatchObject({ live: true })
    expect(firstVariant('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=64000,CODECS="mp4a.40.2"\naudio.m3u8', 'https://x.example/radio/master.m3u8')).toEqual({ url: 'https://x.example/radio/audio.m3u8', audioOnly: true })
    expect(firstVariant('#EXTM3U\n#EXTINF:4,\na.ts', 'https://x.example/a.m3u8')).toBeNull()
    const info = [0x15, 0x49, 0xa9, 0x66, 0x8f, 0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40, 0x44, 0x89, 0x84, ...new Uint8Array(new Float32Array([0]).buffer)]
    const view = new DataView(new ArrayBuffer(4))
    view.setFloat32(0, 634552)
    info.splice(15, 4, ...new Uint8Array(view.buffer))
    expect(webmSeconds(new Uint8Array([0x53, 0xab, 0x84, 0x15, 0x49, 0xa9, 0x66, ...info]))).toBe(635)
    expect(isSignedUrl(new URL('https://cdn.example/a.m3u8?token=1'))).toBe(true)
    expect(isSignedUrl(new URL('https://cdn.example/a.m3u8?quality=hd'))).toBe(false)
  })
})

describe('a site that refuses TVN', () => {
  it('says sign-in only for a sign-in, and a bot wall turning the server away as just that', () => {
    expect(refusal(new Response('', { status: 401 }), 'That address')?.message).toBe('That address needs a sign-in or subscription, which TVN does not use')
    expect(refusal(new Response('', { status: 403, headers: { server: 'cloudflare' } }), 'That address')?.message).toBe("That address turns away TVN's server (its protection blocks automated readers), so TVN cannot read it here")
    expect(refusal(new Response('', { status: 403 }), 'That site')?.message).toBe('That site refused TVN: it may need a sign-in, or block automated readers')
    expect(refusal(new Response('', { status: 403 }), 'That site')?.status).toBe(403)
    expect(refusal(new Response('', { status: 404 }), 'That site')).toBeNull()
  })
})
