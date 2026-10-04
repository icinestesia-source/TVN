import { describe, expect, it } from 'vitest'
import { dayOf } from './web-read.ts'
import { DATE_PLAYLISTS, feedDates, resolveChannel } from './youtube-channel.ts'

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
    expect(urls.filter((url) => url.includes('videos.xml?channel_id='))).toHaveLength(1)
  })


  it('the feeds of the playlists a channel lists date its older uploads, one request per playlist and none per video', async () => {
    const lockup = (id: string, title: string) => ({
      lockupViewModel: {
        contentId: id,
        contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
        contentImage: { thumbnailViewModel: { overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: '20:00' } }] } }] } },
        metadata: { lockupMetadataViewModel: { title: { content: title } } },
      },
    })
    const listing = (id: string) => ({ lockupViewModel: { contentId: id, contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST', metadata: { lockupMetadataViewModel: { title: { content: `List ${id}` } } } } })
    const uploads = `<script>var ytInitialData = ${JSON.stringify({ contents: [lockup('bbbbbbbbbb1', 'New'), lockup('bbbbbbbbbb2', 'Old'), lockup('bbbbbbbbbb3', 'Unlisted anywhere')] })};</script>`
    const lists = Array.from({ length: DATE_PLAYLISTS + 3 }, (_, index) => `PL${String(index).padStart(16, '0')}`)
    const tab = `<script>var ytInitialData = ${JSON.stringify({ contents: lists.map(listing) })};</script>`
    const entry = (id: string, day: string) => `<entry><yt:videoId>${id}</yt:videoId><published>${day}T12:00:00+00:00</published></entry>`
    const urls: string[] = []
    const fake = (async (input: string | URL | Request) => {
      const url = String(input)
      urls.push(url)
      if (url.startsWith('https://www.youtube.com/playlist?list=')) return new Response(uploads)
      if (url.endsWith('/playlists')) return new Response(tab)
      if (url.includes('videos.xml?channel_id=')) return new Response(`<feed>${entry('bbbbbbbbbb1', '2026-09-30')}</feed>`)
      if (url.includes(`videos.xml?playlist_id=${lists[1]}`)) return new Response(`<feed>${entry('bbbbbbbbbb2', '2018-04-02')}${entry('bbbbbbbbbb1', '2026-09-30')}</feed>`)
      if (url.includes('videos.xml?playlist_id=')) return new Response('<feed></feed>')
      return new Response('{}')
    }) as typeof fetch
    const channel = await resolveChannel(`https://www.youtube.com/channel/${'UC' + '0'.repeat(21) + '2'}`, fake)
    expect(channel.videos.map((video) => [video.id, video.published])).toEqual([['bbbbbbbbbb1', '2026-09-30'], ['bbbbbbbbbb2', '2018-04-02'], ['bbbbbbbbbb3', undefined]])
    expect(urls.filter((url) => url.includes('videos.xml?playlist_id='))).toHaveLength(DATE_PLAYLISTS + 2)
    expect(urls.some((url) => url.includes(`playlist_id=UULF${'0'.repeat(21)}2`))).toBe(true)
    // Only the video no feed dated has its own watch page read, once; the player API is never asked.
    expect(urls.filter((url) => url.includes('/watch?'))).toEqual(['https://www.youtube.com/watch?v=bbbbbbbbbb3'])
    expect(urls.some((url) => url.includes('/youtubei/v1/player'))).toBe(false)
  })
})
