import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { shippedChannel } from './data/catalogue.ts'
import { centralEdit, centralEditsFrom, installCentralEdits, withCentralEdits } from './data/central-edits.ts'
import { DEDICATED } from './director/fit.ts'
import { buildCuratedEdit, type CuratedEdit } from './services/curated-edits.ts'

const doc = JSON.parse(readFileSync('src/data/central-edits.json', 'utf8'))
const read = (path: string) => readFileSync(path, 'utf8')

afterEach(() => installCentralEdits(null))

describe('776 VERITAS and 777 CRROW777: central channels from public podcast feeds', () => {
  it('ships each from its public feed only, never a paid or members feed, in a random order', () => {
    const feeds = Object.fromEntries(Object.entries(doc.channels as Record<string, { sources: { url: string }[] }>).map(([number, channel]) => [number, channel.sources.map((source) => source.url)]))
    expect(feeds).toEqual({ '776': ['https://veritas7.com/vs.rss'], '777': ['https://www.crrow777radio.com/feed/podcast/'] })
    for (const url of Object.values(feeds).flat()) expect(url).not.toMatch(/paid|member|private|premium|token|key=/i)
    expect(read('src/data/central-edits.json')).not.toMatch(/token=|signature=|X-Amz|AIza/)
    const edits = centralEditsFrom(doc)
    for (const number of ['776', '777']) {
      const edit = edits[number]
      expect(edit.orderKind).toBe('random')
      expect(edit.sources[0]).toMatchObject({ kind: 'tvn', enabled: false })
      const episodes = edit.sources.slice(1).flatMap((source) => source.videos ?? [])
      expect(episodes.length).toBeGreaterThan(100)
      expect(new Set(edit.order)).toEqual(new Set(episodes.map((episode) => episode.id)))
      expect(edit.order).not.toEqual(episodes.map((episode) => episode.id))
      for (const episode of episodes) expect(episode.media).toMatch(/^https:\/\/[^?]+$/)
    }
  })

  it('airs the episodes as audio programmes on the shipped channels, in the shipped order', () => {
    installCentralEdits(doc)
    for (const [number, name] of [[776, 'VERITAS'], [777, 'CRROW777']] as const) {
      const shipped = shippedChannel(number)!
      expect(shipped.name).toBe(name)
      const edit = centralEdit(number)!
      const built = buildCuratedEdit(shipped, edit)
      expect(built.channel.name).toBe(name)
      expect(built.programmes!.length).toBe(edit.order!.length)
      expect(built.programmes!.map((programme) => programme.videoId ?? programme.id).length).toBeGreaterThan(100)
      expect(built.programmes!.every((programme) => programme.mediaUrl?.startsWith('https://'))).toBe(true)
    }
  })

  it("lets the viewer's own edit of the channel come first", () => {
    installCentralEdits(doc)
    const own = { channelNumber: 776, name: 'MY VERITAS', sources: [], savedAt: 1 } as CuratedEdit
    expect(withCentralEdits({ '776': own })['776']).toBe(own)
    expect(withCentralEdits({})['777'].name).toBe('CRROW777')
    const provider = read('src/state/TvProvider.tsx')
    expect(provider).toContain('const saved = loadCuratedEdit(number) ?? centralEdit(number)')
    expect(provider).toContain('for (const edit of Object.values(withCentralEdits(edits))) {')
  })

  it('moves Adventure Travel and Budget Travel to 799 Adventure & Budget Travel', () => {
    expect(shippedChannel(799)!.name).toBe('Adventure & Budget Travel')
    for (const source of ['src_indigo_traveller', 'src_eva_zu_beck', 'src_travel_tiny_budget', 'src_older_backpacker', 'src_holiday_expert', 'src_hopscotch', 'src_nomadic_matt']) expect(DEDICATED[source], source).toEqual([799])
    const playable = JSON.parse(read('public/independent/playable.json')) as { items: [string, string, number, string, number[], string][] }
    expect(playable.items.some((item) => item[4].includes(776) || item[4].includes(777))).toBe(false)
    expect(playable.items.filter((item) => item[4].includes(799)).length).toBeGreaterThan(500)
  })
})
