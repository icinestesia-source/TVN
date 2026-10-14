import { describe, expect, it } from 'vitest'
import { commandFromKey } from '../input/keyboard.ts'
import { clampPipSize, cycleMultiview, loadPipSize, multiviewLayout, PIP_SIZE_DEFAULT, PIP_SIZE_KEY, PIP_SIZE_MAX, PIP_SIZE_MIN, savePipSize, tileCount } from './multiview.ts'

const plain = { meta: false, ctrl: false, alt: false }

describe('picture in picture', () => {
  it('comes after the nine-picture wall, holds two channels, and leads back to one', () => {
    expect(cycleMultiview('9')).toBe('pip')
    expect(cycleMultiview('pip')).toBe('1')
    expect(tileCount('pip')).toBe(2)
    expect(multiviewLayout('pip', 600)).toEqual({ columns: 2, pageSize: 2, stacked: false })
  })

  it('[ and ] step the inset size', () => {
    expect(commandFromKey('[', plain, false)).toEqual({ type: 'pip-size', step: -1 })
    expect(commandFromKey(']', plain, false)).toEqual({ type: 'pip-size', step: 1 })
  })

  it('keeps the size within its limits and remembers it', () => {
    expect(clampPipSize(5)).toBe(PIP_SIZE_MIN)
    expect(clampPipSize(99)).toBe(PIP_SIZE_MAX)
    expect(clampPipSize('x')).toBe(PIP_SIZE_DEFAULT)
    const memory = new Map<string, string>()
    const store = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value) }
    expect(loadPipSize(store)).toBe(PIP_SIZE_DEFAULT)
    savePipSize(45, store)
    expect(memory.get(PIP_SIZE_KEY)).toBe('45')
    expect(loadPipSize(store)).toBe(45)
  })

})
