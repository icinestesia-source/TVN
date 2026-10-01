import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { historyActions, InfoActions } from './components/InfoActions.tsx'
import type { Channel } from './types/channel.ts'
import type { Programme } from './types/programme.ts'
import type { TvCommand } from './types/input.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const guide = read('src/components/Guide.tsx')
const overlay = read('src/components/NowNextOverlay.tsx')
const css = read('src/styles/guide.css')

function render(history: ReturnType<typeof historyActions> | undefined) {
  const channel = { number: 12, name: 'Twelve', origin: 'default' } as Channel
  const programme = { id: 'p', title: 'Film', videoId: 'abcdefghijk', durationSeconds: 1800, playback: 'seekable-recorded' } as Programme
  return renderToStaticMarkup(
    createElement(InfoActions, { channel, programme, live: true, onTune: () => undefined, onPrev: () => undefined, onNext: () => undefined, history }),
  )
}

describe('one information bar, in the Guide and over the picture', () => {
  it('both pass the same ↑ ↓ viewing history to the same InfoActions', () => {
    expect(overlay).toContain('history={historyActions(tv)}')
    expect(guide).toContain('history={historyActions(tv)}')
    const panel = guide.slice(guide.indexOf('function ProgrammePanel('), guide.indexOf('/** The bundled starter network'))
    expect(panel).toContain('history: HistoryActions')
    expect(panel).toMatch(/<InfoActions [^>]*onPrev=\{onPrev\} onNext=\{onNext\} history=\{history\} \/>/)
  })

  it('renders ↑ ← Watch → ↓ ↗ in that order as one unwrapped group', () => {
    const tv = { canGoBack: true, canGoForward: false, dispatch: () => undefined }
    const markup = render(historyActions(tv))
    expect(markup).toMatch(/^<div class="info-actions has-history">/)
    const labels = [...markup.matchAll(/<(?:button|a)[^>]*>([^<]+)<\/(?:button|a)>/g)].map((match) => match[1])
    expect(labels.filter((label) => label !== '↗')).toEqual(['↑', '←', 'Watch', '→', '↓'])
    if (labels.includes('↗')) expect(labels.indexOf('↗')).toBe(5)
  })

  it('has no Guide-only rule for the actions: the one-line rule and the narrow-width rule apply to both', () => {
    expect(css).toMatch(/\.info-actions\.has-history \{\s*flex-wrap: nowrap;\s*max-width: none;\s*\}/)
    expect(css).toMatch(/@media \(max-width: 420px\) \{\s*\.info-actions\.has-history \{ gap: 4px; \}/)
    expect(css).not.toMatch(/\.guide(?!-info\.is-programme \>)[^{]*\.info-actions/)
  })

  it('keeps the semantics: ↑ and ↓ are viewing history; ← and → stay programme steps', () => {
    const sent: TvCommand['type'][] = []
    const actions = historyActions({ canGoBack: false, canGoForward: true, dispatch: (command) => void sent.push(command.type) })
    actions.onBack()
    actions.onForward()
    expect(sent).toEqual(['history-back', 'history-forward'])
    expect(actions).toMatchObject({ canBack: false, canForward: true })
    expect(guide).toContain("onPrev={precedingSlot ? () => tv.dispatch({ type: 'nav', direction: 'left' }) : undefined}")
    expect(overlay).toContain('onPrev={steps && hasPicture(stepFrom(channel, now, -1).programme) ? () => tv.screenStep(-1) : undefined}')
  })

  it('disables ↑ and ↓ where there is no history, as over the picture', () => {
    const markup = render(historyActions({ canGoBack: false, canGoForward: false, dispatch: () => undefined }))
    expect(markup.match(/disabled=""/g)?.length).toBe(2)
  })
})
