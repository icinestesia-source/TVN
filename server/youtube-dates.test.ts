import { describe, expect, it } from 'vitest'
import { dayOf } from './web-read.ts'
import { feedDates, resolveChannel } from './youtube-channel.ts'

describe('upload dates read without a key', () => {
  it('RSS dates keep the publisher’s calendar day, with no UTC shift', () => {
    expect(dayOf('Tue, 03 Sep 2024 19:01:00 -0700')).toBe('2024-09-03')
    expect(dayOf('2024-09-03T23:30:00-07:00')).toBe('2024-09-03')
    expect(dayOf('nonsense')).toBeUndefined()
  })

  it('the YouTube feed dates a whole source in one request, never one per video', async () => {
    const xml = `<feed><published>2010-01-01T00:00:00+00:00</published>
      <entry><yt:videoId>aaaaaaaaaa1</yt:videoId><published>2026-09-03T18:00:00+00:00</published></entry>
      <entry><yt:videoId>aaaaaaaaaa4</yt:videoId><published>2019-05-03T01:00:00+00:00</published></entry></feed>`
    expect([...feedDates(xml)]).toEqual([['aaaaaaaaaa1', '2026-09-03'], ['aaaaaaaaaa4', '2019-05-03']])
    const lockup = (id: string, title: string, badge: string) => ({
      lockupViewModel: {
        contentId: id,
        contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
        contentImage: { thumbnailViewModel: { overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: badge } }] } }] } },
        metadata: { lockupMetadataViewModel: { title: { content: title } } },
      },
    })
    const page = `<script>var ytInitialData = ${JSON.stringify({ contents: [lockup('aaaaaaaaaa1', 'New', '12:00'), lockup('aaaaaaaaaa4', 'Old', '20:00'), lockup('aaaaaaaaaa7', 'Older', '20:00')] })};</script>`
    const urls: string[] = []
    const fake = (async (input: string | URL | Request) => {
      const url = String(input)
      urls.push(url)
      if (url.startsWith('https://www.youtube.com/playlist?list=')) return new Response(page)
      if (url.startsWith('https://www.youtube.com/feeds/videos.xml?channel_id=UC')) return new Response(xml)
      return new Response('{}')
    }) as typeof fetch
    const channel = await resolveChannel(`https://www.youtube.com/channel/${'UC'+'0'.repeat(21)+'1'}`, fake)
    expect(channel.videos.map((video) => [video.id, video.published])).toEqual([['aaaaaaaaaa1', '2026-09-03'], ['aaaaaaaaaa4', '2019-05-03'], ['aaaaaaaaaa7', undefined]])
    expect(urls.filter((url) => url.includes('/feeds/'))).toHaveLength(1)
  })

})
