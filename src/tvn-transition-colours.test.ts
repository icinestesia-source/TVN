import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChannelChangeOptions } from './components/ChannelChangeOptions.tsx'
import { tintOf, TransitionOverlay } from './components/TransitionOverlay.tsx'
import {
  asTransitionSettings,
  cleanColours,
  COLOUR_SETS,
  DEFAULT_TRANSITION_SETTINGS,
  MAX_TRANSITION_COLOURS,
  toggledColour,
  transitionSettingsErrors,
  withColours,
} from './state/transitions.ts'

const SAMPLE = { number: '225', name: 'TVN Preview', programme: null }
const crt = (colours: Parameters<typeof withColours>[1]) => withColours({ ...DEFAULT_TRANSITION_SETTINGS, id: 'crt' }, colours)

describe('Channel change colours: more of them, and up to five at once', () => {
  it('offers purple, pink, red, blue and teal beside the originals', () => {
    const html = renderToStaticMarkup(createElement(ChannelChangeOptions, { settings: DEFAULT_TRANSITION_SETTINGS, onChange: () => {} }))
    for (const label of ['Mono', 'Warm', 'Cool', 'Green', 'Amber', 'TVN gold', 'Purple', 'Pink', 'Red', 'Blue', 'Teal']) expect(html).toContain(`${label}<`)
    expect(html).toContain('aria-label="Colour combinations"')
    for (const set of COLOUR_SETS) expect(html).toContain(`>${set.label.replace('&', '&amp;')}</option>`)
  })

  it('picks colours in order, takes them out again, and refuses a sixth', () => {
    let colours = toggledColour([], 'purple')
    colours = toggledColour(colours, 'green')
    expect(colours).toEqual(['purple', 'green'])
    expect(toggledColour(colours, 'purple')).toEqual(['green'])
    expect(toggledColour(colours, 'mono')).toEqual([])
    const five = ['red', 'amber', 'green', 'blue', 'purple'] as const
    expect(five).toHaveLength(MAX_TRANSITION_COLOURS)
    expect(toggledColour(five, 'teal')).toEqual(five)
    const html = renderToStaticMarkup(createElement(ChannelChangeOptions, { settings: crt(five), onChange: () => {} }))
    expect(html).toMatch(/disabled=""[^>]*>[\s\S]{0,120}?Teal/)
    expect(html).toContain('5 of 5 colours')
  })

  it('one colour tints flat; several sweep as a band, and Mono has no tint', () => {
    expect(tintOf([])).toBeNull()
    expect(tintOf(['purple'])).toBe('#c79bff')
    expect(tintOf(['purple', 'green'])).toBe('linear-gradient(115deg, #c79bff, #8dffa8, #c79bff)')
    expect(renderToStaticMarkup(createElement(TransitionOverlay, { settings: crt(['purple']), identity: SAMPLE }))).toContain('class="fx-tint"')
    expect(renderToStaticMarkup(createElement(TransitionOverlay, { settings: crt(['purple', 'green']), identity: SAMPLE }))).toContain('fx-tint is-blend')
    expect(renderToStaticMarkup(createElement(TransitionOverlay, { settings: crt([]), identity: SAMPLE }))).not.toContain('fx-tint')
    expect(readFileSync('src/styles/overlays.css', 'utf8')).toMatch(/\.fx-tint\.is-blend \{[\s\S]*animation: fx-tint-sweep/)
  })

  it('saves the colours, keeps the first as the old single colour, and still reads files from before', () => {
    const chosen = crt(['pink', 'purple', 'blue'])
    expect(chosen.colour).toBe('pink')
    expect(asTransitionSettings(JSON.parse(JSON.stringify(chosen)))).toEqual(chosen)
    expect(asTransitionSettings({ id: 'crt', colour: 'amber' }).colours).toEqual(['amber'])
    expect(asTransitionSettings({ id: 'crt', colour: 'mono' }).colours).toEqual([])
    expect(cleanColours(['red', 'red', 'mono', 'wrong', 'blue', 'teal', 'green', 'pink', 'purple'])).toEqual(['red', 'blue', 'teal', 'green', 'pink'])
  })

  it('a restored file with too many or unknown colours is refused', () => {
    expect(transitionSettingsErrors({ colours: ['red', 'blue'] }, 's')).toEqual([])
    expect(transitionSettingsErrors({ colours: ['red', 'neon'] }, 's')).toHaveLength(1)
    expect(transitionSettingsErrors({ colours: ['red', 'amber', 'green', 'blue', 'purple', 'teal'] }, 's')).toHaveLength(1)
  })
})
