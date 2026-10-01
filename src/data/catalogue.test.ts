import { describe, expect, it } from 'vitest'
import { channelByNumber, channels, programmesFor } from './catalogue.ts'

describe('demonstration catalogue', () => {
  it('provides 60 stable numbered channels', () => {
    const core = channels.filter((channel) => channel.number <= 60)
    expect(core).toHaveLength(60)
    expect(core.map((channel) => channel.number)).toEqual(
      Array.from({ length: 60 }, (_, index) => index + 1),
    )
    expect(new Set(core.map((channel) => channel.id)).size).toBe(60)
    expect(channelByNumber(3)?.name).toBe('Three')
    expect(channelByNumber(58)?.name).toBe('Food')
    expect(channelByNumber(31)?.name).toBe('Drama')
  })

  it('gives every channel a varied loop of programmes', () => {
    const signatures = new Set<string>()
    for (const channel of channels) {
      const programmes = programmesFor(channel.id)
      expect(programmes.length).toBeGreaterThanOrEqual(4)
      const durations = programmes.map((programme) => programme.durationSeconds)
      expect(durations.every((duration) => duration > 0)).toBe(true)
      expect(new Set(durations).size).toBeGreaterThan(1)
      signatures.add(durations.join(','))
      expect(channel.phaseOffsetSeconds).toBeGreaterThan(0)
    }
    expect(signatures.size).toBeGreaterThan(20)
  })

  it('keeps retro breaks and idents as ordinary scheduled items', () => {
    const breaks = programmesFor('ch-058')
    expect(breaks.every((programme) => programme.kind === 'retro-commercial')).toBe(true)
    expect(breaks.every((programme) => programme.videoId === null)).toBe(true)
    const continuity = programmesFor('ch-059')
    expect(continuity.some((programme) => programme.kind === 'ident')).toBe(true)
    expect(continuity.some((programme) => programme.identBefore === 'station-ident')).toBe(true)
  })
})
