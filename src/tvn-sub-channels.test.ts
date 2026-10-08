import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { programmesFor } from './data/catalogue.ts'
import { installUserCatalogue, subChannelsOf } from './data/user-overlay.ts'
import { broadcast } from './services/broadcast.ts'
import { channelsFromSources, subChannelId, type ImportedVideo, type StoredSource } from './services/channels-import.ts'
import { guideLayout, loadOpenSubChannels, rowIndexOf, saveOpenSubChannels } from './view/sub-channels-store.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const videos = (prefix: string, count: number): ImportedVideo[] =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}${String(index).padStart(11 - prefix.length, '0')}`, title: `${prefix} ${index + 1}`, durationSec: 1200 }))
const playlist = (id: string, label: string, list: ImportedVideo[], enabled = true) => ({
  id,
  kind: 'youtube' as const,
  url: `https://www.youtube.com/playlist?list=PL${label.replace(/\W/g, '')}`,
  label,
  enabled,
  youtube: 'playlist' as const,
  videos: list,
})
const record = (number: number, sources: ReturnType<typeof playlist>[]): StoredSource => ({
  id: `slot:${number}`,
  name: 'Classic Sports Mix',
  videos: sources.flatMap((source) => source.videos),
  channelSources: sources,
  channelNumber: number,
  inLibrary: false,
  automatic: true,
  updatedAt: 0,
})

afterEach(() => installUserCatalogue([], new Map()))

describe('Each source of a channel is a sub-channel with a schedule of its own', () => {
  const reds = videos('re', 3)
  const sox = videos('so', 4)
  const mix = record(1205, [playlist('s1', 'Reds Games', reds), playlist('s2', 'Red Sox Games', sox), playlist('s3', 'Hidden', videos('hi', 2), false)])

  it('a channel with two or more enabled sources has one sub-channel each, of that source’s programmes', () => {
    const built = channelsFromSources([mix])
    const channel = built.channels[0]
    const subs = built.subChannels.get(channel.id) ?? []
    expect(subs.map((sub) => [sub.channel.id, sub.channel.name, sub.channel.number])).toEqual([
      [subChannelId(channel.id, 's1'), 'Reds Games', 1205],
      [subChannelId(channel.id, 's2'), 'Red Sox Games', 1205],
    ])
    const own = new Set(built.programmes.get(channel.id))
    expect(subs[0].programmes.map((programme) => programme.videoId).sort()).toEqual(reds.map((video) => video.id))
    expect(subs[1].programmes.map((programme) => programme.videoId).sort()).toEqual(sox.map((video) => video.id))
    for (const sub of subs) for (const programme of sub.programmes) expect(own.has(programme)).toBe(true)
    expect(subs[0].channel.phaseOffsetSeconds).not.toBe(subs[1].channel.phaseOffsetSeconds)
  })

  it('one source, or only one that airs anything, has none: the channel is that source', () => {
    expect(channelsFromSources([record(1206, [playlist('s1', 'Only', reds)])]).subChannels.size).toBe(0)
    expect(channelsFromSources([record(1207, [playlist('s1', 'Only', reds), playlist('s2', 'Off', sox, false)])]).subChannels.size).toBe(0)
  })

  it('installed, a sub-channel airs only its own programmes on its clock; the channel still airs them all', () => {
    const built = channelsFromSources([mix])
    installUserCatalogue(built.channels, built.programmes, built.subChannels)
    const channel = built.channels[0]
    const subs = subChannelsOf(channel.id)
    expect(subs).toHaveLength(2)
    expect(programmesFor(subs[1].id).map((programme) => programme.videoId).sort()).toEqual(sox.map((video) => video.id))
    const soxIds = new Set(sox.map((video) => video.id))
    for (let hour = 0; hour < 24; hour += 1) {
      const airing = broadcast(subs[1], Date.UTC(2026, 9, 8, hour)).current.programme
      if (airing.videoId) expect(soxIds.has(airing.videoId)).toBe(true)
    }
    expect(new Set(programmesFor(channel.id).map((programme) => programme.videoId))).toEqual(new Set([...reds, ...sox].map((video) => video.id)))
    installUserCatalogue(built.channels, built.programmes)
    expect(subChannelsOf(channel.id)).toEqual([])
  })
})

describe('The Guide lists sub-channels under their channel when "+" shows them', () => {
  const a = { id: 'a', number: 1201 }
  const b = { id: 'b', number: 1202 }
  const subs = (id: string) => (id === 'a' ? [{ id: 'a~s1', number: 1201 }, { id: 'a~s2', number: 1201 }] : [])

  it('rows follow each shown channel; positions find the channel’s own row', () => {
    expect(guideLayout([a, b], new Set(), subs).map((row) => row.channel.id)).toEqual(['a', 'b'])
    const open = guideLayout([a, b], new Set(['a']), subs)
    expect(open.map((row) => [row.kind, row.channel.id])).toEqual([
      ['channel', 'a'],
      ['sub', 'a~s1'],
      ['sub', 'a~s2'],
      ['channel', 'b'],
    ])
    expect(rowIndexOf(open, 1202)).toBe(3)
    expect(rowIndexOf(open, 1201)).toBe(0)
    expect(rowIndexOf(open, 9)).toBe(-1)
  })

  it('which channels show them is kept in this browser', () => {
    const kept = new Map<string, string>()
    const store = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value) }
    expect(loadOpenSubChannels(store).size).toBe(0)
    saveOpenSubChannels(new Set(['user-slot:1205']), store)
    expect([...loadOpenSubChannels(store)]).toEqual(['user-slot:1205'])
    store.setItem('tvn.guide-sub-channels.v1', 'not json')
    expect(loadOpenSubChannels(store).size).toBe(0)
  })

  it('"+" sits after the channel name; a sub-channel is watched on its own clock, its programmes following', () => {
    const guide = read('src/components/Guide.tsx')
    expect(guide).toMatch(/className=\{subsOpen \? 'ch-act ch-subs is-open' : 'ch-act ch-subs'\}/)
    expect(guide.indexOf("'ch-act ch-subs")).toBeLessThan(guide.indexOf("'ch-act ch-more"))
    expect(guide).toContain('onWatch={() => tv.playSubChannel(channel)}')
    const provider = read('src/state/TvProvider.tsx')
    expect(provider).toContain('playFromGuide(sub, airing.programme, { startMs: airing.startMs, endMs: airing.endMs }, (now - airing.startMs) / 1000)')
    expect(provider).toContain('installUserCatalogue(built.channels, built.programmes, built.subChannels)')
  })

  it('the playlist picker combines the ticked playlists into one channel, each a source of it', () => {
    const panel = read('src/components/GuideAdd.tsx')
    expect(panel).toMatch(/Combine \{chosenPlaylists\(\)\.length\} into one channel/)
    expect(panel).toContain('chosen.map((playlist) => ({ url: playlistUrl(playlist.id), title: playlist.title }))')
    const provider = read('src/state/TvProvider.tsx')
    expect(provider).toMatch(/const addCombinedChannel = useCallback\(/)
    expect(provider).toContain("youtube: 'playlist',")
  })
})
