import { describe, expect, it } from 'vitest'
import { listedCountFrom, parseChannelInput, resolveChannel, seedFromPage } from './youtube-channel.ts'
import { frameAllowed, pageFacts, postFacts, resolveWebsite, resolveXPost, xPostOf, NOT_EMBEDDABLE } from './web-programmes.ts'
import { resolveFeed, VERIFIED_FEED_DOWN } from './podcast-feed.ts'

const MIX = 'https://www.youtube.com/watch?v=cUUlzkI4Ivc&list=RDcUUlzkI4Ivc&start_radio=1'
const X_POST = 'https://x.com/OptiJogos/status/2106446792686715186/video/1'

const headers = (values: Record<string, string>) => new Headers(values)

function fakeFetch(routes: Record<string, () => Response>, seen: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input)
    seen.push(url)
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix))
    if (!key) return new Response('not found', { status: 404 })
    const response = routes[key]()
    Object.defineProperty(response, 'url', { value: url })
    return response
  }) as typeof fetch
}

describe('YouTube playlists and Mixes', () => {
  it('reads a playlist link, from the playlist page or a watch link carrying list=', () => {
    expect(parseChannelInput('https://www.youtube.com/playlist?list=PLFs4vir_WsTwEd-nJgVJCZPNL3HALHHpF')).toEqual({ kind: 'playlist', id: 'PLFs4vir_WsTwEd-nJgVJCZPNL3HALHHpF' })
  })

  it('takes the listed count from the newer metadata parts when the old header is absent', () => {
    const data = { header: { pageHeaderRenderer: { content: { metadataParts: [{ text: { content: 'Playlist' } }, { text: { content: '54 videos' } }] } } } }
    const flat = { metadataParts: [{ text: 'Kurzgesagt' }, { text: '1,204 videos' }] }
    expect([listedCountFrom(data), listedCountFrom(flat)].some((count) => count === 54 || count === 1204)).toBe(true)
  })

  it('never treats an RD Mix as a durable playlist: the seed video is kept, the Mix is not listed', () => {
    expect(parseChannelInput(MIX)).toEqual({ kind: 'video', id: 'cUUlzkI4Ivc', mix: 'RDcUUlzkI4Ivc' })
    expect(parseChannelInput('https://youtu.be/cUUlzkI4Ivc?list=RDcUUlzkI4Ivc')).toEqual({ kind: 'video', id: 'cUUlzkI4Ivc', mix: 'RDcUUlzkI4Ivc' })
    expect(parseChannelInput('https://www.youtube.com/playlist?list=RDcUUlzkI4Ivc')).toEqual({ kind: 'video', id: 'cUUlzkI4Ivc', mix: 'RDcUUlzkI4Ivc' })
    expect(parseChannelInput('https://www.youtube.com/playlist?list=RDMMabc')).toEqual({ kind: 'mix', id: 'RDMMabc' })
  })

  it('a Mix with no seed video is refused honestly, without reading any private endpoint', async () => {
    const seen: string[] = []
    await expect(resolveChannel('https://www.youtube.com/playlist?list=RDMMabc', fakeFetch({}, seen))).rejects.toThrow(/Mix is made fresh for each viewer/)
    expect(seen).toEqual([])
  })

  it('reads the seed video from its own watch page: title, length and day', () => {
    const html = '..."videoDetails":{"videoId":"cUUlzkI4Ivc","title":"MUTO. - Sugar ft. Mel May","lengthSeconds":"206","x":1}..."publishDate":"2016-01-10T00:00:00-08:00"'
    expect(seedFromPage(html, 'cUUlzkI4Ivc')).toEqual({ id: 'cUUlzkI4Ivc', title: 'MUTO. - Sugar ft. Mel May', durationSec: 206, published: '2016-01-10' })
    expect(seedFromPage(html, 'aaaaaaaaaaa')).toBeNull()
  })

})

describe('X / Twitter posts: public embed only', () => {
  it('recognises the addresses X gives one public post', () => {
    expect(xPostOf(new URL(X_POST))).toEqual({ account: 'OptiJogos', id: '2106446792686715186' })
    expect(xPostOf(new URL('https://twitter.com/a_b/status/123456789'))).toEqual({ account: 'a_b', id: '123456789' })
    expect(xPostOf(new URL('https://x.com/OptiJogos'))).toBeNull()
    expect(xPostOf(new URL('https://example.com/a/status/123456789'))).toBeNull()
  })

  it("reads the post's text and day from X's oEmbed markup as plain text", () => {
    const html = '<blockquote class="twitter-tweet"><p lang="pt">Hello <a href="https://t.co/x">#tag</a> pic.x.com/abc</p>&mdash; Opti (@OptiJogos) <a href="https://twitter.com/OptiJogos/status/1">October 1, 2026</a></blockquote>'
    expect(postFacts(html)).toEqual({ text: 'Hello #tag', published: '2026-10-01', media: true })
  })

  it("uses X's public oEmbed and its own embed frame: no API key, no syndication, no media file addresses", async () => {
    const seen: string[] = []
    const read = fakeFetch(
      {
        'https://publish.x.com/oembed': () =>
          new Response(JSON.stringify({ author_name: 'OptiJuegos', html: '<blockquote><p>Clip</p>&mdash; <a href="#">October 2, 2026</a></blockquote>' }), { headers: { 'content-type': 'application/json' } }),
      },
      seen,
    )
    const found = await resolveXPost(new URL(X_POST), read)
    expect(found.provider).toBe('x')
    expect(found.episodes[0]).toMatchObject({
      id: 'x-2106446792686715186',
      title: 'OptiJuegos: Clip',
      published: '2026-10-02',
      web: 'post',
      page: 'https://x.com/OptiJogos/status/2106446792686715186',
      media: 'https://platform.twitter.com/embed/Tweet.html?id=2106446792686715186&dnt=true&theme=dark',
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatch(/^https:\/\/publish\.x\.com\/oembed\?/)
    expect(seen.join(' ')).not.toMatch(/syndication|api\.x\.com|api\.twitter\.com|video\.twimg/)
    const missing = fakeFetch({ 'https://publish.x.com/oembed': () => new Response('', { status: 404 }) })
    await expect(resolveXPost(new URL(X_POST), missing)).rejects.toThrow(/private, removed, or cannot be embedded/)
  })
})

describe('VERITAS: the verified public feed only', () => {
  const page = '<html><head><link rel="alternate" type="application/rss+xml" href="https://veritas7.com/members.rss"><link rel="alternate" type="application/rss+xml" href="https://veritas7.com/vs.rss"></head></html>'
  const item = (n: number) =>
    `<item><title>Guest ${n} | Part 1 of 2</title><pubDate>Thu, 0${n} Oct 2026 10:00:00 GMT</pubDate><itunes:duration>01:02:03</itunes:duration><enclosure url="https://public.manticore.com/veritas/VS-${n}.mp3" type="audio/mpeg" length="1"/></item>`
  const feed = `<?xml version="1.0"?><rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Veritas Show</title><link>https://veritas7.com/</link>${item(1)}${item(2)}</channel></rss>`

  it('reads vs.rss and never the members feed, keeping dates, durations and enclosures', async () => {
    const seen: string[] = []
    const read = fakeFetch(
      {
        'https://veritas7.com/vs.rss': () => new Response(feed, { headers: { 'content-type': 'application/rss+xml' } }),
        'https://veritas7.com/members.rss': () => new Response(feed.replace('Veritas Show', 'Members'), { headers: { 'content-type': 'application/rss+xml' } }),
        'https://veritas7.com/': () => new Response(page, { headers: { 'content-type': 'text/html' } }),
      },
      seen,
    )
    const found = await resolveFeed('https://veritas7.com/', read)
    expect(found.feedUrl).toBe('https://veritas7.com/vs.rss')
    expect(found.episodes.length).toBeGreaterThan(0)
    expect(found.episodes[0]).toMatchObject({ durationSec: 3723, media: expect.stringMatching(/^https:\/\/public\.manticore\.com\/veritas\//) })
    expect(found.episodes.every((episode) => /Part 1 of 2/.test(episode.title))).toBe(true)
    expect(found.episodes.some((episode) => episode.published?.startsWith('2026-10'))).toBe(true)
    expect(seen.some((url) => url.includes('members'))).toBe(false)
  })

  it('reports the public feed being down and does not fall back to any other feed', async () => {
    const seen: string[] = []
    const read = fakeFetch(
      {
        'https://veritas7.com/vs.rss': () => new Response('down', { status: 503 }),
        'https://veritas7.com/members.rss': () => new Response(feed, { headers: { 'content-type': 'application/rss+xml' } }),
        'https://veritas7.com/': () => new Response(page, { headers: { 'content-type': 'text/html' } }),
      },
      seen,
    )
    await expect(resolveFeed('https://veritas7.com/', read)).rejects.toThrow(VERIFIED_FEED_DOWN)
    expect(seen.some((url) => url.includes('members'))).toBe(false)
  })
})

describe('Website programmes (server)', () => {
  it('a site may be framed only when its own headers allow it', () => {
    expect(frameAllowed(headers({}))).toBe(true)
    expect(frameAllowed(headers({ 'x-frame-options': 'SAMEORIGIN' }))).toBe(false)
    expect(frameAllowed(headers({ 'x-frame-options': 'DENY' }))).toBe(false)
    expect(frameAllowed(headers({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self'" }))).toBe(false)
    expect(frameAllowed(headers({ 'content-security-policy': 'frame-ancestors *' }))).toBe(true)
    expect(frameAllowed(headers({ 'content-security-policy': 'frame-ancestors https:' }))).toBe(true)
  })

  it('reads title, description and artwork as plain text, and only https artwork', () => {
    const facts = pageFacts('<title>Plain &amp; Simple</title><meta name="description" content="A page"><meta property="og:image" content="http://insecure/x.png">', 'https://example.com/')
    expect(facts.title).toBe('Plain & Simple')
    expect(facts.summary).toBe('A page')
    expect(facts.image).toBeUndefined()
  })

  it('an embeddable site becomes one programme; a refusing site reports SITE CANNOT BE EMBEDDED', async () => {
    const read = fakeFetch({
      'https://open.example/': () => new Response('<title>Open</title>', { headers: { 'content-type': 'text/html' } }),
      'https://closed.example/': () => new Response('<title>No</title>', { headers: { 'content-type': 'text/html', 'x-frame-options': 'DENY' } }),
    })
    const found = await resolveWebsite(new URL('https://open.example/'), read)
    expect(found.provider).toBe('website')
    expect(found.episodes).toHaveLength(1)
    expect(found.episodes[0]).toMatchObject({ title: 'Open', durationSec: 600, web: 'website', media: 'https://open.example/', page: 'https://open.example/' })
    await expect(resolveWebsite(new URL('https://closed.example/'), read)).rejects.toThrow(NOT_EMBEDDABLE)
    await expect(resolveWebsite(new URL('http://open.example/'), read)).rejects.toThrow(/https/)
  })
})
