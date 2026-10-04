import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  seedFromPage,
  videosFromPlaylistPage,
  watchPageCreator,
  watchPageDate,
  watchPageDates,
  WATCH_DATE_BUDGET_MS,
  WATCH_DATE_LIMIT,
} from './youtube-channel.ts'

const TOM = 'UCBa659QWEk1AI4Tg--mrJ2A'
const read = (path: string) => readFileSync(path, 'utf8')

describe('the scan carries the creator a listing links, and an upload day from each video\'s own page', () => {
  const lockup = (id: string, name: string, endpoint: Record<string, string>) => ({
    lockupViewModel: {
      contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
      contentId: id,
      contentImage: { thumbnailBadgeViewModel: { text: '12:00' } },
      metadata: {
        lockupMetadataViewModel: {
          title: { content: `Video ${id}` },
          metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: name, commandRuns: [{ onTap: { innertubeCommand: { browseEndpoint: endpoint } } }] } }] }] } },
        },
      },
    },
  })

  it('a listing entry gives its uploader\'s name, channel id and handle from the link itself', () => {
    const videos = videosFromPlaylistPage({
      items: [
        lockup('YrZyJuaBfKA', 'Tom Scott', { browseId: TOM, canonicalBaseUrl: '/@TomScottGo' }),
        lockup('omYfLDlt-MA', 'Old Style', { browseId: TOM, canonicalBaseUrl: '/c/OldStyle' }),
        lockup('Pwn8IrDeiwc', 'Not a channel', { browseId: 'VLPL123' }),
      ],
    })
    expect(videos.map((video) => video.creator)).toEqual([{ name: 'Tom Scott', channelId: TOM, handle: 'TomScottGo' }, { name: 'Old Style', channelId: TOM }, undefined])
  })

  it('a watch page gives its upload day and its owner, the handle only from the owner\'s profile address', () => {
    const html = `<meta itemprop="datePublished" content="2026-06-15T08:00:13-07:00">"ownerChannelName":"Tom Scott","externalChannelId":"${TOM}","ownerProfileUrl":"http://www.youtube.com/@TomScottGo"`
    expect(watchPageDate(html)).toBe('2026-06-15')
    expect(watchPageDate('"publishDate":"2024-07-18T00:00:00-07:00"')).toBe('2024-07-18')
    expect(watchPageDate('<html>nothing</html>')).toBeNull()
    expect(watchPageCreator(html)).toEqual({ name: 'Tom Scott', channelId: TOM, handle: 'TomScottGo' })
    expect(watchPageCreator(`"ownerChannelName":"Tom Scott","externalChannelId":"${TOM}"`)).toEqual({ name: 'Tom Scott', channelId: TOM })
    const seed = seedFromPage(`"videoDetails":{"videoId":"YrZyJuaBfKA","title":"T","lengthSeconds":"300"} ${html}`, 'YrZyJuaBfKA')
    expect(seed?.creator?.handle).toBe('TomScottGo')
  })

  it('reads only the undated videos, stops each page at its date, keeps what it learnt, and leaves an unknown day unknown', async () => {
    const asked: string[] = []
    let streamed = 0
    const read = (async (url: string) => {
      const id = new URL(url).searchParams.get('v')!
      asked.push(id)
      if (id === 'NxZOBBenmZM') return new Response('<html>no date here</html>')
      const head = new TextEncoder().encode(`${'x'.repeat(5000)}<meta itemprop="uploadDate" content="2025-0${asked.length}-01T00:00:00-07:00">`)
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          streamed += 1
          if (streamed > 50) controller.close()
          else controller.enqueue(head)
        },
      })
      return new Response(body)
    }) as typeof fetch
    const videos = [
      { id: 'YrZyJuaBfKA', title: 'a', durationSec: 600, published: '2026-06-15' },
      { id: 'omYfLDlt-MA', title: 'b', durationSec: 600 },
      { id: 'NxZOBBenmZM', title: 'c', durationSec: 600 },
    ]
    const days = await watchPageDates(videos, read)
    expect(asked.sort()).toEqual(['NxZOBBenmZM', 'omYfLDlt-MA'])
    expect(days.get('omYfLDlt-MA')).toMatch(/^2025-0\d-01$/)
    expect(days.has('NxZOBBenmZM')).toBe(false)
    expect(streamed).toBeLessThan(5)
    asked.length = 0
    const again = await watchPageDates(videos, read)
    expect(again.get('omYfLDlt-MA')).toBe(days.get('omYfLDlt-MA'))
    expect(asked).toEqual(['NxZOBBenmZM'])
  })

  it('stays inside its budget and its limit, so an answer is never held up', async () => {
    expect(WATCH_DATE_LIMIT).toBeLessThanOrEqual(120)
    expect(WATCH_DATE_BUDGET_MS).toBeLessThanOrEqual(4000)
    let clock = 0
    const read = (async () => {
      clock += WATCH_DATE_BUDGET_MS
      return new Response('<html></html>')
    }) as unknown as typeof fetch
    const many = Array.from({ length: 50 }, (_, index) => ({ id: `id${String(index).padStart(9, '0')}`, title: 't', durationSec: 600 }))
    await watchPageDates(many, read, () => clock)
    expect(clock).toBeLessThanOrEqual(WATCH_DATE_BUDGET_MS * 8)
  })

  it('the first read, playlists and every LOAD MORE batch are all dated this way', () => {
    const server = read('server/youtube-channel.ts')
    expect(server.match(/await watchPageDates\(/g)?.length).toBe(3)
    expect(server).toContain('videos: withDates(videos, await watchPageDates(videos, read)),')
  })
})
