import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { canonicalByNumber } from '../data/canonical.ts'
import { channelByNumber } from '../data/catalogue.ts'
import { expandPlayableCatalogue } from '../library/playable-catalogue.ts'
import { getChannelMedia, getEligibleMedia } from '../library/query.ts'
import type { LibraryMedia } from '../library/types.ts'
import { getSchedule, resetDirector } from './director.ts'
import { explainEligibility } from './eligibility.ts'
import { DEDICATED, OWNED_SOURCES, PROGRAMME_REUSE, channelNameMatches, isNativeSource, programmeSuitsChannel } from './fit.ts'
import { setMediaLibrary } from './library.ts'
import { DIRECTOR_CHANNELS } from './policies.ts'
import type { MediaItem } from './types.ts'

const ICE_HOCKEY = 371
const FIELD_HOCKEY = 372
const BOXING = 330
const MMA = 331
const CRICKET = 339
const RUGBY = 362
const FIGHT_MIX = 55
const SPORT_MIX = 52
const COMBAT_ARCHIVE = 389
const THEATRE = 281
const ANIME = 226
const FOOD = 700

let serial = 0
function routed(title: string, sourceId: string, channels: number[], durationSeconds = 3600): MediaItem {
  serial += 1
  return {
    id: `yt:fit${serial}`,
    title,
    durationSeconds,
    programmeType: 'unclassified',
    topics: [],
    mediaKind: 'video',
    explicitChannelIncludes: channels,
    ...({ sourceId } as object),
  }
}

const SPORT_CHANNELS = [ICE_HOCKEY, FIELD_HOCKEY, BOXING, MMA, CRICKET, RUGBY, FIGHT_MIX, SPORT_MIX, COMBAT_ARCHIVE, THEATRE, ANIME, FOOD]

describe('routing nominates, identity decides', () => {
  const fight = routed('ONE Friday Fights 999: Full Event Replay', 'src_one', SPORT_CHANNELS, 14300)
  const bout = routed('Heavyweight Title Fight Full Replay', 'src_top_rank', SPORT_CHANNELS)
  const hockey = routed('Stanley Cup Final Game 7 | NHL Classic', 'src_fih', [ICE_HOCKEY])
  const iceHockey = routed('Ice Hockey World Championship Final 1966', 'src_nfb', [ICE_HOCKEY, THEATRE])
  const diving = routed('Diving Championship At Crystal Palace (1936)', 'src_nfb', [THEATRE, SPORT_MIX])
  const play = routed('Shakespeare On Stage: A Theatre Company Rehearses', 'src_nfb', [THEATRE])
  const pitch = routed('Every Goal From The Final | FIFA World Cup', 'src_fifa', SPORT_CHANNELS)

  it('keeps combat sport off ice hockey and every other single-sport channel', () => {
    for (const channel of [ICE_HOCKEY, FIELD_HOCKEY, CRICKET, RUGBY]) {
      expect(getEligibleMedia([fight, bout], channel)).toEqual([])
      expect(explainEligibility(fight, channel).eligible).toBe(false)
    }
    expect(getEligibleMedia([fight], BOXING)).toEqual([])
    expect(getEligibleMedia([bout], MMA)).toEqual([])
  })

  it('keeps combat sport on combat, boxing and mixed-sport channels', () => {
    expect(getEligibleMedia([bout], BOXING)).toEqual([bout])
    expect(getEligibleMedia([fight], MMA)).toEqual([fight])
    for (const channel of [FIGHT_MIX, COMBAT_ARCHIVE, SPORT_MIX]) {
      expect(getEligibleMedia([fight, bout], channel)).toEqual([fight, bout])
    }
  })

  it('keeps hockey on ice hockey', () => {
    expect(getEligibleMedia([iceHockey, fight, bout, pitch], ICE_HOCKEY)).toEqual([iceHockey])
    expect(programmeSuitsChannel(hockey, FIELD_HOCKEY)).toBe(true)
  })

  it('rejects other sports on single-sport channels', () => {
    expect(getEligibleMedia([pitch], CRICKET)).toEqual([])
    expect(getEligibleMedia([pitch], RUGBY)).toEqual([])
    expect(getEligibleMedia([diving], ICE_HOCKEY)).toEqual([])
  })

  it('keeps sport off theatre, anime and food, and keeps theatre on theatre', () => {
    expect(getEligibleMedia([diving, fight, bout, pitch, iceHockey, play], THEATRE)).toEqual([play])
    expect(getEligibleMedia([fight, pitch], ANIME)).toEqual([])
    expect(getEligibleMedia([fight, pitch], FOOD)).toEqual([])
  })

  it('never schedules a routed fight on the ice hockey channel', () => {
    resetDirector()
    setMediaLibrary([fight, bout, iceHockey])
    const day = getSchedule(channelByNumber(ICE_HOCKEY)!, '2026-10-01')
    const aired = new Set(day.blocks.flatMap((block) => block.children.map((child) => child.mediaItemId)))
    expect(aired.has(fight.id)).toBe(false)
    expect(aired.has(bout.id)).toBe(false)
    expect(aired.has(iceHockey.id)).toBe(true)
    resetDirector()
  })

  it('does not let a second channel repeat the same catalogue', () => {
    const shelf = Array.from({ length: 6 }, (_, index) => routed(`Rugby Test Match ${index}`, 'src_world_rugby', [362, 363], 3600))
    expect(getEligibleMedia(shelf, 362)).toHaveLength(6)
    expect(getEligibleMedia(shelf, 363)).toHaveLength(6)
    expect(getChannelMedia(shelf, 362)).toHaveLength(6)
    expect(getChannelMedia(shelf, 363)).toEqual([])
  })

  it('keeps a catalogue on its canonical home, not the lower-numbered mix', () => {
    const shelf = Array.from({ length: 6 }, (_, index) => routed(`World Cup Final ${index}`, 'src_fifa', [53, 301], 3600))
    expect(getEligibleMedia(shelf, 53)).toHaveLength(6)
    expect(getChannelMedia(shelf, 301)).toHaveLength(6)
    expect(getChannelMedia(shelf, 53)).toEqual([])
  })

  it('still honours a user placing an item on a channel', () => {
    const own = { ...fight, userEditedMetadata: ['explicitChannelIncludes'] } as MediaItem
    expect(programmeSuitsChannel(own, ICE_HOCKEY)).toBe(true)
  })
})

describe('shipped catalogue eligibility', () => {
  let items: LibraryMedia[] = []
  const eligible = new Map<number, MediaItem[]>()
  beforeAll(() => {
    items = expandPlayableCatalogue(JSON.parse(readFileSync('public/independent/playable.json', 'utf8')))
    for (const number of DIRECTOR_CHANNELS) eligible.set(number, getEligibleMedia(items, number))
  })

  it('never airs a sport federation outside its sport, a combat channel, or a mixed-sport channel', () => {
    const home: Record<string, RegExp> = {
      src_one: /\bmma\b|fight|combat|sport|olympic|great|athletes|coaching|tactics|stadiums/i,
      src_top_rank: /boxing|fight|combat|sport|olympic|great|athletes|coaching|tactics|stadiums/i,
      src_wwe: /wrestl|fight|combat|sport|olympic|great|athletes|coaching|tactics|stadiums/i,
      src_fifa: /football|fifa|sport|olympic|great|athletes|coaching|tactics|stadiums/i,
      src_icc: /cricket|sport|olympic|great|athletes|coaching|tactics|stadiums/i,
      src_world_rugby: /rugby|sport|olympic|great|athletes|coaching|tactics|stadiums/i,
      src_fih: /field hockey|sport|olympic|great|athletes|coaching|tactics|stadiums/i,
      src_fivb_archive: /volleyball|sport|olympic|great|athletes|coaching|tactics|stadiums/i,
    }
    const leaks: string[] = []
    for (const [number, list] of eligible) {
      const name = canonicalByNumber(number)?.name ?? ''
      for (const item of list) {
        const source = (item as LibraryMedia).sourceId ?? ''
        if (home[source] && !home[source].test(name)) leaks.push(`${source} on ${number} ${name}`)
      }
    }
    expect([...new Set(leaks)]).toEqual([])
  })

  it('keeps ice hockey free of other sports and theatre free of sport', () => {
    const hockey = eligible.get(ICE_HOCKEY) ?? []
    expect(hockey.length).toBeGreaterThan(0)
    expect(hockey.every((item) => (item as LibraryMedia).sourceId === 'src_iihf' || /hockey|nhl|stanley cup/i.test(item.title))).toBe(true)
    for (const theatre of [49, 280, 281, 282, 844]) {
      const list = eligible.get(theatre) ?? []
      const sport = /^src_(one|top_rank|wwe|fifa|icc|world_rugby|fih|fivb_archive|iihf|wtt|pdc|nfl|nfl_films|wimbledon)$/
      expect(list.filter((item) => sport.test((item as LibraryMedia).sourceId ?? '') || /diving|boxing|football/i.test(item.title))).toEqual([])
    }
  })

  it('keeps space, religion and aircraft programmes off every channel', () => {
    const banned = /\b(nasa|astronaut|spacex|satellite|galaxy|telescope|sermon|bible|worship|jesus|aircraft|airplane|aeroplane|aviation|helicopter|airport|airship|spitfire|concorde)\b/i
    const hits: string[] = []
    for (const [number, list] of eligible) for (const item of list) if (banned.test(item.title)) hits.push(`${number}: ${item.title}`)
    expect(hits).toEqual([])
    expect(eligible.get(655) ?? []).toEqual([])
  })

  it('airs each owned catalogue on its one channel only, and nothing else there', () => {
    for (const [source, home] of OWNED_SOURCES) {
      const records = items.filter((item) => item.sourceId === source)
      const elsewhere: string[] = []
      for (const [number, list] of eligible) {
        if (number === home) continue
        for (const item of list) if ((item as LibraryMedia).sourceId === source) elsewhere.push(`${number}: ${item.title}`)
      }
      expect(elsewhere).toEqual([])
      const onHome = eligible.get(home) ?? []
      expect(onHome.length).toBeGreaterThan(0)
      expect(onHome.every((item) => (item as LibraryMedia).sourceId === source)).toBe(true)
      expect(onHome.length).toBe(records.filter((item) => programmeSuitsChannel(item, home)).length)
    }
    expect(OWNED_SOURCES.get('src_british_pathe')).toBe(805)
    expect(OWNED_SOURCES.get('src_kofa')).toBe(114)
  })

  it('keeps new sport feeds on their own sport', () => {
    const homes: Record<number, string> = { 371: 'src_iihf', 377: 'src_wtt', 367: 'src_pdc', 370: 'src_nfl', 332: 'src_wimbledon' }
    for (const [number, source] of Object.entries(homes)) {
      const list = eligible.get(Number(number)) ?? []
      expect(list.length).toBeGreaterThan(0)
      expect(list.every((item) => (item as LibraryMedia).sourceId === source)).toBe(true)
    }
  })

  it('gives every channel programming of its own', () => {
    const pools = DIRECTOR_CHANNELS.filter((number) => number <= 999)
      .map((number) => ({ number, ids: new Set(getChannelMedia(items, number).map((item) => item.id)) }))
      .filter((pool) => pool.ids.size > 0)
    const duplicates: string[] = []
    for (let a = 0; a < pools.length; a += 1) {
      for (let b = a + 1; b < pools.length; b += 1) {
        let shared = 0
        for (const id of pools[b].ids) if (pools[a].ids.has(id)) shared += 1
        const similarity = shared / (pools[a].ids.size + pools[b].ids.size - shared)
        if (similarity >= 0.6) duplicates.push(`${pools[a].number}~${pools[b].number}`)
      }
    }
    expect(duplicates).toEqual([])
  }, 30000)

  it('keeps the independent catalogue out of 1001+', () => {
    expect(items.every((item) => (item.explicitChannelIncludes ?? []).every((number) => number <= 999))).toBe(true)
    expect(getEligibleMedia(items, 1001)).toEqual([])
    expect(getEligibleMedia(items, 1500)).toEqual([])
    expect(getChannelMedia(items, 1001)).toEqual([])
  })

  const ids = (number: number) => new Set(getChannelMedia(items, number).map((item) => item.id))
  const sourcesOf = (number: number) => new Set(getChannelMedia(items, number).map((item) => (item as LibraryMedia).sourceId))
  const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((id) => b.has(id)).length

  it('lets canonical homes keep their whole inventory ahead of lower-numbered mixes', () => {
    for (const home of [300, 301, 500, 700, 770, 220, 226, 235, 900]) {
      expect(ids(home).size, `${home}`).toBe(eligible.get(home)!.length)
      expect(ids(home).size, `${home}`).toBeGreaterThan(0)
    }
  })

  it('gives a mix a different selection from its home, never the same complete pool', () => {
    for (const [mix, home] of [[53, 301], [58, 700], [50, 500], [52, 300], [40, 220], [42, 226], [70, 900]]) {
      const own = ids(mix)
      const canonical = ids(home)
      expect(own.size, `${mix}`).toBeGreaterThan(0)
      expect(own.size, `${mix}`).toBeLessThan(canonical.size)
      expect(overlap(own, canonical) / canonical.size, `${mix}~${home}`).toBeLessThan(0.5)
    }
  })

  it('keeps 301 Football to football without cross-sport leakage', () => {
    expect(sourcesOf(301)).toEqual(new Set(['src_fifa']))
    const football = [...Array(28).keys()].map((index) => 302 + index).filter((number) => /football/i.test(canonicalByNumber(number)?.name ?? ''))
    for (const number of football) {
      const own = (item: LibraryMedia) =>
        ((item.sourceId ?? '') !== 'src_fifa' && isNativeSource(item.sourceId ?? '', number)) || !!item.eraChannels?.includes(number) || !!item.curatedChannels?.includes(number)
      expect(getChannelMedia(items, number).filter((item) => !channelNameMatches(item, number) && !own(item as LibraryMedia)), `${number}`).toEqual([])
    }
  })

  it('keeps 700 Food as the one full food channel', () => {
    expect(sourcesOf(700).has('src_atk')).toBe(true)
    const withKitchen = [...Array(29).keys()]
      .map((index) => 701 + index)
      .filter((number) => getChannelMedia(items, number).some((item) => (item as LibraryMedia).sourceId === 'src_atk' && !(item as LibraryMedia).curatedChannels?.includes(number)))
    expect(withKitchen.length).toBeLessThanOrEqual(2)
    for (const number of withKitchen) expect(ids(number).size).toBeLessThan(ids(700).size / 2)
  })

  it('keeps 500 Music full without filling genre and decade channels from generic sessions', () => {
    expect(sourcesOf(500)).toEqual(new Set(['src_kexp', 'src_vevo']))
    for (const number of [501, 505, 514, 515, 520, 528, 546, 585, 587]) {
      const generic = getChannelMedia(items, number).filter((item) => /^src_(kexp|vevo)$/.test((item as LibraryMedia).sourceId ?? ''))
      expect(generic.reduce((sum, item) => sum + item.durationSeconds, 0), `${number}`).toBeLessThan(3 * 3600)
    }
  })

  it('keeps each gap publisher on the channel it was acquired for', () => {
    const homes: Record<string, number[]> = {
      src_jalc: [515],
      src_hr_symphony: [525],
      src_operavision: [526],
      src_opry: [528],
      src_shows_must_go_on: [282],
      src_rt_trailers: [120],
      src_ww2: [412],
      src_geography_now: [430],
      src_lonely_planet: [771],
      src_dw_documentary: [108],
      src_omeleto: [107],
      src_dust: [144],
      src_alter: [140],
      src_bfi: [161],
      src_rockpalast: [501],
      src_soul_train: [516],
      src_cercle: [521],
      src_vp_records: [529],
      src_boiler_room: [554],
      src_athletic_fc: [305],
      src_wsl: [310],
      src_copa90: [314],
      src_mark_wiens: [710],
      src_preppy_kitchen: [711],
      src_bake_with_jack: [712],
      src_rainbow_plant_life: [715],
      src_chuds_bbq: [716],
      src_royal_ballet_opera: [283],
      src_sadlers_wells: [283],
      src_cirque: [286],
    }
    for (const [source, channels] of Object.entries(homes)) {
      const reused = (item: LibraryMedia) => (item.curatedChannels ?? []).filter((channel) => PROGRAMME_REUSE[channel]?.includes(source))
      const eras = new Set(items.filter((item) => item.sourceId === source).flatMap((item) => [...(item.eraChannels ?? []), ...(item.genreChannels ?? []), ...reused(item)]))
      const airing = DIRECTOR_CHANNELS.filter((number) => number <= 999 && sourcesOf(number).has(source) && !eras.has(number))
      expect(airing, source).toEqual(channels)
    }
    const timeline = DIRECTOR_CHANNELS.filter((number) => number <= 999 && sourcesOf(number).has('src_timeline'))
    expect(timeline.length).toBeGreaterThan(0)
    const routedTimeline = new Set(items.filter((item) => item.sourceId === 'src_timeline').flatMap((item) => item.curatedChannels ?? []))
    expect(timeline.filter((number) => !(number >= 400 && number <= 429) && !routedTimeline.has(number))).toEqual([])
  })

  it('airs every dedicated publisher on its home channels only, and gives each home real programming', () => {
    const homeHours = new Map<number, number>()
    const media = new Map<number, LibraryMedia[]>()
    const channelMedia = (number: number) => {
      if (!media.has(number)) media.set(number, getChannelMedia(items, number) as LibraryMedia[])
      return media.get(number)!
    }
    for (const [source, homes] of Object.entries(DEDICATED)) {
      const own = items.filter((item) => item.sourceId === source)
      const reused = (item: LibraryMedia) => (item.curatedChannels ?? []).filter((channel) => PROGRAMME_REUSE[channel]?.includes(source))
      const eras = new Set(own.flatMap((item) => [...(item.eraChannels ?? []), ...(item.genreChannels ?? []), ...reused(item)]))
      const airing = DIRECTOR_CHANNELS.filter((number) => number <= 999 && sourcesOf(number).has(source) && !eras.has(number))
      expect(airing, source).toEqual([...homes])
      for (const era of eras) {
        const aired = channelMedia(era).filter((item) => item.sourceId === source)
        const routed = (item: LibraryMedia) => item.eraChannels?.includes(era) || item.genreChannels?.includes(era) || reused(item).includes(era)
        expect(aired.every((item) => routed(item)), `${source} on ${era}`).toBe(true)
      }
      for (const home of homes) {
        const hours = channelMedia(home).filter((item) => item.sourceId === source).reduce((sum, item) => sum + item.durationSeconds, 0) / 3600
        expect(hours, `${source} on ${home}`).toBeGreaterThan(0)
        homeHours.set(home, (homeHours.get(home) ?? 0) + hours)
      }
    }
    for (const [home, hours] of homeHours) expect(hours, `dedicated programming on ${home}`).toBeGreaterThan(3)
  }, 60000)

  it('keeps the archive, retro TV, workshop and news-documentary channels to their own publishers', () => {
    const own = {
      288: ['src_thames_tv', 'src_bbc_archive', 'src_royal_institution'],
      289: ['src_johnny_carson', 'src_carol_burnett'],
      688: ['src_paul_sellers', 'src_steve_ramsey', 'src_jimmy_diresta', 'src_laura_kampf'],
      914: ['src_frontline', 'src_abc_news_indepth', 'src_cna_insider'],
    }
    for (const [number, sources] of Object.entries(own)) {
      expect([...sourcesOf(Number(number))].every((source) => source !== undefined && sources.includes(source)), number).toBe(true)
      expect(sourcesOf(Number(number)).size, number).toBeGreaterThan(1)
    }
  })

  it('keeps trailers off film channels and KOFA on 114 alone', () => {
    const film = DIRECTOR_CHANNELS.filter((number) => number <= 999 && canonicalByNumber(number)?.category === 'film')
    for (const number of film) {
      if (number !== 120 && number !== 129) expect(sourcesOf(number).has('src_rt_trailers'), `${number}`).toBe(false)
      if (number !== 114) expect(sourcesOf(number).has('src_kofa'), `${number}`).toBe(false)
    }
    expect(sourcesOf(120)).toEqual(new Set(['src_rt_trailers']))
    expect(sourcesOf(129)).toEqual(new Set(['src_rt_trailers']))
    for (const item of getChannelMedia(items, 129)) expect((item as LibraryMedia).curatedChannels, item.title).toContain(129)
    expect(sourcesOf(114)).toEqual(new Set(['src_kofa']))
  })

  it('keeps history period channels to their own period', () => {
    const secondWar = /\bww2\b|\bwwii\b|hitler|nazi/i
    for (const number of [403, 404, 405, 406, 410, 413]) {
      const list = getChannelMedia(items, number)
      expect(list.filter((item) => (item as LibraryMedia).sourceId === 'src_ww2' || secondWar.test(item.title)).map((item) => item.title), `${number}`).toEqual([])
    }
    const classical = getChannelMedia(items, 525).map((item) => item.title)
    expect(classical.some((title) => /Verdi: Messa da Requiem/.test(title))).toBe(true)
    expect(classical.some((title) => /Brahms: Ein deutsches Requiem/.test(title))).toBe(true)
    expect(classical.filter((title) => /worship|sermon|hymns?\b|church service/i.test(title))).toEqual([])
  })

  it('programmes 400 History without Pathé and each publisher channel with its own publisher', () => {
    expect(sourcesOf(400).has('src_british_pathe')).toBe(false)
    expect(getChannelMedia(items, 400).reduce((sum, item) => sum + item.durationSeconds, 0)).toBeGreaterThan(24 * 3600)
    expect(sourcesOf(925)).toEqual(new Set(['src_nbc_news_now']))
    expect(sourcesOf(923)).toEqual(new Set(['src_livenow_fox']))
    expect(sourcesOf(590)).toEqual(new Set(['src_vevo']))
  })
})
