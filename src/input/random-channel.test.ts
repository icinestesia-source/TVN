import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { channelByNumber, channels, randomChannel } from '../data/catalogue.ts'
import { channelMayAir } from '../data/independent/network.ts'
import { installUserCatalogue } from '../data/user-overlay.ts'
import { liveCams } from '../dynamic/providers.ts'
import { getSchedule, resetDirector } from '../director/director.ts'
import { setMediaLibrary } from '../director/library.ts'
import { expandPlayableCatalogue } from '../library/playable-catalogue.ts'
import { airingReport, isOnAir, refreshAiring } from '../network/airing.ts'
import type { Channel } from '../types/channel.ts'
import { commandFromKey, isEditableTarget } from './keyboard.ts'

const plain = { meta: false, ctrl: false, alt: false }
const EXCLUDED = [64, 146, 480, 481, 482, 492, 667, 682, 683, 873, 874]

function sequence(count: number): number[] {
  return [...Array(count).keys()].map((index) => index / count)
}

describe('Space random channel', () => {
  const items = expandPlayableCatalogue(JSON.parse(readFileSync('public/independent/playable.json', 'utf8')))

  beforeAll(() => {
    installUserCatalogue([], new Map())
    resetDirector()
    setMediaLibrary(items)
    refreshAiring(items)
  })

  afterAll(() => installUserCatalogue([], new Map()))

  it('maps Space to a random tune while watching, C to the Guide tabs, and leaves browser shortcuts alone', () => {
    expect(commandFromKey(' ', plain, false)).toEqual({ type: 'random-channel' })
    expect(commandFromKey(' ', plain, true)).toBeNull()
    expect(commandFromKey('c', plain, false)).toEqual({ type: 'guide-cycle' })
    expect(commandFromKey('C', plain, true)).toEqual({ type: 'guide-cycle' })
    expect(commandFromKey('r', { ...plain, meta: true }, false)).toBeNull()
    expect(commandFromKey('r', { ...plain, ctrl: true }, false)).toBeNull()
  })

  it('does not fire from editable controls', () => {
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true)
    expect(isEditableTarget({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isEditableTarget({ tagName: 'SELECT' })).toBe(true)
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: false })).toBe(false)
    expect(isEditableTarget({ tagName: 'BUTTON' })).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })

  it('tunes only to on-air channels, never off-air, excluded or unavailable ones', () => {
    const active = new Set(airingReport().filter((row) => row.status !== 'dormant').map((row) => row.number))
    const picks = sequence(400).map((value) => randomChannel(301, () => value)!)
    for (const channel of picks) {
      expect(isOnAir(channel), `${channel.number}`).toBe(true)
      const cams = liveCams(channel.number).length > 0
      expect(cams || active.has(channel.number), `${channel.number}`).toBe(true)
      expect(EXCLUDED.includes(channel.number)).toBe(false)
      expect(cams || channelMayAir(channel.number)).toBe(true)
      expect(channelByNumber(channel.number)).toBeDefined()
    }
    expect(new Set(picks.map((channel) => channel.number)).size).toBeGreaterThan(100)
  })

  it('avoids the channel being watched when alternatives exist', () => {
    for (const value of sequence(400)) expect(randomChannel(301, () => value)?.number).not.toBe(301)
  })

  it('keeps playable 1001+ user channels eligible', () => {
    const user = { ...channels[0], id: 'user-random-1001', number: 1001, origin: 'user-import', enabled: true } as Channel
    installUserCatalogue([user], new Map())
    const picks = new Set(sequence(2000).map((value) => randomChannel(301, () => value)?.number))
    expect(picks.has(1001)).toBe(true)
    expect(randomChannel(301, () => 0.999999)?.number).toBe(1001)
    installUserCatalogue([], new Map())
  })

  it('leaves deterministic programme scheduling unchanged', () => {
    const channel = channelByNumber(501)!
    const ids = () => getSchedule(channel, '2026-09-27').blocks.flatMap((block) => block.children.map((child) => `${child.startMs}:${child.videoId}`))
    const before = ids()
    for (let index = 0; index < 50; index += 1) randomChannel(501)
    expect(ids()).toEqual(before)
  })
})
