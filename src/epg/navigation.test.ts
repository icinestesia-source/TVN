import { describe, expect, it } from 'vitest'
import { guideFilterForChannel, stepGuideChannel } from './navigation.ts'
import { guideTuneDecision } from '../view/guide-mode.ts'
import { entryFace, formatChannelNumber } from '../input/tuner.ts'
import { commandFromGamepad } from '../input/gamepad.ts'
import { commandFromKey } from '../input/keyboard.ts'
import { channelByNumber, listChannels } from '../data/catalogue.ts'
import { channelIsDefined, channelMayAir } from '../data/independent/network.ts'
import { channelMatchesFilter } from '../data/network.ts'
import { isClosedChannel } from '../director/fit.ts'
import { isOnAir, refreshAiring } from '../network/airing.ts'

const plain = { meta: false, ctrl: false, alt: false }

function pad(pressed: number[] = [], axes: number[] = [0, 0]) {
  const buttons = Array.from({ length: 16 }, (_, index) => ({ pressed: pressed.includes(index) }))
  return { buttons, axes }
}

describe('guide navigation', () => {
  it('opens on the tuned channel even when the current filter hides it', () => {
    const retro = { number: 317, enabled: true, origin: 'default' as const }
    const user = { number: 1004, enabled: true, origin: 'user-import' as const }
    expect(guideFilterForChannel(retro, 'user', [])).toBe('all')
    expect(guideFilterForChannel(user, 'retrotv', [])).toBe('user')
    expect(guideFilterForChannel(user, 'user', [])).toBe('user')
    expect(guideFilterForChannel(user, 'all', [])).toBe('all')
    expect(guideFilterForChannel(user, 'favourites', [1004])).toBe('favourites')
    expect(guideFilterForChannel(retro, 'favourites', [])).toBe('all')
  })

  it('keeps the time anchor when moving to the next channel', () => {
    const cursor = { channelNumber: 47, timeMs: 1_700_000_000_000 }
    const next = stepGuideChannel([4, 23, 47, 317, 1004], cursor, 1)
    expect(next).toEqual({ channelNumber: 317, timeMs: cursor.timeMs })
    expect(stepGuideChannel([4, 23, 47, 317, 1004], cursor, -1).channelNumber).toBe(23)
  })

  it('jumps several rows and wraps', () => {
    const cursor = { channelNumber: 4, timeMs: 50 }
    expect(stepGuideChannel([4, 12, 20, 23], cursor, 8).channelNumber).toBe(4)
    expect(stepGuideChannel([4, 12, 20, 23], cursor, 2).channelNumber).toBe(20)
  })

  it('tunes only the programme that is on now', () => {
    expect(guideTuneDecision(1_000, 2_000, 1_500)).toBe('tune')
    expect(guideTuneDecision(2_000, 3_000, 1_500)).toBe('later')
    expect(guideTuneDecision(0, 1_000, 1_500)).toBe('ended')
  })

  it('shows a waiting dash for an unfinished number and the full four digits', () => {
    const numbers = [4, 317, 1004]
    expect(entryFace('3', numbers)).toBe('3—')
    expect(entryFace('317', numbers)).toBe('317')
    expect(entryFace('1004', numbers)).toBe('1004')
    expect(formatChannelNumber(4)).toBe('004')
    expect(formatChannelNumber(1004)).toBe('1004')
    expect(formatChannelNumber(1004).length).toBe(4)
  })

  it('maps the controller differently while the guide is open', () => {
    const up = commandFromGamepad(pad([12]), new Set(), true)
    expect(up.command).toEqual({ type: 'nav', direction: 'up' })
    const watching = commandFromGamepad(pad([12]), new Set(), false)
    expect(watching.command).toEqual({ type: 'channel-up' })
    expect(commandFromGamepad(pad([0]), new Set(), true).command).toEqual({ type: 'confirm' })
    expect(commandFromGamepad(pad([1]), new Set(), true).command).toEqual({ type: 'cancel' })
    expect(commandFromGamepad(pad([9]), new Set(), false).command).toEqual({ type: 'guide' })
    expect(commandFromGamepad(pad([12]), up.held, true).command).toBeNull()
  })

  it('keeps guide keys and closes on escape', () => {
    expect(commandFromKey('ArrowDown', plain, true)).toEqual({ type: 'nav', direction: 'down' })
    expect(commandFromKey('Enter', plain, true)).toEqual({ type: 'confirm' })
    expect(commandFromKey('Escape', plain, true)).toEqual({ type: 'cancel' })
    expect(commandFromKey('Home', plain, true)).toEqual({ type: 'guide-now' })
    expect(commandFromKey('PageDown', plain, true)).toEqual({ type: 'nav', direction: 'down', rows: 8 })
    expect(commandFromKey('i', plain, false)).toEqual({ type: 'info' })
  })

  it('lists dormant curated channels in the guide but not unavailable ones', () => {
    refreshAiring([])
    const dormant = { number: 9, enabled: true, origin: 'default' as const }
    const retro = { number: 317, enabled: true, origin: 'default' as const }
    const user = { number: 1004, enabled: true, origin: 'user-import' as const }
    expect(isOnAir(dormant)).toBe(false)
    expect(channelMatchesFilter(dormant, 'retrotv', [])).toBe(true)
    expect(channelMatchesFilter(dormant, 'all', [])).toBe(true)
    expect(channelMatchesFilter(dormant, 'dormant', [])).toBe(true)
    expect(isOnAir(user)).toBe(true)
    expect(channelMatchesFilter(user, 'user', [])).toBe(true)
    expect(channelMatchesFilter(user, 'retrotv', [])).toBe(false)
    expect(channelMatchesFilter(user, 'favourites', [1004])).toBe(true)
    expect(channelMatchesFilter(user, 'favourites', [])).toBe(false)
    expect(channelMatchesFilter(retro, 'retrotv', [])).toBe(false)
  })

  it('keeps every defined curated channel in the guide directory when nothing is on air', () => {
    refreshAiring([])
    const curated = listChannels().filter((channel) => channel.number >= 1 && channel.number <= 999)
    expect(curated.length).toBe(999)
    const listed = curated.filter((channel) => channelMatchesFilter(channel, 'all', []))
    const missing = curated.filter((channel) => !listed.includes(channel)).map((channel) => channel.number)
    for (const number of missing) expect(channelIsDefined(number) && !isClosedChannel(number), `${number}`).toBe(false)
    for (const number of [...Array(13).keys()].map((index) => 502 + index).concat([...Array(24).keys()].map((index) => 530 + index))) {
      expect(listed.some((channel) => channel.number === number), `${number}`).toBe(true)
      expect(channelMatchesFilter(channelByNumber(number)!, 'music', []), `${number}`).toBe(true)
    }
    for (const number of [853, 859, 864, 875]) {
      expect(channelMayAir(number), `${number}`).toBe(false)
      expect(listed.some((channel) => channel.number === number), `${number}`).toBe(true)
    }
    for (const number of [64, 146, 480, 481, 482, 492, 667, 682, 683, 873, 874, 317, 426, 655]) {
      expect(listed.some((channel) => channel.number === number), `${number}`).toBe(false)
    }
  })
})
