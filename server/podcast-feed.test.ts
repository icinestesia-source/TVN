import { describe, expect, it } from 'vitest'
import { discoverFeeds, FeedError, parseFeed, resolveFeed } from './podcast-feed.ts'
import { parseChannelInput } from './youtube-channel.ts'

const page = (body: string, status = 200, type = 'text/html') => new Response(body, { status, headers: { 'content-type': type } })
const FEED = `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
<title>Example Radio</title><link>https://www.radio-example.org/</link><description>Talk &amp; music</description>
<item><title><![CDATA[Episode 2: Ancient Rome]]></title><guid>ep2</guid><pubDate>Tue, 01 Sep 2026 10:00:00 GMT</pubDate><itunes:duration>01:02:03</itunes:duration><enclosure url="https://cdn.radio-example.org/ep2.mp3" type="audio/mpeg" length="1000"/></item>
<item><title>Episode 1</title><guid>ep1</guid><enclosure url="https://cdn.radio-example.org/ep1.mp3" type="audio/mpeg" length="16000000"/></item>
<item><title>Members only</title><guid>ep0</guid><enclosure url="https://cdn.radio-example.org/ep0.pdf" type="application/pdf" length="10"/></item>
</channel></rss>`

describe('podcast and RSS/Atom sources', () => {
  it('discovers the feed a website announces, and parses episodes with title, date, duration and enclosure', () => {
    const html = `<html><head><!-- <link rel="alternate" type="application/rss+xml" href="/old.xml"> --><link rel="alternate" type="application/rss+xml" title="Comments" href="/comments/feed/"><link rel="alternate" type="application/rss+xml" title="Podcast" href="/feed/podcast/"></head></html>`
    expect(discoverFeeds(html, 'https://www.radio-example.org/')[0]).toBe('https://www.radio-example.org/feed/podcast/')
    const feed = parseFeed(FEED, 'https://www.radio-example.org/feed/podcast/')
    expect(feed).toMatchObject({ title: 'Example Radio', website: 'https://www.radio-example.org/', description: 'Talk & music', listed: 3, unplayable: 1 })
    expect(feed.episodes[0]).toMatchObject({ title: 'Episode 2: Ancient Rome', durationSec: 3723, published: '2026-09-01', media: 'https://cdn.radio-example.org/ep2.mp3' })
    expect(feed.episodes[1]).toMatchObject({ title: 'Episode 1', durationSec: 1000, estimated: true })
  })

  it('goes website → feed → episodes through the keyless reader, keeping the canonical feed', async () => {
    const read = (async (url: string | URL) => {
      const at = String(url)
      if (at === 'https://www.radio-example.org/') return page('<link rel="alternate" type="application/rss+xml" title="Podcast" href="/feed/podcast/">')
      if (at === 'https://www.radio-example.org/feed/podcast/') return page(FEED, 200, 'application/rss+xml')
      return page('', 200, 'audio/mpeg')
    }) as typeof fetch
    const found = await resolveFeed('https://www.radio-example.org/', read)
    expect(found.feedUrl).toBe('https://www.radio-example.org/feed/podcast/')
    expect(found.episodes).toHaveLength(2)
  })

  it('reports a site with no feed, a paywall and a private address honestly, never as success', async () => {
    await expect(resolveFeed('https://www.example.com/', (async () => page('<html>No feeds here</html>')) as typeof fetch)).rejects.toThrow(/has no public feed or episode archive TVN can play/)
    await expect(resolveFeed('https://members.example.com/', (async () => page('', 401)) as typeof fetch)).rejects.toThrow(/sign-in or subscription/)
    const paywalled = (async (url: string | URL, init?: RequestInit) => (init?.method === 'HEAD' ? page('', 402) : String(url).endsWith('/feed') ? page(FEED, 200, 'application/rss+xml') : page(''))) as typeof fetch
    await expect(resolveFeed('https://www.radio-example.org/feed', paywalled)).rejects.toThrow(/sign-in or subscription/)
    await expect(resolveFeed('http://192.168.1.10/feed', (async () => page(FEED)) as typeof fetch)).rejects.toBeInstanceOf(FeedError)
  })
})


describe('a publisher whose free archive is the first segment of each interview', () => {
  const ITEM = (title: string, file: string, about = '') =>
    `<item><title>${title}</title><description>${about}</description><enclosure url="https://media.veritas-example.org/${file}.mp3" type="audio/mpeg"/><guid isPermaLink="false">https://media.veritas-example.org/${file}.mp3</guid><pubDate>Thu, 03 Sep 2026 19:01:00 -0700</pubDate><itunes:image href="https://www.veritas-example.org/images/${file}.jpg"/></item>`
  const SPLIT = `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>VERITAS</title><link>https://www.veritas-example.org</link><description>Interviews</description>
${ITEM('Jane Guest | The Big Question | Part 1 of 2', 'vs-1', 'First line.&lt;br /&gt;Second line.')}
${ITEM('Jane Guest | The Big Question | Part 2 of 2', 'vs-2')}
${ITEM('Members Only: the full interview', 'vs-3')}
${ITEM('Old Guest | Earlier Days | Part 1 of 2', 'vs-4')}
</channel></rss>`

  it('finds the public feed through the podcast directory and keeps only the free first parts, with their metadata', async () => {
    const read = (async (url: string | URL) => {
      const at = String(url)
      if (at === 'https://www.veritas-example.org/') return page('<html><head><meta property="og:site_name" content="VERITAS"><title>VERITAS</title></head></html>')
      if (at.startsWith('https://itunes.apple.com/search')) return page(JSON.stringify({ results: [{ feedUrl: 'https://www.veritas-example.org/vs.rss' }] }), 200, 'application/json')
      if (at === 'https://www.veritas-example.org/vs.rss') return page(SPLIT, 200, 'application/rss+xml')
      return page('', 200, 'audio/mpeg')
    }) as typeof fetch
    const found = await resolveFeed('https://www.veritas-example.org/', read, { wide: true })
    expect(found).toMatchObject({ feedUrl: 'https://www.veritas-example.org/vs.rss', via: 'directory', listed: 4, excluded: { members: 2, unsupported: 0 } })
    expect(found.episodes.map((episode) => episode.title)).toEqual(['Jane Guest | The Big Question | Part 1 of 2', 'Old Guest | Earlier Days | Part 1 of 2'])
    expect(found.episodes[0]).toMatchObject({
      durationSec: 0,
      published: '2026-09-03',
      media: 'https://media.veritas-example.org/vs-1.mp3',
      image: 'https://www.veritas-example.org/images/vs-1.jpg',
      summary: 'First line. Second line.',
    })
  })
})

describe('a bare @handle', () => {
  it('is read as a YouTube handle for the keyless resolver to confirm', () => {
    expect(parseChannelInput('@daftpunk')).toEqual({ kind: 'handle', handle: 'daftpunk' })
    expect(parseChannelInput('youtube.com/@daftpunk')).toEqual({ kind: 'handle', handle: 'daftpunk' })
  })
})
