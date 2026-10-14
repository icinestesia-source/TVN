import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const guide = readFileSync('src/components/Guide.tsx', 'utf8')
const provider = readFileSync('src/state/TvProvider.tsx', 'utf8')

describe('LATEST right-clicked: the very latest order again', () => {
  it('right-click on LATEST asks for the latest order from now, without the browser menu', () => {
    expect(guide).toMatch(/how === 'latest'\s*\? \(event: MouseEvent<HTMLButtonElement>\) => \{\s*event\.preventDefault\(\)\s*event\.stopPropagation\(\)\s*if \(!busy\) onArrange\?\.\('latest-now'\)/)
    expect(guide).toContain("Right-click: the very latest order again, from now")
    // Like LATEST switched on, it goes to the picture to show the latest programme, but only on the watched channel.
    expect(guide).toContain("channel.number === tv.channel.number && ((how === 'latest' && channel.liveFromMs === undefined) || how === 'latest-now') ? () => tv.dispatch({ type: 'cancel' })")
  })

  it('updates another channel’s schedule without tuning to it: that waits for the viewer to choose it', () => {
    const replay = provider.slice(provider.indexOf('const replayIfWatching'), provider.indexOf('const arrangeChannel'))
    expect(replay).toContain("if (channelRef.current !== number || multiviewRef.current !== '1') return\n")
    expect(replay).not.toContain('requestTune(')
  })

  it('never switches LATEST off: it rescans and schedules newest first from now, whatever was on', () => {
    expect(provider).toContain("const again = asked === 'latest-now'")
    expect(provider).toContain("const how = again ? 'latest' : asked")
    expect(provider).toContain("if (how === 'reset' || (on === how && how !== 'random' && !again)) {")
    expect(provider).toContain("liveFromMs: how === 'latest' ? Date.now() : undefined")
  })

  it('works on any row that shows it, selected or not, and never on TVN’s own 000', () => {
    const cell = guide.slice(guide.indexOf('ARRANGEMENTS.map('), guide.indexOf("onArrange('reset')"))
    expect(cell).toContain('disabled={busy}')
    expect(cell).not.toContain('!selected')
    expect(guide).toContain("editorScope(channel) && editorScope(channel) !== 'tvn' && channel.origin !== 'session'")
  })
})
