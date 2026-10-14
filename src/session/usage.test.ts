import { describe, expect, it } from 'vitest'
import { countResource, formatBytes, mediaDelta, type UsageTotals } from './usage.ts'

const empty: UsageTotals = { startedAt: 0, dataBytes: 0, dataRequests: 0, unmeasured: 0, mediaBytes: 0 }
const entry = (initiatorType: string, transferSize: number, encodedBodySize: number, name = 'https://tvn.example/api/feed') => ({ initiatorType, name, transferSize, encodedBodySize })

describe('session usage', () => {
  it('counts what the network delivered, skips cache hits, and notes sizes kept private', () => {
    let totals = countResource(empty, entry('fetch', 2048, 2000))
    totals = countResource(totals, entry('script', 0, 5000))
    totals = countResource(totals, entry('img', 0, 0, 'https://other.example/a.jpg'))
    expect(totals).toMatchObject({ dataBytes: 2048, dataRequests: 1, unmeasured: 1 })
  })

  it('leaves media requests and local addresses to the media count', () => {
    expect(countResource(empty, entry('video', 9000, 9000))).toBe(empty)
    expect(countResource(empty, entry('fetch', 9000, 9000, 'blob:https://tvn.example/1'))).toBe(empty)
  })

  it('adds only what a media element fetched since last time, and starts again on a new source', () => {
    expect(mediaDelta(undefined, 'a', 500)).toBe(500)
    expect(mediaDelta({ src: 'a', bytes: 500 }, 'a', 800)).toBe(300)
    expect(mediaDelta({ src: 'a', bytes: 800 }, 'b', 100)).toBe(100)
    expect(mediaDelta({ src: 'a', bytes: 800 }, 'a', 100)).toBe(100)
  })

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(12_300)).toBe('12.3 KB')
    expect(formatBytes(340_000_000)).toBe('340 MB')
    expect(formatBytes(1_200_000_000)).toBe('1.2 GB')
  })
})
