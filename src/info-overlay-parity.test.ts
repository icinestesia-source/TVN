import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { historyActions, InfoActions } from './components/InfoActions.tsx'
import type { Channel } from './types/channel.ts'
import type { Programme } from './types/programme.ts'
import type { TvCommand } from './types/input.ts'
import { padProps } from './info-pad.fixture.ts'
import { fullscreenAvailable } from './view/info-shortcuts.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const guide = read('src/components/Guide.tsx')
const overlay = read('src/components/NowNextOverlay.tsx')
const css = read('src/styles/guide.css')

function render(history: ReturnType<typeof historyActions>) {
  const channel = { number: 12, name: 'Twelve', origin: 'default' } as Channel
  const programme = { id: 'p', title: 'Film', videoId: 'abcdefghijk', durationSeconds: 1800, playback: 'seekable-recorded' } as Programme
  return renderToStaticMarkup(
    createElement(InfoActions, { channel, programme, onPrev: () => undefined, onNext: () => undefined, ...padProps(), history }),
  )
}

describe('one information bar, in the Guide and over the picture', () => {
  it('both pass the same history, corners and channel keys to the same pad', () => {
    for (const source of [overlay, guide]) {
      expect(source).toContain('history={historyActions(tv)}')
      expect(source).toContain('corners={cornerActions(tv)}')
      expect(source).toContain('channels={channelActions(tv)}')
    }
    const panel = guide.slice(guide.indexOf('function ProgrammePanel('), guide.indexOf('/** The bundled starter network'))
    expect(panel).toContain('history: HistoryActions')
    expect(panel).toMatch(/<InfoActions\s+key=\{channel\.number\}[\s\S]*onPrev=\{onPrev\}\s+onNext=\{onNext\}(?:\s+following=\{following\})?\s+history=\{history\}\s+corners=\{corners\}\s+channels=\{channels\}\s+\/>/)
  })

  it('renders the one 3×3 pad as one unwrapped group', () => {
    const tv = { canGoBack: true, canGoForward: true, multiviewMode: '1' as const, dispatch: () => undefined }
    const markup = render(historyActions(tv))
    expect(markup).toMatch(/^<div class="info-actions info-pad has-history" role="group" aria-label="Programme controls">/)
    const labels = [...markup.matchAll(/<(?:button|a)[^>]*>([^<]+)<\/(?:button|a)>/g)].map((match) => match[1])
    expect(labels).toEqual(['Remote', '↑', 'CH+', '⛶', '←', 'Guide', '→', '⚙', '↓', 'CH−', 'TVN'])
  })

  it('has no Guide-only rule for the actions: the one-line rule and the narrow-width rule apply to both', () => {
    expect(css).toMatch(/\.info-actions\.has-history \{\s*flex-wrap: nowrap;\s*max-width: none;\s*\}/)
    expect(css).toMatch(/@media \(max-width: 420px\) \{\s*\.info-actions\.has-history \{ gap: 4px; \}/)
    expect(css).not.toMatch(/\.guide(?!-info\.is-programme \>)[^{]*\.info-actions/)
  })

  it('keeps the semantics: ↑ and ↓ are viewing history; ← and → stay programme steps', () => {
    const sent: TvCommand['type'][] = []
    const actions = historyActions({ canGoBack: false, canGoForward: true, multiviewMode: '1', dispatch: (command) => void sent.push(command.type) })
    actions.onBack()
    actions.onForward()
    expect(sent).toEqual(['history-back', 'history-forward'])
    expect(actions).toMatchObject({ canBack: false, canForward: true })
    expect(guide).toContain("onPrev={precedingSlot ? () => tv.dispatch({ type: 'nav', direction: 'left' }) : undefined}")
    expect(overlay).toContain('onPrev={steps && hasPicture(stepFrom(channel, now, -1).programme) ? () => tv.screenStep(-1) : undefined}')
  })

  it('disables ↑ where there is no history, and MULTI holds ↓’s place until there is somewhere forward to go', () => {
    const markup = render(historyActions({ canGoBack: false, canGoForward: false, multiviewMode: '1', dispatch: () => undefined }))
    expect(markup).toMatch(/disabled=""[^>]*aria-label="Previous watched channel"/)
    // Fullscreen is the only other key that can be disabled, where the browser has no fullscreen.
    expect(markup.match(/disabled=""/g)?.length).toBe(fullscreenAvailable() ? 1 : 2)
    expect(markup).toContain('aria-label="Multi View"')
    expect(markup).not.toContain('Next watched channel')
  })
})
