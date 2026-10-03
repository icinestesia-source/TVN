import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { networkLabel, ProgrammeInfo } from './components/ProgrammeInfo.tsx'
import { channelByNumber } from './data/catalogue.ts'
import { channelMayAir } from './data/independent/network.ts'
import { getSchedule, resetDirector } from './director/director.ts'
import { DEDICATED, HARVESTER_REUSE, PROGRAMME_REUSE, programmeSuitsChannel, SUBJECT_TITLES } from './director/fit.ts'
import { setMediaLibrary } from './director/library.ts'
import type { MediaItem } from './director/types.ts'
import { excludedProgramme } from './library/exclusions.ts'
import { schedulingPool } from './library/mode.ts'
import { expandPlayableCatalogue, type PlayableCatalogueV2 } from './library/playable-catalogue.ts'
import { getChannelMedia } from './library/query.ts'
import type { LibraryMedia } from './library/types.ts'
import { DEFAULT_FAVOURITES } from './services/default-favourites.ts'
import { DEFAULT_PREFERENCES, defaultFavouritesDue, loadPreferences, PREFERENCES_KEY, savePreferences } from './services/preferences.ts'
import type { Channel } from './types/channel.ts'
import type { Programme } from './types/programme.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const doc = JSON.parse(read('public/independent/playable.json')) as PlayableCatalogueV2
let items: LibraryMedia[] = []
let pool: LibraryMedia[] = []
const airing = (channel: number) => getChannelMedia(pool as MediaItem[], channel) as LibraryMedia[]
const hours = (list: readonly LibraryMedia[]) => list.reduce((sum, item) => sum + item.durationSeconds, 0) / 3600

beforeAll(() => {
  items = expandPlayableCatalogue(doc)
  resetDirector()
  setMediaLibrary(items)
  pool = schedulingPool(items) as LibraryMedia[]
})

const synthetic = (title: string, sourceId: string, channel: number): MediaItem => ({
  id: `yt:test-${title.length}`,
  title,
  durationSeconds: 1800,
  programmeType: 'unclassified',
  topics: [],
  mediaKind: 'video',
  explicitChannelIncludes: [channel],
  curatedChannels: [channel],
  ...({ sourceId } as object),
})

describe('787 Cats', () => {
  const WRONG = {
    TS3DLBOIABw: 'Catching the Waves (Royal Institution)',
    P9k4FP_b1fo: 'Catching Gravitational Waves (Royal Institution)',
    ZAFE0hJuoHU: 'Catskinner Keen (NFB)',
    '4nUVvGoGQwI': 'The Dagger Designed To Catch A Knight (Sky History)',
    rCDAWSzGk8E: 'A Neolithic Cathedral? (Time Team)',
    '3Yn2HsimjvA': 'Gebrüder Heubach Cats figurines (Antiques Roadshow)',
    DS0EAXwzZgc: 'Austrian "Naughty" Cat Bronze (Antiques Roadshow)',
    mideHecj724: 'Web Appraisal: German Cat Family (Antiques Roadshow)',
    ZTFWvOKvOcM: 'St. Giles’ Cathedral (Rick Steves)',
    '19IAwHsWy58': 'Tiniest Tiger Cub Is Now A Big Cat (The Dodo)',
  }

  it('no longer airs words that only begin with "cat", antique cat figurines or big cats', () => {
    const ids = new Set(airing(787).map((item) => item.externalId))
    for (const [id, title] of Object.entries(WRONG)) expect(ids.has(id), title).toBe(false)
  })

  it('airs genuine domestic-cat programmes, on air for at least three hours', () => {
    const cats = airing(787)
    expect(hours(cats)).toBeGreaterThanOrEqual(3)
    expect(cats.filter((item) => item.sourceId === 'src_the_dodo').length).toBeGreaterThanOrEqual(40)
    expect(cats.some((item) => item.externalId === '9nvWakgwumg')).toBe(true)
    for (const item of cats) expect(item.title, item.title).toMatch(/\b(cats?|kittens?|kitty|kitties|felines?)\b/i)
  })

  it('has not become a generic wildlife or animals channel', () => {
    const cats = airing(787)
    const animals = airing(788)
    expect(cats.length).toBeLessThan(animals.length / 3)
    for (const item of cats) expect(item.title, item.title).not.toMatch(/\b(big cats?|lions?|tigers?|leopards?|cheetahs?|wildlife|safari)\b/i)
    expect(programmeSuitsChannel(synthetic('Lions of the Serengeti: Big Cat Diary', 'src_the_dodo', 787), 787)).toBe(false)
    expect(programmeSuitsChannel(synthetic('Rescued Kitten Learns To Trust Again', 'src_the_dodo', 787), 787)).toBe(true)
  })

  it('leaves 788 Animals with its own Dodo programming', () => {
    expect(DEDICATED.src_the_dodo).toEqual([787, 788])
    expect(hours(airing(788))).toBeGreaterThan(20)
  })
})

describe('812 Fortnite', () => {
  it('is a curated channel in the 001–999 network, holding until it has real programming', () => {
    const channel = channelByNumber(812)!
    expect(channel.name).toBe('Fortnite')
    expect(channel.number).toBeGreaterThanOrEqual(1)
    expect(channel.number).toBeLessThanOrEqual(999)
    expect(channel.origin ?? 'default').toBe('default')
    expect(channelMayAir(812)).toBe(true)
    expect(airing(812)).toEqual([])
    expect(read('src/data/originals/originals.json')).toContain('AWAITING FORTNITE PROGRAMMING')
  })

  it('accepts only programmes about Fortnite, never generic gaming or a passing mention', () => {
    const rule = SUBJECT_TITLES.find((subject) => subject.channel.test('Fortnite'))!
    for (const title of ['Fortnite Save the World PvE mode: Your complete guide', 'Manufactured Discontent and Fortnite', 'Comics for the Cure: Comic Book YouTubers Play Fortnite']) {
      expect(rule.title.test(title), title).toBe(true)
    }
    for (const title of [
      'The History of Battle Royale Games',
      'Minecraft: The Complete Story',
      'Final Destination 7 Announced, Jason in Fortnite??, and More | Horror News',
      'how d4vd went from fortnite kid to global superstar',
    ]) {
      expect(rule.title.test(title), title).toBe(false)
    }
    expect(programmeSuitsChannel(synthetic('The History of Battle Royale Games', 'src_noclip', 812), 812)).toBe(false)
  })

  it('took an empty, redundant gaming slot rather than a healthy channel', () => {
    const manifest = JSON.parse(read('src/data/independent/manifest.json')) as { routes: { number: number; strategy: string; sourceIds: string[] }[] }
    expect(manifest.routes.find((route) => route.number === 812)).toEqual({ number: 812, strategy: 'SOURCE_ROUTED', sourceIds: [] })
    expect(hours(airing(242))).toBeGreaterThan(3)
  })
})

describe('starter Favourites', () => {
  const withStore = <T,>(seed: Record<string, string>, run: () => T): T => {
    const store = new Map(Object.entries(seed))
    const original = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) },
      configurable: true,
    })
    try {
      return run()
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true })
    }
  }
  const record = (fields: Record<string, unknown>) => ({ [PREFERENCES_KEY]: JSON.stringify(fields) })
  const { defaultFavouritesOffered: _marker, ...preMarker } = DEFAULT_PREFERENCES
  const visit = (change: (favourites: number[]) => number[] = (same) => same) => {
    const loaded = loadPreferences()
    savePreferences({ ...loaded, favouriteChannelNumbers: change(loaded.favouriteChannelNumbers), defaultFavouritesOffered: true })
    return loaded.favouriteChannelNumbers
  }
  const NINETEEN = [225, 125, 534, 289, 1008, 710, 103, 1052, 805, 535, 1119, 412, 1023, 485, 1095, 844, 536, 491, 1102]

  it('are exactly the nineteen requested channels, in order', () => expect(DEFAULT_FAVOURITES).toEqual(NINETEEN))

  it('a fresh viewer gets all nineteen in order', () => {
    withStore({}, () => {
      expect(defaultFavouritesDue()).toBe(true)
      expect(visit()).toEqual(NINETEEN)
      expect(defaultFavouritesDue()).toBe(false)
    })
  })

  it('a browser saved before the starter Favourites existed, with none of its own, is offered them once', () => {
    withStore(record({ ...preMarker, favouriteChannelNumbers: [] }), () => {
      expect(defaultFavouritesDue()).toBe(true)
      expect(visit()).toEqual(NINETEEN)
      visit(() => [])
      expect(defaultFavouritesDue()).toBe(false)
      expect(visit()).toEqual([])
      expect(visit()).toEqual([])
    })
  })

  it('existing favourites are preserved exactly, marker or not', () => {
    withStore(record({ ...preMarker, favouriteChannelNumbers: [701, 301, 1001] }), () => {
      expect(defaultFavouritesDue()).toBe(false)
      expect(visit()).toEqual([701, 301, 1001])
      expect(visit()).toEqual([701, 301, 1001])
    })
  })

  it('edited defaults are preserved and a removed default never returns', () => {
    withStore({}, () => {
      visit((favourites) => [...favourites.filter((number) => number !== 225 && number !== 1008), 301])
      for (let reload = 0; reload < 3; reload += 1) {
        const back = visit()
        expect(back).not.toContain(225)
        expect(back).not.toContain(1008)
        expect(back.at(-1)).toBe(301)
        expect(back).toHaveLength(NINETEEN.length - 1)
      }
    })
  })

  it('a deliberately emptied list stays empty', () => {
    withStore(record({ ...DEFAULT_PREFERENCES, favouriteChannelNumbers: [] }), () => {
      expect(defaultFavouritesDue()).toBe(false)
      expect(visit()).toEqual([])
    })
  })

  it('an unreadable record is never treated as a new viewer', () => {
    withStore({ [PREFERENCES_KEY]: '{broken' }, () => expect(defaultFavouritesDue()).toBe(false))
    withStore(record({ version: 9 }), () => expect(defaultFavouritesDue()).toBe(false))
  })

  it('1001+ favourites keep their numbers', () => {
    withStore(record({ ...DEFAULT_PREFERENCES, favouriteChannelNumbers: [1004, 1057, 1080] }), () => expect(visit()).toEqual([1004, 1057, 1080]))
  })
})

describe('information overlay label', () => {
  const channel = (number: number, name: string, origin?: Channel['origin']) => ({ id: `c${number}`, number, name, origin, mediaKind: 'video' }) as Channel
  const programme = { id: 'p', title: 'A Programme Title', description: '', durationSeconds: 1800, videoId: 'abcdefghijk' } as Programme
  const kicker = (c: Channel) => {
    const html = renderToStaticMarkup(createElement(ProgrammeInfo, { channel: c, programme, startMs: 0, endMs: 1_800_000, now: 60_000 }))
    return { html, kicker: html.slice(html.indexOf('<p class="info-kicker">'), html.indexOf('</p>', html.indexOf('<p class="info-kicker">'))) }
  }

  it('reads TVN on 1001+ channels, ahead of the unchanged channel name and title', () => {
    expect(networkLabel(channel(1004, 'Argyle Life | Green', 'user-import'))).toBe('TVN')
    const { html, kicker: k } = kicker(channel(1004, 'Argyle Life | Green', 'user-import'))
    expect(k).toBe('<p class="info-kicker"><span class="info-net">TVN</span><span>1004</span><span>Argyle Life | Green</span>')
    expect(k).not.toContain('User')
    expect(html).toContain('<h2 class="info-title">A Programme Title</h2>')
  })

  it('leaves 001–999 channels and sessions exactly as they were', () => {
    expect(networkLabel(channel(225, 'Saturday Cartoons'))).toBeNull()
    expect(kicker(channel(225, 'Saturday Cartoons')).kicker).toBe('<p class="info-kicker"><span>225</span><span>Saturday Cartoons</span>')
    expect(networkLabel(channel(1000, 'Local Media', 'session'))).toBeNull()
  })

  it('keeps the phone layout: same spans and styles, a label no longer than before', () => {
    expect('TVN'.length).toBeLessThanOrEqual('User'.length)
    const css = read('src/styles/guide.css')
    expect(css).toMatch(/\.info-net \{\s*margin-right: 8px;\s*color: var\(--muted\);\s*\}/)
    expect(read('src/styles/overlays.css')).toMatch(/\.info-next \.info-net \{\s*flex: none;/)
  })

  it('leaves the channel editor and User Network tool wording alone', () => {
    expect(read('src/components/ChannelEditor.tsx')).toContain(`{scope === 'curated' ? 'TVN' : 'User'}`)
    expect(read('src/components/GuideAdd.tsx')).toContain('<span className="info-net">User</span>')
  })
})

describe('first Harvester import', () => {
  const IMPORTED: Record<number, string[]> = {
    37: ['M6h5AS971hY', 'csbcfZIRCnQ'],
    118: ['MJtHaJfDdKM', 'lvX6qlnSB3U', 'KInB0klpDoQ', 'W_fk8ufQAus', '204OS5rQpYM', 'Z0UsmjvTL70', 'abETrgYZZvQ', 'aSVrwxvzxy4', 'i2p2SXUN9x8', 'pnC6yRltB3c'],
    143: ['14jxH5CWvrg', 'lFDGOG_Lzes', 'EbNiGIPi4MY', 'QfEjiEr1FMY', '50nWa8bYQJU', 'C9Z-ar3gHAA', 'CnxfJ7oIw9U', 'H0mTi_sVDII', 'hBa1z1IU8Ac', 'j883-LC2Yy8'],
    149: ['GVSwxNw40Bs', 'nYuXO7fFpJc'],
    152: ['yRDc2J058KM', '5ujLwlhujRk', 'CkiPwkM7q6M'],
    157: ['dWQQmjxifJs', '_Gb82sj3srY'],
    218: ['mw8DD1RBrC0', 'Os8V74XvOEU', 'OTEVa1x3z_k'],
    275: ['hFuy0VkNWeg', 'thSXkB1d4Go'],
    390: ['j6AVzl50yLw', 'tPN7Jh-yf0U', 'Q9QjmcCl0jM'],
    404: ['SxN3k2yngsc', 'crhxfveewH8'],
    450: ['AapCA57CJgs'],
    471: ['n98aYhZnsUI'],
    609: ['WGZJi8c8_ZQ'],
    675: ['VZ1o_F8ULjw'],
    695: ['AmIiqY2VJkQ', 'WtE0trXodXo'],
    696: ['2kisf05A_T4'],
    746: ['Qt8l8gyVsGE'],
    916: ['NLKQvKKi-Sc', 'aOINaGPIUoQ'],
  }
  const HELD = ['FNZhxTtOL-I', 'PkikjVJRJrQ', '7rTC1Fgzwfs', 'j5CiKSQ11nQ', 'pwFbZRWqWGw', 'IS-gpbwEfoI', 'R4YdSsi8Xqc', 'ykAdJt2vhAk', 'xegsA-rweC0', 'Iikm9DFpU3Q', 'e9lbbfi8v10', 'lhW05vDhCLA', 'qio4GbRkhPs']
  const all = Object.values(IMPORTED).flat()

  it('imported 49 programmes onto 18 curated channels, each in the catalogue once', () => {
    expect(all).toHaveLength(49)
    expect(new Set(all).size).toBe(49)
    expect(Object.keys(IMPORTED)).toHaveLength(18)
    const rows = doc.items.filter((row) => all.includes(row[0]))
    expect(rows).toHaveLength(49)
    for (const n of Object.keys(IMPORTED).map(Number)) expect(n).toBeLessThanOrEqual(999)
    for (const id of HELD) expect(doc.items.some((row) => row[0] === id), id).toBe(false)
  })

  it('airs every imported programme on its destination and nowhere in 1001+', () => {
    for (const [channel, ids] of Object.entries(IMPORTED)) {
      const aired = new Set(airing(Number(channel)).map((item) => item.externalId))
      for (const id of ids) expect(aired.has(id), `${id} on ${channel}`).toBe(true)
      for (const id of ids) expect(doc.programmeRoutes?.[channel], `${id} routed to ${channel}`).toContain(id)
    }
    for (const item of items.filter((entry) => all.includes(entry.externalId ?? ''))) {
      expect(excludedProgramme(item), item.title).toBe(false)
      expect(item.durationSeconds, item.title).toBeGreaterThanOrEqual(600)
      expect(item.title, item.title).not.toMatch(/\btrailer\b|#shorts\b/i)
      for (const channel of item.curatedChannels ?? []) expect(channel).toBeLessThanOrEqual(999)
    }
  })

  it('reuse permissions are explicit, bounded pairs: no wildcard, each admitting only routed programmes', () => {
    const pairs = Object.entries(HARVESTER_REUSE).flatMap(([channel, sources]) => sources.map((source) => [Number(channel), source] as const))
    expect(pairs).toHaveLength(16)
    for (const [channel, source] of pairs) {
      expect(source, `${channel}`).toMatch(/^src_[a-z0-9_]+$/)
      expect(PROGRAMME_REUSE[channel]).toContain(source)
      const routed = new Set(doc.programmeRoutes?.[String(channel)] ?? [])
      const admitted = airing(channel).filter((item) => item.sourceId === source && !item.genreChannels?.includes(channel) && !item.eraChannels?.includes(channel))
      expect(admitted.length, `${source} on ${channel}`).toBeGreaterThan(0)
      for (const item of admitted) expect(routed.has(item.externalId ?? ''), `${item.title} on ${channel}`).toBe(true)
      expect(admitted.every((item) => IMPORTED[channel]?.includes(item.externalId ?? '') || !all.includes(item.externalId ?? ''))).toBe(true)
    }
    expect(HARVESTER_REUSE[695]).toEqual(['src_gresham_medicine'])
    expect(HARVESTER_REUSE[157]).not.toContain('src_filmrise_movies')
  })

  it('schedules the imported channels deterministically', () => {
    const DATE = '2026-10-02'
    const ids = (number: number) => getSchedule(channelByNumber(number)!, DATE).blocks.flatMap((block) => block.children).map((child) => child.mediaItemId)
    for (const number of [118, 143, 404, 916]) {
      const first = ids(number)
      resetDirector()
      setMediaLibrary(items)
      expect(ids(number), `${number}`).toEqual(first)
      expect(first.some((id) => id && IMPORTED[number]!.some((video) => id === `yt:${video}`)), `${number}`).toBe(true)
    }
  }, 120_000)
})
