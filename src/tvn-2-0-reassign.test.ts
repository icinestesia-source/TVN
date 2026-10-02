import { readdirSync, readFileSync, statSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shippedEditorial } from './data/central-editorial.ts'
import { channelByNumber, channels, shippedChannel, shippedProgrammes } from './data/catalogue.ts'
import { CHANNEL_ROUTES, INDEPENDENT_SOURCES } from './data/independent/network.ts'
import { writeFrozen } from './director/cache.ts'
import { getSchedule, resetDirector, setChannelIdentity } from './director/director.ts'
import { DEDICATED } from './director/fit.ts'
import { setMediaLibrary } from './director/library.ts'
import type { FrozenDailySchedule, MediaItem } from './director/types.ts'
import { schedulingPool } from './library/mode.ts'
import { expandPlayableCatalogue, type PlayableCatalogueV2 } from './library/playable-catalogue.ts'
import { getChannelMedia } from './library/query.ts'
import { buildCentralCuration, overridesFromExport, reconcileOverride } from './services/central-curation.ts'
import {
  appliedCuratedEdits,
  CURATED_EDITS_KEY,
  followMovedChannels,
  madeForAnother,
  saveCuratedEdit,
  shippedBaseline,
  tvnSource,
  type CuratedEdit,
} from './services/curated-edits.ts'
import { buildSearchGuide, buildSearchIndex } from './services/guide-search.ts'
import { searchChannels } from './services/guide-search-pool.ts'
import { chooseTvn, resetTvnChannel, setTvnLookup, tvnChoice, tvnPool } from './tvn/tvn-channel.ts'
import { isLiveStreamChannel } from './dynamic/stream.ts'
import type { Channel } from './types/channel.ts'
import type { Programme } from './types/programme.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const doc = JSON.parse(read('public/independent/playable.json')) as PlayableCatalogueV2
type Item = [string, string, number, string, number[], string]
const raw = doc.items as unknown as Item[]
const NOW = Date.UTC(2026, 9, 2, 12)

function memoryStore() {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), data }
}

const idsOf = (channel: Channel) => shippedProgrammes(channel.id).map((programme) => programme.id)
const baselineOf = (channel: Channel) => shippedBaseline(channel, idsOf(channel))
/** An override as a browser kept it while 555 was still Live. */
function oldLiveOverride(): CuratedEdit {
  const at555 = shippedChannel(555)!
  return {
    channelNumber: 555,
    name: 'Live',
    sources: [tvnSource()],
    description: 'Live sessions, my notes',
    savedAt: NOW - 86_400_000,
    baseline: { name: 'Live', programmes: 6, fingerprint: shippedBaseline(at555, idsOf(at555)).fingerprint },
  }
}

describe('555 Daft Punk and 586 Live', () => {
  it('ships one authoritative identity at each number', () => {
    expect(shippedChannel(555)?.name).toBe('Daft Punk')
    expect(shippedChannel(586)?.name).toBe('Live')
    expect(channelByNumber(555)?.name).toBe('Daft Punk')
    expect(channelByNumber(586)?.name).toBe('Live')
    expect(channels.filter((channel) => channel.name === 'Live').map((channel) => channel.number)).toEqual([586])
    expect(shippedEditorial(555)?.status).toBe('reviewing')
    expect(shippedEditorial(586)).toBeUndefined()
  })

  it('keeps the expanded Daft Punk pool at 555 and moves every Live programme to 586', () => {
    const at555 = raw.filter((item) => item[4].includes(555))
    expect(at555).toHaveLength(179)
    expect(at555.reduce((sum, item) => sum + item[2], 0) / 3600).toBeCloseTo(17.2, 1)
    expect(new Set(at555.map((item) => item[3]))).toEqual(new Set(['src_daftpunk', 'src_daftpunk_videos', 'src_daftpunk_homework', 'src_daftpunk_discovery', 'src_daftpunk_haa', 'src_daftpunk_haa_remixes', 'src_daftpunk_alive1997', 'src_daftpunk_alive2007', 'src_daftpunk_daftclub', 'src_daftpunk_ram', 'src_daftpunk_essentials']))
    const paste = raw.filter((item) => item[3] === 'src_paste')
    expect(paste).toHaveLength(227)
    expect(paste.every((item) => item[4].length === 1 && item[4][0] === 586)).toBe(true)
    const at586 = new Set(raw.filter((item) => item[4].includes(586)).map((item) => item[3]))
    expect(at586).toEqual(new Set(['src_paste', 'src_kexp', 'src_vevo']))
  })

  it('moves the Live configuration with the channel: home publisher, routes and manifest targets', () => {
    expect(DEDICATED.src_paste).toEqual([586])
    const homes555 = Object.entries(DEDICATED).filter(([, homes]) => homes.includes(555)).map(([id]) => id)
    expect(homes555.every((id) => id.startsWith('src_daftpunk'))).toBe(true)
    expect(CHANNEL_ROUTES.find((route) => route.number === 555)?.sourceIds.every((id) => id.startsWith('src_daftpunk'))).toBe(true)
    expect(CHANNEL_ROUTES.find((route) => route.number === 586)?.sourceIds).toEqual(['src_kexp', 'src_vevo'])
    const kexp = INDEPENDENT_SOURCES.find((source) => source.id === 'src_kexp')!
    expect(kexp.targets).toContain(586)
    expect(kexp.targets).not.toContain(555)
    expect(INDEPENDENT_SOURCES.find((source) => source.id === 'src_vevo')?.targets).not.toContain(555)
  })

  it('the channel manifest agrees: 555 Daft Punk, 586 Live, and no record calls 555 Live', () => {
    const manifest = JSON.parse(read('docs/channel-manifest.json')) as { records: { number: number; name: string; programmes: number; anchorSources: string[] }[] }
    const byNumber = new Map(manifest.records.map((record) => [record.number, record]))
    expect(byNumber.get(555)).toMatchObject({ name: 'Daft Punk', programmes: 179 })
    expect(byNumber.get(586)).toMatchObject({ name: 'Live', anchorSources: ['Paste Magazine'] })
    expect(read('docs/channel-manifest.md')).toMatch(/^\| 555 \| Daft Punk \|/m)
    expect(read('docs/channel-manifest.md')).toMatch(/^\| 586 \| Live \|/m)
    expect(read('scripts/add_targeted_sources.py')).toMatch(/"Paste Magazine", "channels": \[586\]/)
  })

  it('no runtime code keys behaviour to channel 555', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = `${dir}/${name}`
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && /\b555\b/.test(read(path))) offenders.push(path)
      }
    }
    walk('src')
    walk('server')
    // The diagnostic names what 555 resolves to; it never decides anything by the number.
    expect(offenders.filter((path) => path !== 'src/build-info.ts')).toEqual([])
  })

  it('000 leaves live streams out by type, wherever they are numbered', () => {
    expect(isLiveStreamChannel(shippedChannel(586)!)).toBe(false)
    expect(read('src/tvn/tvn-channel.ts')).not.toMatch(/\b555\b|\b586\b/)
    const recorded = shippedChannel(555)!
    for (const [liveAt, form] of [[555, 'stream'], [586, 'stream'], [701, 'stream'], [555, 'youtube'], [586, 'youtube']] as const) {
      const stream: Channel = { ...shippedChannel(586)!, number: liveAt, id: `ch-${liveAt}`, ...(form === 'stream' ? { playbackType: 'live-stream' as const } : {}) }
      const network = [stream, { ...recorded, number: liveAt === 555 ? 586 : 555, id: liveAt === 555 ? 'ch-586' : 'ch-555' }]
      const airing = (on: Channel, nowMs: number) => {
        const programme = { id: `p${on.number}`, title: `On ${on.number}`, description: '', videoId: on === stream && form === 'stream' ? null : `vid${String(on.number).padStart(8, '0')}`, durationSeconds: 3600, channelId: on.id, category: 'Music', source: 'youtube', kind: 'programme', playbackMode: 'linear', ...(on === stream ? (form === 'stream' ? { liveStream: { url: 'https://example.invalid/live.m3u8' } } : { playback: 'live', programmeType: 'live' }) : {}) } as Programme
        const position = { programme, index: 0, startMs: nowMs - 60_000, endMs: nowMs + 3_000_000, elapsedSeconds: 60, seekSeconds: 60 }
        return { channelId: on.id, epochMs: 0, nowMs, cycleDurationSeconds: 3600, offsetSeconds: 0, current: position, previous: position, next: position }
      }
      resetTvnChannel()
      setTvnLookup({ channels: () => network, broadcastOf: airing, onAir: () => true, refused: () => new Set() })
      const picks = new Set<number>()
      for (let step = 0; step < 10; step += 1) {
        chooseTvn(NOW + step)
        const picked = tvnChoice()
        if (picked) picks.add(picked.channelNumber)
      }
      expect([...picks], `${form} live at ${liveAt}`).toEqual([network[1].number])
      expect(tvnPool(network, false, () => true)).toHaveLength(2)
    }
    resetTvnChannel()
  })
})

describe('old 555 Live overrides', () => {
  it('follow Live to 586 when 586 has no override of its own', () => {
    const { edits, moved } = followMovedChannels({ 555: oldLiveOverride() }, channels, baselineOf)
    expect(edits['555']).toBeUndefined()
    expect(edits['586']).toMatchObject({ channelNumber: 586, name: 'Live', description: 'Live sessions, my notes' })
    expect(edits['586'].baseline).toEqual(baselineOf(shippedChannel(586)!))
    expect(edits['586'].conflicts).toEqual(['TVN moved Live from 555 to 586 · your curation moved with it'])
    expect(moved).toHaveLength(1)
    expect(madeForAnother(edits['586'], shippedChannel(586)!)).toBe(false)
  })

  it('stay set aside at 555, never laid over Daft Punk, when they cannot move', () => {
    const store = memoryStore()
    const own586 = saveCuratedEdit(shippedChannel(586)!, { name: 'Live', sources: [tvnSource()], description: 'mine' }, NOW, store, idsOf(shippedChannel(586)!))!
    const old = oldLiveOverride()
    const { edits, moved } = followMovedChannels({ 555: old, 586: own586 }, channels, baselineOf)
    expect(moved).toEqual([])
    expect(edits['555']).toBe(old)
    expect(madeForAnother(old, shippedChannel(555)!)).toBe(true)
    store.setItem(CURATED_EDITS_KEY, JSON.stringify(edits))
    const applied = appliedCuratedEdits(shippedChannel, store)
    expect(Object.keys(applied)).toEqual(['586'])
    expect(JSON.parse(store.getItem(CURATED_EDITS_KEY)!)['555'].description).toBe('Live sessions, my notes')
  })

  it('a restored Live override is moved too; one for a renamed channel keeps its baseline and stays aside', () => {
    const [restored] = overridesFromExport(buildCentralCuration([oldLiveOverride()]))
    const { edits } = followMovedChannels({ 555: restored }, channels, baselineOf)
    expect(Object.keys(edits)).toEqual(['586'])
    const kept = reconcileOverride({ ...restored, baseline: { ...restored.baseline!, name: 'Gone Away' } }, shippedChannel(555), idsOf(shippedChannel(555)!))
    expect(kept.conflicts.join(' ')).toMatch(/set aside, not applied/)
    expect(madeForAnother(kept.edit!, shippedChannel(555)!)).toBe(true)
  })
})

describe('the corrected network on air', () => {
  let items: ReturnType<typeof expandPlayableCatalogue> = []
  beforeAll(() => {
    items = expandPlayableCatalogue(doc)
    resetDirector()
    setMediaLibrary(items)
  }, 120_000)
  afterAll(() => resetDirector())

  it('555 schedules Daft Punk and 586 schedules the former Live programming', () => {
    const pool555 = getChannelMedia(schedulingPool(items) as unknown as MediaItem[], 555)
    expect(pool555.length).toBeGreaterThanOrEqual(170)
    expect(pool555.every((item) => (item as { sourceId?: string }).sourceId?.startsWith('src_daftpunk'))).toBe(true)
    const pool586 = getChannelMedia(schedulingPool(items) as unknown as MediaItem[], 586)
    expect(pool586.some((item) => (item as { sourceId?: string }).sourceId === 'src_paste')).toBe(true)
  })

  it('a day frozen while 555 was Live is not replayed under Daft Punk', () => {
    const date = '2026-10-02'
    const live = getSchedule(channelByNumber(586)!, date)
    expect(live.blocks.some((block) => block.children.some((child) => !child.fallback && child.mediaItemId))).toBe(true)
    expect(live.channelName).toBe('Live')
    const pool = new Set(getChannelMedia(schedulingPool(items) as unknown as MediaItem[], 555).map((item) => item.id))
    const daftPunkOnly = (day: FrozenDailySchedule) => {
      const aired = day.blocks.flatMap((block) => block.children).filter((child) => !child.fallback && child.mediaItemId)
      return aired.length > 0 && aired.every((child) => pool.has(child.mediaItemId!))
    }
    // What an existing browser kept under 555: a Live day from before days recorded their channel, and one that does.
    const { channelName: _, ...legacy } = live
    for (const kept of [legacy, live]) {
      writeFrozen({ ...kept, scheduleId: `ch-555|${date}`, channelId: 'ch-555', channelNumber: 555 })
      const day = getSchedule(channelByNumber(555)!, date)
      expect(day.channelName).toBe('Daft Punk')
      expect(daftPunkOnly(day)).toBe(true)
      expect(getSchedule(channelByNumber(555)!, date)).toBe(day)
    }
  })

  it('a viewer renaming their copy of a channel keeps its frozen day', () => {
    setChannelIdentity((channel) => shippedChannel(channel.number)?.name ?? channel.name)
    const day = getSchedule(channelByNumber(586)!, '2026-10-03')
    expect(getSchedule({ ...channelByNumber(586)!, name: 'My Live' }, '2026-10-03')).toBe(day)
    setChannelIdentity((channel) => channel.name)
  })

  it('Guide search finds Daft Punk at 555; Live no longer speaks for 555', () => {
    const index = buildSearchIndex(searchChannels(shippedEditorial, new Set()))
    const guide = buildSearchGuide(index, 'Daft Punk')
    expect(guide.picks.length).toBeGreaterThan(0)
    expect(guide.picks.filter((pick) => pick.entry.channel.number === 555).length / guide.picks.length).toBeGreaterThan(0.5)
    const at555 = searchChannels(shippedEditorial, new Set()).find((channel) => channel.number === 555)!
    expect(at555.name).toBe('Daft Punk')
    expect(at555.programmes.some((programme) => /paste/i.test(programme.title))).toBe(false)
  })
})
