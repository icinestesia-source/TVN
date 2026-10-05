import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { inNetworkDirectory } from './data/network.ts'

type ManifestRecord = { number: number; name: string; status: string; inGuide: boolean; scope: string; nextStep: string }

const manifest = JSON.parse(readFileSync('docs/channel-manifest.json', 'utf8')) as {
  records: ManifestRecord[]
  totals: Record<string, number>
}

const STATUSES = new Set([
  'PLAYABLE_STRONG', 'PLAYABLE', 'PLAYABLE_THIN', 'NEEDS_CONTENT', 'NEEDS_LIVE_PROVIDER', 'NEEDS_AUDIO_PROVIDER',
  'RETROTV_ORIGINAL', 'GENERATED', 'CENTRAL_PODCAST', 'DELIBERATELY_UNAVAILABLE', 'EXCLUDED',
])

describe('000–999 channel manifest', () => {
  it('accounts for every channel with an explicit disposition', () => {
    expect(manifest.records.map((record) => record.number)).toEqual(Array.from({ length: 1000 }, (_, n) => n))
    for (const record of manifest.records) {
      expect(STATUSES.has(record.status), `${record.number} ${record.status}`).toBe(true)
      expect(record.name.length).toBeGreaterThan(0)
      expect(record.scope.length).toBeGreaterThan(0)
    }
    expect(Object.values(manifest.totals).reduce((a, b) => a + b, 0)).toBe(1000)
  })

  it('keeps excluded channels off and matches the guide directory', () => {
    for (const n of [64, 146, 480, 481, 482, 492, 667, 682, 683, 873, 874]) {
      expect(manifest.records[n].status).toBe('EXCLUDED')
    }
    for (const record of manifest.records.slice(1)) {
      expect(record.inGuide, `${record.number}`).toBe(inNetworkDirectory(record.number))
      if (record.status !== 'EXCLUDED' && record.status !== 'DELIBERATELY_UNAVAILABLE') {
        expect(record.inGuide, `${record.number}`).toBe(true)
      }
    }
  })
})
