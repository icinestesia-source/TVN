import { describe, expect, it } from 'vitest'
import { commandFromKey } from './keyboard.ts'

const plain = { meta: false, ctrl: false, alt: false }

describe('commandFromKey', () => {
  it('surfs channels while watching and moves the guide while it is open', () => {
    expect(commandFromKey('ArrowUp', plain, false)).toEqual({ type: 'channel-up' })
    expect(commandFromKey('ArrowDown', plain, false)).toEqual({ type: 'channel-down' })
    expect(commandFromKey('ArrowUp', plain, true)).toEqual({ type: 'nav', direction: 'up' })
    expect(commandFromKey('ArrowRight', plain, true)).toEqual({ type: 'nav', direction: 'right' })
    expect(commandFromKey('ArrowLeft', plain, false)).toEqual({ type: 'volume-down' })
  })

  it('treats digits as remote entry and ignores modified shortcuts', () => {
    expect(commandFromKey('3', plain, false)).toEqual({ type: 'digit', digit: 3 })
    expect(commandFromKey('3', { meta: true, ctrl: false, alt: false }, false)).toBeNull()
  })

  it('uses M for multiview and K for mute', () => {
    expect(commandFromKey('m', plain, false)).toEqual({ type: 'multiview' })
    expect(commandFromKey('K', plain, false)).toEqual({ type: 'mute' })
    expect(commandFromKey('g', plain, false)).toEqual({ type: 'guide' })
    expect(commandFromKey('ArrowLeft', plain, false, true)).toEqual({ type: 'focus-move', direction: 'left' })
    expect(commandFromKey('ArrowUp', plain, true, true)).toEqual({ type: 'nav', direction: 'up' })
  })
})
