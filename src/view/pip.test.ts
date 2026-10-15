import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { commandFromKey } from '../input/keyboard.ts'
import { clampPipSize, cycleMultiview, loadPipSize, multiviewLayout, PIP_SIZE_DEFAULT, PIP_SIZE_KEY, PIP_SIZE_MAX, PIP_SIZE_MIN, savePipSize, tileCount } from './multiview.ts'
import { providerSource } from '../test-support/provider-source.ts'

const plain = { meta: false, ctrl: false, alt: false }

describe('picture in picture', () => {
  it('is the first Multi View: single, picture in picture, 2, 4, 9, single', () => {
    const steps = ['1'] as ReturnType<typeof cycleMultiview>[]
    for (let index = 0; index < 5; index += 1) steps.push(cycleMultiview(steps[steps.length - 1]))
    expect(steps).toEqual(['1', 'pip', '2', '4', '9', '1'])
    expect(tileCount('pip')).toBe(2)
    expect(multiviewLayout('pip', 600)).toEqual({ columns: 2, pageSize: 2, stacked: false })
  })

  it('sits in the top right corner', () => {
    const css = readFileSync('src/styles/stage2.css', 'utf8')
    const inset = css.slice(css.indexOf('.mv.is-pip > .tile:nth-child(2)'))
    const rule = inset.slice(0, inset.indexOf('}'))
    expect(rule).toMatch(/top: 4%/)
    expect(rule).toMatch(/right: 2\.5%/)
    expect(rule).not.toMatch(/bottom:/)
  })

  it('\\ goes back to a single channel; ↑ ↓ change the selected picture’s channel, ← → move between pictures', () => {
    expect(commandFromKey('\\', plain, false)).toEqual({ type: 'multiview', mode: '1' })
    expect(commandFromKey('/', plain, false)).toEqual({ type: 'multiview' })
    expect(commandFromKey('ArrowUp', plain, false, true)).toEqual({ type: 'channel-up' })
    expect(commandFromKey('ArrowDown', plain, false, true)).toEqual({ type: 'channel-down' })
    expect(commandFromKey('ArrowLeft', plain, false, true)).toEqual({ type: 'focus-move', direction: 'left' })
    expect(commandFromKey('ArrowRight', plain, false, true)).toEqual({ type: 'focus-move', direction: 'right' })
    expect(commandFromKey('ArrowUp', plain, true, true)).toEqual({ type: 'nav', direction: 'up' })
    const provider = providerSource()
    expect(provider).toContain("if (command.mode === '1' && multiviewRef.current === '1') break")
    expect(provider).toContain('const nextMode = command.mode ?? cycleMultiview(multiviewRef.current)')
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
