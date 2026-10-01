import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, PREFERENCES_KEY } from './services/preferences.ts'
import { currentEntryMode, entryMode, SURF_ENTRY_PATH, surfsOnEntry } from './state/entry.ts'
import { SURF_KEY } from './state/surf.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const provider = read('src/state/TvProvider.tsx')

describe('one TVN, two entries', () => {
  it('tvn.lol/ is the television: Surf waits for the TVN button', () => {
    expect(entryMode('/')).toBe('television')
    expect(entryMode('')).toBe('television')
    expect(surfsOnEntry(entryMode('/'))).toBe(false)
    expect(currentEntryMode()).toBe('television')
  })

  it('tvn.lol/tvn turns the television on with Surf running', () => {
    expect(SURF_ENTRY_PATH).toBe('/tvn')
    for (const path of ['/tvn', '/tvn/', '/TVN']) expect(entryMode(path)).toBe('tvn')
    expect(surfsOnEntry(entryMode('/tvn'))).toBe(true)
    for (const path of ['/tvnx', '/tvn/more', '/about', '/surf']) expect(entryMode(path)).toBe('television')
  })

  it('starts Surf through the existing switch, timer and guards, and nothing else', () => {
    expect(provider).toContain('const [surfing, setSurfing] = useState(() => surfsOnEntry(currentEntryMode()))')
    expect(provider).not.toContain('loadSurfOn')
    expect(provider.match(/surfDelayMs\(/g)?.length).toBe(1)
    // The same guard as ever: after startup, after the welcome notice, outside the Guide and the editor.
    expect(provider).toContain("if (!surfing || asleep || guideOpen || screenEdit !== null || startupPhase !== 'ready' || !noticeSeen) return")
    // The TVN button still switches it, from either entry.
    expect(provider).toMatch(/const toggleSurf = useCallback\(\(\) => \{[\s\S]{0,200}setSurfing\(next\)/)
    expect(read('src/components/TouchRemote.tsx')).toContain('aria-pressed={tv.surfing}')
  })

  it('is the same application: one index, one build, one network, one store', () => {
    expect(readdirSync('.').filter((name) => name.endsWith('.html'))).toEqual(['index.html'])
    const entry = read('src/state/entry.ts')
    expect(entry).not.toMatch(/localStorage|indexedDB|sessionStorage|PREFERENCES_KEY|SURF_KEY/)
    expect(read('src/services/preferences.ts')).not.toMatch(/entry|pathname/)
    expect(read('src/state/surf.ts')).not.toMatch(/entry|pathname/)
    expect(PREFERENCES_KEY).toBe('retrotv.preferences.v1')
    expect(SURF_KEY).toBe('tvn.surf.v1')
    const users = provider.split('\n').filter((line) => /currentEntryMode|entryMode\(/.test(line) && !line.startsWith('import'))
    expect(users).toEqual(['  const [surfing, setSurfing] = useState(() => surfsOnEntry(currentEntryMode()))'])
  })

  it('a fresh viewer starts on 225 from either entry; a returning viewer keeps their channel', () => {
    expect(DEFAULT_PREFERENCES.lastChannelNumber).toBe(225)
    expect(provider).toContain('const tuning = resolveStartupTuning(startup, stored)')
    expect(provider).toContain('commitChannel(tuning, false)')
    expect(provider).toContain('historyRef.current = visit(EMPTY_HISTORY, tuning.channelNumber)')
  })

  it('keeps the startup playback check: Surf hops before the first key or tap stay muted', () => {
    expect(provider).toContain('void confirmStart(player, stillFirst, sleep)')
    expect(provider.match(/mutedRef\.current \|\| soundHeld\(startHoldRef\.current, startCheckRef\.current, viewerInteracted\(\)\)\)/g)?.length).toBe(2)
  })

  it('a direct load or refresh of /tvn is served the app by the Netlify SPA fallback', () => {
    expect(read('public/_redirects').trim()).toBe('/*    /index.html   200')
    expect(read('netlify/functions/channel.ts')).toContain("export const config = { path: '/api/channel' }")
    // Every asset and data address is absolute, so nothing resolves under /tvn/.
    for (const href of read('index.html').match(/(?:href|src)="([^"]+)"/g) ?? []) expect(href).toMatch(/="(\/|https:)/)
    expect(read('src/credits/provenance.ts')).toContain("REGISTER_PATH = '/independent/sources.json'")
  })
})
