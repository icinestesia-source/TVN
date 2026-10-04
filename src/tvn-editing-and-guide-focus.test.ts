import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChannelEditor } from './components/ChannelEditor.tsx'
import { channels } from './data/catalogue.ts'
import { anchoredScrollLeft, keyZoomAnchor } from './epg/zoom.ts'
import { commandFromKey } from './input/keyboard.ts'
import { ENTRY_KEYS } from './legal/entry-keys.ts'
import { FirstRunNotice } from './legal/FirstRunNotice.tsx'
import {
  admitted,
  applyChannelEdit,
  editOf,
  eligibilityKey,
  heldIds,
  holdNew,
  rescanChannel,
  type ChannelEdit,
} from './services/channel-editor.ts'
import { airingSources, type ChannelSource } from './services/channel-sources.ts'
import { channelsFromSources, type ImportedVideo, type StoredSource } from './services/channels-import.ts'
import { canonicalEdit, curatedEditOf } from './services/curated-edits.ts'
import type { Channel } from './types/channel.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const videos = (prefix: string, count: number, from = 0): ImportedVideo[] =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}${String(from + index).padStart(11 - prefix.length, '0')}`, title: `${prefix} ${from + index + 1}`, durationSec: 900 }))
const youtube = (list: ImportedVideo[], patch: Partial<ChannelSource> = {}): ChannelSource => ({
  id: 's1',
  kind: 'youtube',
  url: 'https://www.youtube.com/channel/UCaaaa000000000000000001',
  label: 'Alpha',
  enabled: true,
  ref: 'UCaaaa000000000000000001',
  videos: list,
  more: 'next-page',
  status: { state: 'ready', checkedAt: 1 },
  ...patch,
})
const record = (sources: ChannelSource[], patch: Partial<StoredSource> = {}): StoredSource => ({
  id: 'yt:UCaaaa000000000000000001',
  name: 'Alpha',
  videos: sources.flatMap((source) => source.videos ?? []),
  channelNumber: 1001,
  inLibrary: false,
  automatic: true,
  updatedAt: 1,
  channelSources: sources,
  ...patch,
})
const scheduleOf = (stored: StoredSource) => {
  const built = channelsFromSources([stored])
  return (built.programmes.get(built.channels[0].id) ?? []).map((programme) => programme.videoId)
}

describe('ENTRY SCREEN: the keys at a glance', () => {
  const html = renderToStaticMarkup(createElement(FirstRunNotice))

  it('sits in the existing notice, between the disclaimer and the TVN · NEW · LEGAL buttons', () => {
    const keys = html.indexOf('first-run-keys')
    expect(html.indexOf('Welcome to TVN')).toBeLessThan(keys)
    expect(html.indexOf('first-run-example')).toBeLessThan(keys)
    expect(keys).toBeLessThan(html.indexOf('first-run-actions'))
    expect(html).toMatch(/<button[^>]*>TVN<\/button><button[^>]*>New<\/button><button[^>]*>Legal<\/button>/)
    expect(read('src/app/TvScreen.tsx')).toContain('FirstRunNotice')
  })

  it('shows every required key with its plain label', () => {
    for (const [key, label] of [
      ['P', 'Pause'],
      ['Space', 'Surf'],
      ['Hold Space', 'Surf scope'],
      ['S', 'Favourite'],
      [',', 'Prev'],
      ['.', 'Next'],
      ['/', 'Multi'],
      ['-', 'Zoom out'],
      ['=', 'Zoom in'],
    ]) {
      expect(html).toContain(`<kbd${key.length > 1 ? ' class="is-wide"' : ''}>${key}</kbd><span>${label}</span>`)
    }
  })

  it('invents nothing: every key shown is one TVN binds', () => {
    const expected: Record<string, [string, boolean]> = {
      P: ['play-pause', false],
      S: ['favourite', false],
      ',': ['history-back', false],
      '.': ['history-forward', false],
      '/': ['multiview', false],
      '-': ['guide-zoom', true],
      '=': ['guide-zoom', true],
      G: ['guide', false],
      Home: ['guide-now', false],
      F: ['fullscreen', false],
      Space: ['random-channel', false],
    }
    for (const { keys } of ENTRY_KEYS) {
      for (const { key } of keys) {
        if (key === 'Hold Space') continue
        const [type, guideOpen] = expected[key]
        expect(commandFromKey(key === 'Space' ? ' ' : key, { meta: false, ctrl: false, alt: false }, guideOpen)?.type).toBe(type)
      }
    }
    expect(read('src/input/space-hold.ts')).toContain('toggle')
  })

  it('wraps on a narrow screen and never scrolls sideways', () => {
    const css = read('src/styles/credits.css')
    expect(css).toMatch(/\.first-run-keys \{[^}]*flex-wrap: wrap;/)
    expect(css).toMatch(/\.first-run \{[^}]*overflow-x: hidden;/)
  })
})

describe('GUIDE: - and = hold the picked programme, else the NOW line', () => {
  const windowStartMs = 0
  const now = 90 * 60_000
  const view = (scrollLeft: number, px: number) => ({ scrollLeft, clientWidth: 1000, windowStartMs, pxPerMinute: px })
  const step = (scrollLeft: number, from: number, to: number, picked: { startMs: number; endMs: number } | null) => {
    const anchor = keyZoomAnchor(view(scrollLeft, from), now, picked)
    return { scrollLeft: anchoredScrollLeft(anchor.timeMs, anchor.offsetPx, windowStartMs, to), anchor }
  }
  const at = (timeMs: number, scrollLeft: number, px: number) => (timeMs / 60_000) * px - scrollLeft

  it('Case A: with nothing picked, repeated = and - keep the NOW line where it was, never off the left edge', () => {
    let px = 4
    let scrollLeft = (now / 60_000) * px - 250
    for (let press = 0; press < 6; press += 1) {
      const next = step(scrollLeft, px, px * 1.25, null)
      px *= 1.25
      scrollLeft = next.scrollLeft
      expect(at(now, scrollLeft, px)).toBeCloseTo(250, 6)
    }
    for (let press = 0; press < 6; press += 1) {
      const next = step(scrollLeft, px, px / 1.25, null)
      px /= 1.25
      scrollLeft = next.scrollLeft
      expect(at(now, scrollLeft, px)).toBeGreaterThanOrEqual(0)
    }
  })

  it('Case B: a picked programme on another channel stays under its own centre', () => {
    const picked = { startMs: 120 * 60_000, endMs: 150 * 60_000 }
    let px = 4
    let scrollLeft = 300
    const centre = (picked.startMs + picked.endMs) / 2
    const offset = at(centre, scrollLeft, px)
    for (let press = 0; press < 5; press += 1) {
      scrollLeft = step(scrollLeft, px, px * 1.25, picked).scrollLeft
      px *= 1.25
      expect(at(centre, scrollLeft, px)).toBeCloseTo(offset, 6)
    }
  })

  it('with neither on screen, the middle of the timeline holds', () => {
    const anchor = keyZoomAnchor(view(5000, 4), now, null)
    expect(anchor.offsetPx).toBe(500)
  })

  it('Case C: the Guide tells a pick from where it opened, NOW resets that, and rows never move on zoom', () => {
    const guide = read('src/components/Guide.tsx')
    expect(guide).toContain('const chosenSlot = tv.guideCursor !== restingCursor.current ? focused : null')
    expect(guide).toMatch(/nowAsked\.current = tv\.guideNowAsk\s*restingCursor\.current = tv\.guideCursor/)
    expect(guide).toContain('keyZoomAnchor({ scrollLeft: grid.scrollLeft, clientWidth: grid.clientWidth, windowStartMs: before.startMs, pxPerMinute: before.px }, Date.now(), chosenSlot)')
    expect(guide).toContain('zoomHeld.current = true')
    expect(guide).toContain('grid.scrollLeft = openScrollLeft(Date.now(), startMs, pxPerMinute, grid.clientWidth)')
  })
})

describe('CHANNEL EDITOR: LOAD fills AVAILABLE, RESCAN schedules', () => {
  const first = videos('alpha', 4)
  const more = videos('alpha', 3, 4)

  it('holds what LOAD brings back from the schedule, and only that', () => {
    const before = youtube(first)
    const after = holdNew(before, youtube([...first, ...more]))
    expect([...heldIds([after])]).toEqual(more.map((video) => video.id))
    expect(after.videos?.filter((video) => !video.pending).map((video) => video.id)).toEqual(first.map((video) => video.id))
    expect(holdNew(before, youtube(first))).toEqual(youtube(first))
    expect(heldIds(admitted([after])).size).toBe(0)
    expect(airingSources([after])[0].videos).toHaveLength(4)
  })

  it('a saved LOAD leaves the playing schedule exactly as it was, automatic or in the viewer\'s order', () => {
    const automatic = record([youtube(first)])
    const loaded = applyChannelEdit([automatic], 1001, { ...editOf(automatic), sources: [holdNew(youtube(first), youtube([...first, ...more]))] }, 2)[0]
    expect(scheduleOf(loaded)).toEqual(scheduleOf(automatic))
    expect(loaded.videos.map((video) => video.id)).toEqual(first.map((video) => video.id))
    expect(loaded.channelSources?.[0].videos).toHaveLength(7)

    const ordered = record([youtube(first)], { runningOrder: [first[3].id, first[0].id, first[1].id, first[2].id], orderKind: 'manual' })
    const loadedOrdered = applyChannelEdit([ordered], 1001, { ...editOf(ordered), sources: [holdNew(youtube(first), youtube([...first, ...more]))] }, 2)[0]
    expect(loadedOrdered.runningOrder).toEqual(ordered.runningOrder)
    expect(scheduleOf(loadedOrdered)).toEqual(scheduleOf(ordered))
  })

  it('RESCAN admits held programmes and records what it compiled', async () => {
    const held = holdNew(youtube(first), youtube([...first, ...more]))
    const stored = record([held])
    const result = await rescanChannel(
      [stored],
      1001,
      editOf(stored),
      {
        resolveYouTube: async () => ({ channelId: 'UCaaaa000000000000000001', title: 'Alpha', videos: [...first, ...more], next: 'p2' }),
        probeStream: async () => 'online',
      },
      3,
    )
    expect(heldIds(result.edit.sources).size).toBe(0)
    expect(result.edit.compiled).toBe(eligibilityKey(result.edit))
    expect(result.all[0].compiled).toBe(result.edit.compiled)
    expect(scheduleOf(result.all[0])).toEqual(expect.arrayContaining(more.map((video) => video.id)))
  })

  it('the eligibility fingerprint follows sources and filters, not sorting', () => {
    const edit: ChannelEdit = { name: 'Alpha', sources: [youtube(first)] }
    const key = eligibilityKey(edit)
    expect(eligibilityKey({ ...edit, order: first.map((video) => video.id).reverse(), orderKind: 'az' })).toBe(key)
    expect(eligibilityKey({ ...edit, sources: [youtube(first, { enabled: false })] })).not.toBe(key)
    expect(eligibilityKey({ ...edit, sources: [youtube(first, { filter: { exclude: { terms: ['live'] } } })] })).not.toBe(key)
    expect(eligibilityKey({ ...edit, sources: [youtube(first), youtube([], { id: 's2', url: 'https://www.youtube.com/@beta' })] })).not.toBe(key)
    expect(eligibilityKey({ ...edit, order: first.map((video) => video.id), scheduleSize: 2 })).not.toBe(key)
  })

  it('keeps how the running order was made, for user and TVN channels alike', () => {
    const stored = record([youtube(first)])
    const saved = applyChannelEdit([stored], 1001, { ...editOf(stored), order: first.map((video) => video.id), orderKind: 'latest', compiled: 'abc' }, 2)[0]
    expect(saved.orderKind).toBe('latest')
    expect(editOf(saved).orderKind).toBe('latest')
    expect(editOf(saved).compiled).toBe('abc')
    const automatic = applyChannelEdit([saved], 1001, { ...editOf(saved), order: undefined, orderKind: undefined }, 3)[0]
    expect(automatic.orderKind).toBeUndefined()

    const shipped = channels.find((channel) => channel.number === 7)!
    const curated = canonicalEdit(shipped, { name: shipped.name, sources: [youtube(first)], order: first.map((video) => video.id), orderKind: 'random', compiled: 'k' }, [])
    expect(curated.orderKind).toBe('random')
    expect(curatedEditOf(shipped, { channelNumber: 7, savedAt: 1, ...curated }).orderKind).toBe('random')
  })
})

describe('CHANNEL EDITOR: what the viewer sees', () => {
  const user = { ...channels[0], number: 1001, id: 'user-x', origin: 'user-import' } as Channel
  const first = videos('alpha', 4)
  const render = (edit: ChannelEdit) =>
    renderToStaticMarkup(
      createElement(ChannelEditor, {
        channel: user,
        scope: 'user',
        initial: edit,
        onLoad: async () => edit,
        onSave: async () => '',
        onRescan: async () => ({ edit, message: '' }),
        onLoadMore: async (source: ChannelSource) => source,
        onDelete: async () => '',
        onClose: () => {},
      }),
    )

  it('names the kind of running order the channel follows', () => {
    const ids = first.map((video) => video.id)
    const label = (edit: ChannelEdit) => render(edit).match(/<span class="editor-order-kind"[^>]*>([^<]+)<\/span>/)?.[1]
    expect(label({ name: 'Alpha', sources: [youtube(first)] })).toBe('Automatic')
    expect(label({ name: 'Alpha', sources: [youtube(first)], order: ids, orderKind: 'az' })).toBe('A–Z')
    expect(label({ name: 'Alpha', sources: [youtube(first)], order: ids, orderKind: 'latest' })).toBe('Latest first')
    expect(label({ name: 'Alpha', sources: [youtube(first)], order: ids, orderKind: 'random' })).toBe('Randomised')
    expect(label({ name: 'Alpha', sources: [youtube(first)], order: ids, orderKind: 'rebuilt' })).toBe('Rebuilt')
    expect(label({ name: 'Alpha', sources: [youtube(first)], order: ids, orderKind: 'manual' })).toBe('Yours · manual')
    expect(label({ name: 'Alpha', sources: [youtube(first)], order: ids })).toBe('Yours')
    const shipped = channels.find((channel) => channel.number === 7)!
    const tvn = renderToStaticMarkup(
      createElement(ChannelEditor, {
        channel: shipped,
        scope: 'curated',
        initial: { name: shipped.name, sources: [{ id: 'tvn', kind: 'tvn', url: '', label: 'TVN', enabled: true }] },
        onLoad: async () => null,
        onSave: async () => '',
        onRescan: async () => ({ edit: { name: '', sources: [] }, message: '' }),
        onDelete: async () => '',
        onClose: () => {},
      }),
    )
    if (tvn.includes('editor-order-kind')) expect(tvn).toMatch(/editor-order-kind[^>]*>TVN&#x27;s own</)
  })

  it('puts LOAD immediately before RESCAN, and RESCAN is plain while nothing waits for it', () => {
    const html = render({ name: 'Alpha', sources: [youtube(first)] })
    expect(html).toMatch(/<button type="button" class="tab"[^>]*>Load<\/button><button type="button" class="tab"[^>]*>Rescan channel<\/button>/)
    expect(html).not.toContain('is-dirty')
  })

  it('marks RESCAN with the accent and * once LOAD has brought programmes it has not scheduled', () => {
    const held = holdNew(youtube(first), youtube([...first, ...videos('alpha', 2, 4)]))
    const html = render({ name: 'Alpha', sources: [held] })
    expect(html).toMatch(/<button type="button" class="tab is-dirty"[^>]*>Rescan channel \*<\/button>/)
    expect(html).toContain('<span>6 available</span><span>6 eligible</span><span class="editor-pool-on">4 scheduled</span>')
    expect(html).toContain('2 new · rescan to schedule')
    expect(html.match(/class="editor-lineup-new"/g)).toHaveLength(2)
    expect(read('src/styles/guide.css')).toMatch(/\.editor-actions \.tab\.is-dirty \{[^}]*border-color: var\(--gold\)/)
  })

  it('marks RESCAN after a source or filter changes since the last rescan, and not for sorting', () => {
    const compiled = eligibilityKey({ name: 'Alpha', sources: [youtube(first)] })
    expect(render({ name: 'Alpha', sources: [youtube(first)], compiled })).not.toContain('is-dirty')
    expect(render({ name: 'Alpha', sources: [youtube(first)], order: first.map((video) => video.id).reverse(), orderKind: 'az', compiled })).not.toContain('is-dirty')
    expect(render({ name: 'Alpha', sources: [youtube(first, { enabled: false })], compiled })).toContain('Rescan channel *')
  })

  it('LOAD reads one batch per source, keeps Stop, and adding a source reads its first programmes without rebuilding', () => {
    const editor = read('src/components/ChannelEditor.tsx')
    expect(editor).toContain('const loadable = edit ? edit.sources.filter(canLoadMore) : []')
    expect(editor).toMatch(/const found = await onLoadMore\(source, \{\s*signal: stop\.signal,/)
    expect(editor).not.toMatch(/loadBatch[^]*all: true[^]*const noteDraft/)
    expect(editor).toContain('Loading · {batch.of}')
    expect(editor).toContain('onClick={() => stopRef.current?.abort()}')
    expect(editor).toContain("const arrived = holding ? holdNew({ ...source, videos: [] }, found) : found")
    expect(read('src/state/TvProvider.tsx')).toContain('const acquireChannelSource = useCallback(async (source: ChannelSource) => (await rescanSources([source], rescanDeps(), Date.now()))[0], [rescanDeps])')
    expect(read('src/components/Guide.tsx')).toContain('onAcquire={tv.acquireChannelSource}')
  })
})

describe('STARTUP RACE: the viewer\'s channels win over the starter install', () => {
  it('plans the starter around what is stored now and plans again if it changed before saving', () => {
    const provider = read('src/state/TvProvider.tsx')
    const body = provider.slice(provider.indexOf('const loadTestChannels = useCallback'), provider.indexOf('// However the first load goes'))
    expect(body.indexOf('await ingestParsed(')).toBeLessThan(body.indexOf('const stored = await loadStoredSources()'))
    expect(body).toContain('if (plan.added.length > 0 && !sameStoredSources(stored, await loadStoredSources())) continue')
    expect(body).toContain("if (!settled) return ''")
    expect(provider).toContain('if (!channelByNumber(channelRef.current)) requestTune(1)')
  })
})
