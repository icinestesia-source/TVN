import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { channelByNumber } from '../data/catalogue.ts'
import { DYNAMIC_VERSION } from '../dynamic/providers.ts'
import { freshFor } from '../dynamic/runtime.ts'
import { artistOf } from '../library/metadata-channels.ts'
import { excludedProgramme } from '../library/exclusions.ts'
import { expandPlayableCatalogue } from '../library/playable-catalogue.ts'
import { getChannelMedia } from '../library/query.ts'
import type { LibraryMedia } from '../library/types.ts'
import { measureAiring } from '../network/airing.ts'
import { nightPool, ORIGINAL_CHANNELS, originalCard, originalCards, originalFormat, STATUS_CARD_CLASSES } from '../originals/originals.ts'
import { broadcast, guideSlots } from '../services/broadcast.ts'
import { channelsFromSources, mergeParsedExports, parseChannelsExport, planImport } from '../services/channels-import.ts'
import type { Programme } from '../types/programme.ts'
import { resetDirector } from './director.ts'
import { OWNED_SOURCES } from './fit.ts'
import { setMediaLibrary } from './library.ts'
import { CATALOGUE_VERSION } from './network.ts'
import { broadcastWindow } from './time.ts'
import type { MediaItem } from './types.ts'

const RECURATED = new Set(Object.keys((JSON.parse(readFileSync('src/data/central-sources.json', 'utf8')) as { channels: object }).channels))

const DATE = '2026-09-28'
const NOW = new Date(`${DATE}T12:00:00+01:00`).getTime()
const OUTCOMES = ['ACTIVATED', 'GENERATED_PRESENTATION', 'RETROTV_ORIGINAL', 'INTENTIONALLY_UNAVAILABLE', 'UNRESOLVED', 'RIGHTS_BLOCKED']
const CLASSES = [
  'IDENTITY_COLLISION', 'NEAR_THRESHOLD', 'METADATA_UNAVAILABLE', 'INSUFFICIENT_EXISTING_INVENTORY', 'NO_LEGITIMATE_CONTENT_MODEL',
  'INSUFFICIENT_INVENTORY', 'NO_OFFICIAL_SOURCE', 'IDENTITY_UNRESOLVED', 'RIGHTS_BLOCKED', 'ORIGINAL_MEDIA_REQUIRED',
]
const FRONT_DOORS = [19, 61, 78, 800]
const EXCLUDED = /\b(space(ship)?|nasa|rockets?|satellites?|astronom\w*|cosmolog\w*|galax\w*|aircraft|aviation|airplanes?|helicopters?|spaceflight|aerospace|church|mosque|prayer|bible|sermon|worship|preach\w*)\b/i
const ON_AIR = ['PLAYABLE', 'PLAYABLE_STRONG']

interface MapRow {
  number: number
  v41Class: string
  outcome: string
  subtype: string
  statusAfter: string
  redirect?: number
  rights?: Record<string, unknown>
}
interface ManifestRow { number: number; status: string; hours: number }

describe('Pass 22 final 000–999 completion', () => {
  let items: LibraryMedia[] = []
  let routes: Record<string, string[]> = {}
  let manifest: Map<number, ManifestRow>
  let v41: { records: { number: number; finalClass: string }[] }
  let v42: { records: MapRow[]; unresolved: { number: number; finalClass: string }[]; baselineProgrammes: Record<string, number> }
  let v43: { records: (MapRow & { decidedIn: string })[]; unresolved: { number: number; finalClass: string }[] }
  const pool = (n: number) => freshFor(n, getChannelMedia(items as MediaItem[], n) as LibraryMedia[], DATE) as LibraryMedia[]
  const hours = (list: { durationSeconds: number }[]) => list.reduce((sum, item) => sum + item.durationSeconds, 0) / 3600

  beforeAll(() => {
    const doc = JSON.parse(readFileSync('public/independent/playable.json', 'utf8'))
    routes = doc.programmeRoutes
    manifest = new Map((JSON.parse(readFileSync('docs/channel-manifest.json', 'utf8')).records as ManifestRow[]).map((row) => [row.number, row]))
    v41 = JSON.parse(readFileSync('docs/remaining-content-map-v41.json', 'utf8'))
    v42 = JSON.parse(readFileSync('docs/remaining-content-map-v42.json', 'utf8'))
    v43 = JSON.parse(readFileSync('docs/remaining-content-map-v43.json', 'utf8'))
    items = expandPlayableCatalogue(doc)
    resetDirector()
    setMediaLibrary(items)
  })

  it('bumps the catalogue once and records the new dynamic config', () => {
    // Pass 23 bumped again (catalogue-v43) when the Director fill order changed.
    expect(CATALOGUE_VERSION).toBe('catalogue-v43')
    expect(DYNAMIC_VERSION).toBe('dynamic-v2')
  })

  it('gives every one of the 54 catalogue-v41 channels exactly one outcome', () => {
    const before = v41.records.map((row) => row.number).sort((a, b) => a - b)
    expect(before).toHaveLength(54)
    expect(v42.records.map((row) => row.number)).toEqual(before)
    // Pass 23 re-decided some of these channels; the current status is checked against the latest map.
    const latest = new Map(v43.records.map((row) => [row.number, row]))
    for (const row of v42.records) {
      expect(OUTCOMES, `${row.number}`).toContain(row.outcome)
      expect(row.v41Class, `${row.number}`).toBe(v41.records.find((old) => old.number === row.number)?.finalClass)
      expect(manifest.get(row.number)?.status, `${row.number}`).toBe(latest.get(row.number)?.statusAfter)
      if (latest.get(row.number)?.decidedIn === '22') expect(latest.get(row.number)?.statusAfter, `${row.number}`).toBe(row.statusAfter)
    }
    const needs = [...manifest.values()].filter((row) => row.status === 'NEEDS_CONTENT').map((row) => row.number)
    expect(v43.unresolved.map((row) => row.number).sort((a, b) => a - b)).toEqual(needs.sort((a, b) => a - b))
    expect(new Set(v43.unresolved.map((row) => row.number)).size).toBe(v43.unresolved.length)
    for (const row of [...v42.unresolved, ...v43.unresolved]) expect(CLASSES, `${row.number}`).toContain(row.finalClass)
  })

  it('keeps all ten rights channels blocked with a complete rights record', () => {
    const rights = v42.records.filter((row) => row.v41Class === 'RIGHTS_BLOCKED')
    expect(rights).toHaveLength(10)
    for (const row of rights) {
      expect(row.outcome, `${row.number}`).toBe('RIGHTS_BLOCKED')
      expect(row.statusAfter, `${row.number}`).toBe('NEEDS_CONTENT')
      for (const key of ['desired', 'provenance', 'problem', 'jurisdiction', 'alternative']) expect(row.rights?.[key], `${row.number} ${key}`).toBeTruthy()
      expect(row.rights?.ukUseEstablished, `${row.number}`).toBe(false)
      expect(pool(row.number), `${row.number}`).toEqual([])
    }
  })

  it('points each redundant slot at a channel that is on air', () => {
    // A slot re-decided later (769 became Indian Cooking in TVN 1.0.8) is judged by the latest map instead.
    const latest = new Map(v43.records.map((row) => [row.number, row]))
    const redundant = v42.records.filter((row) => row.outcome === 'INTENTIONALLY_UNAVAILABLE' && latest.get(row.number)?.outcome !== 'ACTIVATED')
    expect(redundant.length).toBeGreaterThan(0)
    expect(latest.get(769)).toMatchObject({ outcome: 'ACTIVATED', decidedIn: '1.0.8', statusAfter: manifest.get(769)?.status })
    for (const row of redundant) {
      expect(row.statusAfter, `${row.number}`).toBe('DELIBERATELY_UNAVAILABLE')
      expect(ON_AIR, `${row.number} -> ${row.redirect}`).toContain(manifest.get(row.redirect!)?.status)
      expect(originalCard(row.number)?.caption, `${row.number}`).toContain(String(row.redirect).padStart(3, '0'))
    }
  })

  it('programmes the front doors only from their curated lists', () => {
    for (const n of FRONT_DOORS) {
      const list = pool(n)
      expect(new Set(list.map((item) => item.externalId)), `${n}`).toEqual(new Set(routes[String(n)]))
      expect(hours(list), `${n}`).toBeGreaterThanOrEqual(3)
      for (const item of list) {
        expect(OWNED_SOURCES.has(item.sourceId ?? ''), `${n} ${item.title}`).toBe(false)
        expect(item.title, `${n}`).not.toMatch(EXCLUDED)
      }
    }
    const lists = FRONT_DOORS.map((n) => routes[String(n)])
    expect(new Set(lists.flat()).size).toBe(lists.flat().length)
  })

  it('airs one official video per act that Wikidata records as a musical group on Bands', () => {
    const years = JSON.parse(readFileSync('scripts/data/wikidata-song-years.json', 'utf8')).programmes as Record<string, { qid: string }>
    const performers = JSON.parse(readFileSync('scripts/data/wikidata-song-performers.json', 'utf8')) as Record<string, { performer: string; group: boolean }[]>
    const list = pool(564)
    expect(new Set(list.map((item) => item.externalId))).toEqual(new Set(routes['564']))
    const acts = list.map((item) => performers[years[item.externalId!]?.qid]?.find((entry) => entry.group)?.performer)
    expect(acts.every(Boolean)).toBe(true)
    expect(new Set(acts).size).toBe(list.length)
    expect(hours(list)).toBeGreaterThanOrEqual(3)
  })

  it('activates Indie 2000 without breaking the 60% single-act cap', () => {
    const list = pool(582)
    const total = hours(list)
    expect(total).toBeGreaterThanOrEqual(3)
    const byAct = new Map<string, number>()
    for (const item of list) {
      expect(item.original?.year, item.title).toBeGreaterThanOrEqual(2000)
      expect(item.original?.year, item.title).toBeLessThanOrEqual(2009)
      byAct.set(artistOf(item), (byAct.get(artistOf(item)) ?? 0) + item.durationSeconds / 3600)
    }
    expect(byAct.size).toBeGreaterThanOrEqual(3)
    expect(Math.max(...byAct.values())).toBeLessThanOrEqual(total * 0.6)
  })

  it('puts Americas Report on air from rolling official reporting', () => {
    expect(hours(pool(935))).toBeGreaterThanOrEqual(3)
    expect(measureAiring(items as MediaItem[], NOW).find((row) => row.number === 935)?.status).toBe('active')
  })

  it('runs the Test Card as a deterministic hourly cycle with no external media', () => {
    const channel = channelByNumber(887)!
    expect(originalFormat(887)?.kind).toBe('test-card')
    const first = broadcast(channel, NOW)
    expect(first.current.programme.videoId).toBeNull()
    expect(first.current.programme.caption).toBeTruthy()
    expect(broadcast(channel, NOW).current.programme.id).toBe(first.current.programme.id)
    expect(broadcast(channel, NOW + 3_600_000).current.programme.id).toBe(first.current.programme.id)
    const slots = guideSlots(channel, NOW, NOW + 6 * 3_600_000)
    for (let index = 1; index < slots.length; index += 1) expect(slots[index].startMs).toBe(slots[index - 1].endMs)
    expect(slots.every((slot) => slot.programme.videoId === null)).toBe(true)
  })

  it('airs Night Network from midnight to four, one verified 1987–1992 act per night, the same for every viewer', () => {
    const channel = channelByNumber(898)!
    const format = originalFormat(898)!
    expect(format.kind).toBe('night-block')
    const day = broadcastWindow(DATE, '00:00')
    const blockEnd = day.startMs + 4 * 3_600_000
    const slots = guideSlots(channel, day.startMs, day.endMs)
    const recordings = slots.filter((slot) => slot.programme.videoId)
    expect(recordings.length).toBeGreaterThan(20)
    expect(recordings[0].startMs).toBe(day.startMs)
    const pool = new Map(nightPool(format as Parameters<typeof nightPool>[0], items as MediaItem[]).map((item) => [item.externalId, item]))
    const acts = new Set<string>()
    for (const slot of recordings) {
      expect(slot.endMs, slot.programme.title).toBeLessThanOrEqual(blockEnd)
      const item = pool.get(slot.programme.videoId!)
      expect(item, slot.programme.title).toBeDefined()
      expect(item!.original!.year).toBeGreaterThanOrEqual(1987)
      expect(item!.original!.year).toBeLessThanOrEqual(1992)
      expect(OWNED_SOURCES.has((item as LibraryMedia).sourceId ?? '')).toBe(false)
      acts.add(artistOf(item as LibraryMedia))
    }
    expect(acts.size).toBe(recordings.length)
    const card = slots.find((slot) => !slot.programme.videoId)!
    expect(card.startMs).toBeLessThanOrEqual(blockEnd)
    expect(card.endMs).toBe(day.endMs)
    expect(broadcast(channel, NOW).current.programme.videoId).toBeNull()
    const ids = (list: typeof slots) => list.map((slot) => slot.programme.id).join()
    expect(ids(guideSlots(channel, day.startMs, day.endMs))).toBe(ids(slots))
    const next = broadcastWindow('2026-09-29', '00:00')
    const tomorrow = guideSlots(channel, next.startMs, next.startMs + 4 * 3_600_000).map((slot) => slot.programme.videoId)
    expect(tomorrow.join()).not.toBe(recordings.map((slot) => slot.programme.videoId).join())
  })

  it('shows an explicit card, never a bare Off air, on every unavailable, blocked or unresolved channel', () => {
    // Presentation-only cards (off-air services, live interruptions, empty rolling windows) are covered in pass23.test.ts.
    const cards = Object.fromEntries(Object.entries(originalCards()).filter(([, card]) => STATUS_CARD_CLASSES.has(card.class)))
    for (const [number, card] of Object.entries(cards)) {
      const n = Number(number)
      expect(['NEEDS_CONTENT', 'DELIBERATELY_UNAVAILABLE'], number).toContain(manifest.get(n)?.status)
      const programme: Programme = broadcast(channelByNumber(n)!, NOW).current.programme
      expect(programme.videoId, number).toBeNull()
      expect(programme.caption, number).toBe(card.caption)
      expect(programme.title, number).toBe(card.title)
    }
    for (const row of manifest.values()) if (row.status === 'NEEDS_CONTENT') expect(cards[String(row.number)], `${row.number}`).toBeDefined()
  })

  it('loses no programming on any static channel against the catalogue-v41 baseline, apart from the mandatory Pass 23 exclusions', () => {
    const removals = JSON.parse(readFileSync('docs/exclusion-removals-v43.json', 'utf8')).removed as Record<string, string[]>
    const byId = new Map(items.map((item) => [item.id, item]))
    for (const [channel, count] of Object.entries(v42.baselineProgrammes)) {
      // A channel re-defined centrally (src/data/central-sources.json) is held to its own definition, not the old baseline.
      if (RECURATED.has(channel)) continue
      const n = Number(channel)
      if (n >= 900 && n < 1000) continue
      const removed = (removals[channel] ?? []).map((id) => byId.get(id)!)
      for (const item of removed) expect(excludedProgramme(item), `${channel}`).toBe(true)
      const allowance = freshFor(n, removed, DATE).length
      expect(pool(n).length + allowance, channel).toBeGreaterThanOrEqual(count)
    }
  }, 120_000)

  it('keeps owned catalogues on their own channels', () => {
    expect(OWNED_SOURCES.get('src_british_pathe')).toBe(805)
    expect(OWNED_SOURCES.get('src_kofa')).toBe(114)
    expect(OWNED_SOURCES.get('src_orbital_bacon')).toBe(225)
    for (const n of [...FRONT_DOORS, 564, 582, 935]) {
      for (const item of pool(n)) expect(OWNED_SOURCES.has(item.sourceId ?? ''), `${n}`).toBe(false)
    }
    for (const at of [NOW, NOW + 3_600_000 * 5]) {
      const programme = broadcast(channelByNumber(225)!, at).current.programme
      expect(items.find((entry) => entry.externalId === programme.videoId)?.sourceId).toBe('src_orbital_bacon')
    }
  })

  it('lets user channels carry user programming while originals never use user media', () => {
    const merged = mergeParsedExports([parseChannelsExport(readFileSync('public/user-network/channels.txt', 'utf8'))])
    const built = channelsFromSources(planImport([], merged, { library: true, automatic: true }, [], 1).sources)
    const user = built.channels[0]
    expect(user.number).toBeGreaterThanOrEqual(1001)
    expect((built.programmes.get(user.id) ?? []).some((programme) => programme.videoId)).toBe(true)
    expect(originalFormat(user.number)).toBeUndefined()
    expect(originalCard(user.number)).toBeUndefined()
    expect(ORIGINAL_CHANNELS.every((n) => n < 1000)).toBe(true)
    const userItem = { ...items[0], id: 'user:1', provider: 'youtube', provenance: 'built-in-user', original: { year: 1990, basis: 'recording', source: 'title', confidence: 'HIGH', evidence: 'user' } } as unknown as MediaItem
    const format = originalFormat(898) as Parameters<typeof nightPool>[0]
    const withUser = nightPool(format, [...(items as MediaItem[]), userItem])
    expect(withUser.length).toBe(nightPool(format, items as MediaItem[]).length)
  })
})
