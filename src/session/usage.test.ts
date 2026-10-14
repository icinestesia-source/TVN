import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { countResource, countYoutube, formatBytes, formatPlayed, mediaDelta, YOUTUBE_RATE_UNKNOWN, YOUTUBE_RATES, type UsageTotals } from './usage.ts'

const empty: UsageTotals = { startedAt: 0, dataBytes: 0, dataRequests: 0, unmeasured: 0, mediaBytes: 0, youtubeSeconds: 0, youtubeEstimate: 0 }
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

  it('counts YouTube by the time it plays, estimating the data from the quality it reports', () => {
    let totals = countYoutube(empty, 60, 'hd720')
    totals = countYoutube(totals, 30, undefined)
    expect(totals.youtubeSeconds).toBe(90)
    expect(totals.youtubeEstimate).toBe(60 * YOUTUBE_RATES.hd720 + 30 * YOUTUBE_RATE_UNKNOWN)
    expect(countYoutube(totals, 0, 'hd1080')).toBe(totals)
    // An hour of 1080p is about 2 GB, an hour of 720p a little over 1 GB.
    expect(formatBytes(3600 * YOUTUBE_RATES.hd1080)).toBe('2.0 GB')
    expect(formatBytes(3600 * YOUTUBE_RATES.hd720)).toBe('1.1 GB')
  })

  it('every YouTube player reports what it plays, and OPTIONS shows it', () => {
    const stage = readFileSync('src/player/YoutubeStage.tsx', 'utf8')
    expect(stage).toContain('if (player?.getPlayerState?.() === 1) noteYoutubePlaying(seconds, player.getPlaybackQuality?.())')
    const options = readFileSync('src/components/GuideOptions.tsx', 'utf8')
    expect(options).toContain('formatBytes(usage.dataBytes + usage.mediaBytes + usage.youtubeEstimate)')
    expect(options).toContain('formatPlayed(usage.youtubeSeconds)')
  })

  it('formats time played', () => {
    expect(formatPlayed(40.6)).toBe('40 s')
    expect(formatPlayed(14 * 60 + 5)).toBe('14 min')
    expect(formatPlayed(2 * 3600 + 5 * 60)).toBe('2 h 05 min')
  })

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(12_300)).toBe('12.3 KB')
    expect(formatBytes(340_000_000)).toBe('340 MB')
    expect(formatBytes(1_200_000_000)).toBe('1.2 GB')
  })
})
