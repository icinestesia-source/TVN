import { afterEach, describe, expect, it } from 'vitest'
import { adjacentChannel, channelByNumber, randomChannel } from './data/catalogue.ts'
import { channelMatchesFilter } from './data/network.ts'
import { setUrlRevoker, clearSession, replaceSession } from './session/session-channel.ts'
import { stepTarget, universeChannels } from './state/tuning.ts'

const T0 = Date.UTC(2026, 9, 7, 20)
setUrlRevoker(() => {})
const load = (number: number) => replaceSession([{ title: 'Holiday', durationSeconds: 600, url: `blob:${number}`, kind: 'video' }], T0, number)

afterEach(() => {
  clearSession(994)
  clearSession(1000)
})

describe('Local Media with files is a playing channel, in ALL and USER, and can be a Favourite', () => {
  it('an empty Local Media channel is in ALL only, and CH+/CH- pass over it', () => {
    const empty = channelByNumber(994)!
    expect(channelMatchesFilter(empty, 'all', [])).toBe(true)
    expect(channelMatchesFilter(empty, 'user', [])).toBe(false)
    expect(adjacentChannel(993, 1).number).not.toBe(994)
    expect(universeChannels({ filter: 'user', favourites: [] }).some((channel) => channel.number === 994)).toBe(false)
  })

  it('with files loaded it joins USER, CH+/CH- step onto it in ALL and USER, and Random can choose it', () => {
    load(994)
    const loaded = channelByNumber(994)!
    expect(channelMatchesFilter(loaded, 'user', [])).toBe(true)
    expect(channelMatchesFilter(loaded, 'user:someone', [])).toBe(false)
    expect(adjacentChannel(993, 1).number).toBe(994)
    expect(universeChannels({ filter: 'user', favourites: [] }).map((channel) => channel.number)).toContain(994)
    expect(stepTarget({ channelNumber: 994, previousNumber: null }, null, 1, { filter: 'user', favourites: [] })).not.toBeNull()
    expect(randomChannel(1, () => 0, [channelByNumber(994)!, channelByNumber(995)!])?.number).toBe(994)
  })

  it('a Favourite Local Media channel is in FAVOURITES, and stepped to there once it has files', () => {
    expect(channelMatchesFilter(channelByNumber(1000)!, 'favourites', [1000])).toBe(true)
    load(1000)
    expect(stepTarget({ channelNumber: 1, previousNumber: null }, null, 1, { filter: 'favourites', favourites: [1000] })).toBe(1000)
  })
})
