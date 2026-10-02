import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { channelByNumber, listChannels, programmesFor } from './data/catalogue.ts'
import { channelMayAir } from './data/independent/network.ts'
import { channelMatchesFilter, inFavouriteOrder, inNetworkDirectory } from './data/network.ts'
import { BUILT_IN_CATALOGUE_FILES } from './data/user-network/bootstrap.ts'
import { installUserCatalogue } from './data/user-overlay.ts'
import { expandPlayableCatalogue } from './library/playable-catalogue.ts'
import { getEligibleMedia } from './library/query.ts'
import { channelsFromSources, mergeParsedExports, parseChannelsExport, type StoredSource } from './services/channels-import.ts'
import { DEFAULT_FAVOURITES, placeStarterFavourites, starterFavouriteSources } from './services/default-favourites.ts'
import { DEFAULT_PREFERENCES, loadPreferences, PREFERENCES_KEY, preferencesSaved, savePreferences } from './services/preferences.ts'
import { setShippedArchive, uploaderIdFor } from './services/user-archive.ts'
import { planTestChannels } from './services/user-network.ts'
import { DEFAULT_SHORTCUTS, SHORTCUT_IDS } from './view/info-shortcuts.ts'

const read = (path: string) => readFileSync(path, 'utf8')
setShippedArchive(JSON.parse(read('public/user-network/uploaders.json')))
const template = mergeParsedExports(BUILT_IN_CATALOGUE_FILES.map((file) => parseChannelsExport(read(`public${file.path}`))))
const shipped = expandPlayableCatalogue(JSON.parse(read('public/independent/playable.json')))
const provider = read('src/state/TvProvider.tsx')

const REQUIRED = [125, 225, 534, 535, 536, 1004, 1023, 1044, 1080]
const NAMES: Record<number, string> = {
  225: 'Saturday Cartoons',
  125: '1980s Trailers',
  534: 'Dance',
  289: 'Retro Television',
  1004: 'Argyle Life | Green',
  710: 'Street Food',
  103: 'Classic Film',
  1023: 'Heat Check',
  805: 'Newsreel Archive',
  535: 'Drum & Bass',
  1057: 'World Wanderings: 4K Walking Tours',
  412: 'World War II',
  1012: 'CinemaSins',
  485: 'Wildlife',
  1044: 'Secret Base',
  844: 'Theatre Archive',
  536: 'Trip-Hop',
  491: 'Ideas',
  1080: 'Sporting Logically',
}

function withStore<T>(seed: Record<string, string>, run: (store: Map<string, string>) => T): T {
  const store = new Map(Object.entries(seed))
  const original = globalThis.localStorage
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) },
    configurable: true,
  })
  try {
    return run(store)
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true })
  }
}

const saved = (favourites: number[]) => ({ [PREFERENCES_KEY]: JSON.stringify({ ...DEFAULT_PREFERENCES, favouriteChannelNumbers: favourites }) })

/** The provider's favourite toggle. */
const toggle = (current: number[], number: number) =>
  current.includes(number) ? current.filter((item) => item !== number) : [...current, number]

/** One visit: load, let the viewer act, save as the provider does once ready. */
const visit = (change: (favourites: number[]) => number[] = (same) => same) => {
  const loaded = loadPreferences()
  savePreferences({ ...loaded, favouriteChannelNumbers: change(loaded.favouriteChannelNumbers) })
  return loaded.favouriteChannelNumbers
}

function showFreshStarter() {
  const plan = planTestChannels([], template, 5, uploaderIdFor)
  const built = channelsFromSources(plan.sources)
  installUserCatalogue(built.channels, built.programmes)
  return plan.sources
}

afterEach(() => installUserCatalogue([], new Map()))

describe('the starter Favourites', () => {
  it('includes all nine required channels, 18–20 in all, none twice', () => {
    for (const number of REQUIRED) expect(DEFAULT_FAVOURITES).toContain(number)
    expect(DEFAULT_FAVOURITES.length).toBeGreaterThanOrEqual(18)
    expect(DEFAULT_FAVOURITES.length).toBeLessThanOrEqual(20)
    expect(new Set(DEFAULT_FAVOURITES).size).toBe(DEFAULT_FAVOURITES.length)
  })

  it('opens with 225 and 125 and mixes the User Network in rather than trailing it', () => {
    expect(DEFAULT_FAVOURITES.slice(0, 2)).toEqual([225, 125])
    const user = DEFAULT_FAVOURITES.map((number, index) => (number > 1000 ? index : -1)).filter((index) => index >= 0)
    expect(user[0]).toBeLessThan(DEFAULT_FAVOURITES.length / 2)
    for (let index = 1; index < DEFAULT_FAVOURITES.length; index += 1) {
      const pair = [DEFAULT_FAVOURITES[index - 1]!, DEFAULT_FAVOURITES[index]!]
      expect(pair.every((number) => number > 1000) || pair.every((number) => number >= 534 && number <= 536)).toBe(false)
    }
  })

  it('names only curated channels that exist, are listed and have programmes to air', () => {
    for (const number of DEFAULT_FAVOURITES.filter((item) => item < 1000)) {
      const channel = channelByNumber(number)
      expect(channel?.name, `${number}`).toBe(NAMES[number])
      expect(inNetworkDirectory(number) && channelMayAir(number), `${number}`).toBe(true)
      expect(getEligibleMedia(shipped, number).length, `${number}`).toBeGreaterThanOrEqual(100)
    }
  })

  it('names only bundled User Network channels that a fresh install creates, each with videos', () => {
    showFreshStarter()
    for (const number of DEFAULT_FAVOURITES.filter((item) => item > 1000)) {
      const channel = channelByNumber(number)
      expect(channel?.name, `${number}`).toBe(NAMES[number])
      expect(programmesFor(channel!.id).filter((programme) => programme.videoId).length, `${number}`).toBeGreaterThanOrEqual(5)
    }
  })
})

describe('seeding once, for a new viewer only', () => {
  it('a fresh viewer receives the starter Favourites', () => {
    withStore({}, () => {
      expect(preferencesSaved()).toBe(false)
      expect(loadPreferences().favouriteChannelNumbers).toEqual(DEFAULT_FAVOURITES)
    })
  })

  it('existing favourites are kept exactly, in their order', () => {
    withStore(saved([701, 301, 1001]), () => expect(loadPreferences().favouriteChannelNumbers).toEqual([701, 301, 1001]))
  })

  it('a deliberately empty list stays empty', () => {
    withStore(saved([]), () => {
      expect(preferencesSaved()).toBe(true)
      expect(loadPreferences().favouriteChannelNumbers).toEqual([])
    })
  })

  it('saved preferences that cannot be read are not treated as a new viewer', () => {
    withStore({ [PREFERENCES_KEY]: '{broken' }, () => expect(loadPreferences().favouriteChannelNumbers).toEqual([]))
    withStore({ [PREFERENCES_KEY]: JSON.stringify({ version: 9 }) }, () => expect(loadPreferences().favouriteChannelNumbers).toEqual([]))
  })

  it('does not re-seed on reload, nor because a default is missing', () => {
    withStore({}, () => {
      visit((favourites) => favourites.filter((number) => number !== 225 && number !== 1004))
      for (let reload = 0; reload < 3; reload += 1) {
        const back = visit()
        expect(back).not.toContain(225)
        expect(back).not.toContain(1004)
        expect(back).toHaveLength(DEFAULT_FAVOURITES.length - 2)
      }
    })
  })

  it('removing a default, adding a favourite, removing all and re-adding all persist', () => {
    withStore({}, () => {
      visit((favourites) => toggle(favourites, 534))
      expect(visit()).not.toContain(534)
      visit((favourites) => toggle(favourites, 301))
      expect(visit().at(-1)).toBe(301)
      visit(() => [])
      expect(visit()).toEqual([])
      expect(visit()).toEqual([])
      visit((favourites) => toggle(favourites, 534))
      expect(visit()).toEqual([534])
    })
  })

  it('a new favourite joins the end instead of re-sorting the viewer’s order', () => {
    expect(provider).toContain('current.includes(number) ? current.filter((item) => item !== number) : [...current, number],')
    expect(provider).not.toContain('[...current, number].sort(')
  })

  it('seeding is decided before anything is saved and is not tied to a catalogue refresh', () => {
    expect(provider).toContain('const [favouritesSeeded] = useState(() => defaultFavouritesDue())')
    expect(provider.indexOf('defaultFavouritesDue()')).toBeLessThan(provider.indexOf('useRef(loadPreferences())'))
    expect(provider).not.toMatch(/catalogueVersion[^\n]*DEFAULT_FAVOURITES|DEFAULT_FAVOURITES[^\n]*catalogueVersion/)
    expect(provider).not.toContain('DEFAULT_FAVOURITES')
  })
})

describe('User Network favourites', () => {
  const expected = starterFavouriteSources(planTestChannels([], template, 0, uploaderIdFor).sources)

  it('resolve to the starter channels a fresh install numbers them to', () => {
    const sources = showFreshStarter()
    expect([...expected.keys()].sort()).toEqual(DEFAULT_FAVOURITES.filter((number) => number > 1000).sort())
    expect(placeStarterFavourites(DEFAULT_FAVOURITES, expected, sources)).toEqual(DEFAULT_FAVOURITES)
  })

  it('follow their channel when the viewer’s own channels took the first numbers', () => {
    const own: StoredSource[] = [1001, 1002, 1003].map((number) => ({
      id: `own-${number}`,
      name: `Own ${number}`,
      videos: [{ id: `own${number}abcd`.slice(0, 11), title: 'Own', durationSec: 600 }],
      channelNumber: number,
      inLibrary: false,
      automatic: false,
      updatedAt: 1,
    }))
    const plan = planTestChannels(own, template, 5, uploaderIdFor)
    const built = channelsFromSources(plan.sources)
    installUserCatalogue(built.channels, built.programmes)
    const placed = placeStarterFavourites(DEFAULT_FAVOURITES, expected, plan.sources)
    expect(placed).toHaveLength(DEFAULT_FAVOURITES.length)
    expect(new Set(placed).size).toBe(placed.length)
    for (const [index, number] of DEFAULT_FAVOURITES.entries()) {
      if (number > 1000) expect(channelByNumber(placed[index]!)?.name).toBe(NAMES[number])
      else expect(placed[index]).toBe(number)
    }
    expect(placed.some((number) => number <= 1003 && number > 1000)).toBe(false)
  })

  it('drop out when the starter network is not installed, and never create a channel', () => {
    const placed = placeStarterFavourites(DEFAULT_FAVOURITES, expected, [])
    expect(placed).toEqual(DEFAULT_FAVOURITES.filter((number) => number < 1000))
  })

  it('create no duplicate 1001+ channels: installing again adds nothing', () => {
    const first = planTestChannels([], template, 5, uploaderIdFor)
    const again = planTestChannels(first.sources, template, 6, uploaderIdFor)
    expect(again.added).toEqual([])
    const numbers = again.sources.map((source) => source.channelNumber)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it('are only re-placed for a seeded viewer, after the once-only starter install', () => {
    expect(provider).toContain('const installed = starterDue ? loadTestChannels(true).catch(() => undefined) : Promise.resolve()')
    expect(provider).toContain('if (!favouritesSeeded) return')
    expect(provider).toContain('setFavourites((current) => placeStarterFavourites(current, expected, sources))')
  })
})

describe('the Favourites tab', () => {
  it('lists the starter selection, in its order, as a filter over the real channels', () => {
    showFreshStarter()
    const listed = inFavouriteOrder(
      listChannels().filter((channel) => channelMatchesFilter(channel, 'favourites', DEFAULT_FAVOURITES)),
      DEFAULT_FAVOURITES,
    )
    expect(listed.map((channel) => channel.number)).toEqual(DEFAULT_FAVOURITES)
    expect(listed.every((channel) => channel === channelByNumber(channel.number))).toBe(true)
    expect(provider).toContain("return guideRows(guideFilter === 'favourites' ? inFavouriteOrder(listed, favourites) : listed, channelByNumber(channelNumber), guideFilter)")
  })

  it('leaves every other tab in channel order', () => {
    const all = listChannels().filter((channel) => channelMatchesFilter(channel, 'all', DEFAULT_FAVOURITES)).map((channel) => channel.number)
    expect(all).toEqual([...all].sort((a, b) => a - b))
  })
})

describe('unchanged around it', () => {
  const guide = read('src/components/Guide.tsx')
  const css = read('src/styles/guide.css')

  it('keeps the tabs, the yellow playing programme and the gold cursor', () => {
    expect(guide).toMatch(/\['all', 'All'\],\s*\['user', 'TVN'\],\s*\.\.\.tv\.networkUsers\.map/)
    const plus = guide.indexOf('className={tool === \'users\' ? \'tab guide-plus is-on\'')
    expect(plus).toBeGreaterThan(guide.indexOf('...tv.networkUsers.map'))
    expect(plus).toBeLessThan(guide.indexOf('            Fav\n'))
    const playing = css.slice(css.indexOf('\n.prog.is-playing {'), css.indexOf('}', css.indexOf('\n.prog.is-playing {')))
    expect(playing).toContain('box-shadow: inset 0 0 0 2px var(--gold);')
    expect(css).toMatch(/\n\.prog\.is-focused \{\s*z-index: 2;\s*background: var\(--guide-selected\);/)
  })

  it('keeps the 3×3 pad with Fullscreen and MULTI in ↓’s place', () => {
    expect(SHORTCUT_IDS).toEqual(['remote', 'fullscreen', 'tvn', 'random', 'captions'])
    expect(DEFAULT_SHORTCUTS.topRight).toBe('fullscreen')
    expect(read('src/components/InfoActions.tsx')).toContain("MULTI holds ↓'s place")
  })
})
