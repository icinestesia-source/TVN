import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { channelByNumber } from '../data/catalogue.ts'
import { dynamicBroadcast } from '../dynamic/broadcast.ts'
import { DYNAMIC_CHANNELS, DYNAMIC_VERSION, dynamicChannel, freshnessDays, liveEndpoint } from '../dynamic/providers.ts'
import { freshFor, LIVE_RETRY_MS, markLiveUnavailable, resetLiveState } from '../dynamic/runtime.ts'
import { excludedProgramme } from '../library/exclusions.ts'
import { expandPlayableCatalogue } from '../library/playable-catalogue.ts'
import { getChannelMedia, getEligibleMedia } from '../library/query.ts'
import type { LibraryMedia } from '../library/types.ts'
import { measureAiring } from '../network/airing.ts'
import { broadcast, guideSlots } from '../services/broadcast.ts'
import { readFrozen, writeFrozen } from './cache.ts'
import { getSchedule, resetDirector } from './director.ts'
import { OWNED_SOURCES } from './fit.ts'
import { setMediaLibrary } from './library.ts'
import { addCalendarDays, broadcastWindow } from './time.ts'
import type { MediaItem } from './types.ts'

const DATE = '2026-09-28'
const NOW = new Date(`${DATE}T12:00:00+01:00`).getTime()
const STAMPS = [7, 11, 15, 20].map((hour) => new Date(`${DATE}T${String(hour).padStart(2, '0')}:23:00+01:00`).getTime())
const DAY_MS = 86_400_000
const MODES = ['LIVE_STREAM', 'ROLLING_CURRENT', 'HYBRID_LIVE_ROLLING', 'UNRESOLVED']
const FINAL_CLASSES = ['LIVE_OR_ROLLING', 'RIGHTS_BLOCKED', 'ORIGINAL_REQUIRED', 'RESEARCH_UNRESOLVED', 'OTHER_GENUINE_BLOCKER']
const EXCLUDED = /\b(space(ship)?|nasa|rockets?|satellites?|astronom\w*|astrophysic\w*|cosmolog\w*|galax\w*|aircraft|aviation|airplanes?|helicopters?|airports?|spaceflight|aerospace|church|christianity|mosque|prayer|bible|theolog\w*|sermon|worship|preach\w*|rabbi|pope)\b/i

const words = (pattern: string) => new RegExp(`(?<![a-z0-9])(?:${pattern})(?![a-z0-9])`, 'i')
const REGIONS: Record<string, RegExp> = {
  us: /\b(u\.s\.?|usa|united states|america(ns?)?(?! ?(latin|south|central))|trump|vance|biden|white house|congress\w*|senat(e|or)s?|democrats?|republicans?|gop|washington|pentagon|fbi|cia|ice|supreme court|capitol|midterms?|new york|california|texas|florida|chicago|los angeles|ohio|pennsylvania|michigan|arizona|illinois|minnesota|louisiana|virginia|carolina|oregon|colorado|nevada|hawaii|alaska|mississippi|tennessee|kentucky|missouri|wisconsin|maryland|massachusetts|epstein)\b/i,
  europe: /\b(europe(an)?|eu|brussels|france|french|paris|macron|germany|german|berlin|merz|italy|italian|rome|meloni|spain|spanish|madrid|poland|polish|warsaw|ukraine|ukrainian|kyiv|zelensk(y|yy)|russia|russian|moscow|kremlin|putin|netherlands|dutch|belgium|sweden|swedish|norway|denmark|danish|finland|greece|greek|athens|portugal|austria|switzerland|swiss|hungary|orban|romania|czech|slovakia|serbia|kosovo|bosnia|croatia|moldova|baltic|estonia|latvia|lithuania|ireland|irish|greenland|georgia(?!,? us)|armenia|azerbaijan|belarus|balkans?)\b/i,
  asia: /\b(china|chinese|beijing|xi jinping|xi|japan|japanese|tokyo|india|indian|delhi|modi|korea|korean|seoul|pyongyang|kim jong|taiwan|taipei|singapore|malaysia|indonesia|jakarta|philippines|manila|vietnam|thailand|thai|bangkok|cambodia|myanmar|bangladesh|pakistan|afghanistan|taliban|nepal|sri lanka|hong kong|mongolia|kazakhstan|asia(n)?|asean|laos)\b/i,
  pacific: /\b(australia(n)?|albanese|canberra|sydney|melbourne|brisbane|perth|adelaide|queensland|victoria|tasmania|new zealand|pacific|papua|fiji|solomon|tonga|samoa|vanuatu|chalmers)\b/i,
  africa: /\b(africa(n)?|nigeria|kenya|ethiopia|sudan|congo|drc|ghana|senegal|mali|niger|burkina|sahel|somalia|uganda|tanzania|rwanda|cameroon|zimbabwe|zambia|mozambique|angola|malawi|namibia|botswana|libya|tunisia|algeria|morocco|chad|ivory coast|madagascar|eritrea|gabon|guinea|sierra leone|liberia|togo|benin|ramaphosa|anc|tinubu|ruto|kinshasa|nairobi|lagos|johannesburg|khartoum|gauteng|cape town|durban|soweto|eswatini|lesotho)\b/i,
  mideast: /\b(middle east|israel(i|is)?|gaza|palestin\w*|west bank|hamas|hezbollah|lebanon|lebanese|beirut|syria(n)?|damascus|iran(ian)?|tehran|iraq(i)?|baghdad|yemen(i)?|houthis?|saudi|riyadh|uae|emirates|dubai|qatar|doha|kuwait|bahrain|oman|jordan|egypt(ian)?|cairo|netanyahu|turkey|türkiye|erdogan|kurd\w*|abbas|barghouti)\b/i,
  americas: /\b(latin america(n)?|south america(n)?|central america(n)?|canada|canadian|ottawa|carney|mexico|mexican|brazil(ian)?|lula|argentina|milei|venezuela(n)?|maduro|colombia(n)?|chile(an)?|peru(vian)?|bolivia|ecuador|cuba(n)?|haiti(an)?|guatemala|honduras|el salvador|bukele|nicaragua|panama|costa rica|paraguay|uruguay|caribbean|jamaica|puerto rico|dominican|toronto|montreal|quebec)\b/i,
}
function regions(title: string): Set<string> {
  const found = new Set(Object.keys(REGIONS).filter((name) => REGIONS[name].test(title)))
  if (found.has('americas') && !REGIONS.us.test(title.replace(/(latin|south|central) america/gi, ''))) found.delete('us')
  return found
}
/** channel -> [allowed regions, whether a title naming no region is allowed] */
const GEOGRAPHY: Record<number, [string[], boolean]> = {
  902: [['us'], true], 930: [['us'], true], 903: [['europe'], true], 904: [['asia'], true], 932: [['pacific', 'asia'], true],
  905: [['africa'], true], 906: [['mideast'], false], 934: [['mideast'], false],
}
const TOPICS: Record<number, RegExp> = {
  913: words("analysis|explained|explainer|this is why|inside story|to the point|sources (&|and) methods|global story|newscast|the dip|al jazeera explains|breakdown|fact.?check|what we know|what it means|decoded|in context|^(why|how|what|is|are|can|could|does|did|will|who|should) .*\\?"),
  917: words('econom\\w*|inflation|interest rates?|rate (cut|hike)s?|federal reserve|\\bfed\\b|central bank|ecb|bank of england|boe|gdp|recession|jobs report|payrolls|unemployment|tariffs?|trade (war|deal)|bond (yields?|market)|treasur(y|ies)|currency|dollar|yuan|yen|budget|deficit|debt ceiling|cpi|mortgage rates?|imf|world bank|oil prices?|opec'),
  919: words('\\bu\\.?n\\.?\\b|united nations|general assembly|unga|security council|nato|g7|g20|summit|diplomac\\w*|diplomat\\w*|foreign (minister|policy|secretary)|sanctions?|treat(y|ies)|peace (talks|deal|proposal|plan|process)|ceasefire|envoy|ambassador|geopolit\\w*|brics|world leaders|state (visit|dinner)|bilateral|alliance|multilateral|global order'),
  939: words('climate|environment\\w*|emissions?|carbon|pollution|plastics?|biodiversity|deforestation|glaciers?|coral|conservation|wildlife|endangered|cop\\d\\d|renewables?|solar (power|farm|panels?)|wind (farm|power)|fossil fuels?|net zero|ocean(s)? (warming|heat)|sea level|rainforest|amazon (forest|fires?)|extinction|greenpeace|epa'),
  941: words('cultur\\w*|\\barts?\\b|artists?|museums?|exhibition|galler(y|ies)|painting|sculpture|theat(re|er)|opera|ballet|festival|novel(ist)?|authors?|new book|book (prize|award|fair|festival)|literature|poet\\w*|heritage|unesco|fashion|design(er)?|architect\\w*|orchestra|composer|film ?maker|cinema|comedian|comedy|musician|singer|album'),
  944: words('interview|in conversation|speaks (to|with)|talk to al jazeera|conflict zone|hardtalk|one[- ]on[- ]one|sits down|newsmakers|the bottom line|\\| .*\\bceo\\b|frankly speaking|upfront|head to head|full interview'),
}
const WEATHER = words("forecast|weather|storm|hurricane|tropical|typhoon|cyclone|tornado|flood\\w*|rain\\w*|snow\\w*|heat\\w*|drought|wildfire|nor'?easter|el ni(n|ñ)o|la ni(n|ñ)a|derecho|lightning|blizzard|monsoon|\\bwinds?\\b|temperatures?|kelvin wave|frost|fog|thunder\\w*|hail|landslide|mudslide|meteorolog\\w*")
const NEW_RELEASE = words('official (music )?video|official visuali[sz]er|\\(official\\)|\\[official')
const NOT_NEW = words('remaster\\w*|anniversary|\\blive\\b|live (at|from|in|session)|acoustic|lyric|audio|reaction|behind the scenes|making of|teaser|trailer|mix 20|\\bset\\b|\\bdj mix|yule log|full album|album stream|\\d+ years|documentary|interview')

type Config = { mode: string; family?: string; reason?: string; live?: { sourceId: string; videoId: string; service: string }; rolling?: { freshnessDays: number; sources: string[] } }

describe('Pass 21 live and rolling provider model', () => {
  let items: LibraryMedia[] = []
  let routes: Record<string, string[]> = {}
  let sources: Record<string, string> = {}
  let published: Record<string, string> = {}
  let config: Record<string, Config> = {}
  let v40: { records: { number: number; finalClass: string }[] }
  let v41: { baselineProgrammes: Record<string, number>; records: { number: number; finalClass: string }[] }
  const routed = (channel: number) => getChannelMedia(items as MediaItem[], channel) as LibraryMedia[]
  const fresh = (channel: number, date = DATE) => freshFor(channel, routed(channel), date)
  const withMode = (...modes: string[]) => Object.entries(config).filter(([, row]) => modes.includes(row.mode)).map(([n]) => Number(n))
  const rolling = () => withMode('ROLLING_CURRENT', 'HYBRID_LIVE_ROLLING')

  beforeAll(() => {
    const doc = JSON.parse(readFileSync('public/independent/playable.json', 'utf8'))
    routes = doc.programmeRoutes
    sources = doc.sources
    published = doc.published
    config = JSON.parse(readFileSync('src/data/dynamic/providers.json', 'utf8')).channels
    v40 = JSON.parse(readFileSync('docs/remaining-content-map-v40.json', 'utf8'))
    v41 = JSON.parse(readFileSync('docs/remaining-content-map-v41.json', 'utf8'))
    items = expandPlayableCatalogue(doc)
    resetDirector()
    setMediaLibrary(items)
  })

  afterEach(() => resetLiveState())

  it('classifies every one of the 39 live-or-rolling channels exactly once', () => {
    const expected = v40.records.filter((row) => row.finalClass === 'LIVE_OR_ROLLING').map((row) => row.number).sort((a, b) => a - b)
    expect(expected).toHaveLength(39)
    expect([...DYNAMIC_CHANNELS].filter((n) => config[String(n)].mode !== 'LIVE_CAMS').sort((a, b) => a - b)).toEqual(expected)
    for (const n of expected) {
      const row = config[String(n)]
      expect(MODES, `${n}`).toContain(row.mode)
      if (row.mode === 'UNRESOLVED') expect(row.reason, `${n}`).toBeTruthy()
      if (row.mode === 'LIVE_STREAM' || row.mode === 'HYBRID_LIVE_ROLLING') expect(row.live?.videoId, `${n}`).toMatch(/^[\w-]{11}$/)
      if (row.mode === 'ROLLING_CURRENT' || row.mode === 'HYBRID_LIVE_ROLLING') expect(row.rolling?.freshnessDays, `${n}`).toBeGreaterThan(0)
      if (row.mode === 'ROLLING_CURRENT' || row.mode === 'UNRESOLVED') expect(liveEndpoint(n), `${n}`).toBeUndefined()
    }
    const records = v41.records.map((row) => row.number)
    const needs = (JSON.parse(readFileSync('docs/channel-manifest.json', 'utf8')).records as { number: number; status: string }[])
      .filter((row) => row.status === 'NEEDS_CONTENT').map((row) => row.number)
    // Channels reclassified to NEEDS_CONTENT in Pass 23 are mapped in remaining-content-map-v43.
    const pass23 = new Set((JSON.parse(readFileSync('docs/remaining-content-map-v43.json', 'utf8')).records as { number: number; decidedIn: string }[]).filter((row) => row.decidedIn === '23').map((row) => row.number))
    for (const n of needs.filter((number) => !pass23.has(number))) expect(records, `${n}`).toContain(n)
    expect(new Set(records).size).toBe(records.length)
    for (const row of v41.records) expect(FINAL_CLASSES, `${row.number}`).toContain(row.finalClass)
    for (const n of withMode('UNRESOLVED')) expect(v41.records.find((row) => row.number === n)?.finalClass, `${n}`).toBe('LIVE_OR_ROLLING')
  })

  it('keeps static channels on frozen days untouched by the provider model', () => {
    for (const n of [114, 225, 301, 500, 805]) {
      const channel = channelByNumber(n)!
      expect(dynamicChannel(n), `${n}`).toBeUndefined()
      expect(freshnessDays(n), `${n}`).toBeUndefined()
      const pool = routed(n)
      expect(freshFor(n, pool, addCalendarDays(DATE, 400)), `${n}`).toBe(pool)
      const first = getSchedule(channel, DATE)
      expect(first.dynamicVersion, `${n}`).toBeUndefined()
      expect(getSchedule(channel, DATE), `${n}`).toBe(first)
      expect(dynamicBroadcast(channel, NOW), `${n}`).toBeNull()
    }
  })

  it('never lets an empty dynamic day or an old provider config poison later availability', () => {
    const channel = channelByNumber(902)!
    resetDirector()
    const empty = getSchedule(channel, DATE)
    expect(empty.poolSize).toBe(0)
    expect(empty.dynamicVersion).toBe(DYNAMIC_VERSION)
    setMediaLibrary(items)
    const later = addCalendarDays(DATE, 30)
    expect(getSchedule(channel, later).poolSize).toBe(0)
    const filled = getSchedule(channel, DATE)
    expect(filled.poolSize).toBeGreaterThan(0)
    expect(filled.blocks.flatMap((block) => block.children).some((child) => child.videoId)).toBe(true)
    writeFrozen({ ...filled, dynamicVersion: 'dynamic-v0' })
    const recompiled = getSchedule(channel, DATE)
    expect(recompiled.generation).not.toBe(filled.generation)
    expect(recompiled.dynamicVersion).toBe(DYNAMIC_VERSION)
    const live = liveEndpoint(903)!
    const before = readFrozen(903, DATE)
    markLiveUnavailable(live.videoId, NOW, 903)
    expect(readFrozen(903, DATE)).toBe(before)
  })

  it('airs the verified live stream when it is available', () => {
    for (const n of withMode('LIVE_STREAM', 'HYBRID_LIVE_ROLLING')) {
      const channel = channelByNumber(n)!
      const live = liveEndpoint(n)!
      for (const at of STAMPS) {
        const programme = broadcast(channel, at).current.programme
        expect(programme.videoId, `${n}`).toBe(live.videoId)
        expect(programme.playback, `${n}`).toBe('live')
        expect(programme.title, `${n}`).toBe(live.service)
      }
      const slots = guideSlots(channel, NOW, NOW + 3 * 3600_000)
      expect(slots.length, `${n}`).toBeGreaterThan(0)
      expect(slots.every((slot) => slot.programme.videoId === live.videoId), `${n}`).toBe(true)
      expect(measureAiring(items, NOW).find((row) => row.number === n)?.live, `${n}`).toBe(live.service)
    }
  })

  it('falls back to rolling or off air when a stream fails, and retries it after the window', () => {
    for (const n of withMode('LIVE_STREAM', 'HYBRID_LIVE_ROLLING')) {
      const channel = channelByNumber(n)!
      const live = liveEndpoint(n)!
      expect(markLiveUnavailable(live.videoId, NOW, n), `${n}`).toBe(true)
      const fallback = broadcast(channel, NOW + 60_000).current.programme
      expect(fallback.videoId, `${n}`).not.toBe(live.videoId)
      if (config[String(n)].mode === 'HYBRID_LIVE_ROLLING') {
        expect(routes[String(n)], `${n}`).toContain(fallback.videoId)
      } else {
        expect(fallback.videoId ?? null, `${n}`).toBeNull()
      }
      expect(broadcast(channel, NOW + LIVE_RETRY_MS - 1).current.programme.videoId, `${n}`).not.toBe(live.videoId)
      expect(broadcast(channel, NOW + LIVE_RETRY_MS + 60_000).current.programme.videoId, `${n}`).toBe(live.videoId)
    }
    expect(markLiveUnavailable('dQw4w9WgXcQ', NOW)).toBe(false)
  }, 120_000)

  it('airs only routed, dated programmes from the configured publishers on rolling channels', () => {
    const owner = new Map<string, number>()
    for (const n of DYNAMIC_CHANNELS) {
      for (const id of routes[String(n)] ?? []) {
        expect(owner.get(id), `${id} on ${owner.get(id)} and ${n}`).toBeUndefined()
        owner.set(id, n)
        expect(published[id], id).toMatch(/^\d{4}-\d\d-\d\dT/)
      }
    }
    for (const n of rolling()) {
      const listed = new Set(routes[String(n)])
      const allowed = config[String(n)].rolling!.sources
      for (const item of routed(n)) {
        expect(listed.has(item.externalId ?? ''), `${n} ${item.title}`).toBe(true)
        expect(allowed, `${n} ${item.sourceId}`).toContain(item.sourceId)
        expect(item.title, `${n}`).not.toMatch(EXCLUDED)
      }
      const children = getSchedule(channelByNumber(n)!, DATE).blocks.flatMap((block) => block.children).filter((child) => child.videoId)
      expect(children.length, `${n}`).toBeGreaterThan(0)
      for (const child of children) expect(listed.has(child.videoId!), `${n} ${child.title}`).toBe(true)
    }
    for (const n of withMode('LIVE_STREAM', 'UNRESOLVED')) expect(routes[String(n)] ?? [], `${n}`).toEqual([])
  }, 120_000)

  it('enforces each channel freshness window and never airs a programme before it was published', () => {
    for (const n of rolling()) {
      const days = config[String(n)].rolling!.freshnessDays
      expect(freshnessDays(n), `${n}`).toBe(days)
      const { startMs, endMs } = broadcastWindow(DATE)
      const today = fresh(n)
      expect(today.length, `${n}`).toBeGreaterThan(0)
      for (const item of today) {
        const at = Date.parse(item.publishedAt!)
        expect(at, `${n} ${item.title}`).toBeGreaterThanOrEqual(startMs - days * DAY_MS)
        expect(at, `${n} ${item.title}`).toBeLessThan(endMs)
      }
      expect(fresh(n, addCalendarDays(DATE, days + 2)), `${n}`).toEqual([])
      const earlier = addCalendarDays(DATE, -3)
      const earlierEnd = broadcastWindow(earlier).endMs
      for (const item of fresh(n, earlier)) expect(Date.parse(item.publishedAt!), `${n}`).toBeLessThan(earlierEnd)
    }
    for (const n of withMode('LIVE_STREAM', 'UNRESOLVED')) {
      expect(freshnessDays(n), `${n}`).toBe(0)
      expect(fresh(n), `${n}`).toEqual([])
    }
    const later = measureAiring(items, NOW + 200 * DAY_MS)
    for (const n of withMode('ROLLING_CURRENT')) expect(later.find((row) => row.number === n)?.status, `${n}`).toBe('dormant')
    for (const n of withMode('HYBRID_LIVE_ROLLING')) expect(later.find((row) => row.number === n)?.count, `${n}`).toBe(0)
  })

  it('classifies geographic news by the region each report names', () => {
    for (const [channel, [allowed, allowNone]] of Object.entries(GEOGRAPHY)) {
      for (const item of routed(Number(channel))) {
        const found = regions(item.title)
        if (found.size === 0) expect(allowNone, `${channel} ${item.title}`).toBe(true)
        for (const region of found) expect(allowed, `${channel} ${item.title}`).toContain(region)
      }
    }
    for (const item of routed(933)) {
      const found = regions(item.title)
      if (item.sourceId !== 'src_sabc_news') expect(found.has('africa'), item.title).toBe(true)
      for (const region of found) expect(region, item.title).toBe('africa')
    }
    for (const [n, source] of [[903, 'src_euronews'], [904, 'src_cna'], [905, 'src_africanews'], [906, 'src_aljazeera_english'], [932, 'src_abc_news_au']] as const) {
      expect(config[String(n)].rolling!.sources, `${n}`).toEqual([source])
    }
  })

  it('classifies topical and format news by subject, duration and programme form', () => {
    for (const [channel, pattern] of Object.entries(TOPICS)) {
      for (const item of routed(Number(channel))) expect(item.title, channel).toMatch(pattern)
    }
    for (const item of routed(938)) {
      if (item.sourceId !== 'src_new_scientist') expect(item.title).toMatch(words('scien\\w*|researchers|study (finds|shows|suggests)|discover\\w*|species|fossils?|dinosaurs?|\\bdna\\b|genes?|genetic\\w*|vaccines?|medic(al|ine)|brain|cancer|disease|virus|physics|chemistry|archaeolog\\w*|quantum|evolution|biolog\\w*|neuro\\w*|health breakthrough|mathematic\\w*|robots?|artificial intelligence'))
    }
    for (const item of routed(912)) expect(item.durationSeconds, item.title).toBeGreaterThanOrEqual(900)
    for (const item of routed(943)) expect(item.durationSeconds, item.title).toBeGreaterThanOrEqual(1200)
    for (const item of routed(947)) expect(item.durationSeconds, item.title).toBeLessThanOrEqual(360)
    for (const n of [913, 919, 938, 939, 941, 942, 943, 944]) expect(config[String(n)].rolling!.sources.length, `${n}`).toBeGreaterThanOrEqual(5)
  })

  it('keeps weather its own family of official weather programming', () => {
    const weather = Object.entries(config).filter(([, row]) => row.family === 'weather').map(([n]) => Number(n)).sort((a, b) => a - b)
    expect(weather).toEqual([74, 895, 910, 911, 922])
    expect(liveEndpoint(922)?.sourceId).toBe('src_fox_weather')
    expect(liveEndpoint(74)?.sourceId).toBe('src_weathernation')
    for (const item of routed(922)) {
      expect(item.sourceId).toBe('src_fox_weather')
      expect(item.title).toMatch(WEATHER)
    }
    for (const item of routed(895)) expect(item.sourceId).toBe('src_met_office')
    for (const item of routed(911)) {
      expect(item.title).toMatch(WEATHER)
      expect(regions(item.title).has('us') && regions(item.title).size === 1, item.title).toBe(false)
    }
    const weatherIds = new Set(weather.flatMap((n) => routes[String(n)] ?? []))
    for (const n of DYNAMIC_CHANNELS.filter((n) => !weather.includes(n))) {
      for (const id of routes[String(n)] ?? []) expect(weatherIds.has(id), `${n} ${id}`).toBe(false)
    }
  })

  it('keeps Chart and New Music distinct', () => {
    expect(config['550'].mode).toBe('UNRESOLVED')
    expect(config['550'].reason).toMatch(/chart/i)
    expect(routed(550)).toEqual([])
    expect(config['551'].mode).toBe('ROLLING_CURRENT')
    expect(config['551'].rolling!.freshnessDays).toBeLessThanOrEqual(60)
    const pool = routed(551)
    expect(pool.length).toBeGreaterThan(0)
    for (const item of pool) {
      expect(item.title).toMatch(NEW_RELEASE)
      expect(item.title).not.toMatch(NOT_NEW)
    }
    const ids = new Set(pool.map((item) => item.id))
    for (let n = 500; n <= 599; n += 1) {
      if (n === 551) continue
      expect(routed(n).some((item) => ids.has(item.id)), `${n}`).toBe(false)
    }
    expect(broadcast(channelByNumber(550)!, NOW).current.programme.videoId ?? null).toBeNull()
  })

  it('needs no developer key or data API at runtime', () => {
    const offenders: string[] = []
    const scan = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = `${dir}/${name}`
        if (statSync(path).isDirectory()) scan(path)
        else if (/\.(ts|tsx|js|json|html|css)$/.test(name) && !name.endsWith('.test.ts')) {
          const text = readFileSync(path, 'utf8')
          if (/AIza[0-9A-Za-z_-]{35}|[?&]key=|googleapis\.com\/youtube\/v3|youtube\.googleapis/.test(text)) offenders.push(path)
        }
      }
    }
    for (const dir of ['src', 'public', 'dist']) if (existsSync(dir)) scan(dir)
    expect(offenders).toEqual([])
  })

  it('keeps owned catalogues, ICC and the International Criminal Court where they belong', () => {
    expect(OWNED_SOURCES.get('src_british_pathe')).toBe(805)
    expect(OWNED_SOURCES.get('src_kofa')).toBe(114)
    expect(OWNED_SOURCES.get('src_orbital_bacon')).toBe(225)
    for (const [source] of OWNED_SOURCES) {
      for (const n of DYNAMIC_CHANNELS) {
        expect(routed(n).some((item) => item.sourceId === source), `${source} ${n}`).toBe(false)
        expect(config[String(n)].live?.sourceId, `${n}`).not.toBe(source)
      }
    }
    expect(sources.src_icc).not.toMatch(/criminal/i)
    expect(sources.src_intl_criminal_court).toMatch(/criminal court/i)
  })

  it('still schedules Orbital Bacon on 225', () => {
    for (const at of STAMPS) {
      const programme = broadcast(channelByNumber(225)!, at).current.programme
      const item = items.find((entry) => entry.externalId === programme.videoId)
      expect(item?.sourceId).toBe('src_orbital_bacon')
    }
  })

  it('keeps the 1001+ User Network outside the provider model', () => {
    for (const n of [1001, 1500]) {
      expect(dynamicChannel(n)).toBeUndefined()
      expect(liveEndpoint(n)).toBeUndefined()
      expect(freshnessDays(n)).toBeUndefined()
      expect(getEligibleMedia(items as MediaItem[], n)).toEqual([])
      expect(routed(n)).toEqual([])
    }
    expect(DYNAMIC_CHANNELS.every((n) => n < 1000)).toBe(true)
  })

  it('loses no programming on any channel against the catalogue-v40 baseline, apart from the mandatory Pass 23 exclusions', () => {
    const removals = JSON.parse(readFileSync('docs/exclusion-removals-v43.json', 'utf8')).removed as Record<string, string[]>
    const byId = new Map(items.map((item) => [item.id, item]))
    for (const [channel, count] of Object.entries(v41.baselineProgrammes)) {
      const removed = (removals[channel] ?? []).map((id) => byId.get(id)!)
      for (const item of removed) expect(excludedProgramme(item), `${channel}`).toBe(true)
      const allowance = freshFor(Number(channel), removed, DATE).length
      expect(fresh(Number(channel)).length + allowance, channel).toBeGreaterThanOrEqual(count)
    }
  }, 120_000)
})
