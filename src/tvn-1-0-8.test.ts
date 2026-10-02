import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AddChannelForm, GuideActions } from './components/GuideAdd.tsx'
import { adjacentChannel, channelByNumber, listChannels } from './data/catalogue.ts'
import { channelMatchesFilter } from './data/network.ts'
import { installUserCatalogue } from './data/user-overlay.ts'
import { resetDirector } from './director/director.ts'
import { DEDICATED, INDIAN_COOKING_TITLE, PROGRAMME_REUSE, programmeSuitsChannel } from './director/fit.ts'
import { setMediaLibrary } from './director/library.ts'
import type { MediaItem } from './director/types.ts'
import { schedulingPool } from './library/mode.ts'
import { expandPlayableCatalogue, type PlayableCatalogueV2 } from './library/playable-catalogue.ts'
import { getChannelMedia } from './library/query.ts'
import type { LibraryMedia } from './library/types.ts'
import { originalCard } from './originals/originals.ts'
import { lookUpChannel } from './services/add-channel.ts'
import { DEFAULT_PREFERENCES, loadPreferences, PREFERENCES_KEY, savePreferences } from './services/preferences.ts'
import { applyChannelEdit, editOf, rescanChannel, sourcesOf, type RescanDeps } from './services/channel-editor.ts'
import { canonicalYouTubeUrl, sourceStatusText, type ChannelSource } from './services/channel-sources.ts'
import {
  channelsFromSources,
  emptySlotRecord,
  planImport,
  type ImportedVideo,
  type ParsedExport,
  type StoredSource,
} from './services/channels-import.ts'
import { addChannelSource, clearUserChannel, planTestChannels, removeUserChannels } from './services/user-network.ts'
import {
  buildUserNetworkExport,
  exportFilename,
  MAX_LIST_VIDEOS,
  serialiseUserNetworkExport,
  storedKindOf,
  USER_NETWORK_FORMAT,
  validateUserNetworkExport,
} from './services/user-network-export.ts'
import { emptyUniverseNote, randomTarget, stepTarget, universeChannels, type ChannelUniverse, type Tuned } from './state/tuning.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const provider = read('src/state/TvProvider.tsx')

function videos(prefix: string, count: number, from = 0): ImportedVideo[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${String(from + index).padStart(11 - prefix.length, '0')}`,
    title: `${prefix} ${from + index + 1}`,
    durationSec: 900 + index * 60,
  }))
}

const A = 'UCaaaa000000000000000001'
const B = 'UCbbbb000000000000000002'
const C = 'UCcccc000000000000000003'
const LIST = 'PL490JTer_zRIZbIlQUdavpI-yelTGVBgu'

function added(channelId: string, name: string, number: number, list = videos(channelId.slice(2, 6), 6)): StoredSource {
  return { id: `yt:${channelId}`, name, videos: list, channelNumber: number, inLibrary: false, automatic: true, updatedAt: 1 }
}

function collection(id: string, name: string, number: number, list = videos(id.slice(4, 8), 5)): StoredSource {
  return { id, name, videos: list, channelNumber: number, inLibrary: true, automatic: true, updatedAt: 1 }
}

function install(sources: readonly StoredSource[]) {
  const built = channelsFromSources(sources)
  installUserCatalogue(built.channels, built.programmes)
  return built
}

const tuned = (channelNumber: number): Tuned => ({ channelNumber, previousNumber: null })
const user: ChannelUniverse = { filter: 'user', favourites: [] }
const favs = (...favourites: number[]): ChannelUniverse => ({ filter: 'favourites', favourites })
const sequence = (...values: number[]) => {
  let at = 0
  return () => values[at++ % values.length]
}

afterEach(() => installUserCatalogue([], new Map()))

describe('Guide tab sets the CH+ / CH- / R universe', () => {
  const network = () => [added(A, 'Alpha', 1001), added(B, 'Bravo', 1002), emptySlotRecord(1003, 1), added(C, 'Charlie', 1004)]

  it('ALL keeps the whole network exactly as before', () => {
    install(network())
    const all: ChannelUniverse = { filter: 'all', favourites: [] }
    for (const from of [1, 5, 101, 999, 1001, 1004]) {
      expect(stepTarget(tuned(from), null, 1, all)).toBe(adjacentChannel(from, 1).number)
      expect(stepTarget(tuned(from), null, -1, all)).toBe(adjacentChannel(from, -1).number)
      expect(stepTarget(tuned(from), null, 1)).toBe(adjacentChannel(from, 1).number)
    }
  })

  it('TVN steps only through the User Network the TVN tab lists, wrapping at both ends and skipping empty slots', () => {
    install(network())
    expect(universeChannels(user).map((channel) => channel.number)).toEqual([1001, 1002, 1003, 1004])
    expect(stepTarget(tuned(1001), null, 1, user)).toBe(1002)
    expect(stepTarget(tuned(1002), null, 1, user)).toBe(1004)
    expect(stepTarget(tuned(1004), null, 1, user)).toBe(1001)
    expect(stepTarget(tuned(1001), null, -1, user)).toBe(1004)
    expect(stepTarget(tuned(1004), null, -1, user)).toBe(1002)
    // TVN is the viewer's own network, not curated 001–999.
    for (const number of [1001, 1002, 1004]) expect(channelByNumber(number)!.origin).toBe('user-import')
  })

  it('enters a tab from a channel outside it at its first channel going up and its last going down', () => {
    install(network())
    expect(stepTarget(tuned(5), null, 1, user)).toBe(1001)
    expect(stepTarget(tuned(5), null, -1, user)).toBe(1004)
    expect(stepTarget(tuned(1003), null, 1, favs(7, 1002))).toBe(7)
    expect(stepTarget(tuned(1003), null, -1, favs(7, 1002))).toBe(1002)
  })

  it('a settling tune steps on from the pending channel inside the universe', () => {
    install(network())
    const first = stepTarget(tuned(1001), null, 1, user)
    expect(stepTarget(tuned(1001), first, 1, user)).toBe(1004)
  })

  it('FAVOURITES follows the favourites order, not channel numbers, and wraps', () => {
    install(network())
    const order = favs(1004, 7, 1001)
    expect(universeChannels(order).map((channel) => channel.number)).toEqual([1004, 7, 1001])
    expect(stepTarget(tuned(1004), null, 1, order)).toBe(7)
    expect(stepTarget(tuned(7), null, 1, order)).toBe(1001)
    expect(stepTarget(tuned(1001), null, 1, order)).toBe(1004)
    expect(stepTarget(tuned(1004), null, -1, order)).toBe(1001)
  })

  it('zero favourites tunes nothing and says so; one favourite stays on it', () => {
    install(network())
    expect(stepTarget(tuned(5), null, 1, favs())).toBeNull()
    expect(randomTarget(5, favs())).toBeUndefined()
    expect(emptyUniverseNote('favourites')).toBe('NO FAVOURITES TO TUNE')
    expect(stepTarget(tuned(1002), null, 1, favs(1002))).toBe(1002)
    expect(stepTarget(tuned(5), null, -1, favs(1002))).toBe(1002)
    expect(randomTarget(1002, favs(1002), () => 0.9)!.number).toBe(1002)
  })

  it('skips a cleared, deleted or invalid favourite', () => {
    install(network())
    // 1003 is an empty slot, 1099 does not exist, 64 is an excluded channel outside the directory.
    const order = favs(1003, 1099, 64, 1002, 1001)
    expect(stepTarget(tuned(1001), null, 1, order)).toBe(1002)
    expect(stepTarget(tuned(1002), null, 1, order)).toBe(1001)
    for (let i = 0; i < 20; i += 1) expect(randomTarget(1001, order, () => i / 20)!.number).toBe(1002)
  })

  it('a TVN tab with no user channels tunes nothing', () => {
    install([])
    expect(stepTarget(tuned(5), null, 1, user)).toBeNull()
    expect(randomTarget(5, user)).toBeUndefined()
    expect(emptyUniverseNote('user')).toBe('NO TVN CHANNELS TO TUNE')
  })

  it('R picks only eligible channels of the tab: on air, not empty, not the current one while there is a choice', () => {
    install(network())
    const picks = new Set<number>()
    const random = sequence(0, 0.2, 0.4, 0.6, 0.8, 0.99)
    for (let i = 0; i < 30; i += 1) picks.add(randomTarget(1001, user, random)!.number)
    expect([...picks].sort()).toEqual([1002, 1004])
    const allPicks = new Set<number>()
    for (let i = 0; i < 200; i += 1) allPicks.add(randomTarget(1001, { filter: 'all', favourites: [] }, () => i / 200)!.number)
    expect(allPicks.has(1003)).toBe(false)
    expect(allPicks.has(1001)).toBe(false)
  })

  it('the chosen tab persists after the Guide closes and across visits, in the existing preference', () => {
    const store = new Map<string, string>()
    const original = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) },
      configurable: true,
    })
    try {
      savePreferences({ ...DEFAULT_PREFERENCES, guideFilter: 'favourites', favouriteChannelNumbers: [1002] })
      expect(loadPreferences().guideFilter).toBe('favourites')
      savePreferences({ ...loadPreferences(), guideFilter: 'user' })
      expect(loadPreferences().guideFilter).toBe('user')
      expect([...store.keys()]).toEqual([PREFERENCES_KEY])
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true })
    }
    const close = provider.slice(provider.indexOf('const closeGuide = () => {'), provider.indexOf('const closeGuideTool = () => {'))
    expect(close).not.toContain('setGuideFilter')
  })

  it('the provider steps and picks inside the chosen tab, and changing the tab never retunes', () => {
    expect(provider).toContain("stepTarget(tuned(), pending, command.type === 'channel-up' ? 1 : -1, { filter: guideFilter, favourites })")
    expect(provider).toContain('randomTarget(channelRef.current, { filter: guideFilter, favourites })')
    const filterCase = provider.slice(provider.indexOf("case 'guide-filter'"), provider.indexOf('case ', provider.indexOf("case 'guide-filter'") + 10))
    expect(filterCase).not.toMatch(/requestTune|tuneTo|tune\(/)
    // The tab is the existing persisted preference; no second store.
    expect(provider).toContain('guideFilter')
    expect(provider).not.toMatch(/localStorage\.setItem\([^)]*universe/i)
  })
})

describe('EXPORT: the User Network as tvn-user-network-v1', () => {
  const edited = (): StoredSource => ({
    ...collection('src:retro-gaming', 'My Games', 1002, videos('rg', 3)),
    listName: 'Retro Gaming',
    channelSources: [
      { id: 's1', kind: 'collection', url: '', label: 'Retro Gaming', enabled: true, ref: 'Retro Gaming', videos: videos('rg', 3).map((video) => ({ ...video, watched: true })), status: { state: 'ready', playable: 3, checkedAt: 5 } },
      { id: 's2', kind: 'audio', url: 'https://radio.example/stream?token=SECRET123&station=7', label: 'Radio', enabled: false, info: { website: 'https://radio.example' } },
      { id: 's3', kind: 'youtube', url: '@someone', label: 'Someone', enabled: true, ref: B, youtube: 'channel', videos: videos('bb', 2) },
    ],
    runningOrder: ['rg00000000002', 'rg00000000000'],
  })
  const stored = (): StoredSource[] => [
    collection('src:big-list', 'Big List', 1005, videos('bl', MAX_LIST_VIDEOS + 7)),
    added(A, 'Alpha', 1001),
    edited(),
    emptySlotRecord(1003, 9),
    { ...added(LIST, 'Saturday Films', 1004), sourceType: 'youtube-playlist' },
    collection('src:library-only', 'Library Only', null as unknown as number),
  ]
  const NOW = new Date(2026, 9, 1, 14, 30)

  it('exports only 1001+ channels, in number order, with the documented fields', () => {
    const doc = buildUserNetworkExport(stored(), NOW, (name) => (name === 'Retro Gaming' ? C : null))
    expect(doc.format).toBe(USER_NETWORK_FORMAT)
    expect(doc.version).toBe(1)
    expect(doc.channels.map((channel) => channel.number)).toEqual([1001, 1002, 1003, 1004, 1005])
    const [alpha, games, empty, films, big] = doc.channels
    expect(alpha).toMatchObject({ name: 'Alpha', state: 'populated', enabled: true, edited: false })
    expect(alpha.sources).toEqual([{ sourceType: 'youtube-channel', url: `https://www.youtube.com/channel/${A}`, providerId: A, label: 'Alpha', enabled: true }])
    expect(games).toMatchObject({ name: 'My Games', listName: 'Retro Gaming', edited: true, runningOrder: ['rg00000000002', 'rg00000000000'] })
    expect(games.sources.map((source) => [source.sourceType, source.enabled])).toEqual([['collection', true], ['audio', false], ['youtube-channel', true]])
    expect(games.sources[0]).toMatchObject({ uploaderChannelId: C, url: `https://www.youtube.com/channel/${C}`, providerId: 'Retro Gaming' })
    expect(games.sources[0].videos).toEqual(videos('rg', 3))
    expect(games.sources[1]).toMatchObject({ url: 'https://radio.example/stream?station=7', info: { website: 'https://radio.example' } })
    expect(games.sources[2]).toMatchObject({ url: `https://www.youtube.com/channel/${B}` })
    expect(games.sources[2].videos).toBeUndefined()
    expect(empty).toEqual({ number: 1003, owner: 'tvn', name: 'Empty channel', state: 'empty', enabled: true, edited: false, sources: [] })
    expect(films.sources[0]).toMatchObject({ sourceType: 'youtube-playlist', url: `https://www.youtube.com/playlist?list=${LIST}`, providerId: LIST })
    expect(big.sources[0].videos).toHaveLength(MAX_LIST_VIDEOS)
    expect(big.sources[0].videosOmitted).toBe(7)
  })

  it('never includes Channel 000 or 001–999, and reflects cleared slots in place', () => {
    const records = [...stored(), { ...collection('src:zero', 'Session', 0), channelNumber: 0 }, { ...collection('src:curated', 'Curated', 769), channelNumber: 769 }]
    const cleared = clearUserChannel(records, 1004, 3).sources
    const doc = buildUserNetworkExport(cleared, NOW)
    expect(doc.channels.map((channel) => channel.number)).toEqual([1001, 1002, 1003, 1004, 1005])
    expect(doc.channels.find((channel) => channel.number === 1004)).toMatchObject({ state: 'empty', sources: [] })
    expect(doc.channels.find((channel) => channel.number === 1005)).toMatchObject({ name: 'Big List', state: 'populated' })
  })

  it('leaves out secrets, playback state, history and object URLs', () => {
    const text = serialiseUserNetworkExport(buildUserNetworkExport(stored(), NOW))
    for (const banned of ['SECRET123', 'token=', '"watched"', '"status"', '"checkedAt"', 'blob:', 'retrotv_key', 'session', 'Library Only']) expect(text).not.toContain(banned)
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text).channels).toHaveLength(5)
  })

  it('is read-only: the stored records are not changed', () => {
    const records = stored()
    const before = structuredClone(records)
    const frozen = records.map((record) => Object.freeze(record))
    buildUserNetworkExport(frozen, NOW, () => C)
    expect(records).toEqual(before)
    const body = provider.slice(provider.indexOf('const exportUserNetwork = useCallback'), provider.indexOf('/** The editor\'s scope for this channel number'))
    expect(body).toContain('loadStoredSources()')
    for (const write of ['saveStoredSources', 'installSources', 'setFavourites', 'setGuideFilter', 'requestTune', 'savePreferences', 'localStorage']) expect(body).not.toContain(write)
  })

  it('names the file TVN_User_Network_YYYY-MM-DD.json', () => {
    expect(exportFilename(NOW)).toBe('TVN_User_Network_2026-10-01.json')
    expect(exportFilename(new Date(2027, 0, 9))).toBe('TVN_User_Network_2027-01-09.json')
  })

  it('validates its own output and refuses files a later IMPORT must not apply', () => {
    const doc = JSON.parse(serialiseUserNetworkExport(buildUserNetworkExport(stored(), NOW))) as Record<string, unknown>
    expect(validateUserNetworkExport(doc)).toMatchObject({ ok: true })
    const bad = (change: (copy: Record<string, any>) => void) => {
      const copy = structuredClone(doc) as Record<string, any>
      change(copy)
      return validateUserNetworkExport(copy)
    }
    expect(bad((copy) => (copy.format = 'tvn-user-network-v2'))).toMatchObject({ ok: false })
    expect(bad((copy) => (copy.version = 2))).toMatchObject({ ok: false })
    expect(bad((copy) => (copy.channels[1].number = 1001))).toMatchObject({ ok: false })
    expect(bad((copy) => (copy.channels[0].number = 769))).toMatchObject({ ok: false })
    expect(bad((copy) => (copy.channels[2].sources = [{ sourceType: 'youtube-channel', url: 'https://www.youtube.com/channel/x', label: '', enabled: true }]))).toMatchObject({ ok: false })
    expect(bad((copy) => (copy.channels[0].sources[0].sourceType = 'ftp'))).toMatchObject({ ok: false })
    expect(bad((copy) => (copy.channels[0].sources[0].url = 'blob:https://tvn.lol/123'))).toMatchObject({ ok: false })
    expect(bad((copy) => (copy.channels[4].sources[0].videos = videos('zz', MAX_LIST_VIDEOS + 1)))).toMatchObject({ ok: false })
    expect(validateUserNetworkExport(null)).toMatchObject({ ok: false })
    expect(storedKindOf('youtube-playlist')).toBe('youtube')
    expect(storedKindOf('collection')).toBe('collection')
  })

  it('EXPORT sits on the ADD CHANNEL line, after the link box and its IMPORT button, not in the Guide actions', () => {
    const html = renderToStaticMarkup(createElement(AddChannelForm, { nextNumber: 1055, onAdd: async () => '', onExport: async () => '' }))
    expect(html.indexOf('<input')).toBeLessThan(html.indexOf('>Import</button>'))
    const labels = [...html.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((match) => match[1])
    expect(labels).toEqual(['Import', 'Export'])
    const actions = renderToStaticMarkup(createElement(GuideActions, { tool: null, picked: false, onNow: () => {}, onTool: () => {} }))
    expect([...actions.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((match) => match[1])).toEqual(['Options', 'Now', 'Add', 'Media'])
    const guide = read('src/components/Guide.tsx')
    expect(guide.match(/<AddChannelForm [^>]*onExport=\{tv\.exportUserNetwork\}/g)).toHaveLength(2)
    expect(guide).not.toMatch(/<GuideActions[^>]*onExport/)
  })
})

describe('YouTube playlists as User Channel sources', () => {
  it('one playlist becomes one User Channel, named after the playlist and typed explicitly', () => {
    const result = addChannelSource([], { channelId: LIST, sourceType: 'youtube-playlist', title: 'Cooking Classics', videos: videos('pp', 3) }, 10)
    expect(result).toMatchObject({ status: 'added', number: 1001 })
    expect(result.sources[0]).toMatchObject({ id: `yt:${LIST}`, name: 'Cooking Classics', sourceType: 'youtube-playlist' })
    const [source] = sourcesOf(result.sources[0])
    expect(source).toMatchObject({ kind: 'youtube', youtube: 'playlist', ref: LIST, url: `https://www.youtube.com/playlist?list=${LIST}` })
    expect(sourceStatusText(source)).toMatch(/^YouTube playlist/)
  })

  it('keeps a renamed playlist channel’s name through RESCAN, which reads the playlist itself', async () => {
    const start = addChannelSource([], { channelId: LIST, sourceType: 'youtube-playlist', title: 'Cooking Classics', videos: videos('pl', 3) }, 10).sources
    const renamed = applyChannelEdit(start, 1001, { ...editOf(start[0]), name: 'Sunday Kitchen' }, 20)
    const asked: string[] = []
    const deps: RescanDeps = {
      async resolveYouTube(url) {
        asked.push(url)
        return { channelId: LIST, sourceType: 'youtube-playlist', title: 'Cooking Classics (2026)', videos: videos('pl', 5) }
      },
      probeStream: async () => 'online',
    }
    const before = renamed[0].videos.length
    const result = await rescanChannel(renamed, 1001, editOf(renamed[0]), deps, 30)
    const after = result.all[0].videos.length
    console.info(`playlist rescan: ${before} -> ${after} programmes`)
    expect(asked).toEqual([`https://www.youtube.com/playlist?list=${LIST}`])
    expect(result.all[0]).toMatchObject({ name: 'Sunday Kitchen', channelNumber: 1001, id: `yt:${LIST}` })
    expect([before, after]).toEqual([3, 5])
  })

  it('the lookup reports the source type, inferring it from the id when the server does not say', async () => {
    const answer = (body: object) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch
    const base = { title: 'X', videos: [{ id: 'aaaaaaaaaa1', title: 'A', durationSec: 600 }] }
    expect((await lookUpChannel('x', answer({ ...base, channelId: LIST })))).toMatchObject({ sourceType: 'youtube-playlist' })
    expect((await lookUpChannel('x', answer({ ...base, channelId: A })))).toMatchObject({ sourceType: 'youtube-channel' })
    expect((await lookUpChannel('x', answer({ ...base, channelId: A, sourceType: 'youtube-playlist' })))).toMatchObject({ sourceType: 'youtube-playlist' })
  })
})

describe('RESCAN genuinely refreshes', () => {
  it('asks past every cache only for an explicit rescan', async () => {
    const calls: [string, RequestInit | undefined][] = []
    const answer = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push([String(input), init])
      return new Response(JSON.stringify({ channelId: A, title: 'Alpha', videos: [{ id: 'aaaaaaaaaa1', title: 'A', durationSec: 600 }] }))
    }) as typeof fetch
    await lookUpChannel('https://www.youtube.com/@alpha', answer)
    await lookUpChannel(`https://www.youtube.com/channel/${A}`, answer, { fresh: true, now: () => 1234 })
    expect(calls[0]).toEqual(['/api/channel?url=https%3A%2F%2Fwww.youtube.com%2F%40alpha', undefined])
    expect(calls[1][0]).toBe(`/api/channel?url=${encodeURIComponent(`https://www.youtube.com/channel/${A}`)}&refresh=1234`)
    expect(calls[1][1]).toEqual({ cache: 'no-store' })
    expect(read('netlify/functions/channel.ts')).toContain('channelCacheControl(url, status)')
    expect(read('server/youtube-channel.ts')).toContain("response.setHeader('cache-control', channelCacheControl(url, status))")
    expect(provider).toContain('lookUpChannel(url, fetch, { fresh: true })')
    expect(provider).toContain('uploaderOf: uploaderIdFor')
  })

  it('refreshes an imported list from its uploader, keeping identity, name, switches and order (before/after counts)', async () => {
    const list = videos('rg', 4)
    const record: StoredSource = {
      ...collection('src:retro-gaming', 'My Retro Games', 1002, list),
      listName: 'Retro Gaming',
      channelSources: [
        { id: 's1', kind: 'collection', url: '', label: 'Retro Gaming', enabled: true, ref: 'Retro Gaming', videos: list, info: { website: 'https://retro.example' } },
        { id: 's2', kind: 'youtube', url: '@off', label: 'Off', enabled: false, ref: B, videos: videos('of', 2) },
      ],
      runningOrder: [list[2].id, list[0].id],
    }
    const others = [added(A, 'Alpha', 1001), added(C, 'Charlie', 1003)]
    const all = [others[0], record, others[1]]
    const asked: string[] = []
    const fresh = [...videos('nw', 3), list[1]]
    const deps: RescanDeps = {
      async resolveYouTube(url) {
        asked.push(url)
        return { channelId: C, sourceType: 'youtube-channel', title: 'Retro Gaming Uploads', videos: fresh }
      },
      probeStream: async () => 'online',
      uploaderOf: (name) => (name === 'Retro Gaming' ? C : null),
    }
    const before = all[1].videos.length
    const result = await rescanChannel(all, 1002, editOf(record), deps, 50)
    const after = result.all[1].videos.length
    console.info(`collection rescan: ${before} -> ${after} programmes`)
    expect(asked).toEqual([`https://www.youtube.com/channel/${C}`])
    expect(before).toBe(4)
    expect(after).toBe(7)
    expect(result.all[1].videos.slice(0, 3).map((video) => video.id)).toEqual(videos('nw', 3).map((video) => video.id))
    expect(result.all[1]).toMatchObject({ id: 'src:retro-gaming', name: 'My Retro Games', listName: 'Retro Gaming', channelNumber: 1002 })
    expect(result.all[1].runningOrder!.slice(0, 2)).toEqual([list[2].id, list[0].id])
    const [listSource, off] = result.all[1].channelSources!
    expect(listSource).toMatchObject({ kind: 'collection', ref: 'Retro Gaming', enabled: true, info: { website: 'https://retro.example' } })
    expect(off).toEqual(record.channelSources![1])
    expect(result.all[0]).toBe(others[0])
    expect(result.all[2]).toBe(others[1])
  })

  it('an added channel picks up new uploads on RESCAN without delete and re-add, and without duplicates', async () => {
    const first = videos('aa', 4)
    const start = addChannelSource([added(B, 'Bravo', 1001)], { channelId: A, sourceType: 'youtube-channel', title: 'Alpha', videos: first }, 10).sources
    const renamed = applyChannelEdit(start, 1002, { ...editOf(start[1]), name: 'My Alpha' }, 11)
    const later = [...videos('nw', 2), ...first]
    const asked: string[] = []
    const deps: RescanDeps = {
      async resolveYouTube(url) {
        asked.push(url)
        return { channelId: A, sourceType: 'youtube-channel', title: 'Alpha', videos: later }
      },
      probeStream: async () => 'online',
    }
    const before = renamed[1].videos.length
    const result = await rescanChannel(renamed, 1002, editOf(renamed[1]), deps, 12)
    const after = result.all[1].videos
    console.info(`added channel rescan: ${before} -> ${after.length} programmes`)
    expect([before, after.length]).toEqual([4, 6])
    expect(new Set(after.map((video) => video.id)).size).toBe(after.length)
    expect(asked).toEqual([`https://www.youtube.com/channel/${A}`])
    expect(result.all[1]).toMatchObject({ id: `yt:${A}`, name: 'My Alpha', channelNumber: 1002 })
    expect(result.all[1].channelSources![0]).toMatchObject({ kind: 'youtube', ref: A, youtube: 'channel' })
    expect(result.all[0]).toBe(renamed[0])
  })

  it('a YouTube source rescans its canonical address, not the link first pasted, and a failure keeps what it had', async () => {
    const source: ChannelSource = { id: 's1', kind: 'youtube', url: 'https://youtu.be/Bu9SOZwn2Oo', label: 'A', enabled: true, ref: A, videos: videos('aa', 2) }
    expect(canonicalYouTubeUrl(source)).toBe(`https://www.youtube.com/channel/${A}`)
    expect(canonicalYouTubeUrl({ ...source, ref: undefined })).toBe('https://youtu.be/Bu9SOZwn2Oo')
    const record = { ...added(A, 'Alpha', 1001), channelSources: [source] }
    const failing: RescanDeps = { resolveYouTube: async () => Promise.reject(new Error('offline')), probeStream: async () => 'online' }
    const result = await rescanChannel([record], 1001, editOf(record), failing, 9)
    expect(result.all[0].videos.map((video) => video.id)).toEqual(videos('aa', 2).map((video) => video.id))
    expect(result.all[0].channelSources![0].status?.state).toBe('failed')
  })

  it('an imported list with no known uploader has nothing to ask and is left as it is', async () => {
    const record = collection('src:mystery', 'Mystery', 1001)
    const asked: string[] = []
    const deps: RescanDeps = { resolveYouTube: async (url) => (asked.push(url), Promise.reject(new Error('no'))), probeStream: async () => 'online', uploaderOf: () => null }
    const result = await rescanChannel([record], 1001, editOf(record), deps, 9)
    expect(asked).toEqual([])
    expect(result.all[0].videos).toEqual(record.videos)
  })
})

describe('a cleared 1001+ channel keeps its number as an empty slot', () => {
  const network = () => [added(A, 'Alpha', 1001), added(B, 'Bravo', 1002), added(C, 'Charlie', 1003)]

  it('clears without renumbering anything', () => {
    const result = clearUserChannel(network(), 1002, 7)
    expect(result.status).toBe('cleared')
    expect(result.sources.map((source) => [source.channelNumber, source.name, Boolean(source.emptySlot)])).toEqual([
      [1001, 'Alpha', false],
      [1002, 'Empty channel', true],
      [1003, 'Charlie', false],
    ])
    expect(result.sources[1]).toMatchObject({ videos: [], channelSources: [], automatic: true })
    expect(clearUserChannel(result.sources, 1002, 8).status).toBe('already-empty')
    expect(clearUserChannel(result.sources, 1099, 8).status).toBe('missing')
  })

  it('clearing 1004 leaves slot 1004; 1005 stays 1005; the next channel fills 1004', () => {
    const five = [...network(), added('UCdddd000000000000000004', 'Delta', 1004), added('UCeeee000000000000000005', 'Echo', 1005)]
    const cleared = clearUserChannel(five, 1004, 7).sources
    expect(cleared.map((source) => source.channelNumber)).toEqual([1001, 1002, 1003, 1004, 1005])
    expect(cleared.find((source) => source.channelNumber === 1005)?.name).toBe('Echo')
    const refilled = addChannelSource(cleared, { channelId: 'UCffff000000000000000006', title: 'Foxtrot', videos: videos('ff', 3) }, 9)
    expect(refilled).toMatchObject({ status: 'added', number: 1004 })
    expect(refilled.sources.find((source) => source.channelNumber === 1005)?.name).toBe('Echo')
  })

  it('is not applied to 001–999', () => {
    const before = network()
    const result = clearUserChannel(before, 769, 7)
    expect(result.status).toBe('missing')
    expect(result.sources).toEqual(before)
  })

  it('stays listed and tunable by number as an empty channel, but never airs a programme', () => {
    const cleared = clearUserChannel(network(), 1002, 7).sources
    const built = install(cleared)
    const slot = channelByNumber(1002)!
    expect(slot).toMatchObject({ name: 'Empty channel', emptySlot: true, origin: 'user-import' })
    const [holding] = built.programmes.get(slot.id)!
    expect(holding).toMatchObject({ videoId: null, caption: 'EMPTY USER CHANNEL · ADD A SOURCE IN THE GUIDE' })
    expect(channelMatchesFilter(slot, 'user', [])).toBe(true)
    expect(listChannels().filter((channel) => channel.number >= 1001).map((channel) => channel.number)).toEqual([1001, 1002, 1003])
  })

  it('a new channel fills the lowest empty slot before a higher number and never overwrites a populated one', () => {
    let sources = clearUserChannel(clearUserChannel(network(), 1003, 7).sources, 1002, 7).sources
    const first = addChannelSource(sources, { channelId: 'UCdddd000000000000000004', title: 'Delta', videos: videos('dd', 3) }, 9)
    expect(first).toMatchObject({ status: 'added', number: 1002 })
    sources = first.sources
    const second = addChannelSource(sources, { channelId: 'UCeeee000000000000000005', title: 'Echo', videos: videos('ee', 3) }, 9)
    expect(second).toMatchObject({ status: 'added', number: 1003 })
    const third = addChannelSource(second.sources, { channelId: 'UCffff000000000000000006', title: 'Foxtrot', videos: videos('ff', 3) }, 9)
    expect(third).toMatchObject({ status: 'added', number: 1004 })
    expect(third.sources.filter((source) => source.emptySlot)).toEqual([])
    expect(third.sources.find((source) => source.channelNumber === 1001)?.name).toBe('Alpha')
    expect(new Set(third.sources.map((source) => source.channelNumber)).size).toBe(third.sources.length)
  })

  it('the starter network and list imports fill empty slots first too', () => {
    const cleared = clearUserChannel(network(), 1002, 7).sources
    const parsed: ParsedExport = { version: '2.4', sources: [{ id: 'src:new-list', name: 'New List', videos: videos('nl', 3) }, { id: 'src:other', name: 'Other', videos: videos('ot', 3) }], videoCount: 6, totalSeconds: 0, watchedCount: 0, warnings: [] }
    const starter = planTestChannels(cleared, parsed, 9)
    expect(starter.added).toEqual([1002, 1004])
    const imported = planImport(cleared, parsed, { library: true, automatic: true }, [], 9)
    expect(imported.sources.filter((source) => source.channelNumber !== null).map((source) => source.channelNumber).sort()).toEqual([1001, 1002, 1003, 1004])
    expect(imported.sources.some((source) => source.emptySlot)).toBe(false)
  })

  it('an empty slot stays editable: saving a source fills it, saving none keeps it empty', () => {
    const cleared = clearUserChannel(network(), 1002, 7).sources
    const keep = applyChannelEdit(cleared, 1002, { name: 'Empty channel', sources: [] }, 8)
    expect(keep[1]).toMatchObject({ emptySlot: true, channelNumber: 1002 })
    const filled = applyChannelEdit(cleared, 1002, { name: 'Empty channel', sources: [{ id: 's1', kind: 'youtube', url: `https://www.youtube.com/playlist?list=${LIST}`, label: 'Cooking Classics', enabled: true, ref: LIST, youtube: 'playlist', videos: videos('pl', 3) }] }, 8)
    expect(filled[1].emptySlot).toBeUndefined()
    expect(filled[1]).toMatchObject({ name: 'Cooking Classics', channelNumber: 1002 })
    expect(filled[1].videos).toHaveLength(3)
    const named = applyChannelEdit(cleared, 1002, { name: 'My Kitchen', sources: filled[1].channelSources! }, 8)
    expect(named[1].name).toBe('My Kitchen')
  })

  it('keeps a favourite on the slot number: Favourites still lists it, while CH+ / CH- / R skip it until it is filled', () => {
    const cleared = clearUserChannel(network(), 1002, 7).sources
    install(cleared)
    const favourites = [1002, 1001]
    expect(universeChannels({ filter: 'favourites', favourites }).map((channel) => channel.number)).toEqual([1002, 1001])
    expect(stepTarget(tuned(1001), null, 1, { filter: 'favourites', favourites })).toBe(1001)
    const refilled = addChannelSource(cleared, { channelId: 'UCdddd000000000000000004', title: 'Delta', videos: videos('dd', 3) }, 9).sources
    install(refilled)
    expect(stepTarget(tuned(1001), null, 1, { filter: 'favourites', favourites })).toBe(1002)
    expect(channelByNumber(1002)!.name).toBe('Delta')
  })

  it('the editor clears rather than deletes; bulk removal still removes', () => {
    const body = provider.slice(provider.indexOf('const deleteUserChannel = useCallback'), provider.indexOf('const screenAction'))
    expect(body).toContain('clearUserChannel(')
    expect(body).not.toContain('removeUserChannels(')
    expect(removeUserChannels(network(), [1002]).map((source) => source.channelNumber)).toEqual([1001, 1003])
  })
})

describe('769 Indian Cooking', () => {
  const doc = JSON.parse(read('public/independent/playable.json')) as PlayableCatalogueV2
  let pool: LibraryMedia[] = []
  const airing = (channel: number) => getChannelMedia(pool as MediaItem[], channel) as LibraryMedia[]
  const hours = (list: readonly LibraryMedia[]) => list.reduce((sum, item) => sum + item.durationSeconds, 0) / 3600

  beforeAll(() => {
    const items = expandPlayableCatalogue(doc)
    resetDirector()
    setMediaLibrary(items)
    pool = schedulingPool(items) as LibraryMedia[]
  }, 120_000)

  it('is the curated channel Indian Cooking, no longer the redundant Home Extra slot', () => {
    const channel = channelByNumber(769)!
    expect(channel.name).toBe('Indian Cooking')
    expect(channel.origin ?? 'default').toBe('default')
    expect(originalCard(769)).toBeUndefined()
    const manifest = JSON.parse(read('src/data/independent/manifest.json')) as { routes: { number: number; strategy: string; sourceIds: string[] }[] }
    expect(manifest.routes.find((route) => route.number === 769)).toEqual({ number: 769, strategy: 'SOURCE_ROUTED', sourceIds: ['src_manjulas_kitchen'] })
  })

  it('airs Manjula’s Kitchen Indian dishes, a full day and more', () => {
    const list = airing(769)
    console.info(`769 Indian Cooking: ${list.length} programmes, ${hours(list).toFixed(1)} h`)
    expect(hours(list)).toBeGreaterThanOrEqual(24)
    for (const item of list) {
      expect(item.sourceId, item.title).toBe('src_manjulas_kitchen')
      expect(item.title, item.title).toMatch(INDIAN_COOKING_TITLE)
    }
    expect(new Set(list.map((item) => item.externalId))).toEqual(new Set(doc.programmeRoutes?.['769']))
    const ids = new Set(list.map((item) => item.externalId))
    for (const id of ['LQsPJupfvH4', 'nAUEiuk9b20', 'ZTa1LsJAcTo', '-q9qwqV7onA']) expect(ids.has(id), id).toBe(true)
  })

  it('is Indian cooking, not generic food: Western and fusion recipes stay on 714 only', () => {
    const ids = new Set(airing(769).map((item) => item.externalId))
    for (const id of ['OnlQRaUZKGQ', 'f_wBYLqNH-E', 'XaBMyLtxPnk', '8pzK0eGCcDE', 'vgKGYZo55Fo', 'MEC9uB7dRNc']) expect(ids.has(id), id).toBe(false)
    for (const title of ['Homemade Pizza Recipe', 'Vegetable Pasta Recipe', 'Taco Samosa | A Unique Indian Mexican Fusion Recipe', 'Eggless Chocolate Cake Recipe', 'Classic Lemonade']) {
      expect(INDIAN_COOKING_TITLE.test(title), title).toBe(false)
    }
    for (const title of ['Punjabi Samosa Recipe', 'Malai Kofta Recipe', 'How to make Sambar', 'Indian Milk Cake Recipe', 'Handvo - Baked Spicy Lentil Cake']) {
      expect(INDIAN_COOKING_TITLE.test(title), title).toBe(true)
    }
    const generic = { id: 'yt:test-generic', title: 'Perfect Roast Chicken', durationSeconds: 900, programmeType: 'unclassified', topics: [], mediaKind: 'video', explicitChannelIncludes: [769], sourceId: 'src_atk' } as unknown as MediaItem
    expect(programmeSuitsChannel(generic, 769)).toBe(false)
  })

  it('routes exactly the Indian-dish programmes the shared rule chooses, through the normal reuse architecture', () => {
    const routed = doc.programmeRoutes?.['769'] ?? []
    const eligible = doc.items.filter((row) => row[3] === 'src_manjulas_kitchen' && INDIAN_COOKING_TITLE.test(row[1]))
    const chosen = [...eligible].sort((a, b) => b[2] - a[2] || (a[0] < b[0] ? -1 : 1)).slice(0, 170).map((row) => row[0])
    expect(eligible.length).toBe(247)
    expect(routed).toEqual(chosen)
    // 714 airs all 300; sharing 60% or more would darken 769 under the anti-duplication rule.
    expect(routed.length / 300).toBeLessThan(0.6)
    expect(PROGRAMME_REUSE[769]).toEqual(['src_manjulas_kitchen'])
    expect(DEDICATED.src_manjulas_kitchen).toEqual([714])
    expect(read('scripts/indian_cooking_routes.py')).toContain('Keep identical to INDIAN_COOKING_TITLE')
  })

  it('leaves 714 Vegetarian with all of Manjula’s Kitchen, and the old Home Extra rows off 769', () => {
    expect(airing(714).filter((item) => item.sourceId === 'src_manjulas_kitchen')).toHaveLength(300)
    expect(airing(769).some((item) => ['src_bh_photo', 'src_missouri_star', 'src_rhs'].includes(item.sourceId ?? ''))).toBe(false)
  })
})
