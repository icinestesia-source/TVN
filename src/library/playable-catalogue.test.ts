import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { channelMayAir } from '../data/independent/network.ts'
import { policyFor } from '../director/policies.ts'
import { getEligibleMedia } from './query.ts'
import { expandPlayableCatalogue } from './playable-catalogue.ts'

const EXCLUDED = [64, 146, 480, 481, 482, 492, 667, 682, 683, 873, 874]

describe('shipped playable catalogue', () => {
  const shipped = expandPlayableCatalogue(JSON.parse(readFileSync('public/independent/playable.json', 'utf8')))

  it('expands compact rows and drops rows that cannot air', () => {
    const items = expandPlayableCatalogue({
      format: 'retrotv-playable-v2',
      generatedAt: 5,
      sources: { src_nfb: 'NFB' },
      items: [
        ['abc', 'Film', 600, 'src_nfb', [101, 1001], 'api'],
        ['nodur', 'Broken', 0, 'src_nfb', [101], 'api'],
        ['user', 'User only', 60, 'src_nfb', [1002], 'api'],
      ],
    })
    expect(items.map((item) => item.id)).toEqual(['yt:abc'])
    expect(items[0]?.explicitChannelIncludes).toEqual([101])
    expect(items[0]?.sourceCollection).toBe('NFB')
    expect(items[0]?.ingestedFrom).toBe('youtube-discovery')
    expect(expandPlayableCatalogue([{ id: 'legacy' }])).toHaveLength(1)
  })

  it('keeps the resolved Pathé records and adds other approved sources', () => {
    const bySource = new Map<string, number>()
    for (const item of shipped) bySource.set(item.sourceId ?? '', (bySource.get(item.sourceId ?? '') ?? 0) + 1)
    expect(bySource.get('src_british_pathe')).toBe(2098)
    expect(bySource.size).toBeGreaterThan(40)
    const shortForm = new Set(['src_british_pathe', 'src_rt_classic_trailers', 'src_ed_sullivan'])
    expect(Math.max(...[...bySource.entries()].filter(([id]) => !shortForm.has(id)).map(([, count]) => count))).toBeLessThanOrEqual(900)
  })

  it('carries no aircraft, space or religion titles and nothing for 655', () => {
    const blocked = /\b(aircraft|aviation|airliner|helicopter|aerospace|nasa|astronaut|sermon|worship|bible)\b/i
    expect(shipped.filter((item) => blocked.test(item.title)).map((item) => item.title)).toEqual([])
    expect(shipped.some((item) => item.explicitChannelIncludes?.includes(655))).toBe(false)
  })

  it('never routes independent items to 1001+, excluded or unavailable channels', () => {
    const problems: string[] = []
    for (const item of shipped) {
      if (!(item.durationSeconds > 0)) problems.push(`${item.id} has no duration`)
      for (const number of item.explicitChannelIncludes ?? []) {
        if (number > 999 || EXCLUDED.includes(number) || !channelMayAir(number)) problems.push(`${item.id} -> ${number}`)
      }
    }
    expect(problems).toEqual([])
  })

  it('lets manifest channels without a bespoke policy broadcast routed items', () => {
    for (const number of [20, 114, 225, 805]) {
      expect(policyFor(number)).toBeDefined()
      expect(getEligibleMedia(shipped, number).length).toBeGreaterThan(0)
    }
  })
})
