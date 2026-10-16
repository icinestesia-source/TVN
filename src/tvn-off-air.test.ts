import { describe, expect, it } from 'vitest'
import { adjacentChannel, randomChannel } from './data/catalogue.ts'
import { isOffAir, loadOffAir, OFF_AIR_KEY, setOffAir } from './data/off-air.ts'

describe('a channel taken off air', () => {
  it('is remembered in this browser and left out of channel up and random', () => {
    const memory = new Map<string, string>()
    const store = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
    }
    const next = adjacentChannel(1, 1).number
    const random = randomChannel(1, () => 0)?.number
    setOffAir(next, true, store)
    if (random !== undefined && random !== next) setOffAir(random, true, store)
    try {
      expect(isOffAir(next)).toBe(true)
      expect(loadOffAir(store)).toContain(next)
      expect(memory.get(OFF_AIR_KEY)).toContain(String(next))
      expect(adjacentChannel(1, 1).number).not.toBe(next)
      if (random !== undefined) expect(randomChannel(1, () => 0)?.number).not.toBe(random)
    } finally {
      setOffAir(next, false, store)
      if (random !== undefined) setOffAir(random, false, store)
    }
    expect(isOffAir(next)).toBe(false)
  })
})
