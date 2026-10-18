import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GuideActions } from './components/GuideAdd.tsx'
import { INFO_MODULES, InfoCentre } from './components/InfoCentre.tsx'
import { commandFromKey } from './input/keyboard.ts'
import { guideToolTarget } from './view/guide-tool.ts'
import type { Channel } from './types/channel.ts'

const read = (path: string) => readFileSync(path, 'utf8')

describe('INFO centre (Phase B1)', () => {
  it('sits between Network and Guide in the header, as tool infocentre', () => {
    const html = renderToStaticMarkup(createElement(GuideActions, { tool: null, picked: false, onNow: () => {}, onTool: () => {} }))
    expect([...html.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((match) => match[1])).toEqual([
      'Network',
      'Info',
      'Guide',
      'Options',
      'Now',
      'Add',
      'Media',
    ])
    const on = renderToStaticMarkup(createElement(GuideActions, { tool: 'infocentre', picked: false, onNow: () => {}, onTool: () => {} }))
    expect(on).toMatch(/class="tab is-on"[^>]*>Info</)
    expect(read('src/types/input.ts')).toMatch(/'infocentre'/)
    expect(read('src/components/Guide.tsx')).toContain('<InfoCentre />')
    expect(read('src/components/Guide.tsx')).toContain("tool === 'infocentre'")
  })

  it('does not steal V (picture info) or I (Add)', () => {
    const plain = { meta: false, ctrl: false, alt: false }
    expect(commandFromKey('v', plain, true)).toEqual({ type: 'info' })
    expect(commandFromKey('V', plain, false)).toEqual({ type: 'info' })
    expect(commandFromKey('i', plain, true)).toEqual({ type: 'guide-tool', tool: 'add' })
    expect(read('src/input/keyboard.ts')).not.toMatch(/infocentre/)
  })

  it('keeps the Guide filter and cursor when opening, like Options', () => {
    const cursor = { channelNumber: 12, timeMs: 1_700_000_000_000 }
    const channels = [{ number: 12, enabled: true, origin: 'default' }] as Channel[]
    expect(guideToolTarget('infocentre', 'favourites', [12], cursor, channels, Date.now())).toEqual({
      filter: 'favourites',
      cursor,
    })
  })

  it('opens as a Guide panel with News, Sports and Weather only', () => {
    const markup = renderToStaticMarkup(createElement(InfoCentre))
    expect(markup).toContain('aria-label="Info centre"')
    expect(markup).toContain('Info')
    expect(markup).toContain('Weather')
    expect(markup).not.toMatch(/Chat|Games|Events/i)
    expect(INFO_MODULES.map((module) => module.id)).toEqual(['news', 'sports', 'weather'])
    expect(INFO_MODULES.every((module) => module.Panel)).toBe(true)
  })

  it('does not remount the player when INFO opens', () => {
    const screen = read('src/app/TvScreen.tsx')
    expect(screen).toContain('<PlayerStage')
    expect(screen).toContain('{guide ? <Guide')
    expect(screen).not.toMatch(/key=\{[^}]*guideTool/)
    expect(read('src/state/TvProvider.tsx')).toContain("held?.kind === 'infocentre'")
  })
})
