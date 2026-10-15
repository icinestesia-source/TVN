import { describe, expect, it } from 'vitest'
import { arrangementOn, arrangePlan, replaysHere } from './view/arrange.ts'
import { guidePickAction } from './view/guide-mode.ts'
import { pipToRemember, planMultiview } from './view/multiview.ts'

const ordered = [1, 2, 3, 4, 5, 1001, 1002, 1085]

describe('MULTI: what entering, changing and leaving a layout does', () => {
  it('entering from single view starts at the watched channel, with the sound on it', () => {
    expect(planMultiview('1', '4', 3, [7, 8, 9, 10], 2, ordered, null)).toEqual({ focus: 3, tiles: [3, 4, 5, 1001], audioFocus: 0 })
  })

  it('the earlier Multi View’s tiles are not brought back on entering', () => {
    expect(planMultiview('1', '2', 1002, [3, 4], 1, ordered, null).tiles).toEqual([1002, 1085])
  })

  it('entering PiP brings back the remembered inset', () => {
    expect(planMultiview('1', 'pip', 3, [], 0, ordered, 1002).tiles).toEqual([3, 1002])
  })

  it('changing layout keeps the channel with the sound first and keeps the sound on it where it still fits', () => {
    const plan = planMultiview('4', '9', 3, [3, 4, 5, 1001], 2, ordered, null)
    expect(plan.focus).toBe(5)
    expect(plan.tiles[0]).toBe(5)
    expect(new Set(plan.tiles).size).toBe(plan.tiles.length)
    expect(plan.audioFocus).toBe(2)
  })

  it('a smaller layout never leaves the sound on a tile that is gone', () => {
    const plan = planMultiview('9', '2', 3, [1, 2, 3, 4, 5, 1001, 1002, 1085], 6, ordered, null)
    expect(plan.tiles).toHaveLength(2)
    expect(plan.audioFocus).toBeLessThan(2)
  })

  it('leaving for single view tunes to the channel that had the sound and keeps the tiles as they were', () => {
    const plan = planMultiview('4', '1', 3, [3, 4, 5, 1001], 1, ordered, null)
    expect(plan.focus).toBe(4)
    expect(plan.tiles).toEqual([3, 4, 5, 1001])
  })

  it('the sound falls back to the watched channel when its tile is missing', () => {
    expect(planMultiview('4', '1', 3, [], 5, ordered, null).focus).toBe(3)
  })
})

describe('PiP: which inset is remembered', () => {
  it('remembers the inset only when the viewer changes it under the same main picture', () => {
    expect(pipToRemember([3, 4], [3, 1002])).toBe(1002)
    expect(pipToRemember([3, 4], [5, 1002])).toBeNull()
    expect(pipToRemember([3, 4], [3, 4])).toBeNull()
    expect(pipToRemember(null, [3, 1002])).toBeNull()
    expect(pipToRemember([3, 4], [3])).toBeNull()
  })
})

describe('Choosing a Guide programme', () => {
  const start = 1_000_000
  const end = start + 60_000

  it('on air: tunes the channel, or plays from the start when asked', () => {
    expect(guidePickAction(start, end, start + 1, true)).toBe('tune')
    expect(guidePickAction(start, end, start + 1, false)).toBe('tune')
    expect(guidePickAction(start, end, start + 1, true, true)).toBe('play')
  })

  it('later or ended with a picture: plays from the beginning', () => {
    expect(guidePickAction(start, end, start - 1, true)).toBe('play')
    expect(guidePickAction(start, end, end, true)).toBe('play')
  })

  it('later or ended without a picture: says so', () => {
    expect(guidePickAction(start, end, start - 1, false)).toBe('later')
    expect(guidePickAction(start, end, end, false)).toBe('ended')
    expect(guidePickAction(start, end, start + 1, false, true)).toBe('ended')
  })
})

describe('LATEST, A–Z, RANDOM and RESET in the Guide', () => {
  it('LATEST is on only while it airs from a moment; A–Z and RANDOM while their order stands', () => {
    expect(arrangementOn({ order: ['a'], orderKind: 'latest', liveFromMs: 5 })).toBe('latest')
    expect(arrangementOn({ order: ['a'], orderKind: 'latest' })).toBeNull()
    expect(arrangementOn({ order: ['a'], orderKind: 'az' })).toBe('az')
    expect(arrangementOn({ order: ['a'], orderKind: 'random' })).toBe('random')
    expect(arrangementOn({ order: [], orderKind: 'az' })).toBeNull()
    expect(arrangementOn({})).toBeNull()
  })

  it('RESET with nothing on has nothing to do; with something on it restores the schedule', () => {
    expect(arrangePlan('reset', null).step).toBe('already-default')
    expect(arrangePlan('reset', 'az')).toMatchObject({ step: 'restore', name: 'RESET' })
  })

  it('LATEST and A–Z pressed while on switch off', () => {
    expect(arrangePlan('latest', 'latest')).toMatchObject({ step: 'restore', name: 'LATEST' })
    expect(arrangePlan('az', 'az')).toMatchObject({ step: 'restore', name: 'A–Z' })
    expect(arrangePlan('az', 'latest')).toMatchObject({ step: 'arrange', how: 'az' })
  })

  it('RANDOM always deals again', () => {
    expect(arrangePlan('random', 'random')).toMatchObject({ step: 'arrange', how: 'random' })
  })

  it('LATEST right-clicked never switches off: it arranges newest first from now, whatever was on', () => {
    for (const on of [null, 'latest', 'az', 'random'] as const) {
      expect(arrangePlan('latest-now', on)).toMatchObject({ step: 'arrange', how: 'latest', again: true, name: 'LATEST' })
    }
  })

  it('a changed schedule replays at once only on the watched channel in single view', () => {
    expect(replaysHere(7, 7, '1')).toBe(true)
    expect(replaysHere(8, 7, '1')).toBe(false)
    expect(replaysHere(7, 7, '4')).toBe(false)
    expect(replaysHere(7, 7, 'pip')).toBe(false)
  })
})
