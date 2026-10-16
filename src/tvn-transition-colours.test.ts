import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChannelChangeOptions } from './components/ChannelChangeOptions.tsx'
import { parseHex, shadeTowards } from './components/StaticOverlay.tsx'
import { snowColours, tintOf, TransitionOverlay, TINTS } from './components/TransitionOverlay.tsx'
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
const tune = (colours: Parameters<typeof withColours>[1]) => withColours({ ...DEFAULT_TRANSITION_SETTINGS, id: 'tv-tune' }, colours)

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

  it('colours the static blocks from black through the colour to white, not a filter over grey snow', () => {
    expect(parseHex('#c79bff')).toEqual([199, 155, 255])
    expect(shadeTowards([199, 155, 255], 0)).toEqual([0, 0, 0])
    expect(shadeTowards([199, 155, 255], 128)).toEqual([199, 155, 255])
    expect(shadeTowards([199, 155, 255], 255)).toEqual([255, 255, 255])
    expect(snowColours(['purple', 'green'])).toEqual([TINTS.purple, TINTS.green])
    expect(snowColours([])).toEqual([])
    // Tuned snow carries the colours; there is no multiply tint layer.
    const snow = renderToStaticMarkup(createElement(TransitionOverlay, { settings: tune(['purple', 'green']), identity: SAMPLE }))
    expect(snow).toContain('static-noise')
    expect(snow).not.toContain('fx-tint')
    // CRT and flash have no snow: the beam / flash take the colour fill instead.
    expect(tintOf(['purple'])).toBe('#c79bff')
    expect(tintOf(['purple', 'green'])).toBe('linear-gradient(115deg, #c79bff, #8dffa8, #c79bff)')
    const beam = renderToStaticMarkup(createElement(TransitionOverlay, { settings: crt(['purple']), identity: SAMPLE }))
    expect(beam).toContain('fx-beam')
    expect(beam).toContain('--fx-fill:#c79bff')
    expect(beam).toContain('has-fill')
    expect(beam).not.toContain('fx-tint')
    expect(renderToStaticMarkup(createElement(TransitionOverlay, { settings: crt([]), identity: SAMPLE }))).not.toContain('--fx-fill')
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
