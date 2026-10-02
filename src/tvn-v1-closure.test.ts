import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ChannelEditor } from './components/ChannelEditor.tsx'
import { InfoActions } from './components/InfoActions.tsx'
import type { ChannelEdit } from './services/channel-editor.ts'
import { padProps } from './info-pad.fixture.ts'
import { channelByNumber, listChannels } from './data/catalogue.ts'
import { installUserCatalogue } from './data/user-overlay.ts'
import { resetDirector } from './director/director.ts'
import { setMediaLibrary } from './director/library.ts'
import { isLiveStreamChannel } from './dynamic/stream.ts'
import { AboutPanel, RightsContact } from './legal/AboutPanel.tsx'
import { FirstRunNotice } from './legal/FirstRunNotice.tsx'
import { CONTACT_EMAIL, contactLink, LEGAL_SECTIONS } from './legal/legal-text.ts'
import { expandPlayableCatalogue, type PlayableCatalogueV2 } from './library/playable-catalogue.ts'
import { isOnAir, refreshAiring } from './network/airing.ts'
import { broadcast } from './services/broadcast.ts'
import { DEFAULT_PREFERENCES, FIRST_CHANNEL_NUMBER, loadPreferences, PREFERENCES_KEY, savePreferences } from './services/preferences.ts'
import { createStartupRestore } from './state/startup-channel.ts'
import { resolveStartupTuning } from './state/startup.ts'
import { canGoBack, canGoForward, commitHistory, EMPTY_HISTORY, historyStep, visit, type ViewingHistory } from './state/history.ts'
import type { Channel } from './types/channel.ts'
import { compactTracks, gridRows, MIN_EMBED_PX, MULTI_PLAYBACK, multiviewLayout, surfTile, tileEmbeds } from './view/multiview.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const T = Date.UTC(2026, 9, 1, 19, 0, 0)

function withStorage(run: (data: Map<string, string>) => void) {
  const data = new Map<string, string>()
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) }
  const original = globalThis.localStorage
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  try {
    run(data)
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true })
  }
}

beforeAll(() => {
  const items = expandPlayableCatalogue(JSON.parse(read('public/independent/playable.json')) as PlayableCatalogueV2)
  installUserCatalogue([], new Map())
  resetDirector()
  setMediaLibrary(items)
  refreshAiring(items)
}, 60000)

afterAll(() => installUserCatalogue([], new Map()))

describe('rights and attribution contact', () => {
  const EMAIL = /tvnlol@pm\.me/

  it('is the Version 1 rights address', () => {
    expect(CONTACT_EMAIL).toBe('tvnlol@pm.me')
    expect(contactLink('TVN rights & attribution')).toMatch(/^mailto:tvnlol@pm\.me\?subject=/)
  })

  it('is not shown in the first-run notice, the legal text, or the collapsed About panel', () => {
    expect(renderToStaticMarkup(createElement(FirstRunNotice))).not.toMatch(EMAIL)
    expect(JSON.stringify(LEGAL_SECTIONS)).not.toMatch(EMAIL)
    const about = renderToStaticMarkup(createElement(AboutPanel))
    expect(about).not.toMatch(EMAIL)
    expect(about).not.toContain('mailto:')
    expect(about).toContain('Rights &amp; attribution')
    expect(about).toMatch(/<button type="button" class="about-disclose" aria-expanded="false" aria-controls="about-contact">Contact TVN<\/button>/)
  })

  it('opens to the restrained rights wording, with the address as plain text rather than a mail button', () => {
    const html = renderToStaticMarkup(createElement(RightsContact))
    expect(html).toContain('Rights &amp; attribution contact')
    expect(html).toContain('If you are a creator, rights holder or source representative and believe TVN contains incorrect attribution, an incorrect source link, or programming that requires our attention, you can contact TVN here.')
    expect(html).toContain('>tvnlol@pm.me</a>')
    expect(html).toContain('Please identify the TVN channel, programme/source and the nature of your request.')
    expect(html).not.toContain('about-button')
    expect(read('src/legal/AboutPanel.tsx')).toContain('{open ? <RightsContact /> : null}')
  })

  it('is used nowhere else in the interface and invites no general correspondence', () => {
    for (const file of ['src/credits/CreditsRoll.tsx', 'src/components/TouchRemote.tsx', 'src/components/Guide.tsx', 'src/app/TvScreen.tsx', 'src/legal/FirstRunNotice.tsx']) {
      expect(read(file)).not.toMatch(/CONTACT_EMAIL|contactLink|RightsContact|tvnlol/)
    }
    const wording = read('src/legal/legal-text.ts') + read('src/legal/AboutPanel.tsx')
    expect(wording).not.toMatch(/contact us|love to hear|send feedback|get in touch|general enquir/i)
  })
})

describe('YouTube status record', () => {
  const status = JSON.parse(read('public/independent/youtube-status.json')) as Record<string, unknown>

  it('holds only Made for Kids and embeddable results, every shipped video accounted for', () => {
    expect(Object.keys(status).sort()).toEqual(['checkedAt', 'eligible', 'format', 'madeForKids', 'notEmbeddable', 'notReturned', 'resolved', 'unprocessed'])
    expect(status.format).toBe('tvn-youtube-status-v1')
    const eligible = status.eligible as number
    expect(eligible).toBeGreaterThan(121_000)
    expect((status.resolved as number) + (status.notReturned as string[]).length + (status.unprocessed as number)).toBe(eligible)
    for (const key of ['madeForKids', 'notEmbeddable', 'notReturned']) {
      for (const id of status[key] as string[]) expect(id).toMatch(/^[\w-]{11}$/)
    }
  })

  it('carries no credential and the runtime never calls the Data API', () => {
    expect(read('public/independent/youtube-status.json')).not.toMatch(/AIza|key=/)
    expect(read('scripts/youtube_status.py')).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/)
    expect(read('scripts/youtube_status.py')).toContain('os.environ.get("YOUTUBE_API_KEY")')
  })
})

describe('first channel', () => {
  it('a viewer with no saved state starts on 225', () => {
    withStorage(() => {
      expect(FIRST_CHANNEL_NUMBER).toBe(225)
      expect(DEFAULT_PREFERENCES.lastChannelNumber).toBe(225)
      const fresh = loadPreferences()
      expect(fresh.lastChannelNumber).toBe(225)
      expect(isOnAir(channelByNumber(225)!)).toBe(true)
      expect(resolveStartupTuning(createStartupRestore(), fresh)).toEqual({ channelNumber: 225, previousNumber: null })
    })
  })

  it('a returning viewer resumes their own channel and previous channel', () => {
    withStorage((data) => {
      savePreferences({ ...loadPreferences(), lastChannelNumber: 168, previousChannelNumber: 401 })
      expect(JSON.parse(data.get(PREFERENCES_KEY)!).lastChannelNumber).toBe(168)
      const back = loadPreferences()
      expect(resolveStartupTuning(createStartupRestore(), back)).toEqual({ channelNumber: 168, previousNumber: 401 })
      data.set(PREFERENCES_KEY, JSON.stringify({ ...DEFAULT_PREFERENCES, lastChannelNumber: 1 }))
      expect(resolveStartupTuning(createStartupRestore(), loadPreferences())?.channelNumber).toBe(1)
    })
  })
})

describe('Multi View', () => {
  const wall = () =>
    listChannels()
      .filter((item) => item.enabled && item.origin !== 'session' && !isLiveStreamChannel(item) && item.mediaKind !== 'audio' && isOnAir(item))
      .slice(0, 9)

  it('defaults to one YouTube player, on the selected tile only, at 200×200 or more', () => {
    expect(MULTI_PLAYBACK).toBe('thumbnails')
    expect(MIN_EMBED_PX).toBe(200)
    expect(tileEmbeds({ focused: true, width: 320, height: 200 })).toBe(true)
    expect(tileEmbeds({ focused: true, width: 199, height: 300 })).toBe(false)
    expect(tileEmbeds({ focused: true, width: 300, height: 199 })).toBe(false)
    expect(tileEmbeds({ focused: false, width: 800, height: 450 })).toBe(false)
    expect(tileEmbeds({ focused: false, width: 800, height: 450 }, 'live')).toBe(true)
    const tile = read('src/components/BroadcastTile.tsx')
    expect(tile).toContain('const embed = active && tileEmbeds({ focused, ...size })')
    expect(tile).toContain('<div className="tile-player">')
    expect(tile).not.toContain('const embed = active && audible')
  })

  it('inactive tiles show what their own channel airs now and change at their own boundaries', () => {
    const tile = read('src/components/BroadcastTile.tsx')
    expect(tile).toContain('const now = useClock(1000)')
    expect(tile).toContain('const snap = channel ? broadcast(channel, now) : null')
    expect(tile).toMatch(/i\.ytimg\.com\/vi\/\$\{snap\.current\.programme\.videoId\}/)
    const channels = wall()
    expect(channels.length).toBe(9)
    const boundaries = channels.map((channel) => broadcast(channel, T).current.endMs)
    expect(new Set(boundaries).size).toBeGreaterThan(5)
    // Just past the first boundary, only the channels ending then have moved on.
    const first = Math.min(...boundaries)
    const before = channels.map((channel) => broadcast(channel, first - 1000).current.programme.id)
    const after = channels.map((channel) => broadcast(channel, first + 1000).current.programme.id)
    const changed = before.filter((id, index) => id !== after[index]).length
    expect(changed).toBeGreaterThanOrEqual(1)
    expect(changed).toBeLessThan(channels.length)
  })

  it('selecting a tile moves the player there and returns the old tile to its still', () => {
    const provider = read('src/state/TvProvider.tsx')
    expect(provider).toContain("case 'focus-tile': {")
    expect(provider).toContain("case 'focus-move': {")
    const grid = read('src/components/MultiviewGrid.tsx')
    expect(grid).toContain('focused={index === tv.audioFocus}')
  })

  it('gives a selected YouTube tile room for a player when the even grid is too small, and leaves large grids alone', () => {
    const phone = multiviewLayout('4', 390)
    expect(compactTracks({ width: 1200, height: 640 }, multiviewLayout('4', 1200), 2, 0, 4, 0)).toBeNull()
    const tracks = compactTracks({ width: 382, height: 420 }, phone, gridRows('4', phone), 3, 4, 0)!
    expect(tracks.columns).toBe('minmax(0, 1fr) minmax(200px, 1fr)')
    expect(tracks.rows).toBe('minmax(0, 1fr) minmax(200px, 1fr)')
    const stacked = multiviewLayout('2', 390)
    expect(compactTracks({ width: 382, height: 300 }, stacked, gridRows('2', stacked), 1, 4, 0)!.rows).toBe('minmax(0, 1fr) minmax(200px, 1fr)')
    expect(read('src/components/MultiviewGrid.tsx')).toContain("selected.mediaKind !== 'audio'")
  })

  it('Surf changes one unselected tile per hop, never the selected one, never duplicating a channel', () => {
    const tiles = wall().map((channel) => channel.number).slice(0, 4)
    const candidates = listChannels().filter((item) => isOnAir(item)).map((item) => item.number)
    let seed = 7
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    let current = tiles
    const changedAt = new Set<number>()
    for (let hop = 0; hop < 24; hop += 1) {
      const next = surfTile(current, 1, candidates, random)!
      const diff = next.map((number, index) => (number !== current[index] ? index : -1)).filter((index) => index >= 0)
      expect(diff.length).toBe(1)
      expect(diff[0]).not.toBe(1)
      expect(new Set(next).size).toBe(next.length)
      changedAt.add(diff[0])
      current = next
    }
    expect([...changedAt].sort()).toEqual([0, 2, 3])
    expect(surfTile([5], 0, candidates)).toBeNull()
  })

  it('Surf runs in Multi View through the same timer, and single-picture Surf is unchanged', () => {
    const provider = read('src/state/TvProvider.tsx')
    expect(provider).toContain("if (!surfing || asleep || guideOpen || screenEdit !== null || startupPhase !== 'ready' || !noticeSeen) return")
    expect(provider).toMatch(/if \(multiviewRef\.current === '1'\) \{[\s\S]{0,200}?if \(channelRef\.current === TVN_CHANNEL_NUMBER\) return setSurfHops\(\(hops\) => hops \+ 1\)\s+const picked = randomChannel\(channelRef\.current\)\s+if \(picked\) requestTune\(picked\.number\)/)
    expect(provider).toContain('const next = surfTile(tilesRef.current, audioFocusRef.current, candidates)')
    expect(provider.match(/surfDelayMs\(/g)?.length).toBe(1)
  })
})

describe('Open original', () => {
  const shipped = channelByNumber(225)!
  const editor = (edit: ChannelEdit) =>
    renderToStaticMarkup(
      createElement(ChannelEditor, {
        channel: { ...shipped, number: 1001, origin: 'user-import' } as Channel,
        scope: 'user',
        initial: edit,
        onLoad: async () => edit,
        onSave: async () => '',
        onRescan: async () => ({ edit, message: '' }),
        onDelete: async () => '',
        onClose: () => {},
      }),
    )

  it('is no longer a key on the pad: Fullscreen holds that corner', () => {
    const programme = broadcast(shipped, T).current.programme
    const html = renderToStaticMarkup(createElement(InfoActions, { channel: shipped, programme, onPrev: () => {}, onNext: () => {}, ...padProps() }))
    expect(html).not.toContain('href=')
    expect(html).not.toContain('Open original source')
    expect(html).toContain('aria-label="Fullscreen"')
  })

  it('opens each YouTube programme from the Channel Editor list, in a new tab', () => {
    const edit: ChannelEdit = {
      name: 'Mine',
      sources: [{ id: 's1', kind: 'youtube', url: 'https://www.youtube.com/@maker', label: 'Maker', enabled: true, videos: [
        { id: 'abcdefghijk', title: 'Film', durationSec: 600 },
        { id: 'local-file-1', title: 'Home video', durationSec: 60 },
      ] }],
    }
    const html = editor(edit)
    expect(html).toContain('href="https://www.youtube.com/watch?v=abcdefghijk"')
    expect(html).toContain('aria-label="Open Film on YouTube"')
    expect(html).toContain('target="_blank" rel="noopener noreferrer"')
    // An id that is not a YouTube video id links nowhere; its space stays.
    expect(html).not.toContain('Open Home video on YouTube')
    expect(html.match(/editor-link/g)?.length).toBe(2)
  })
})

describe('viewing history: Back and Forward', () => {
  const walk = (...numbers: number[]) => numbers.reduce((history, number) => visit(history, number), EMPTY_HISTORY)
  const at = (history: ViewingHistory) => history.entries[history.index]
  const go = (history: ViewingHistory, delta: -1 | 1) => {
    const step = historyStep(history, delta)!
    return commitHistory(history, step.channelNumber, step.index)
  }

  it('A → B → C: Back is B, then A; Forward is B, then C, without appending', () => {
    let history = walk(225, 417, 31)
    history = go(history, -1)
    expect(at(history)).toBe(417)
    expect(history.entries).toEqual([225, 417, 31])
    history = go(history, -1)
    expect(at(history)).toBe(225)
    expect(canGoBack(history)).toBe(false)
    expect(historyStep(history, -1)).toBeNull()
    history = go(history, 1)
    expect(at(history)).toBe(417)
    history = go(history, 1)
    expect(at(history)).toBe(31)
    expect(canGoForward(history)).toBe(false)
    expect(historyStep(history, 1)).toBeNull()
    expect(history.entries).toEqual([225, 417, 31])
  })

  it('the brief’s journey: 225 → 417 → 031 → 582 → 114 → 733', () => {
    let history = walk(225, 417, 31, 582, 114, 733)
    const seen: number[] = []
    for (const delta of [-1, -1, -1, 1, 1, 1] as const) {
      history = go(history, delta)
      seen.push(at(history))
    }
    expect(seen).toEqual([114, 582, 31, 582, 114, 733])
    expect(history.entries.length).toBe(6)
  })

  it('a new tune after going back discards the old forward branch', () => {
    let history = walk(225, 417, 31, 582)
    history = go(go(history, -1), -1)
    expect(at(history)).toBe(417)
    history = commitHistory(history, 733, null)
    expect(history.entries).toEqual([225, 417, 733])
    expect(canGoForward(history)).toBe(false)
  })

  it('never records the same channel twice in a row, so a same-channel programme pick adds nothing', () => {
    const history = walk(225, 225, 417, 417)
    expect(history.entries).toEqual([225, 417])
    expect(commitHistory(history, 417, null)).toBe(history)
  })

  it('a fresh session has nowhere to go: ↑ disabled in place, and MULTI holds ↓’s place', () => {
    const history = walk(225)
    expect(canGoBack(history)).toBe(false)
    expect(canGoForward(history)).toBe(false)
    const shipped = channelByNumber(225)!
    const html = renderToStaticMarkup(
      createElement(InfoActions, {
        channel: shipped,
        programme: broadcast(shipped, T).current.programme,
        onPrev: () => {},
        onNext: () => {},
        ...padProps({ canBack: false, canForward: false }),
      }),
    )
    expect(html).toMatch(/<button type="button" class="info-square info-pad-up" disabled="" title="Previous watched channel"/)
    expect(html).not.toContain('Next watched channel')
    expect(html).toMatch(/<button type="button" class="info-square info-pad-multi" aria-pressed="false" title="Multi View" aria-label="Multi View">Multi<\/button>/)
  })

  it('orders the pad REMOTE ↑|CH+ ⛶ / ← GUIDE → / TVN ↓|CH− R as one unwrapped group', () => {
    const shipped = channelByNumber(225)!
    const html = renderToStaticMarkup(
      createElement(InfoActions, {
        channel: shipped,
        programme: broadcast(shipped, T).current.programme,
        onPrev: () => {},
        onNext: () => {},
        ...padProps(),
      }),
    )
    const labels = [...html.matchAll(/<(?:button|a)[^>]*>([^<]+)<\/(?:button|a)>/g)].map((match) => match[1])
    expect(labels).toEqual(['Remote', '↑', 'CH+', '⛶', '←', 'Guide', '→', '⚙', '↓', 'CH−', 'TVN'])
    expect(html).toContain('class="info-actions info-pad has-history"')
    const css = read('src/styles/guide.css')
    expect(css).toMatch(/\.info-actions\.has-history \{\s*flex-wrap: nowrap;/)
    expect(css).toContain('.guide-info.is-programme > .info-actions.has-history { flex: 0 0 auto; }')
    expect(read('src/components/InfoActions.tsx')).toContain("onBack: () => tv.dispatch({ type: 'history-back' })")
    expect(read('src/components/NowNextOverlay.tsx')).toContain('history={historyActions(tv)}')
  })

  it('every tune records through the one commit point; Back and Forward aim the cursor; Multi View focus does not record', () => {
    const provider = read('src/state/TvProvider.tsx')
    expect(provider).toContain('historyRef.current = commitHistory(historyRef.current, next.channelNumber, historyAimRef.current)')
    expect(provider).toMatch(/const requestTune = \(number: number, keepPick = false\) => \{\s+historyAimRef\.current = historyNavRef\.current\s+historyNavRef\.current = null/)
    expect(provider).toMatch(/historyNavRef\.current = step\.index\s+requestTune\(step\.channelNumber\)/)
    expect(provider.match(/commitChannel\(\{ channelNumber: heard, previousNumber: previousRef\.current \}, false\)/g)?.length).toBe(3)
    // Random and Surf tune through requestTune, so their destinations are recorded like any other.
    expect(provider).toMatch(/case 'random-channel': \{\s+const picked = randomTarget\(channelRef\.current, \{ filter: guideFilter, favourites \}\)\s+if \(picked\) requestTune\(picked\.number\)/)
    expect(provider).toMatch(/if \(multiviewRef\.current === '1'\) \{[\s\S]{0,200}?if \(channelRef\.current === TVN_CHANNEL_NUMBER\) return setSurfHops\(\(hops\) => hops \+ 1\)\s+const picked = randomChannel\(channelRef\.current\)\s+if \(picked\) requestTune\(picked\.number\)/)
  })

  it('a Surf or Random journey can be retraced and followed again, never re-rolled', () => {
    let history = walk(225)
    for (const hop of [706, 876, 272, 761]) history = commitHistory(history, hop, null)
    history = go(go(history, -1), -1)
    expect(at(history)).toBe(876)
    history = go(history, 1)
    expect(at(history)).toBe(272)
    history = go(history, 1)
    expect(at(history)).toBe(761)
  })

  it('leaves Previous and programme Prev/Next as they were', () => {
    const provider = read('src/state/TvProvider.tsx')
    expect(provider).toMatch(/case 'last-channel': \{\s+const previous = previousRef\.current/)
    expect(read('src/components/NowNextOverlay.tsx')).toContain('onPrev={steps && hasPicture(stepFrom(channel, now, -1).programme) ? () => tv.screenStep(-1) : undefined}')
    expect(read('src/components/Guide.tsx')).toMatch(/<InfoActions\s+key=\{channel\.number\}\s+channel=\{channel\}\s+programme=\{slot\.programme\}\s+onPrev=\{onPrev\}\s+onNext=\{onNext\}(?:\s+following=\{following\})?\s+history=\{history\}/)
  })
})
