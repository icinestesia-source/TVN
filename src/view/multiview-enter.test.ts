import { describe, expect, it } from 'vitest'
import { enterTiles, loadPipChannel, PIP_CHANNEL_KEY, pipToRemember, planMultiview, savePipChannel } from './multiview.ts'

const memory = () => {
  const items = new Map<string, string>()
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) }
}

const ordered = [1, 2, 3, 4, 5, 1001, 1002, 1085]

describe('MULTI from single view starts at the watched channel', () => {
  it('fills the tiles with the channels after the watched one; the inset is one channel up', () => {
    expect(enterTiles(3, ordered, 'pip', null)).toEqual([3, 4])
    expect(enterTiles(3, ordered, '4', null)).toEqual([3, 4, 5, 1001])
    expect(enterTiles(1085, ordered, '2', null)).toEqual([1085, 1])
  })

  it('a chosen inset channel comes back in the next PiP, between sessions, unless it is the watched one', () => {
    const store = memory()
    expect(loadPipChannel(store)).toBeNull()
    savePipChannel(1002, store)
    expect(store.getItem(PIP_CHANNEL_KEY)).toBe('1002')
    expect(loadPipChannel(store)).toBe(1002)
    expect(enterTiles(3, ordered, 'pip', loadPipChannel(store))).toEqual([3, 1002])
    expect(enterTiles(1002, ordered, 'pip', 1002)).toEqual([1002, 1085])
    // Only the inset is remembered: 2, 4 and 9 still follow on from the watched channel.
    expect(enterTiles(3, ordered, '2', 1002)).toEqual([3, 4])
  })

  it('the earlier Multi View’s tiles are not brought back, and the sound starts on the watched channel', () => {
    expect(planMultiview('1', '4', 3, [7, 8, 9, 10], 2, ordered, null)).toEqual({ focus: 3, tiles: [3, 4, 5, 1001], audioFocus: 0 })
  })

  it('the inset is remembered only when the viewer changes it under the same main picture', () => {
    expect(pipToRemember([3, 4], [3, 1002])).toBe(1002)
    expect(pipToRemember([3, 4], [5, 1002])).toBeNull()
  })
})
