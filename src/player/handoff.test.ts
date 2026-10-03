import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handoffPlayer, HANDOFF_MAX_MS, type Slot, type SlotPlayer } from './handoff.ts'
import type { PlayerLoadRequest, PlayerStatus } from './types.ts'

interface Fake extends SlotPlayer {
  loads: PlayerLoadRequest[]
  sound: [boolean, number, boolean][]
  stops: number
}

function fake(): Fake {
  const player: Fake = {
    loads: [],
    sound: [],
    stops: 0,
    load(request) {
      player.loads.push(request)
      return Promise.resolve('playing')
    },
    play() {},
    pause() {},
    seek() {},
    setAudible(audible, volume, muted) {
      player.sound.push([audible, volume, muted])
    },
    currentTime: () => 0,
    actualVideoId: () => null,
    stop() {
      player.stops += 1
    },
  }
  return player
}

const request = (videoId: string): PlayerLoadRequest => ({ videoId, startSeconds: 0, loop: false })
const audible = (player: Fake) => {
  const last = player.sound.at(-1)
  return Boolean(last && last[0] && !last[2] && last[1] > 0)
}

function setup(prebuffer = true) {
  const slots = [fake(), fake()] as const
  const emitted: PlayerStatus[] = []
  const holds: boolean[] = []
  const primaries: Slot[] = []
  const player = handoffPlayer({
    slot: (index) => slots[index],
    prebuffer: () => prebuffer,
    ready: () => true,
    onPrimary: (index) => primaries.push(index),
    onHold: (held) => holds.push(held),
    emit: (status) => emitted.push(status),
  })
  player.setAudible(true, 80, false)
  // Something is already on screen and playing in slot 0.
  void player.load(request('old'))
  player.status(0, 'playing')
  emitted.length = 0
  return { slots, player, emitted, holds, primaries }
}

describe('INSTANT pre-buffered cut', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('loads the destination unseen and silent while the old picture and sound carry on', () => {
    const { slots, player, emitted, holds } = setup()
    void player.load(request('new'))
    expect(slots[1].loads.at(-1)?.videoId).toBe('new')
    expect(slots[0].loads).toHaveLength(1)
    expect(audible(slots[1])).toBe(false)
    expect(audible(slots[0])).toBe(true)
    expect(holds).toEqual([true])
    // The destination's buffering and the old picture's reports are not passed on yet.
    player.status(1, 'buffering')
    player.status(0, 'ended')
    expect(emitted).toEqual([])
  })

  it('cuts on the destination really playing: one unmute, the old slot stopped and silenced', () => {
    const { slots, player, emitted, holds, primaries } = setup()
    void player.load(request('new'))
    player.setAudible(true, 80, false)
    const unmutesBefore = slots[1].sound.filter(([on, volume, muted]) => on && volume > 0 && !muted).length
    expect(unmutesBefore).toBe(0)
    player.status(1, 'playing')
    expect(primaries).toEqual([1])
    expect(holds).toEqual([true, false])
    expect(emitted).toEqual(['playing'])
    expect(slots[1].sound.filter(([on, volume, muted]) => on && volume > 0 && !muted)).toHaveLength(1)
    expect(audible(slots[0])).toBe(false)
    expect(slots[0].stops).toBe(1)
    // Afterwards the new slot is the one on screen; the next INSTANT load goes back to slot 0.
    void player.load(request('third'))
    expect(slots[0].loads.at(-1)?.videoId).toBe('third')
  })

  it('a destination that fails is handed the screen so the usual refusal and fallback run', () => {
    const { slots, player, emitted, holds } = setup()
    void player.load(request('broken'))
    player.status(1, 'error')
    expect(emitted).toEqual(['error'])
    expect(holds.at(-1)).toBe(false)
    expect(slots[0].stops).toBe(1)
  })

  it('does not hold the old picture forever', () => {
    const { slots, player, emitted, holds, primaries } = setup()
    void player.load(request('slow'))
    vi.advanceTimersByTime(HANDOFF_MAX_MS - 1)
    expect(primaries).toEqual([])
    vi.advanceTimersByTime(1)
    expect(primaries).toEqual([1])
    expect(holds).toEqual([true, false])
    expect(slots[0].stops).toBe(1)
    // The slow destination now reports as the slot on screen.
    player.status(1, 'buffering')
    player.status(1, 'playing')
    expect(emitted).toEqual(['buffering', 'playing'])
  })

  it('a second channel change while waiting reuses the standby and keeps the old picture', () => {
    const { slots, player, holds } = setup()
    void player.load(request('a'))
    void player.load(request('b'))
    expect(slots[1].loads.map((r) => r.videoId)).toEqual(['a', 'b'])
    expect(slots[0].stops).toBe(0)
    expect(holds).toEqual([true, true])
  })

  it('other transitions, and loads with nothing playing, use the slot on screen as before', () => {
    const off = setup(false)
    void off.player.load(request('new'))
    expect(off.slots[0].loads.at(-1)?.videoId).toBe('new')
    expect(off.slots[1].loads).toHaveLength(0)
    expect(off.holds).toEqual([])

    const paused = setup()
    paused.player.status(0, 'paused')
    void paused.player.load(request('resume'))
    expect(paused.slots[0].loads.at(-1)?.videoId).toBe('resume')
    expect(paused.holds).toEqual([])
  })
})
