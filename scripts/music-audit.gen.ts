// Compiles seven Director days for every music channel (500–599) and writes docs/music-audit.json:
// pool depth plus what actually airs, by source and by credited artist (title prefix before " - ").
import { readFileSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { channelByNumber } from '../src/data/catalogue.ts'
import { getSchedule, resetDirector } from '../src/director/director.ts'
import { setMediaLibrary } from '../src/director/library.ts'
import { policyFor } from '../src/director/policies.ts'
import { addCalendarDays } from '../src/director/time.ts'
import { expandPlayableCatalogue } from '../src/library/playable-catalogue.ts'

const START = '2026-09-28'
const DAYS = 7
const round = (value: number) => Math.round(value * 100) / 100
const OUT = process.env.MUSIC_AUDIT_OUT ?? 'docs/music-audit.json'

interface Row { number: number; status: string; programmes: number; hours: number; sources?: Record<string, { programmes: number; hours: number }> }

const artistOf = (title: string, source: string) => {
  const match = /^(.{2,60}?)\s+[-–—|]\s+/.exec(title)
  return (match ? match[1] : source).toLowerCase().replace(/\s*(feat\.|ft\.|&|,|x ).*$/, '').trim()
}

const top = (counts: Map<string, number>, total: number) => {
  const sorted = [...counts].sort((a, b) => b[1] - a[1])
  return { distinct: sorted.length, top: sorted.slice(0, 6).map(([key, value]) => ({ key, hours: round(value), share: total ? round(value / total) : 0 })) }
}

it('writes the music audit', () => {
  const raw = JSON.parse(readFileSync('public/independent/playable.json', 'utf8'))
  const items = expandPlayableCatalogue(raw)
  resetDirector()
  setMediaLibrary(items)
  const byId = new Map(items.map((item) => [item.id, item]))
  const manifest = new Map((JSON.parse(readFileSync('docs/channel-manifest.json', 'utf8')).records as Row[]).map((row) => [row.number, row]))
  const channels = []
  for (let n = 500; n <= 599; n += 1) {
    const channel = channelByNumber(n)
    const record = manifest.get(n)
    if (!channel || !record) continue
    const policy = policyFor(n)
    const bySource = new Map<string, number>()
    const byArtist = new Map<string, number>()
    const airings = new Map<string, number>()
    let aired = 0
    let fallback = 0
    if (policy) {
      for (let d = 0; d < DAYS; d += 1) {
        for (const block of getSchedule(channel, addCalendarDays(START, d)).blocks) {
          for (const child of block.children) {
            const h = (child.endMs - child.startMs) / 3_600_000
            if (!child.videoId || child.fallback) { fallback += h; continue }
            aired += h
            const item = child.mediaItemId ? byId.get(child.mediaItemId) : undefined
            const source = item?.sourceId ?? 'unknown'
            bySource.set(source, (bySource.get(source) ?? 0) + h)
            const artist = artistOf(item?.title ?? child.title ?? '', source)
            byArtist.set(artist, (byArtist.get(artist) ?? 0) + h)
            airings.set(child.videoId, (airings.get(child.videoId) ?? 0) + 1)
          }
        }
      }
    }
    const pool = Object.values(record.sources ?? {})
    channels.push({
      number: n, name: channel.name, status: record.status, programmes: record.programmes, poolHours: record.hours,
      poolTopSource: pool.length ? round(Math.max(...pool.map((source) => source.hours)) / (record.hours || 1)) : 0,
      aired7d: round(aired), fallback7d: round(fallback), uniqueAired: airings.size, maxAirings: Math.max(0, ...airings.values()),
      mostAired: [...airings].sort((a, b) => b[1] - a[1]).slice(0, 1).map(([id, count]) => ({ id, count, title: items.find((item) => item.externalId === id)?.title })),
      sources: top(bySource, aired), artists: top(byArtist, aired),
    })
  }
  writeFileSync(OUT, `${JSON.stringify({ start: START, days: DAYS, channels }, null, 2)}\n`)
  expect(channels.length).toBeGreaterThan(90)
}, 600_000)
