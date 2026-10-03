import { describe, expect, it } from 'vitest'
import { commandFromKey, commandFromKeyEvent } from './keyboard.ts'

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

  it('uses M for mute, / for multiview, comma and full stop for previous and next, and A for Add', () => {
    expect(commandFromKey('m', plain, false)).toEqual({ type: 'mute' })
    expect(commandFromKey('M', plain, false)).toEqual({ type: 'mute' })
    expect(commandFromKey('K', plain, false)).toBeNull()
    expect(commandFromKey('/', plain, false)).toEqual({ type: 'multiview' })
    expect(commandFromKey(',', plain, false)).toEqual({ type: 'history-back' })
    expect(commandFromKey('.', plain, false)).toEqual({ type: 'history-forward' })
    expect(commandFromKey('a', plain, false)).toEqual({ type: 'guide-tool', tool: 'add' })
    expect(commandFromKey('g', plain, false)).toEqual({ type: 'guide' })
    expect(commandFromKey('ArrowLeft', plain, false, true)).toEqual({ type: 'focus-move', direction: 'left' })
    expect(commandFromKey('ArrowUp', plain, true, true)).toEqual({ type: 'nav', direction: 'up' })
  })

  it('in the Guide − shows more time and = widens the cells; over the picture they set the volume', () => {
    expect(commandFromKey('-', plain, true)).toEqual({ type: 'guide-zoom', direction: -1 })
    expect(commandFromKey('=', plain, true)).toEqual({ type: 'guide-zoom', direction: 1 })
    expect(commandFromKey('-', plain, false)).toEqual({ type: 'volume-down' })
    expect(commandFromKey('=', plain, false)).toEqual({ type: 'volume-up' })
  })

  it('no shortcut fires while typing in a field, a list box or editable text', () => {
    const event = (key: string, target: unknown) => ({ key, target, metaKey: false, ctrlKey: false, altKey: false })
    for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
      for (const key of ['m', '/', ',', '.', '-', '=', 'a', '5']) expect(commandFromKeyEvent(event(key, target), true), `${key} in ${target.tagName}`).toBeNull()
    }
    expect(commandFromKeyEvent(event('m', { tagName: 'BUTTON' }), false)).toEqual({ type: 'mute' })
    expect(commandFromKeyEvent(event('5', { tagName: 'DIV' }), false)).toEqual({ type: 'digit', digit: 5 })
  })
})
