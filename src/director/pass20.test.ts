import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { channelByNumber } from '../data/catalogue.ts'
import { excludedProgramme } from '../library/exclusions.ts'
import { expandPlayableCatalogue } from '../library/playable-catalogue.ts'
import { getChannelMedia, getEligibleMedia } from '../library/query.ts'
import type { LibraryMedia } from '../library/types.ts'
import { broadcast } from '../services/broadcast.ts'
import { resetDirector } from './director.ts'
import { DEDICATED, OWNED_SOURCES, PROGRAMME_REUSE } from './fit.ts'
import { setMediaLibrary } from './library.ts'
import type { MediaItem } from './types.ts'

const RECURATED = new Set(Object.keys((JSON.parse(readFileSync('src/data/central-sources.json', 'utf8')) as { channels: object }).channels))

const CURATED = [27, 84, 88, 89, 90, 292]
const YEAR_DECADES: Record<number, [number, number]> = { 544: [1990, 1999], 547: [2020, 2029] }
const ACTIVATED = [...CURATED, 139, ...Object.keys(YEAR_DECADES).map(Number)]
const PROGRAMMING = [...CURATED, 139]
const SHORTS_HOMES: Record<string, number> = { src_omeleto: 107, src_alter: 140, src_dust: 144 }
const EXCLUDED_CHANNELS = [64, 146, 480, 481, 482, 492, 667, 682, 683, 873, 874]
const EXCLUDED = /\b(space(ship)?|nasa|rockets?|satellites?|astronom\w*|astrophysic\w*|cosmolog\w*|galax\w*|aircraft|aviation|airplanes?|helicopters?|airports?|spaceflight|aerospace|church|christianity|mosque|prayer|bible|theolog\w*|sermon|worship|preach\w*|rabbi|everyman)\b/i
const FINAL_CLASSES = ['LIVE_OR_ROLLING', 'RIGHTS_BLOCKED', 'ORIGINAL_REQUIRED', 'RESEARCH_UNRESOLVED', 'OTHER_GENUINE_BLOCKER']
const STAMPS = [7, 11, 15, 20].map((hour) => new Date(`2026-09-28T${String(hour).padStart(2, '0')}:23:00+01:00`).getTime())

describe('Pass 20 static content production', () => {
  let items: LibraryMedia[] = []
  let routes: Record<string, string[]> = {}
  let sources: Record<string, string> = {}
  let originals: Record<string, [number, string, string, string, string]> = {}
  let map: { baselineProgrammes: Record<string, number>; records: { number: number; finalClass: string }[] }
  const airing = (channel: number) => getChannelMedia(items as MediaItem[], channel) as LibraryMedia[]
  const hours = (pool: LibraryMedia[]) => pool.reduce((sum, item) => sum + item.durationSeconds, 0) / 3600

  beforeAll(() => {
    const doc = JSON.parse(readFileSync('public/independent/playable.json', 'utf8'))
    routes = doc.programmeRoutes
    sources = doc.sources
    originals = doc.originals
    map = JSON.parse(readFileSync('docs/remaining-content-map-v40.json', 'utf8'))
    items = expandPlayableCatalogue(doc)
    resetDirector()
    setMediaLibrary(items)
  })

  it('activates every Pass 20 channel with at least three real hours', () => {
    for (const channel of ACTIVATED) {
      const pool = airing(channel)
      expect(pool.length, `${channel}`).toBeGreaterThan(0)
      expect(pool.every((item) => item.durationSeconds > 0), `${channel}`).toBe(true)
      expect(hours(pool), `${channel}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('resolves a real programme with a valid video id on every Pass 20 channel', () => {
    for (const channel of ACTIVATED) {
      for (const at of STAMPS) {
        const programme = broadcast(channelByNumber(channel)!, at).current.programme
        expect(programme.videoId ?? '', `${channel}`).toMatch(/^[\w-]{11}$/)
        expect(items.some((item) => item.externalId === programme.videoId), `${channel}`).toBe(true)
      }
    }
  }, 120_000)

  it('airs the front doors only from their explicit programme lists', () => {
    for (const channel of CURATED) {
      const listed = new Set(routes[String(channel)])
      expect(listed.size, `${channel}`).toBeGreaterThan(0)
      for (const item of airing(channel)) {
        expect(PROGRAMME_REUSE[channel], `${channel} ${item.sourceId}`).toContain(item.sourceId)
        expect(listed.has(item.externalId ?? ''), `${channel} ${item.title}`).toBe(true)
      }
    }
  })

  it('samples Indie Screen evenly without cloning any shorts home', () => {
    const pool = airing(84)
    for (const [source, home] of Object.entries(SHORTS_HOMES)) {
      const share = pool.filter((item) => item.sourceId === source)
      const homePool = new Set(airing(home).map((item) => item.id))
      expect(share.length, source).toBeGreaterThan(0)
      expect(share.length / pool.length, source).toBeLessThan(0.4)
      expect(share.filter((item) => homePool.has(item.id)).length / homePool.size, source).toBeLessThan(0.2)
    }
  })

  it('keeps Community on the Voice of the People collection and Local disjoint from it', () => {
    const community = airing(88)
    for (const item of community) expect(item.title).toMatch(/voice of the people/i)
    const own = new Set(community.map((item) => item.id))
    expect(airing(89).filter((item) => own.has(item.id))).toEqual([])
  })

  it('builds Documentary Trailers from the official documentary distributor alone', () => {
    expect(DEDICATED.src_dogwoof).toEqual([139])
    expect(sources.src_dogwoof).toBe('Dogwoof')
    for (const item of airing(139)) {
      expect(item.sourceId).toBe('src_dogwoof')
      expect(item.title).toMatch(/\btrailer\b/i)
      expect(item.durationSeconds).toBeLessThanOrEqual(600)
    }
    for (const channel of [120, 129, 891]) expect(airing(channel).some((item) => item.sourceId === 'src_dogwoof'), `${channel}`).toBe(false)
  })

  it('fills the new decade channels only with Wikidata-dated original recordings from several artists', () => {
    for (const [channel, [from, to]] of Object.entries(YEAR_DECADES)) {
      const pool = airing(Number(channel))
      const bySource = new Map<string, number>()
      for (const item of pool) {
        const [year, basis, provenance, confidence, evidence] = originals[item.externalId ?? ''] ?? []
        expect(basis, `${channel} ${item.title}`).toBe('recording')
        expect(['VERIFIED', 'HIGH']).toContain(confidence)
        expect(year, `${channel} ${item.title}`).toBeGreaterThanOrEqual(from)
        expect(year, `${channel} ${item.title}`).toBeLessThanOrEqual(to)
        if (provenance === 'wikidata') expect(evidence, item.title).toMatch(/^Q\d+ .+ P577 \d{4}/)
        bySource.set(item.sourceId ?? '', (bySource.get(item.sourceId ?? '') ?? 0) + item.durationSeconds)
      }
      expect(bySource.size, channel).toBeGreaterThanOrEqual(3)
      expect(Math.max(...bySource.values()) / (hours(pool) * 3600), channel).toBeLessThanOrEqual(0.6)
    }
  })

  it('carries no excluded subjects on the Pass 20 channels', () => {
    for (const channel of PROGRAMMING) for (const item of airing(channel)) expect(item.title, `${channel}`).not.toMatch(EXCLUDED)
  })

  it('keeps owned catalogues, ICC and the International Criminal Court where they belong', () => {
    expect(OWNED_SOURCES.get('src_british_pathe')).toBe(805)
    expect(OWNED_SOURCES.get('src_kofa')).toBe(114)
    expect(OWNED_SOURCES.get('src_orbital_bacon')).toBe(225)
    for (const [source] of OWNED_SOURCES) {
      for (const channel of ACTIVATED) expect(airing(channel).some((item) => item.sourceId === source), `${source} ${channel}`).toBe(false)
    }
    expect(sources.src_icc).not.toMatch(/criminal/i)
    expect(sources.src_intl_criminal_court).toMatch(/criminal court/i)
  })

  it('keeps the excluded channels empty and the independent catalogue out of 1001+', () => {
    for (const channel of [...EXCLUDED_CHANNELS, 1001, 1500]) {
      expect(getEligibleMedia(items as MediaItem[], channel), `${channel}`).toEqual([])
      expect(airing(channel), `${channel}`).toEqual([])
    }
  })

  it('classifies every remaining NEEDS_CONTENT channel exactly once into a final class', () => {
    const manifest = JSON.parse(readFileSync('docs/channel-manifest.json', 'utf8')).records as { number: number; status: string }[]
    const needs = manifest.filter((row) => row.status === 'NEEDS_CONTENT').map((row) => row.number)
    const mapped = map.records.map((row) => row.number)
    expect(new Set(mapped).size).toBe(mapped.length)
    // Channels reclassified to NEEDS_CONTENT in Pass 23 are mapped in remaining-content-map-v43.
    const pass23 = new Set((JSON.parse(readFileSync('docs/remaining-content-map-v43.json', 'utf8')).records as { number: number; decidedIn: string }[]).filter((row) => row.decidedIn === '23').map((row) => row.number))
    for (const number of needs.filter((n) => !pass23.has(n))) expect(mapped, `${number}`).toContain(number)
    const resolved = mapped.filter((number) => !needs.includes(number))
    const pass22 = new Set((JSON.parse(readFileSync('docs/remaining-content-map-v42.json', 'utf8')).records as { number: number }[]).map((row) => row.number))
    for (const number of resolved.filter((n) => !pass22.has(n))) expect(map.records.find((row) => row.number === number)?.finalClass, `${number}`).toBe('LIVE_OR_ROLLING')
    for (const row of map.records) expect(FINAL_CLASSES, `${row.number}`).toContain(row.finalClass)
  })

  it('loses no programming on any channel against the catalogue-v39 baseline, apart from the mandatory Pass 23 exclusions', () => {
    const removals = JSON.parse(readFileSync('docs/exclusion-removals-v43.json', 'utf8')).removed as Record<string, string[]>
    const byId = new Map(items.map((item) => [item.id, item]))
    for (const [channel, count] of Object.entries(map.baselineProgrammes)) {
      // A channel re-defined centrally (src/data/central-sources.json) is held to its own definition, not the old baseline.
      if (RECURATED.has(channel)) continue
      const removed = (removals[channel] ?? []).map((id) => byId.get(id)!)
      for (const item of removed) expect(excludedProgramme(item), `${channel}`).toBe(true)
      expect(airing(Number(channel)).length + removed.length, channel).toBeGreaterThanOrEqual(count)
    }
  }, 120_000)
})
