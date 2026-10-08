import { describe, expect, it } from 'vitest'
import { rescanSources, type RescanDeps } from './services/channel-editor.ts'
import { classifyChoice, newSource, singleVideoId, sourceStatusText, SOURCE_CHOICES, youTubeVideoId, type ChannelSource } from './services/channel-sources.ts'
import { exportSource } from './services/user-network-export.ts'
import type { FoundFeed } from './services/podcast-source.ts'

const site: FoundFeed = {
  feedUrl: 'https://luckyradio.lol/',
  title: 'Omni',
  episodes: [{ id: 'web-lucky', title: 'Omni', durationSec: 600, media: 'https://luckyradio.lol/', web: 'website' }],
} as unknown as FoundFeed

function deps(patch: Partial<RescanDeps> = {}): RescanDeps {
  return {
    resolveYouTube: async () => {
      throw new Error('unused')
    },
    probeStream: async () => 'online',
    ...patch,
  } as RescanDeps
}

describe('a website Detect took for a podcast (www.luckyradio.lol)', () => {
  it('is shown as the website it is when no feed is found, instead of failing', async () => {
    const source = newSource([], 'www.luckyradio.lol')
    expect(source.kind).toBe('podcast')
    const [read] = await rescanSources(
      [source],
      deps({ resolveFeed: async (_url, options) => (options?.as === 'website' ? site : Promise.reject(new Error('No podcast feed was found'))) }),
      1,
    )
    expect(read.kind).toBe('website')
    expect(read.status?.state).toBe('ready')
    expect(read.videos?.[0]?.web).toBe('website')
  })

  it('a podcast already read keeps being a podcast when its feed fails for a while', async () => {
    const held: ChannelSource = { ...newSource([], 'https://example.com/feed'), videos: [{ id: 'e1', title: 'Episode', durationSec: 1800, media: 'https://example.com/e1.mp3' }], status: { state: 'ready', checkedAt: 0 } }
    const [read] = await rescanSources([held], deps({ resolveFeed: async () => Promise.reject(new Error('down')) }), 1)
    expect(read.kind).toBe('podcast')
    expect(read.status?.state).toBe('failed')
  })
})

describe('Add Source: YouTube single video', () => {
  it('is a choice of its own beside the video-to-its-channel one', () => {
    expect(SOURCE_CHOICES.map((choice) => choice.value)).toContain('youtube-single')
    expect(SOURCE_CHOICES.find((choice) => choice.value === 'youtube-single')?.label).toBe('YouTube single video (just this video)')
  })

  it('reads the one video from any of its address forms', () => {
    for (const link of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'https://youtu.be/dQw4w9WgXcQ', 'youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ']) {
      expect(youTubeVideoId(link)).toBe('dQw4w9WgXcQ')
      expect(classifyChoice(link, 'youtube-single')).toEqual({ kind: 'collection', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
    }
    expect(() => classifyChoice('https://www.youtube.com/@someone', 'youtube-single')).toThrow('does not name one video')
    expect(() => classifyChoice('https://example.com/', 'youtube-single')).toThrow('not a YouTube address')
  })

  it('holds just that video, never its channel, and keeps it through a rescan and an export', async () => {
    const source = newSource([], 'https://youtu.be/dQw4w9WgXcQ', 'youtube-single')
    expect(singleVideoId(source)).toBe('dQw4w9WgXcQ')
    const asked: string[] = []
    const [read] = await rescanSources(
      [source],
      deps({
        resolveYouTube: async (url) => {
          asked.push(url)
          return { channelId: 'UCx', title: 'Uploader', videos: [{ id: 'dQw4w9WgXcQ', title: 'The video', durationSec: 213 }, { id: 'other000000', title: 'Another', durationSec: 300 }] }
        },
      }),
      1,
    )
    expect(asked).toEqual(['https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ'])
    expect(read.videos?.map((video) => video.id)).toEqual(['dQw4w9WgXcQ'])
    expect(read.label).toBe('The video')
    expect(sourceStatusText(read)).toBe('YouTube single video · just this video')
    const [again] = await rescanSources([read], deps(), 2)
    expect(again.videos?.map((video) => video.id)).toEqual(['dQw4w9WgXcQ'])
    expect(exportSource(read, () => null).url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  })

  it('says a video its publisher keeps on YouTube cannot play here, and keeps "Resolution failed" for a lookup that failed', async () => {
    const source = newSource([], 'https://www.youtube.com/watch?v=K2gBg7jjhIc', 'youtube-single')
    const outcome = async (resolveYouTube: RescanDeps['resolveYouTube']) => (await rescanSources([source], deps({ resolveYouTube }), 1))[0]
    const refused = await outcome(async () => {
      throw new Error('That video’s publisher does not allow it to play outside YouTube')
    })
    expect(refused.status?.state).toBe('unavailable')
    expect(sourceStatusText(refused)).toBe('YouTube single video · cannot play outside YouTube (its publisher’s choice, or not on air)')
    const left = await outcome(async () => ({ channelId: 'UCx', title: 'Uploader', videos: [{ id: 'other000000', title: 'Another', durationSec: 300 }] }))
    expect(left.status?.state).toBe('unavailable')
    const failed = await outcome(async () => {
      throw new Error('TVN could not reach its channel lookup')
    })
    expect(sourceStatusText(failed)).toBe('Resolution failed')
  })
})
