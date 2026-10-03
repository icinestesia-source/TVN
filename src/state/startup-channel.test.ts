import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adjacentChannel, channelByNumber, channels, listChannels, randomChannel } from '../data/catalogue.ts'
import { installUserCatalogue } from '../data/user-overlay.ts'
import { resetDirector } from '../director/director.ts'
import { setMediaLibrary } from '../director/library.ts'
import { expandPlayableCatalogue } from '../library/playable-catalogue.ts'
import { isOnAir, refreshAiring } from '../network/airing.ts'
import type { Channel } from '../types/channel.ts'
import { createStartupRestore } from './startup-channel.ts'

describe('startup channel restoration', () => {
  beforeAll(() => {
    const items = expandPlayableCatalogue(JSON.parse(readFileSync('public/independent/playable.json', 'utf8')))
    installUserCatalogue([], new Map())
    resetDirector()
    setMediaLibrary(items)
    refreshAiring(items)
  }, 60000)

  afterAll(() => installUserCatalogue([], new Map()))

  it('keeps the first Random destination when delayed startup restoration completes afterwards', () => {
    const startup = createStartupRestore()
    let tuned = 1
    const picked = randomChannel(tuned, () => 0.5)!
    startup.noteUserTune()
    tuned = picked.number
    expect(tuned).not.toBe(1)

    const restored = startup.target(channelByNumber(1), listChannels())
    if (restored) tuned = restored.number

    expect(restored).toBeUndefined()
    expect(tuned).toBe(picked.number)
  })

  it('never lets restoration override any explicit tune, not just Random', () => {
    const destinations = [adjacentChannel(1, 1).number, adjacentChannel(1, -1).number, 501, 356]
    for (const destination of destinations) {
      const startup = createStartupRestore()
      startup.noteUserTune()
      expect(startup.target(channelByNumber(1), listChannels()), `${destination}`).toBeUndefined()
    }
  })

  it('still restores the saved channel on launch when the viewer has not tuned', () => {
    const saved = channelByNumber(501)!
    expect(isOnAir(saved)).toBe(true)
    expect(createStartupRestore().target(saved, listChannels())?.number).toBe(501)
  })

  it('falls back to 000 TVN, never a random or first channel, when the saved one is off air, missing or 1000', () => {
    const offAir = listChannels().find((channel) => channel.number < 1001 && !isOnAir(channel))!
    expect(createStartupRestore().target(offAir, listChannels())?.number).toBe(0)
    expect(createStartupRestore().target(undefined, listChannels())?.number).toBe(0)
    expect(createStartupRestore().target(channelByNumber(1000), listChannels())?.number).toBe(0)
  })

  it('restores a saved 1001+ channel that only exists once the user network installs', () => {
    const user = { ...channels[0], id: 'user-startup-1001', number: 1001, origin: 'user-import', enabled: true } as Channel
    installUserCatalogue([user], new Map())
    expect(createStartupRestore().target(channelByNumber(1001), listChannels())?.number).toBe(1001)
    installUserCatalogue([], new Map())
  })
})
