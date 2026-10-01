import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adjacentChannel, channelByNumber } from '../data/catalogue.ts'
import { installUserCatalogue } from '../data/user-overlay.ts'
import { resetDirector } from '../director/director.ts'
import { setMediaLibrary } from '../director/library.ts'
import { expandPlayableCatalogue } from '../library/playable-catalogue.ts'
import { broadcast } from '../services/broadcast.ts'
import { airingReport, isOnAir } from './airing.ts'

describe('a thin channel', () => {
  beforeAll(() => {
    installUserCatalogue([], new Map())
    resetDirector()
    setMediaLibrary(expandPlayableCatalogue(JSON.parse(readFileSync('public/independent/playable.json', 'utf8'))))
  })
  afterAll(() => installUserCatalogue([], new Map()))

  it('is short, not empty: it stays on air and channel up and down stop on it', () => {
    for (const number of [249, 259]) {
      expect(airingReport().find((row) => row.number === number)?.status).toBe('thin')
      expect(isOnAir(channelByNumber(number)!)).toBe(true)
    }
    expect(adjacentChannel(248, 1).number).toBe(249)
    expect(adjacentChannel(260, -1).number).toBe(259)
  })

  it('always has a picture to show', () => {
    const now = Date.UTC(2026, 8, 30, 18, 0)
    for (const row of airingReport().filter((item) => item.status === 'thin')) {
      const channel = channelByNumber(row.number)
      if (channel) expect(broadcast(channel, now).current.programme.videoId, `channel ${row.number}`).toBeTruthy()
    }
  })

  it('an empty channel is still skipped', () => {
    const dormant = airingReport().find((row) => row.status === 'dormant' && channelByNumber(row.number))
    if (dormant) expect(isOnAir(channelByNumber(dormant.number)!)).toBe(false)
  })
})
