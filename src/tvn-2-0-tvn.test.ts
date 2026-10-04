import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { screenFace } from './app/screen-face.ts'
import { PlaylistDiscovery } from './components/PlaylistDiscovery.tsx'
import { ProgrammeInfo } from './components/ProgrammeInfo.tsx'
import { channelByNumber, listChannels, randomChannel } from './data/catalogue.ts'
import { installUserCatalogue } from './data/user-overlay.ts'
import { resetDirector } from './director/director.ts'
import { setMediaLibrary } from './director/library.ts'
import type { MediaItem } from './director/types.ts'
import { searchGuideChannels } from './epg/navigation.ts'
import { schedulingPool } from './library/mode.ts'
import { expandPlayableCatalogue, type PlayableCatalogueV2 } from './library/playable-catalogue.ts'
import { getChannelMedia } from './library/query.ts'
import { firstOnAir } from './network/airing.ts'
import { lookUpPlaylists } from './services/add-channel.ts'
import { broadcast } from './services/broadcast.ts'
import { buildSearchGuide, buildSearchIndex } from './services/guide-search.ts'
import { searchChannels } from './services/guide-search-pool.ts'
import { buildTvnExport, readTvnExportFile, validateTvnExport, type PortableSettings } from './services/tvn-export.ts'
import { cannotAdd } from './services/viewing-guides.ts'
import { clearSession, replaceSession, searchSession, SESSION_CHANNEL, SESSION_CHANNEL_NUMBER, sessionRefresh, sessionUrlFor } from './session/session-channel.ts'
import { DEFAULT_TRANSITION_SETTINGS } from './state/transitions.ts'
import {
  chooseAnotherTvn,
  driveTvn,
  endedTvn,
  enterTvn,
  MIN_REMAINING_MS,
  resetTvnChannel,
  setTvnChannelSettings,
  setTvnLookup,
  setTvnRandom,
  TVN_CHANNEL,
  tvnBroadcast,
  tvnChannelSettings,
  tvnChoice,
  tvnGuideSlots,
  tvnPool,
} from './tvn/tvn-channel.ts'
import type { Channel } from './types/channel.ts'
import type { Programme } from './types/programme.ts'
import { editorScope } from './view/channel-edit.ts'
import { guideToolTarget } from './view/guide-tool.ts'
import { DEFAULT_SHORTCUTS } from './view/info-shortcuts.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const T0 = new Date('2026-10-02T20:00:00+01:00').getTime()
const MIN = 60_000
const SLOT = 30 * MIN

describe('the numbering: 000 TVN, 1000 Local Media', () => {
  it('000 is TVN and no longer local media; 1000 is Local Media', () => {
    expect(channelByNumber(0)).toBe(TVN_CHANNEL)
    expect(TVN_CHANNEL).toMatchObject({ number: 0, name: 'Channel Zero', origin: 'tvn' })
    expect(SESSION_CHANNEL_NUMBER).toBe(1000)
    expect(channelByNumber(1000)).toBe(SESSION_CHANNEL)
    expect(SESSION_CHANNEL).toMatchObject({ id: 'ch-1000', name: 'Local Media', origin: 'session' })
    expect(editorScope(TVN_CHANNEL)).toBe('tvn')
    expect(editorScope(SESSION_CHANNEL)).toBeNull()
  })

  it('MEDIA takes the Guide to 1000, and 1000 plays local files through their object URLs', () => {
    const target = guideToolTarget('media', 'retrotv', [], { channelNumber: 12, timeMs: T0 - MIN }, listChannels(), T0)
    expect(target.cursor).toEqual({ channelNumber: 1000, timeMs: T0 })
    replaceSession([{ title: 'Holiday 2019', durationSeconds: 600, url: 'blob:test/holiday', kind: 'video' }], T0)
    try {
      const programme = broadcast(SESSION_CHANNEL, T0 + MIN).current.programme
      expect(programme.channelId).toBe('ch-1000')
      expect(sessionUrlFor(programme)).toBe('blob:test/holiday')
      expect(screenFace(SESSION_CHANNEL, programme, 'playing')).toBe('picture')
      expect(sessionRefresh(1000, false, true)).toBe('in-place')
      const match = (channel: { origin?: string }, needle: string) => channel.origin === 'session' && searchSession(needle).length > 0
      expect(searchGuideChannels(listChannels(), 'holiday', match).map((channel) => channel.number)).toContain(1000)
      expect(cannotAdd(SESSION_CHANNEL, programme)).toMatch(/Local files/)
    } finally {
      clearSession()
    }
  })

  it('no hidden channel-000 local-media assumption remains', () => {
    for (const path of ['src/session/import.ts', 'src/credits/roll.ts', 'src/legal/legal-text.ts', 'src/legal/FirstRunNotice.tsx', 'src/services/viewing-guides.ts', 'src/credits/provenance.ts']) {
      const text = read(path)
      expect(text, path).not.toMatch(/CHANNEL 000|Channel 000 plays|Local Session Media|ch-000|number === 0 \?/)
    }
    expect(read('src/session/session-channel.ts')).toContain('export const SESSION_CHANNEL_NUMBER = 1000')
    expect(read('src/library/playable-catalogue.ts')).toContain('number >= 1 && number <= 999')
    expect(randomChannel(225, () => 0)?.number).not.toBe(0)
    expect(firstOnAir(listChannels())?.number).not.toBe(0)
    expect(cannotAdd(TVN_CHANNEL, { videoId: 'x', liveStream: undefined } as unknown as Programme)).toMatch(/TVN/)
  })
})

// A small fake network: every channel airs 30-minute programmes on the half hour.
function channel(number: number, patch: Partial<Channel> = {}): Channel {
  return { ...TVN_CHANNEL, id: `ch-${number}`, number, name: `Channel ${number}`, origin: number >= 1001 ? 'user-import' : 'default', ...patch }
}
const network: Channel[] = [
  TVN_CHANNEL,
  ...Array.from({ length: 12 }, (_, index) => channel(index + 1)),
  channel(13, { enabled: false }),
  SESSION_CHANNEL,
  channel(1001),
  channel(1002),
]
const refused = new Set<string>()
function airing(on: Channel, nowMs: number) {
  const index = Math.floor(nowMs / SLOT)
  const programme: Programme = {
    id: `p${on.number}-${index}`,
    title: `Programme ${on.number}/${index}`,
    description: '',
    videoId: `v${String(on.number).padStart(4, '0')}${String(index % 1e6).padStart(6, '0')}`,
    durationSeconds: SLOT / 1000,
    channelId: on.id,
    category: 'Test',
    source: 'youtube',
    kind: 'programme',
    playbackMode: 'linear',
    creator: `Maker ${on.number % 7}`,
  }
  const startMs = index * SLOT
  const position = { programme, index, startMs, endMs: startMs + SLOT, elapsedSeconds: (nowMs - startMs) / 1000, seekSeconds: (nowMs - startMs) / 1000 }
  return { channelId: on.id, epochMs: 0, nowMs, cycleDurationSeconds: 1800, offsetSeconds: 0, current: position, previous: position, next: position }
}

describe('000 TVN: the network’s own sampler', () => {
  let now = T0
  let seed = 1
  beforeEach(() => {
    resetTvnChannel()
    refused.clear()
    now = T0
    seed = 1
    setTvnRandom(
      () => {
        seed = (seed * 16807) % 2147483647
        return seed / 2147483647
      },
      () => now,
    )
    setTvnLookup({ channels: () => network, broadcastOf: airing, onAir: (item) => item.enabled, refused: () => refused })
  })

  it('pools 001–999 by default, 1001+ only when asked, and never 000, 1000 or a disabled channel', () => {
    const numbers = (includeUser: boolean) => tvnPool(network, includeUser, (item) => item.enabled).map((item) => item.number)
    expect(numbers(false)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(numbers(true)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1001, 1002])
    for (let step = 0; step < 200; step += 1) {
      chooseAnotherTvn(now)
      expect([0, 13, 1000, 1001, 1002]).not.toContain(tvnChoice()!.channelNumber)
    }
  })

  it('stays 000 TVN while showing another channel’s programme, which it names without claiming', () => {
    now = T0 + MIN
    driveTvn(now)
    const snap = tvnBroadcast(now)
    const choice = tvnChoice()!
    expect(snap.channelId).toBe('ch-tvn')
    expect(snap.current.programme.relay).toEqual({ channelNumber: choice.channelNumber, channelName: `Channel ${choice.channelNumber}` })
    expect(snap.current.programme.videoId).toBe(choice.programme.videoId)
    expect(snap.current.seekSeconds).toBeCloseTo(60, 0)
    const markup = renderToStaticMarkup(
      createElement(ProgrammeInfo, { channel: TVN_CHANNEL, programme: snap.current.programme, startMs: snap.current.startMs, endMs: snap.current.endMs, now }),
    )
    expect(markup).toContain('<span>000</span><span>Channel Zero</span>')
    expect(markup).toContain(`On ${String(choice.channelNumber).padStart(3, '0')} · Channel ${choice.channelNumber} · chosen by TVN`)
  })

  it('chooses another when the programme ends, never straight back to the same channel, programme or source', () => {
    driveTvn(now)
    const seen: { channel: number; programme: string; source: string }[] = []
    for (let step = 0; step < 40; step += 1) {
      const choice = tvnChoice()!
      seen.push({ channel: choice.channelNumber, programme: choice.programme.videoId!, source: choice.programme.creator! })
      now = choice.endMs
      driveTvn(now)
      const snap = tvnBroadcast(now)
      expect(snap.current.programme.relay, `step ${step}`).toBeDefined()
    }
    for (let at = 1; at < seen.length; at += 1) {
      expect(seen[at].channel).not.toBe(seen[at - 1].channel)
      expect(seen[at].programme).not.toBe(seen[at - 1].programme)
      expect(seen[at].source).not.toBe(seen[at - 1].source)
    }
    expect(new Set(seen.map((item) => item.channel)).size).toBeGreaterThan(6)
  })

  it('only joins what has at least three minutes left, and never a refused programme', () => {
    now = T0 + SLOT - MIN
    expect(tvnBroadcast(now).current.programme.relay).toBeUndefined()
    now = T0 + 5 * MIN
    for (let channelNumber = 1; channelNumber <= 11; channelNumber += 1) refused.add(airing(network[channelNumber], now).current.programme.videoId!)
    chooseAnotherTvn(now)
    expect(tvnChoice()!.channelNumber).toBe(12)
    expect(tvnChoice()!.endMs - now).toBeGreaterThanOrEqual(MIN_REMAINING_MS)
  })

  it('with auto-next off, entering 000 still chooses, but an ended choice holds until 000 is entered again', () => {
    setTvnChannelSettings({ autoNext: false })
    enterTvn(now)
    const first = tvnChoice()!
    now = first.endMs + 1000
    const held = tvnBroadcast(now)
    expect(held.current.programme.relay).toBeUndefined()
    expect(held.current.programme.title).toBe('TVN Selection')
    expect(held.current.programme.caption).toMatch(/HAS ENDED/)
    expect(tvnBroadcast(now + 2000).current.programme.id).toBe('tvn-holding')
    expect(tvnChoice()).toBe(first)
    enterTvn(now + 3000)
    expect(tvnChoice()).not.toBe(first)
    expect(tvnBroadcast(now + 3000).current.programme.relay).toBeDefined()
  })

  it('includes the User Network only when its setting is on', () => {
    setTvnChannelSettings({ includeUser: true })
    const numbers = new Set<number>()
    for (let step = 0; step < 300; step += 1) {
      chooseAnotherTvn(now)
      numbers.add(tvnChoice()!.channelNumber)
    }
    expect([...numbers].some((number) => number >= 1001)).toBe(true)
    expect(numbers.has(1000)).toBe(false)
    expect(tvnChannelSettings()).toEqual({ autoNext: true, includeUser: true })
  })

  it('the Guide shows NOW as the current choice and NEXT as “TVN Selection · To be selected”, nothing invented', () => {
    driveTvn(now)
    const slots = tvnGuideSlots(now - 2 * SLOT, now + 6 * SLOT)
    expect(slots).toHaveLength(2)
    expect(slots[0].programme.relay?.channelNumber).toBe(tvnChoice()!.channelNumber)
    expect(slots[1].programme).toMatchObject({ title: 'TVN Selection', description: 'To be selected', videoId: null })
    expect(slots[1].startMs).toBe(tvnChoice()!.endMs)
    expect(tvnBroadcast(now).next.programme.title).toBe('TVN Selection')
    // Asking about later never chooses.
    const before = tvnChoice()
    expect(tvnBroadcast(now + 5 * SLOT).current.programme.title).toBe('TVN Selection')
    expect(tvnChoice()).toBe(before)
  })

  it('keeps no personal data: the history is this session’s, in memory only', () => {
    const source = read('src/tvn/tvn-channel.ts')
    expect(source).not.toMatch(/indexedDB|watched|favourite|history.*localStorage/i)
    expect(source.match(/localStorage\.(get|set)Item\(SETTINGS_KEY/g)).toHaveLength(2)
  })
})

describe('Complete Export carries 000’s settings, never its choices', () => {
  const settings: PortableSettings = {
    volume: 50,
    muted: false,
    subtitles: false,
    sleepMinutes: 0,
    guideSplit: 0.5,
    infoShortcuts: { ...DEFAULT_SHORTCUTS },
    surfRange: { minSeconds: 5, maxSeconds: 20 },
    transition: 'tv-tune',
    transitionStyle: { ...DEFAULT_TRANSITION_SETTINGS },
    tvnChannel: { autoNext: false, includeUser: true },
  }
  it('round-trips auto-next and Include User Network, and leaves 1000 and 000’s history out', () => {
    const document = buildTvnExport({ stored: [], users: [], favourites: [0, 12], settings, now: new Date(T0) })
    const back = readTvnExportFile(JSON.stringify(document))
    if (!back.ok) throw new Error(back.errors.join('; '))
    expect(back.value.settings.tvnChannel).toEqual({ autoNext: false, includeUser: true })
    const text = JSON.stringify(document)
    expect(text).not.toMatch(/tvn-selection|relay|joinedMs|blob:|ch-1000|Local Media/)
    const bad = { ...document, settings: { ...document.settings, tvnChannel: { autoNext: 'yes' } } }
    const checked = validateTvnExport(bad)
    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.errors.join()).toMatch(/tvnChannel\.autoNext/)
  })
})

describe('playlist discovery in the Channel Editor', () => {
  it('reads the discovery answer, and adds only what the curator ticks', async () => {
    const read = (async (url: string) => {
      expect(url).toContain('mode=playlists')
      return Response.json({
        title: 'Artist',
        playlists: [
          { id: 'PLown00000000001', title: 'Debut (Full Album)', official: true, videos: 12, ownerId: 'UC1' },
          { id: 'PLfan00000000001', title: 'Fan mix', official: false, videos: null, ownerId: 'UC2' },
        ],
      })
    }) as unknown as typeof fetch
    const found = await lookUpPlaylists('@artist', read)
    expect(found.playlists).toEqual([
      { id: 'PLown00000000001', title: 'Debut (Full Album)', official: true, videos: 12 },
      { id: 'PLfan00000000001', title: 'Fan mix', official: false, videos: null },
    ])
    const markup = renderToStaticMarkup(createElement(PlaylistDiscovery, { channelUrl: 'https://www.youtube.com/@artist', present: new Set<string>(), disabled: false, onAdd: () => undefined }))
    expect(markup).toContain('Discover playlists')
    expect(markup).not.toContain('Fan mix')
    expect(read.toString()).not.toMatch(/key=/)
  })
})

describe('555 Daft Punk, acquired deeper', () => {
  const doc = JSON.parse(read('public/independent/playable.json')) as PlayableCatalogueV2
  const central = JSON.parse(read('src/data/central-sources.json')) as { channels: Record<string, { sources: { id: string; input: string; owner?: string; mode: string }[] }> }
  let items: ReturnType<typeof expandPlayableCatalogue> = []
  beforeAll(() => {
    items = expandPlayableCatalogue(doc)
    resetDirector()
    installUserCatalogue([], new Map())
    setMediaLibrary(items)
  }, 120_000)
  afterAll(() => resetDirector())

  it('adds only official playlists, each owned by the official channel, ahead of its uploads', () => {
    const sources = central.channels['555'].sources
    expect(sources.at(-1)).toMatchObject({ id: 'src_daftpunk', input: '@daftpunk' })
    const lists = sources.filter((source) => source.input.includes('playlist?list='))
    expect(lists.length).toBeGreaterThanOrEqual(8)
    expect(lists.every((source) => source.owner === 'src_daftpunk' && source.mode === 'all' && /list=PLSdoVPM5Wnn/.test(source.input))).toBe(true)
    expect(read('scripts/central-channel.ts')).toMatch(/found\.ownerId !== owner\.channelId/)
  })

  it('airs far more than the first read: at least 150 programmes and 15 hours, deduplicated, with provenance', () => {
    const pool = getChannelMedia(schedulingPool(items) as unknown as MediaItem[], 555)
    const hours = pool.reduce((sum, item) => sum + (item.durationSeconds ?? 0), 0) / 3600
    console.info(`555: ${pool.length} programmes, ${hours.toFixed(2)} h`)
    expect(pool.length).toBeGreaterThanOrEqual(150)
    expect(hours).toBeGreaterThan(15)
    const ids = pool.map((item) => (item as { externalId?: string }).externalId ?? item.id)
    expect(new Set(ids).size).toBe(ids.length)
    const provenance = new Set(pool.map((item) => (item as { sourceId?: string }).sourceId))
    expect(provenance.has('src_daftpunk')).toBe(true)
    expect(provenance.has('src_daftpunk_homework')).toBe(true)
    expect(pool.every((item) => (item.durationSeconds ?? 0) >= 120 && !/#shorts|teaser|trailer|watch now/i.test(item.title ?? ''))).toBe(true)
  })

  it('reaches the older eras the first read missed', () => {
    const titles = getChannelMedia(schedulingPool(items) as unknown as MediaItem[], 555).map((item) => item.title ?? '')
    for (const era of [/Da Funk|Around The World|Revolution 909/i, /One More Time|Digital Love|Harder, Better/i, /Robot Rock|Technologic/i, /Live 2007|Alive 2007/i, /Get Lucky|Instant Crush/i]) {
      expect(titles.some((title) => era.test(title)), String(era)).toBe(true)
    }
  })

  it('the Guide search index sees the expanded 555 with no Guide-specific code', () => {
    const index = buildSearchIndex(searchChannels(() => undefined, new Set()))
    const own = index.entries.filter((entry) => entry.channel.number === 555)
    expect(own.length).toBeGreaterThanOrEqual(150)
    const guide = buildSearchGuide(index, 'Daft Punk')
    expect(guide.matched).toBeGreaterThanOrEqual(150)
    expect(guide.picks.some((pick) => /Da Funk|Around The World|One More Time|Harder, Better/i.test(pick.entry.programme.title))).toBe(true)
    expect(index.entries.some((entry) => entry.channel.number === 0 || entry.channel.number === 1000)).toBe(false)
  })
})

describe('000 TVN: a continuous channel surfer on the Random Cycle wait', () => {
  const DWELL = 3 * MIN
  let now = T0
  let seed = 7
  let dwell = DWELL
  beforeEach(() => {
    resetTvnChannel()
    refused.clear()
    now = T0 + 2 * MIN
    seed = 7
    dwell = DWELL
    setTvnRandom(
      () => {
        seed = (seed * 16807) % 2147483647
        return seed / 2147483647
      },
      () => now,
    )
    setTvnLookup({ channels: () => network, broadcastOf: airing, onAir: (item) => item.enabled, refused: () => refused, dwellMs: () => dwell })
  })

  it('surfs on after each wait, stays 000 throughout, and joins every channel where it is now', () => {
    const seen: number[] = []
    driveTvn(now)
    for (let hop = 0; hop < 3; hop += 1) {
      const choice = tvnChoice()!
      seen.push(choice.channelNumber)
      expect(choice.untilMs - now, `hop ${hop}`).toBe(DWELL)
      const snap = tvnBroadcast(now)
      expect(snap.channelId).toBe('ch-tvn')
      expect(snap.current.programme.relay?.channelNumber).toBe(choice.channelNumber)
      // Joined at the source's present position, not from the programme's start.
      expect(snap.current.seekSeconds).toBeCloseTo((now - choice.startMs) / 1000, 3)
      expect(snap.current.seekSeconds).toBeGreaterThan(0)
      now += DWELL - 1000
      driveTvn(now)
      expect(tvnChoice()).toBe(choice)
      now += 1000
      driveTvn(now)
      expect(tvnChoice()).not.toBe(choice)
    }
    expect(new Set(seen).size).toBe(3)
  })

  it('surfs on as soon as the programme ends when that comes before the wait', () => {
    dwell = 60 * MIN
    driveTvn(now)
    const first = tvnChoice()!
    expect(first.untilMs).toBe(first.endMs)
    now = first.endMs
    driveTvn(now)
    expect(tvnChoice()!.channelNumber).not.toBe(first.channelNumber)
  })

  it('with Keep surfing off it makes one choice and holds it to its end; the wait never forces another', () => {
    setTvnChannelSettings({ autoNext: false })
    enterTvn(now)
    const first = tvnChoice()!
    expect(first.untilMs).toBe(first.endMs)
    now += DWELL * 2
    driveTvn(now)
    expect(tvnChoice()).toBe(first)
    now = first.endMs + 1000
    driveTvn(now)
    expect(tvnChoice()).toBe(first)
    expect(tvnBroadcast(now).current.programme.id).toBe('tvn-holding')
  })

  it('switching Keep surfing off during a wait lets the choice play on, then holds', () => {
    driveTvn(now)
    const first = tvnChoice()!
    setTvnChannelSettings({ autoNext: false })
    now = first.untilMs + 1000
    driveTvn(now)
    expect(tvnChoice()).toBe(first)
    expect(tvnBroadcast(now).current.programme.relay?.channelNumber).toBe(first.channelNumber)
  })

  it('a new Random Cycle wait applies from the next choice', () => {
    driveTvn(now)
    const first = tvnChoice()!
    dwell = 10_000
    expect(tvnChoice()!.untilMs).toBe(first.untilMs)
    now = first.untilMs
    driveTvn(now)
    expect(tvnChoice()!.untilMs - now).toBe(10_000)
  })

  it('Choose another picks at once and restarts the wait', () => {
    driveTvn(now)
    const first = tvnChoice()!
    now += MIN
    chooseAnotherTvn(now)
    const next = tvnChoice()!
    expect(next.channelNumber).not.toBe(first.channelNumber)
    expect(next.untilMs - now).toBe(DWELL)
  })

  it('surfs on when the player reports the sampled video really ended, and ignores an ENDED from one it has left', () => {
    driveTvn(now)
    const first = tvnChoice()!
    expect(endedTvn(now + 1000, 'some-earlier-video')).toBe(false)
    expect(tvnChoice()).toBe(first)
    expect(endedTvn(now + 1000, first.programme.videoId)).toBe(true)
    expect(tvnChoice()!.channelNumber).not.toBe(first.channelNumber)
  })

  it('looking at 000 (the Guide, the bar, a search) never makes or moves a choice', () => {
    expect(tvnGuideSlots(now - SLOT, now + 4 * SLOT).at(-1)?.programme.title).toBe('TVN Selection')
    expect(tvnChoice()).toBeNull()
    driveTvn(now)
    const first = tvnChoice()!
    now = first.untilMs + 5000
    tvnGuideSlots(now - SLOT, now + 4 * SLOT)
    tvnBroadcast(now)
    tvnBroadcast(now + 5 * SLOT)
    expect(tvnChoice()).toBe(first)
  })

  it('never samples a live broadcast, while a recorded live performance stays eligible', () => {
    const live = (on: Channel, nowMs: number) => {
      const snap = airing(on, nowMs)
      const playback = on.number <= 6 ? 'live' : undefined
      const title = on.number <= 6 ? 'Live now' : 'Live at the Roundhouse (recorded)'
      return { ...snap, current: { ...snap.current, programme: { ...snap.current.programme, title, playback, programmeType: on.number <= 6 ? 'live' : 'performance' } as Programme } }
    }
    setTvnLookup({ channels: () => network, broadcastOf: live, onAir: (item) => item.enabled, refused: () => refused, dwellMs: () => dwell })
    for (let step = 0; step < 100; step += 1) {
      chooseAnotherTvn(now)
      expect(tvnChoice()!.channelNumber).toBeGreaterThan(6)
    }
  })

  it('surfing is driven only by watching 000: no timer of its own, Random Cycle timing reused, and the Random Cycle stays on 000', () => {
    const tvn = read('src/tvn/tvn-channel.ts')
    expect(tvn).not.toMatch(/setTimeout|setInterval/)
    expect(read('src/services/broadcast.ts')).toContain('dwellMs: () => surfDelayMs(loadSurfRange()),')
    const provider = read('src/state/TvProvider.tsx')
    expect(provider).toContain("if (current.origin === 'tvn') driveTvn(nowMs)")
    expect(provider).toContain("if (target.origin === 'tvn') driveTvn(nowMs)")
    expect(provider).toContain('if (channelRef.current === TVN_CHANNEL_NUMBER) return setSurfHops((hops) => hops + 1)')
    expect(provider).toMatch(/if \(sampled && tvnChoice\(\) !== sampled\) presentTvnSurf\(\)/)
  })

  it("a surf's title card names the channel 000 has just joined; a tune made during it names its own channel", () => {
    const provider = read('src/state/TvProvider.tsx')
    expect(provider).toContain('const sampled = tvnChoice()?.channelNumber')
    expect(provider).toContain('number: TVN_CHANNEL_NUMBER, settings, ...(sampled !== undefined ? { cardNumber: sampled } : {}) }')
    expect(provider).toContain('held ? { session: held.session, number, settings: held.settings }')
    expect(read('src/app/TvScreen.tsx')).toContain('channelNumber={layer.presentation.cardNumber ?? layer.number}')
  })
})
