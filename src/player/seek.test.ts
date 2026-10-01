import { describe, expect, it } from 'vitest'
import { mediaSeekSeconds } from './seek.ts'

describe('mediaSeekSeconds', () => {
  it('seeks to 17:00 when the master covers the slot', () => {
    expect(
      mediaSeekSeconds(17 * 60, {
        playbackMode: 'linear',
        durationSeconds: 45 * 60,
        mediaDurationSeconds: 50 * 60,
      }),
    ).toBe(17 * 60)
  })

  it('loops a short demonstration film inside a longer slot', () => {
    const seek = mediaSeekSeconds(17 * 60, {
      playbackMode: 'loop-demo',
      durationSeconds: 45 * 60,
      mediaDurationSeconds: 10 * 60,
    })
    expect(seek).toBe(7 * 60)
  })

  it('seeks linearly into a film that is longer than an hour', () => {
    const elapsed = 64 * 60
    expect(
      mediaSeekSeconds(elapsed, {
        playbackMode: 'linear',
        durationSeconds: 195 * 60,
        mediaDurationSeconds: 195 * 60,
      }),
    ).toBe(elapsed)
  })
})
