import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { screenFace } from './app/screen-face.ts'
import { isWebsiteSource } from './services/channel-sources.ts'
import { channelsFromSources } from './services/channels-import.ts'
import { lookUpFeed, sourcePreviewLines, type FoundFeed } from './services/podcast-source.ts'
import { addPodcastChannel } from './services/user-network.ts'
import type { Channel } from './types/channel.ts'
import type { Programme } from './types/programme.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('a source read a slice at a time, its unstated lengths measured', () => {
  it('follows the reader’s cursor, keeps each episode once, measures files and leaves out members-only and unreadable ones', async () => {
    const asked: string[] = []
    const reader = (async (input: string | URL) => {
      const url = new URL(String(input), 'http://tvn.test')
      asked.push(url.search)
      if (url.searchParams.has('measure')) {
        const durations: Record<string, number> = {}
        for (const file of url.searchParams.getAll('measure')) durations[file] = file.endsWith('locked.mp4') ? -1 : file.endsWith('broken.mp4') ? 0 : 3600
        return json({ durations })
      }
      const cursor = url.searchParams.get('cursor')
      const base = { feedUrl: 'https://shows.example.org/podcast/', website: 'https://shows.example.org/', title: 'Example Podcast', description: '', shape: 'archive', via: 'archive' }
      if (!cursor) {
        return json({ ...base, pages: 2, listed: 3, excluded: { members: 0, unsupported: 1 }, next: 'c1', episodes: [
          { id: 'web-1', title: 'One', durationSec: 0, media: 'https://cdn.example.net/one.mp4', type: 'video/mp4' },
          { id: 'abcdefghijk', title: 'Two', durationSec: 1800, type: 'youtube', youtube: 'abcdefghijk' },
        ] })
      }
      return json({ ...base, pages: 1, listed: 4, excluded: { members: 1, unsupported: 0 }, episodes: [
        { id: 'web-1', title: 'One (again)', durationSec: 0, media: 'https://cdn.example.net/one.mp4', type: 'video/mp4' },
        { id: 'web-3', title: 'Three', durationSec: 0, media: 'https://cdn.example.net/locked.mp4', type: 'video/mp4' },
        { id: 'web-4', title: 'Four', durationSec: 0, media: 'https://cdn.example.net/broken.mp4', type: 'video/mp4' },
        { id: 'web-5', title: 'Five', durationSec: 0, media: 'https://cdn.example.net/five.mp3', type: 'audio/mpeg' },
      ] })
    }) as typeof fetch
    const progress: string[] = []
    const found = await lookUpFeed('https://shows.example.org/podcast/', reader, { mode: 'all', onProgress: (text) => progress.push(text) })
    expect(found.episodes).toEqual([
      { id: 'web-1', title: 'One', durationSec: 3600, media: 'https://cdn.example.net/one.mp4', mediaKind: 'video' },
      { id: 'abcdefghijk', title: 'Two', durationSec: 1800 },
      { id: 'web-5', title: 'Five', durationSec: 3600, media: 'https://cdn.example.net/five.mp3' },
    ])
    expect(found.summary).toEqual({ shape: 'archive', via: 'archive', pages: 3, listed: 7, media: { audio: 1, video: 1, youtube: 1 }, excluded: { members: 2, unsupported: 1, unmeasured: 1 }, segments: 0 })
    expect(asked.filter((search) => search.includes('cursor=c1'))).toHaveLength(1)
    expect(progress.some((text) => text.startsWith('MEASURING'))).toBe(true)
  })
})

describe('the preview shows what TVN found before anything is saved', () => {
  const feed = (overrides: Partial<FoundFeed['summary']>, episodes: FoundFeed['episodes']): FoundFeed => ({
    feedUrl: 'https://veritas.example/vs.rss',
    website: 'https://veritas.example/',
    title: 'VERITAS',
    description: '',
    episodes,
    summary: { shape: 'feed', via: 'directory', pages: 0, listed: 506, media: { audio: episodes.length, video: 0, youtube: 0 }, excluded: { members: 0, unsupported: 0, unmeasured: 0 }, segments: episodes.length, ...overrides },
  })

  it("names a directory-found feed, and calls the publisher's part-one episodes public segments, never full interviews", () => {
    const lines = sourcePreviewLines(feed({}, [{ id: 'a', title: 'Guest | Part 1 of 2', durationSec: 3811, media: 'https://cdn.example/a.mp3' }]))
    expect(lines).toEqual([
      { label: 'Source', value: 'VERITAS' },
      { label: 'Type', value: "Podcast feed · the publisher's own, found in the public podcast directory" },
      { label: 'Found', value: '1 episode of 506 listed' },
      { label: 'Media', value: '1 audio' },
      { label: 'Public segments', value: 'All labelled by the publisher as a part or preview: not full programmes' },
    ])
  })

  it('describes an archive by its pages, its media and what it left out', () => {
    const episodes = Array.from({ length: 161 }, (_, index) => ({ id: `e${index}`, title: `Episode ${index}`, durationSec: 3600 }))
    const lines = sourcePreviewLines(feed({ shape: 'archive', via: 'archive', pages: 20, listed: 162, media: { audio: 0, video: 160, youtube: 1 }, excluded: { members: 0, unsupported: 1, unmeasured: 0 }, segments: 0 }, episodes))
    expect(lines.map((line) => `${line.label}: ${line.value}`)).toEqual([
      'Source: VERITAS',
      'Type: Public episode archive · 20 pages',
      'Found: 161 episodes of 162 listed',
      'Media: 160 video · 1 YouTube',
      'Left out: 1 in players TVN cannot use',
    ])
  })

  it('the ADD box reads a website first and shows the preview with Add channel and Cancel', () => {
    const form = read('src/components/GuideAdd.tsx')
    expect(form).toContain('found = await onPreview(link, setNote)')
    expect(form).toContain('sourcePreviewLines(preview).map((line) => (')
    expect(form).toContain('Add channel')
    expect(read('src/components/Guide.tsx').match(/onPreview=\{tv\.previewSource\}/g)).toHaveLength(2)
    expect(read('src/state/TvProvider.tsx')).toContain("const previewed = previewedRef.current?.link === link.trim() ? previewedRef.current.feed : null")
  })
})

describe('what ADD reads as a website', () => {
  it('any page or feed address, never a YouTube link or a media file or stream', () => {
    expect(isWebsiteSource('https://topherhq.example/biocharisma-podcast/')).toBe(true)
    expect(isWebsiteSource('veritas.example')).toBe(true)
    expect(isWebsiteSource('https://shows.example.org/feed.rss')).toBe(true)
    expect(isWebsiteSource('https://www.youtube.com/@daftpunk')).toBe(false)
    expect(isWebsiteSource('https://cdn.example.net/show.mp3')).toBe(false)
    expect(isWebsiteSource('https://radio.example.net/live.m3u8')).toBe(false)
  })
})

describe('video episodes play with their picture; audio ones keep the radio face', () => {
  it('an archive of video files is a picture channel; a mixed one shows the radio face only for its audio episodes', () => {
    const result = addPodcastChannel([], {
      feedUrl: 'https://shows.example.org/podcast/',
      title: 'Example Podcast',
      episodes: [
        { id: 'web-1', title: 'Video', durationSec: 3600, media: 'https://cdn.example.net/one.mp4', mediaKind: 'video' },
        { id: 'web-2', title: 'Audio', durationSec: 1800, media: 'https://cdn.example.net/two.mp3' },
      ],
    }, 1)
    const built = channelsFromSources(result.sources)
    const channel = built.channels[0] as Channel
    const programmes = built.programmes.get(channel.id) as Programme[]
    expect(channel.mediaKind).not.toBe('audio')
    const video = programmes.find((programme) => programme.mediaUrl?.endsWith('.mp4')) as Programme
    const audio = programmes.find((programme) => programme.mediaUrl?.endsWith('.mp3')) as Programme
    expect(video).toMatchObject({ mediaKind: 'video', videoId: null })
    expect(video.programmeType).not.toBe('radio')
    expect(audio).toMatchObject({ mediaKind: 'audio', programmeType: 'radio' })
    expect(screenFace(channel, video, 'playing')).toBe('picture')
    expect(screenFace(channel, audio, 'playing')).toBe('radio')
  })
})

describe('a slow publisher file is given time while it is still arriving', () => {
  it('a web file fails only after 30 s with nothing sent, or two minutes in all', () => {
    const stage = readFileSync('src/player/LocalStage.tsx', 'utf8')
    expect(stage).toMatch(/WEB_FILE_TIMEOUT_MS = 30_000/)
    expect(stage).toMatch(/WEB_FILE_LIMIT_MS = 120_000/)
    expect(stage).toMatch(/addEventListener\('progress', onProgress\)/)
    expect(stage).toMatch(/Math\.min\(WEB_FILE_TIMEOUT_MS, pending\.giveUpAt - Date\.now\(\)\)/)
  })
})
