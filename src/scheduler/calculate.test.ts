import { describe, expect, it } from 'vitest'
import { SCHEDULE_EPOCH_MS } from './epoch.ts'
import { calculateSchedule, positiveModulo } from './calculate.ts'
import { slotsOverlapping } from './window.ts'

interface Item {
  id: string
  durationSeconds: number
}

function item(id: string, minutes: number): Item {
  return { id, durationSeconds: minutes * 60 }
}

const EPOCH = Date.UTC(2024, 0, 1, 0, 0, 0)

describe('positiveModulo', () => {
  it('wraps negative values into the cycle', () => {
    expect(positiveModulo(-30, 100)).toBe(70)
    expect(positiveModulo(0, 100)).toBe(0)
    expect(positiveModulo(100, 100)).toBe(0)
    expect(positiveModulo(130, 100)).toBe(30)
  })
})

describe('calculateSchedule', () => {
  const programmes = [item('a', 20), item('b', 45), item('c', 30)]

  it('selects the programme that contains the wall-clock time and seeks to elapsed', () => {
    // A is 20 min, so 20 + 17 minutes lands 17 minutes into B.
    const nowMs = EPOCH + (20 + 17) * 60 * 1000
    const snapshot = calculateSchedule({
      channelId: 'demo',
      phaseOffsetSeconds: 0,
      programmes,
      epochMs: EPOCH,
      nowMs,
    })

    expect(snapshot.current.programme.id).toBe('b')
    expect(snapshot.current.elapsedSeconds).toBe(17 * 60)
    expect(snapshot.current.seekSeconds).toBe(17 * 60)
    expect(snapshot.previous.programme.id).toBe('a')
    expect(snapshot.next.programme.id).toBe('c')
    expect(snapshot.current.endMs - snapshot.current.startMs).toBe(45 * 60 * 1000)
  })

  it('starts the next programme at a boundary with seek 0', () => {
    const nowMs = EPOCH + 20 * 60 * 1000
    const snapshot = calculateSchedule({
      channelId: 'demo',
      phaseOffsetSeconds: 0,
      programmes,
      epochMs: EPOCH,
      nowMs,
    })

    expect(snapshot.current.programme.id).toBe('b')
    expect(snapshot.current.elapsedSeconds).toBe(0)
    expect(snapshot.current.seekSeconds).toBe(0)
    expect(snapshot.previous.programme.id).toBe('a')
    expect(snapshot.previous.endMs).toBe(snapshot.current.startMs)
  })

  it('keeps the previous programme one millisecond before the boundary', () => {
    const nowMs = EPOCH + 20 * 60 * 1000 - 1
    const snapshot = calculateSchedule({
      channelId: 'demo',
      phaseOffsetSeconds: 0,
      programmes,
      epochMs: EPOCH,
      nowMs,
    })

    expect(snapshot.current.programme.id).toBe('a')
    expect(snapshot.current.elapsedSeconds).toBeCloseTo(20 * 60 - 0.001, 5)
  })

  it('wraps from the last programme back to the first', () => {
    const cycleSeconds = (20 + 45 + 30) * 60
    const atStart = calculateSchedule({
      channelId: 'demo',
      phaseOffsetSeconds: 0,
      programmes,
      epochMs: EPOCH,
      nowMs: EPOCH + cycleSeconds * 1000,
    })
    expect(atStart.current.programme.id).toBe('a')
    expect(atStart.current.elapsedSeconds).toBe(0)
    expect(atStart.previous.programme.id).toBe('c')

    const justBeforeWrap = calculateSchedule({
      channelId: 'demo',
      phaseOffsetSeconds: 0,
      programmes,
      epochMs: EPOCH,
      nowMs: EPOCH + cycleSeconds * 1000 - 1000,
    })
    expect(justBeforeWrap.current.programme.id).toBe('c')
    expect(justBeforeWrap.current.elapsedSeconds).toBe(30 * 60 - 1)
    expect(justBeforeWrap.next.programme.id).toBe('a')
  })

  it('crosses midnight without resetting the programme', () => {
    // Want B (50 min) to be 30 minutes in at 00:10, so it started at 23:40.
    const lineup = [item('a', 20), item('b', 50), item('c', 30)]
    const nowMs = Date.UTC(2024, 0, 1, 0, 10, 0)
    const snapshot = calculateSchedule({
      channelId: 'night',
      phaseOffsetSeconds: 2400,
      programmes: lineup,
      epochMs: EPOCH,
      nowMs,
    })

    expect(snapshot.current.programme.id).toBe('b')
    expect(snapshot.current.elapsedSeconds).toBe(30 * 60)

    const start = new Date(snapshot.current.startMs)
    expect(start.getUTCFullYear()).toBe(2023)
    expect(start.getUTCMonth()).toBe(11)
    expect(start.getUTCDate()).toBe(31)
    expect(start.getUTCHours()).toBe(23)
    expect(start.getUTCMinutes()).toBe(40)

    const end = new Date(snapshot.current.endMs)
    expect(end.getUTCFullYear()).toBe(2024)
    expect(end.getUTCMonth()).toBe(0)
    expect(end.getUTCDate()).toBe(1)
    expect(end.getUTCHours()).toBe(0)
    expect(end.getUTCMinutes()).toBe(30)
  })

  it('keeps channels independent at the same wall-clock time', () => {
    const shared = {
      programmes,
      epochMs: EPOCH,
      nowMs: EPOCH + 30 * 60 * 1000,
    }
    const first = calculateSchedule({ ...shared, channelId: 'one', phaseOffsetSeconds: 0 })
    const second = calculateSchedule({ ...shared, channelId: 'two', phaseOffsetSeconds: 40 * 60 })

    expect(first.current.programme.id).toBe('b')
    expect(second.current.programme.id).not.toBe(first.current.programme.id)
    expect(second.offsetSeconds).not.toBe(first.offsetSeconds)
  })

  it('stays inside the cycle after decades of continuous broadcasting', () => {
    const nowMs = EPOCH + 1000 * 60 * 60 * 24 * 365 * 40
    const first = calculateSchedule({
      channelId: 'long',
      phaseOffsetSeconds: 90,
      programmes,
      epochMs: EPOCH,
      nowMs,
    })
    const second = calculateSchedule({
      channelId: 'long',
      phaseOffsetSeconds: 90,
      programmes,
      epochMs: EPOCH,
      nowMs,
    })

    expect(second).toEqual(first)
    expect(first.current.elapsedSeconds).toBeGreaterThanOrEqual(0)
    expect(first.current.elapsedSeconds).toBeLessThan(first.current.programme.durationSeconds)
    expect(first.offsetSeconds).toBeGreaterThanOrEqual(0)
    expect(first.offsetSeconds).toBeLessThan(first.cycleDurationSeconds)
  })

  it('matches a later visit to the same clock, including refresh', () => {
    const nowMs = EPOCH + 90 * 60 * 1000
    const opened = calculateSchedule({
      channelId: 'demo',
      phaseOffsetSeconds: 15,
      programmes,
      epochMs: EPOCH,
      nowMs,
    })
    const refreshed = calculateSchedule({
      channelId: 'demo',
      phaseOffsetSeconds: 15,
      programmes,
      epochMs: EPOCH,
      nowMs,
    })
    expect(refreshed).toEqual(opened)

    const later = calculateSchedule({
      channelId: 'demo',
      phaseOffsetSeconds: 15,
      programmes,
      epochMs: EPOCH,
      nowMs: nowMs + 15_000,
    })
    expect(later.current.programme.id).toBe(opened.current.programme.id)
    expect(later.current.elapsedSeconds).toBeCloseTo(opened.current.elapsedSeconds + 15, 5)
    expect(later.current.seekSeconds).toBeCloseTo(opened.current.seekSeconds + 15, 5)
  })

  it('still resolves a clock before the epoch', () => {
    const snapshot = calculateSchedule({
      channelId: 'demo',
      phaseOffsetSeconds: 0,
      programmes,
      epochMs: EPOCH,
      nowMs: EPOCH - 5 * 60 * 1000,
    })
    expect(snapshot.current.programme.id).toBe('c')
    expect(snapshot.current.elapsedSeconds).toBe(25 * 60)
  })

  it('uses the shared application epoch as a fixed instant', () => {
    expect(SCHEDULE_EPOCH_MS).toBe(Date.UTC(2020, 0, 6, 0, 0, 0))
    const nowMs = SCHEDULE_EPOCH_MS + (20 + 17) * 60 * 1000
    const snapshot = calculateSchedule({
      channelId: 'demo',
      phaseOffsetSeconds: 0,
      programmes,
      epochMs: SCHEDULE_EPOCH_MS,
      nowMs,
    })
    expect(snapshot.current.programme.id).toBe('b')
    expect(snapshot.current.seekSeconds).toBe(17 * 60)
  })
})

describe('slotsOverlapping', () => {
  const programmes = [item('a', 20), item('b', 45), item('c', 30)]

  it('covers the window exactly once, including a programme already in progress', () => {
    const rangeStartMs = EPOCH + 10 * 60 * 1000
    const rangeEndMs = EPOCH + (3 * 60 + 10) * 60 * 1000
    const slots = slotsOverlapping(
      {
        channelId: 'demo',
        phaseOffsetSeconds: 0,
        programmes,
        epochMs: EPOCH,
        nowMs: rangeStartMs,
      },
      rangeStartMs,
      rangeEndMs,
    )

    expect(slots[0]?.programme.id).toBe('a')
    expect(slots[0]?.startMs).toBeLessThan(rangeStartMs)

    let covered = 0
    for (const slot of slots) {
      const from = Math.max(slot.startMs, rangeStartMs)
      const to = Math.min(slot.endMs, rangeEndMs)
      covered += to - from
      expect(slot.endMs - slot.startMs).toBe(slot.programme.durationSeconds * 1000)
    }
    expect(Math.abs(covered - (rangeEndMs - rangeStartMs))).toBeLessThan(2)
  })

  it('includes the midnight-spanning airing when the window crosses midnight', () => {
    const lineup = [item('a', 20), item('b', 50), item('c', 30)]
    const rangeStartMs = Date.UTC(2023, 11, 31, 23, 50, 0)
    const rangeEndMs = Date.UTC(2024, 0, 1, 0, 20, 0)
    const slots = slotsOverlapping(
      {
        channelId: 'night',
        phaseOffsetSeconds: 2400,
        programmes: lineup,
        epochMs: EPOCH,
        nowMs: rangeStartMs,
      },
      rangeStartMs,
      rangeEndMs,
    )
    const spanning = slots.find((slot) => slot.programme.id === 'b')
    expect(spanning).toBeTruthy()
    expect(spanning!.startMs).toBeLessThan(Date.UTC(2024, 0, 1, 0, 0, 0))
    expect(spanning!.endMs).toBeGreaterThan(Date.UTC(2024, 0, 1, 0, 0, 0))
  })

  it('joins a multi-hour film at the elapsed broadcast time', () => {
    const film = [{ id: 'feature', durationSeconds: 3 * 60 * 60 + 17 * 60 }]
    const nowMs = Date.UTC(2026, 8, 26, 21, 43, 27)
    const elapsed = 43 * 60 + 27
    const snapshot = calculateSchedule({
      channelId: 'feature',
      phaseOffsetSeconds: 0,
      programmes: film,
      epochMs: nowMs - elapsed * 1000,
      nowMs,
    })
    expect(snapshot.current.programme.id).toBe('feature')
    expect(snapshot.current.elapsedSeconds).toBeCloseTo(elapsed, 5)
    expect(snapshot.current.seekSeconds).toBeCloseTo(elapsed, 5)
    expect(snapshot.current.endMs - snapshot.current.startMs).toBe(film[0].durationSeconds * 1000)
  })
})
