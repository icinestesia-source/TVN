import { describe, expect, it } from 'vitest'
import { decodeCursor, encodeCursor, handleChannelRequest, listedCountFrom } from './youtube-channel.ts'

describe('the server batch reader', () => {
  it('reads the total a playlist header lists', () => {
    expect(listedCountFrom({ header: { playlistHeaderRenderer: { numVideosText: { runs: [{ text: '1,759' }, { text: ' videos' }] } } } })).toBe(1759)
    expect(listedCountFrom({})).toBeNull()
  })

  it('round-trips its own cursors and refuses anything else', async () => {
    const cursor = { list: 'UUBa659QWEk1AI4Tg--mrJ2A', version: '2.20260101.00.00', token: 'abc', skip: 40 }
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
    expect(decodeCursor('not-a-cursor')).toBeNull()
    expect(decodeCursor(Buffer.from(JSON.stringify(['RDmix', '1', null, 0])).toString('base64url'))).toBeNull()
    const refused = await handleChannelRequest(new URL('http://x/api/channel?cursor=junk'), async () => new Response(''))
    expect(refused.status).toBe(400)
  })
})


describe('reading a list batch by batch', () => {
  const ids = Array.from({ length: 250 }, (_, index) => `vid${String(index).padStart(8, '0')}`)
  const items = (from: number, to: number) => ids.slice(from, to).map((videoId, index) => ({ playlistVideoRenderer: { videoId, title: { simpleText: `Video ${from + index}` }, lengthSeconds: '600' } }))
  const html = (data: unknown) => `<script>var ytInitialData = ${JSON.stringify(data)};</script><script>"INNERTUBE_CLIENT_VERSION":"2.20260101.00.00"</script>`
  const read = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/oembed')) return new Response('{}')
    if (url.includes('/feeds/')) return new Response('', { status: 404 })
    if (url.includes('/youtubei/v1/browse')) {
      const token = (JSON.parse(String(init?.body)) as { continuation: string }).continuation
      const from = Number(token.slice(1))
      return Response.json({ items: items(from, from + 100), ...(from + 100 < ids.length ? { next: { continuationCommand: { token: `t${from + 100}` } } } : {}) })
    }
    if (url.includes('/playlist?list=')) {
      return new Response(html({ header: { playlistHeaderRenderer: { numVideosText: { runs: [{ text: '250' }, { text: ' videos' }] } } }, items: items(0, 100), next: { continuationCommand: { token: 't100' } } }))
    }
    return new Response('', { status: 404 })
  }) as typeof fetch

  it('reads the first 60, then every later video exactly once, to the end', async () => {
    const { resolveChannel, resolveBatch } = await import('./youtube-channel.ts')
    const first = await resolveChannel('https://www.youtube.com/playlist?list=PLabcdefghijklmnop', read)
    expect(first.videos).toHaveLength(60)
    expect(first.listed).toBe(250)
    const seen = first.videos.map((video) => video.id)
    let next = first.next
    while (next) {
      const batch = await resolveBatch(next, read)
      seen.push(...batch.videos.map((video) => video.id))
      next = batch.next
    }
    expect(seen).toEqual(ids)
  })
})
