import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EMPTY_REGISTER } from './credits/provenance.ts'
import { episodeAttribution, programmeAttribution } from './credits/attribution.ts'
import { lengthRangeOf, withLengthRange, type ChannelEdit } from './services/channel-editor.ts'
import { eligibleOf } from './services/channel-curation.ts'
import type { ChannelSource } from './services/channel-sources.ts'
import { channelsFromSources, type StoredSource } from './services/channels-import.ts'
import { publicWebPage, siteOf } from './utils/web-page.ts'
import type { Programme } from './types/programme.ts'

const feed = (videos: ChannelSource['videos'], website?: string): ChannelSource => ({
  id: 'feed',
  kind: 'podcast',
  url: 'https://feeds.example.org/show/rss',
  label: 'Example Show',
  enabled: true,
  videos,
  ...(website ? { info: { website } } : {}),
})

const channel = (source: ChannelSource): StoredSource => ({
  id: 'show',
  name: 'Example Show',
  videos: source.videos ?? [],
  channelNumber: 1001,
  inLibrary: false,
  automatic: true,
  updatedAt: 1,
  channelSources: [source],
})

describe('A feed episode links to its own page, or its publisher', () => {
  const episodes = [
    { id: 'e1', title: 'One', durationSec: 3600, media: 'https://media.example.org/one.mp3', page: 'https://show.example.org/episodes/one/' },
    { id: 'e2', title: 'Two', durationSec: 3600, media: 'https://media.example.org/two.mp3' },
  ]

  it("carries the episode's page, else the feed's website", () => {
    const built = channelsFromSources([channel(feed(episodes, 'https://show.example.org/'))])
    const programmes = [...built.programmes.values()][0]
    expect(programmes.find((programme) => programme.title === 'One')?.episodeUrl).toBe('https://show.example.org/episodes/one/')
    expect(programmes.find((programme) => programme.title === 'Two')?.episodeUrl).toBe('https://show.example.org/')
  })

  it('falls back to the home page of the address the feed is read from', () => {
    const built = channelsFromSources([channel(feed(episodes))])
    expect([...built.programmes.values()][0].find((programme) => programme.title === 'Two')?.episodeUrl).toBe('https://feeds.example.org/')
  })

  it('shows on the information bar where a YouTube @user would', () => {
    const programme = { id: 'p', title: 'One', channelId: 'c', durationSeconds: 60, videoId: null, mediaUrl: 'https://media.example.org/one.mp3' } as Programme
    expect(programmeAttribution({ ...programme, episodeUrl: 'https://www.crrow777radio.com/699-where-we-go/' }, EMPTY_REGISTER)).toEqual({ text: 'LINK', url: 'https://www.crrow777radio.com/699-where-we-go/' })
    expect(programmeAttribution({ ...programme, episodeUrl: 'https://veritas7.com/' }, EMPTY_REGISTER)).toEqual({ text: 'veritas7.com', url: 'https://veritas7.com/' })
    expect(programmeAttribution(programme, EMPTY_REGISTER)).toBeNull()
  })

  it('never links anything but a public web page', () => {
    expect(episodeAttribution('javascript:alert(1)')).toBeNull()
    expect(episodeAttribution('https://user:secret@example.org/')).toBeNull()
    expect(publicWebPage('ftp://example.org/')).toBeUndefined()
    expect(siteOf('https://www.crrow777radio.com/feed/podcast/')).toBe('https://www.crrow777radio.com/')
  })

  it('reaches 776 VERITAS and 777 CRROW777', () => {
    const edits = JSON.parse(readFileSync('src/data/central-edits.json', 'utf8')) as { channels: Record<string, { sources: ChannelSource[] }> }
    for (const number of ['776', '777']) {
      const source = edits.channels[number].sources[0]
      expect(source.kind).toBe('podcast')
      expect(publicWebPage(source.info?.website)).toBeTruthy()
    }
    expect(edits.channels['777'].sources[0].videos?.every((video) => video.page)).toBe(true)
  })
})

describe('Edit Channel: programme length', () => {
  const videos = [
    { id: 'short', title: 'Short', durationSec: 120 },
    { id: 'mid', title: 'Mid', durationSec: 1800 },
    { id: 'long', title: 'Long', durationSec: 7200 },
  ]
  const youtube: ChannelSource = { id: 'yt', kind: 'youtube', url: 'https://www.youtube.com/@example', label: 'Example', enabled: true, videos }
  const tvn: ChannelSource = { id: 'tvn', kind: 'tvn', url: '', label: 'TVN', enabled: true }
  const edit: ChannelEdit = { name: 'Example', sources: [tvn, youtube] }

  it("limits every source, so the channel's clips outside the range leave it", () => {
    const next = withLengthRange(edit, { minSeconds: 300, maxSeconds: 3600 })
    const limited = next.sources.find((source) => source.id === 'yt')!
    expect(eligibleOf(limited).map((video) => video.id)).toEqual(['mid'])
    expect(next.sources.find((source) => source.id === 'tvn')).toEqual(tvn)
    expect(lengthRangeOf(next.sources)).toEqual({ minSeconds: 300, maxSeconds: 3600 })
  })

  it('clearing the range brings them back', () => {
    const cleared = withLengthRange(withLengthRange(edit, { maxSeconds: 600 }), {})
    expect(eligibleOf(cleared.sources.find((source) => source.id === 'yt')!).map((video) => video.id)).toEqual(['short', 'mid', 'long'])
    expect(lengthRangeOf(cleared.sources)).toEqual({})
  })

  it("leaves TVN's own programmes outside the range out of the running order", () => {
    const next = withLengthRange({ name: 'TVN', sources: [tvn] }, { maxSeconds: 3600 }, videos)
    expect(next.excluded).toEqual(['long'])
    expect(next.orderKind).toBe('manual')
  })

  it('sits after Schedule in Edit Channel', () => {
    const editor = readFileSync('src/components/ChannelEditor.tsx', 'utf8')
    expect(editor.indexOf('{lengthControl}', editor.indexOf('aria-label="Programmes scheduled"'))).toBeGreaterThan(0)
  })
})

describe('User Network panel', () => {
  it('has EXPORT and RESTORE above its other buttons, and no long note', () => {
    const add = readFileSync('src/components/GuideAdd.tsx', 'utf8')
    expect(add).not.toContain('Paste a YouTube channel or video link in the last row')
    const tools = add.slice(add.indexOf('export function UserNetworkTools'))
    expect(tools.indexOf("key('Export ALL'")).toBeLessThan(tools.indexOf("key('Channel list'"))
    expect(tools.indexOf("key('Restore'")).toBeLessThan(tools.indexOf("key('Add starter network'"))
  })
})
