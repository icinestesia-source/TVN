import { describe, expect, it } from 'vitest'
import { episodeLinks, nextArchivePage, readEpisodePage } from './media-archive.ts'
import { id3Length, measureMedia, mp3Seconds, mvhdSeconds } from './media-probe.ts'
import { handleFeedRequest, measureFiles, resolveFeed } from './podcast-feed.ts'

// ——— Synthetic media: real headers, nothing else ———

/** An MPEG-1 layer III file at 128 kbit/s, 44.1 kHz: an ID3 tag, then frames; `xingFrames` adds an Info header. */
function mp3File(options: { tagBytes?: number; frames?: number; xingFrames?: number }): Uint8Array {
  const tag = options.tagBytes ?? 0
  const frame = 417
  const count = options.frames ?? 4
  const bytes = new Uint8Array((tag ? tag + 10 : 0) + frame * count)
  if (tag) {
    bytes.set([0x49, 0x44, 0x33, 3, 0, 0, (tag >> 21) & 0x7f, (tag >> 14) & 0x7f, (tag >> 7) & 0x7f, tag & 0x7f])
  }
  const start = tag ? tag + 10 : 0
  for (let index = 0; index < count; index += 1) bytes.set([0xff, 0xfb, 0x90, 0x00], start + index * frame)
  if (options.xingFrames) {
    const at = start + 4 + 32
    bytes.set([...'Info'].map((char) => char.charCodeAt(0)), at)
    bytes.set([0, 0, 0, 1], at + 4)
    const n = options.xingFrames
    bytes.set([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255], at + 8)
  }
  return bytes
}

const box = (type: string, body: Uint8Array): Uint8Array => {
  const out = new Uint8Array(8 + body.length)
  const size = out.length
  out.set([(size >>> 24) & 255, (size >>> 16) & 255, (size >>> 8) & 255, size & 255])
  out.set([...type].map((char) => char.charCodeAt(0)), 4)
  out.set(body, 8)
  return out
}

/** An MP4 whose movie header sits after a large mdat, as a file not prepared for streaming has it. */
function mp4File(seconds: number, scale = 1000): Uint8Array {
  const mvhd = new Uint8Array(100)
  const duration = seconds * scale
  mvhd.set([(scale >>> 24) & 255, (scale >>> 16) & 255, (scale >>> 8) & 255, scale & 255], 12)
  mvhd.set([(duration >>> 24) & 255, (duration >>> 16) & 255, (duration >>> 8) & 255, duration & 255], 16)
  const parts = [box('ftyp', new Uint8Array(8)), box('mdat', new Uint8Array(90_000)), box('moov', box('mvhd', mvhd))]
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

// ——— A small web: pages, feeds, files, and a log of every address TVN asked for ———

type Answer = string | Uint8Array | { status: number; body?: string; location?: string; type?: string }

function web(routes: Record<string, Answer>) {
  const asked: string[] = []
  const read = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    asked.push(url)
    const answer = routes[url] ?? (url.startsWith('https://itunes.apple.com/') ? JSON.stringify({ results: [] }) : { status: 404 })
    if (answer instanceof Uint8Array) {
      const range = new Headers(init?.headers).get('range')?.match(/bytes=(\d+)-(\d+)/)
      if (init?.method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-length': String(answer.length) } })
      if (!range) return new Response(answer.slice(), { status: 200, headers: { 'content-length': String(answer.length) } })
      const from = Number(range[1])
      const to = Math.min(Number(range[2]), answer.length - 1)
      return new Response(answer.slice(from, to + 1), { status: 206, headers: { 'content-range': `bytes ${from}-${to}/${answer.length}` } })
    }
    if (typeof answer === 'string') {
      const type = answer.trimStart().startsWith('<?xml') || answer.trimStart().startsWith('<rss') ? 'application/rss+xml' : answer.trimStart().startsWith('{') ? 'application/json' : 'text/html'
      const response = new Response(answer, { status: 200, headers: { 'content-type': type } })
      Object.defineProperty(response, 'url', { value: url })
      return response
    }
    if (answer.location) {
      const target = routes[answer.location]
      const response = new Response(typeof target === 'string' ? target : '', { status: 200, headers: { 'content-type': 'text/html' } })
      Object.defineProperty(response, 'url', { value: answer.location })
      return response
    }
    return new Response(answer.body ?? '', { status: answer.status, headers: { 'content-type': answer.type ?? 'text/html' } })
  }) as typeof fetch
  return { read, asked }
}

const SITE = 'https://shows.example.org'
const page = (title: string, body: string, head = '') => `<html><head><title>${title} - Example Shows</title><meta property="og:site_name" content="Example Shows">${head}</head><body><header><nav><a href="${SITE}/about/">About</a><a href="${SITE}/2026/01/01/nav-link-episode/">Nav</a></nav></header><main>${body}</main><footer><a href="${SITE}/privacy-policy/">Privacy</a><a href="https://elsewhere.example.com/2026/01/01/other-show/">Elsewhere</a></footer></body></html>`
const jsonLdEpisode = (fields: Record<string, unknown>) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'PodcastEpisode', ...fields })}</script>`

describe('A. an RSS podcast, including one that states no lengths', () => {
  const FEED = `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Interviews</title><link>${SITE}/</link>
<item><title>Guest One | Part 1 of 2</title><guid>g1</guid><pubDate>Thu, 03 Sep 2026 19:01:00 -0700</pubDate><enclosure url="https://cdn.example.net/one.mp3" type="audio/mpeg"/><itunes:image href="${SITE}/one.jpg"/></item>
<item><title>Guest Two</title><guid>g2</guid><itunes:duration>45:00</itunes:duration><enclosure url="https://cdn.example.net/two.mp3" type="audio/mpeg"/></item>
</channel></rss>`

  it('keeps an episode with no stated length for measuring, and measures it from the file header', async () => {
    const one = mp3File({ tagBytes: 20_000, xingFrames: 138_000 })
    const { read } = web({ [`${SITE}/feed.rss`]: FEED, 'https://cdn.example.net/one.mp3': one, 'https://cdn.example.net/two.mp3': mp3File({}) })
    const found = await resolveFeed(`${SITE}/feed.rss`, read)
    expect(found).toMatchObject({ shape: 'feed', via: 'address', title: 'Interviews' })
    expect(found.episodes.map((episode) => [episode.title, episode.durationSec])).toEqual([['Guest One | Part 1 of 2', 0], ['Guest Two', 2700]])
    expect(found.episodes[0]).toMatchObject({ published: '2026-09-04', image: `${SITE}/one.jpg`, media: 'https://cdn.example.net/one.mp3' })
    expect(await measureFiles([{ url: 'https://cdn.example.net/one.mp3', type: 'audio/mpeg' }], read)).toEqual({ 'https://cdn.example.net/one.mp3': Math.round((138_000 * 1152) / 44100) })
  })

  it("finds a site's unannounced feed in the public podcast directory, only on the publisher's own domain", async () => {
    const home = page('Example Shows', '<p>Interviews since 2008</p>')
    const directory = JSON.stringify({ results: [{ feedUrl: 'https://impostor.example.com/feed.rss' }, { feedUrl: `${SITE}/feed.rss` }] })
    const { read, asked } = web({ [`${SITE}/`]: home, [`${SITE}/feed.rss`]: FEED, 'https://itunes.apple.com/search?media=podcast&entity=podcast&limit=25&term=Example%20Shows': directory, 'https://cdn.example.net/one.mp3': mp3File({}) })
    const found = await resolveFeed(`${SITE}/`, read)
    expect(found).toMatchObject({ shape: 'feed', via: 'directory', feedUrl: `${SITE}/feed.rss` })
    expect(asked).not.toContain('https://impostor.example.com/feed.rss')
  })

  it('measures constant-bitrate MP3s, VBR (Info) MP3s and MP4s whose movie header sits after the media', async () => {
    const cbr = mp3File({ frames: 8 })
    expect(id3Length(mp3File({ tagBytes: 300 }))).toBe(310)
    expect(mp3Seconds(cbr, 16_000 * 600)).toBe(600)
    const { read } = web({ 'https://cdn.example.net/talk.mp4': mp4File(3601) })
    expect(await measureMedia('https://cdn.example.net/talk.mp4', 'video/mp4', read)).toEqual({ seconds: 3601 })
    const v1 = new Uint8Array(40)
    v1[0] = 1
    v1.set([0, 0, 0x03, 0xe8], 20)
    v1.set([0, 0, 0, 0, 0, 0x36, 0xee, 0x80], 24)
    expect(mvhdSeconds(v1, 0)).toBe(3600)
  })
})

describe('B. archive page → episode pages → direct MP3', () => {
  const archive = page('Episodes', `<article><h2><a href="${SITE}/episodes/first-guest/">First Guest</a></h2></article><article><h2><a href="${SITE}/episodes/second-guest/">Second Guest</a></h2></article><a href="${SITE}/category/interviews/">Interviews</a><a href="${SITE}/tag/history/">History</a>`)
  const first = page('First Guest', '<h1>First Guest</h1><audio controls src="https://cdn.example.net/first.mp3"></audio>', jsonLdEpisode({ name: 'First Guest on Memory', datePublished: '2026-08-01T00:00:00-07:00', image: { url: `${SITE}/first.jpg` }, description: 'A conversation.' }))
  const second = page('Second Guest', '<h1>Second Guest</h1>', jsonLdEpisode({ name: 'Second Guest', associatedMedia: { '@type': 'AudioObject', contentUrl: 'https://cdn.example.net/second.m4a' } }) + '<meta property="article:published_time" content="2026-07-01T10:00:00Z">')

  it('reads each episode page for its public file and its own metadata, preferring structured data', async () => {
    const { read } = web({ [`${SITE}/episodes/`]: archive, [`${SITE}/episodes/first-guest/`]: first, [`${SITE}/episodes/second-guest/`]: second })
    const found = await resolveFeed(`${SITE}/episodes/`, read)
    expect(found).toMatchObject({ shape: 'archive', via: 'archive', title: 'Episodes', feedUrl: `${SITE}/episodes/`, pages: 1 })
    expect(found.episodes).toEqual([
      expect.objectContaining({ title: 'First Guest on Memory', published: '2026-08-01', media: 'https://cdn.example.net/first.mp3', type: 'audio/mpeg', image: `${SITE}/first.jpg`, page: `${SITE}/episodes/first-guest/`, durationSec: 0 }),
      expect.objectContaining({ title: 'Second Guest', published: '2026-07-01', media: 'https://cdn.example.net/second.m4a', type: 'audio/mp4' }),
    ])
  })

  it('uses a sane length the page states, and ignores an absurd one', () => {
    expect(readEpisodePage(jsonLdEpisode({ name: 'x', duration: 'PT1H2M3S' }), SITE).statedSec).toBe(3723)
    expect(readEpisodePage(jsonLdEpisode({ name: 'x', duration: 'PT23H05M21S' }), SITE).statedSec).toBeUndefined()
  })
})

describe('C. archive page → episode pages → YouTube and BitChute players', () => {
  it('a YouTube player becomes a YouTube programme; a BitChute player resolves to its public MP4', async () => {
    const archive = page('Podcast', `<a href="${SITE}/2026/09/28/karma/">Karma</a><a href="${SITE}/2026/09/21/wiggle/">Wiggle</a><a href="${SITE}/2026/09/14/elsewhere-player/">Elsewhere</a>`)
    const karma = page('Karma', '<h1>“Reverse Karma” w/ Guest</h1><iframe src="https://www.youtube.com/embed/abcdefghijk?rel=0"></iframe>')
    const wiggle = page('Wiggle', '<h1>Full Wiggle</h1><iframe allowfullscreen src="https://www.bitchute.com/embed/VQrZSwN4vRiO"></iframe>')
    const elsewhere = page('Elsewhere', '<h1>Elsewhere</h1><iframe src="https://player.unknown.example/embed/123"></iframe>')
    const { read } = web({
      [`${SITE}/podcast/`]: archive,
      [`${SITE}/2026/09/28/karma/`]: karma,
      [`${SITE}/2026/09/21/wiggle/`]: wiggle,
      [`${SITE}/2026/09/14/elsewhere-player/`]: elsewhere,
      'https://www.youtube.com/watch?v=abcdefghijk&hl=en': '<script>var p = {"playableInEmbed":true,"lengthSeconds":"3725"}</script>',
      'https://www.bitchute.com/embed/VQrZSwN4vRiO/': `<video id="player_one"><source src="https://seed1.bitchute.com/x/VQrZSwN4vRiO.mp4" type="video/mp4"></video>`,
    })
    const found = await resolveFeed(`${SITE}/podcast/`, read)
    expect(found.episodes).toEqual([
      expect.objectContaining({ id: 'abcdefghijk', youtube: 'abcdefghijk', type: 'youtube', durationSec: 3725, title: '“Reverse Karma” w/ Guest' }),
      expect.objectContaining({ media: 'https://seed1.bitchute.com/x/VQrZSwN4vRiO.mp4', type: 'video/mp4', title: 'Full Wiggle' }),
    ])
    expect(found.excluded).toEqual({ members: 0, unsupported: 1 })
  })
})

describe('D. a paginated archive, read a slice at a time', () => {
  const list = (n: number, next: string | null) =>
    page(`Archive ${n}`, `${[1, 2, 3].map((i) => `<a href="${SITE}/show/ep-${n}-${i}/">Episode ${n}.${i}</a>`).join('')}${next ? `<a class="next page-numbers" href="${next}">Next</a>` : ''}`)
  const routes: Record<string, Answer> = {
    [`${SITE}/show/`]: list(1, `${SITE}/show/page/2/`),
    [`${SITE}/show/page/2/`]: list(2, `${SITE}/show/page/3/`),
    [`${SITE}/show/page/3/`]: list(3, null),
  }
  for (const n of [1, 2, 3]) for (const i of [1, 2, 3]) routes[`${SITE}/show/ep-${n}-${i}/`] = page(`Episode ${n}.${i}`, `<h1>Episode ${n}.${i}</h1><audio src="https://cdn.example.net/${n}-${i}.mp3"></audio>`)

  it('follows /page/N/ links to the end of the archive', async () => {
    expect(nextArchivePage(routes[`${SITE}/show/`] as string, `${SITE}/show/`)).toBe(`${SITE}/show/page/2/`)
    expect(nextArchivePage(page('x', `<a href="${SITE}/list?page=3">3</a><a href="${SITE}/list?page=2">2</a>`), `${SITE}/list`)).toBe(`${SITE}/list?page=2`)
    const found = await resolveFeed(`${SITE}/show/`, web(routes).read)
    expect(found.episodes.map((episode) => episode.title)).toEqual(['Episode 1.1', 'Episode 1.2', 'Episode 1.3', 'Episode 2.1', 'Episode 2.2', 'Episode 2.3', 'Episode 3.1', 'Episode 3.2', 'Episode 3.3'])
    expect(found.pages).toBe(3)
    expect(found.next).toBeUndefined()
  })

  it('stops at its time budget with a cursor, and carries on from exactly there', async () => {
    let now = 0
    const clock = () => now
    const { read } = web(routes)
    const slow = (async (input: string | URL, init?: RequestInit) => {
      now += 1000
      return read(input, init)
    }) as typeof fetch
    const first = await resolveFeed(`${SITE}/show/`, slow, { clock })
    expect(first.next).toBeTypeOf('string')
    const titles = first.episodes.map((episode) => episode.title)
    let cursor = first.next
    for (let call = 0; cursor && call < 20; call += 1) {
      const more = await resolveFeed(`${SITE}/show/`, slow, { clock, cursor })
      titles.push(...more.episodes.map((episode) => episode.title))
      cursor = more.next
    }
    expect(titles).toEqual(['Episode 1.1', 'Episode 1.2', 'Episode 1.3', 'Episode 2.1', 'Episode 2.2', 'Episode 2.3', 'Episode 3.1', 'Episode 3.2', 'Episode 3.3'])
    await expect(resolveFeed('https://other.example.com/', slow, { clock, cursor: first.next })).rejects.toThrow(/another site/)
  })
})

describe('E. members-only and paywalled media is never offered', () => {
  it('a 403 episode page, a redirect to sign-in, a members-only link, a hidden address and a 401 file are all left out', async () => {
    const archive = page('Archive', `<a href="${SITE}/ep/open/">Open</a><a href="${SITE}/ep/locked/">Locked</a><a href="${SITE}/ep/redirected/">Redirected</a><a href="${SITE}/ep/vip/">Members only: the full interview</a><a href="${SITE}/ep/hidden/">Hidden</a>`)
    const open = page('Open', `<h1>Open</h1><audio src="https://cdn.example.net/open.mp3"></audio><a href="https://cdn.example.net/full-members.mp3"><i class="lock"></i> Members only</a>`)
    const hidden = page('Hidden', `<h1>Hidden</h1><audio id="player"></audio><audio><source src="https://sampler.example.net/play.php?song=Theme" type="audio/mpeg"></audio><script>player.src = atob("aHR0cHM6Ly9jZG4uZXhhbXBsZS5uZXQvaGlkZGVuLm1wMw==")</script>`)
    const { read, asked } = web({
      [`${SITE}/archive/`]: archive,
      [`${SITE}/ep/open/`]: open,
      [`${SITE}/ep/locked/`]: { status: 403 },
      [`${SITE}/ep/redirected/`]: { status: 302, location: `${SITE}/login/` },
      [`${SITE}/login/`]: page('Sign in', '<form>Password</form>'),
      [`${SITE}/ep/hidden/`]: hidden,
      'https://cdn.example.net/locked.mp3': { status: 401 },
    })
    const found = await resolveFeed(`${SITE}/archive/`, read)
    expect(found.episodes.map((episode) => episode.media)).toEqual(['https://cdn.example.net/open.mp3'])
    expect(found.excluded).toEqual({ members: 2, unsupported: 1 })
    expect(asked).not.toContain(`${SITE}/ep/vip/`)
    expect(asked).not.toContain('https://cdn.example.net/hidden.mp3')
    expect(await measureFiles([{ url: 'https://cdn.example.net/locked.mp3', type: 'audio/mpeg' }], read)).toEqual({ 'https://cdn.example.net/locked.mp3': -1 })
  })
})

describe('F. unrelated links are never followed', () => {
  it('navigation, footer, category and tag pages, login pages and other sites stay unread', () => {
    const html = page('Archive', `<a href="${SITE}/2026/02/02/real-episode/">Real</a><a href="${SITE}/category/talks/">Talks</a><a href="${SITE}/tag/x/">x</a><a href="${SITE}/login/">Log in</a><a href="${SITE}/subscribe/">Subscribe</a><a href="https://elsewhere.example.com/2026/02/02/theirs/">Theirs</a><a href="${SITE}/wp-content/uploads/a.jpg">img</a><a href="#top">Top</a><a href="mailto:a@b.c">Mail</a>`)
    expect(episodeLinks(html, `${SITE}/archive/`)).toEqual([`${SITE}/2026/02/02/real-episode/`])
  })
})

describe('G. duplicate episodes are kept once', () => {
  it('the same page linked twice, and the same file on two pages, give one programme', async () => {
    const archive = page('Archive', `<a href="${SITE}/ep/a/">A</a><a href="${SITE}/ep/a/#comments">A again</a><a href="${SITE}/ep/b/">B</a>`)
    const same = (title: string) => page(title, `<h1>${title}</h1><audio src="https://cdn.example.net/same.mp3"></audio>`)
    const { read, asked } = web({ [`${SITE}/archive/`]: archive, [`${SITE}/ep/a/`]: same('A'), [`${SITE}/ep/b/`]: same('B (repost)') })
    const found = await resolveFeed(`${SITE}/archive/`, read)
    expect(found.episodes).toHaveLength(1)
    expect(asked.filter((url) => url === `${SITE}/ep/a/`)).toHaveLength(1)
  })
})

describe('the measuring request', () => {
  it('takes a bounded batch of files and answers with their lengths; too many is refused', async () => {
    const { read } = web({ 'https://cdn.example.net/talk.mp4': mp4File(1800) })
    const ok = await handleFeedRequest(new URL(`http://localhost/api/feed?measure=${encodeURIComponent('https://cdn.example.net/talk.mp4')}&type=video%2Fmp4`), read)
    expect(ok).toEqual({ status: 200, body: { durations: { 'https://cdn.example.net/talk.mp4': 1800 } } })
    const many = new URLSearchParams(Array.from({ length: 30 }, (_, index): [string, string] => ['measure', `https://cdn.example.net/${index}.mp3`]))
    expect((await handleFeedRequest(new URL(`http://localhost/api/feed?${many}`), read)).status).toBe(400)
    expect(await measureFiles([{ url: 'http://192.168.1.2/a.mp3', type: 'audio/mpeg' }], read)).toEqual({ 'http://192.168.1.2/a.mp3': 0 })
  })
})

describe('H. a long feed read for longer than one call allows carries on where it stopped', () => {
  const total = 30
  const item = (index: number) =>
    `<item><title>Épisode ${index} — Café ☕</title><guid>ep-${index}</guid><enclosure url="https://cdn.example.org/ep-${index}.mp3" type="audio/mpeg" length="1"/><itunes:duration>45:00</itunes:duration></item>\n`
  const feed = new TextEncoder().encode(`\uFEFF<?xml version="1.0"?><rss><channel><title>Long Show</title>\n${Array.from({ length: total }, (_, index) => item(index)).join('')}</channel></rss>`)
  /** Sends the feed a few hundred bytes at a time, slowly, from any byte a range asks for. */
  const slow = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'HEAD' || url.endsWith('.mp3')) return new Response(null, { status: 200 })
    const from = Number(new Headers(init?.headers).get('range')?.match(/bytes=(\d+)-/)?.[1] ?? 0)
    const bytes = feed.slice(from)
    let at = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, 15))
        if (at >= bytes.length) return controller.close()
        controller.enqueue(bytes.slice(at, at + 700))
        at += 700
      },
    })
    const response = new Response(body, { status: from ? 206 : 200, headers: { 'content-type': 'application/rss+xml' } })
    Object.defineProperty(response, 'url', { value: url })
    return response
  }) as typeof fetch

  it('every episode arrives once, intact, over several calls', async () => {
    const clock = () => Date.now() - 4960
    const ids = new Set<string>()
    const titles: string[] = []
    let cursor: string | null = null
    let calls = 0
    let listed = 0
    do {
      const result = await resolveFeed('https://shows.example.org/feed.xml', slow, { wide: true, cursor, clock })
      calls += 1
      listed += result.listed
      for (const episode of result.episodes) {
        expect(ids.has(episode.id)).toBe(false)
        ids.add(episode.id)
        titles.push(episode.title)
      }
      cursor = result.next ?? null
    } while (cursor && calls < 40)
    expect(calls).toBeGreaterThan(1)
    expect(ids.size).toBe(total)
    expect(listed).toBe(total)
    expect(titles).toContain('Épisode 29 — Café ☕')
    expect(titles.every((title) => /^Épisode \d+ — Café ☕$/.test(title))).toBe(true)
  })

  it('a cursor for another site, or one past what TVN keeps, is refused', async () => {
    const other = Buffer.from(JSON.stringify({ u: 'https://elsewhere.example.net/feed.xml', k: 0, n: 10, f: 1 })).toString('base64url')
    await expect(resolveFeed('https://shows.example.org/feed.xml', slow, { cursor: other })).rejects.toMatchObject({ status: 400 })
    const past = Buffer.from(JSON.stringify({ u: 'https://shows.example.org/feed.xml', k: 60, n: 10, f: 1 })).toString('base64url')
    await expect(resolveFeed('https://shows.example.org/feed.xml', slow, { cursor: past })).rejects.toMatchObject({ status: 400 })
  })
})
