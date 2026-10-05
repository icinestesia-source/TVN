import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChannelEditor } from './components/ChannelEditor.tsx'
import { channelByNumber, channels } from './data/catalogue.ts'
import { calculateSchedule } from './scheduler/calculate.ts'
import { SCHEDULE_EPOCH_MS } from './scheduler/epoch.ts'
import { applyChannelEdit, editOf, holdNew, admitted, loadMoreSource, type ChannelEdit } from './services/channel-editor.ts'
import type { ChannelSource } from './services/channel-sources.ts'
import { channelsFromSources, livePhase, poolProgramme, type ImportedVideo, type StoredSource } from './services/channels-import.ts'
import { loadSurfUntilEnd, saveSurfUntilEnd, SURF_END_LIMIT_MS, surfUntilEndMs } from './state/surf.ts'
import type { Channel } from './types/channel.ts'
import { loadGuideActionsAll, saveGuideActionsAll } from './view/guide-actions-store.ts'
import { saveScheduleBeforeLatest, takeScheduleBeforeLatest } from './view/latest-mode-store.ts'
import { newestProgramme } from './view/programme-order.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const dated = (count: number, from = 0): ImportedVideo[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `vid${String(from + index).padStart(8, '0')}`,
    title: `Clip ${from + index + 1}`,
    durationSec: 600,
    published: `2026-0${1 + ((from + index) % 9)}-1${(from + index) % 10}`,
  }))
const youtube = (list: ImportedVideo[], patch: Partial<ChannelSource> = {}): ChannelSource => ({
  id: 's1',
  kind: 'youtube',
  url: 'https://www.youtube.com/channel/UCaaaa000000000000000001',
  label: 'Alpha',
  enabled: true,
  ref: 'UCaaaa000000000000000001',
  videos: list,
  more: 'next',
  status: { state: 'ready', checkedAt: 1 },
  ...patch,
})
const record = (sources: ChannelSource[]): StoredSource => ({
  id: 'yt:UCaaaa000000000000000001',
  name: 'Alpha',
  videos: sources.flatMap((source) => source.videos ?? []),
  channelNumber: 1001,
  inLibrary: false,
  automatic: true,
  updatedAt: 1,
  channelSources: sources,
})
const memory = () => {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) }
}

describe('CHANNEL ZERO and the creator line', () => {
  it('names channel 000 Channel Zero', () => {
    expect(channelByNumber(0)?.name).toBe('Channel Zero')
    expect(channelByNumber(0)?.shortName).toBe('TVN')
  })

  it('keeps the creator after the channel name, on the first line', () => {
    const info = read('src/components/ProgrammeInfo.tsx')
    expect(info.indexOf('<span>{channel.name}</span>')).toBeLessThan(info.indexOf('className="info-creator"'))
    expect(info.indexOf('className="info-creator"')).toBeLessThan(info.indexOf('</p>\n      <h2 className="info-title">'))
    expect(info).not.toContain('info-headline')
  })
})

describe('EDIT CHANNEL: LOAD MORE on each source, before REMOVE', () => {
  const user = { ...channels[0], number: 1001, id: 'user-x', origin: 'user-import' } as Channel
  const render = (edit: ChannelEdit, canLoad?: (source: ChannelSource) => boolean) =>
    renderToStaticMarkup(
      createElement(ChannelEditor, {
        channel: user,
        scope: 'user',
        initial: edit,
        onLoad: async () => edit,
        onSave: async () => '',
        onRescan: async () => ({ edit, message: '' }),
        onLoadMore: async (source: ChannelSource) => source,
        ...(canLoad ? { canLoad } : {}),
        onDelete: async () => '',
        onClose: () => {},
      }),
    )

  it('puts Load more on the source line, just before Remove', () => {
    const html = render({ name: 'Alpha', sources: [youtube(dated(3))] })
    expect(html).toMatch(/<button type="button" class="tab editor-source-load"[^>]*>Load more<\/button><button type="button" class="tab editor-source-remove"/)
    expect(html.match(/>Load more</g)).toHaveLength(1)
    expect(html).toContain('>Load all<')
  })

  it('shows it disabled, with the reason, when the source is read to the end', () => {
    const html = render({ name: 'Alpha', sources: [youtube(dated(3), { complete: true, more: undefined })] })
    expect(html).toMatch(/class="tab editor-source-load" disabled=""[^>]*title="The whole source is read"/)
  })

  it('reads an imported list further from the channel it came from', async () => {
    const list: ChannelSource = { id: 's1', kind: 'collection', url: '', label: 'Alpha list', enabled: true, ref: 'Alpha list', videos: dated(2) }
    expect(render({ name: 'Alpha', sources: [list] }, () => true)).toMatch(/class="tab editor-source-load"[^>]*>Load more</)
    expect(render({ name: 'Alpha', sources: [list] }, () => true)).not.toMatch(/class="tab editor-source-load" disabled/)
    const read = await loadMoreSource(list, {
      uploaderOf: (name) => (name === 'Alpha list' ? 'UCaaaa000000000000000009' : null),
      resolveYouTube: async (url) => ({ channelId: url.split('/').pop()!, title: 'Alpha', videos: dated(4), next: 'p2' }),
      resolveBatch: async () => ({ videos: dated(3, 4) }),
    })
    expect(read.kind).toBe('collection')
    expect(read.ref).toBe('Alpha list')
    expect(read.videos?.length).toBeGreaterThan(2)
    await expect(loadMoreSource({ ...list, ref: 'Unknown' }, { resolveYouTube: async () => ({ channelId: '', title: '', videos: [] }), resolveBatch: async () => ({ videos: [] }), uploaderOf: () => null })).rejects.toThrow(/which channel/)
  })
})

describe('GUIDE: LATEST FIRST, a semi-live channel', () => {
  const now = Date.UTC(2026, 9, 4, 18, 0)
  const videos = dated(6)
  const newest = [...videos].sort((a, b) => (a.published! < b.published! ? 1 : -1))

  it('airs the newest programme from its start at the moment it is pressed, then newest to oldest', () => {
    const stored = record([youtube(videos)])
    const order = newest.map((video) => video.id)
    const saved = applyChannelEdit([stored], 1001, { ...editOf(stored), order, orderKind: 'latest', liveFromMs: now }, now)[0]
    expect(saved.liveFromMs).toBe(now)
    expect(editOf(saved).liveFromMs).toBe(now)
    const built = channelsFromSources([saved])
    const channel = built.channels[0]
    expect(channel.liveFromMs).toBe(now)
    expect(channel.phaseOffsetSeconds).toBe(livePhase(now))
    const programmes = built.programmes.get(channel.id)!
    expect(programmes.map((programme) => programme.videoId)).toEqual(order)
    const snap = calculateSchedule({ channelId: channel.id, phaseOffsetSeconds: channel.phaseOffsetSeconds, programmes, epochMs: SCHEDULE_EPOCH_MS, nowMs: now + 1000 })
    expect(snap.current.programme.videoId).toBe(order[0])
    expect(Math.round(snap.current.elapsedSeconds)).toBe(1)
    expect(snap.next.programme.videoId).toBe(order[1])
  })

  it('stays newest first when RESCAN lets newly loaded programmes in, and drops live once another order is chosen', () => {
    const stored = record([youtube(videos)])
    const live = applyChannelEdit([stored], 1001, { ...editOf(stored), order: newest.map((video) => video.id), orderKind: 'latest', liveFromMs: now }, now)[0]
    const fresh = { ...dated(1, 20)[0], published: '2026-12-31' }
    const loaded = holdNew(youtube(videos), youtube([...videos, fresh]))
    const held = applyChannelEdit([live], 1001, { ...editOf(live), sources: [loaded] }, now)[0]
    expect(held.runningOrder).not.toContain(fresh.id)
    const rescanned = applyChannelEdit([held], 1001, { ...editOf(held), sources: admitted([loaded]) }, now)[0]
    expect(rescanned.runningOrder?.[0]).toBe(fresh.id)
    const sorted = applyChannelEdit([rescanned], 1001, { ...editOf(rescanned), orderKind: 'az' }, now)[0]
    expect(sorted.liveFromMs).toBeUndefined()
  })

  it('offers LATEST FIRST, EDIT, RELOAD and DELETE on the selected channel, before its star', () => {
    const guide = read('src/components/Guide.tsx')
    const cell = guide.slice(guide.indexOf('function ChannelCell('), guide.indexOf('/** The slot the watched channel is playing'))
    const at = (marker: string) => cell.indexOf(marker)
    expect(at("'ch-act ch-more")).toBeGreaterThan(0)
    expect(at("'ch-act ch-more")).toBeLessThan(at("'ch-act ch-latest"))
    expect(at("'ch-act ch-latest")).toBeGreaterThan(0)
    expect(at("'ch-act ch-latest")).toBeLessThan(at('title="Edit channel"'))
    expect(at('title="Edit channel"')).toBeLessThan(at('title="Reload: rescan'))
    expect(at('title="Reload: rescan')).toBeLessThan(at("'ch-act ch-extra ch-delete"))
    expect(at("'ch-act ch-extra ch-delete")).toBeLessThan(at("className={favourite ? 'star is-on' : 'star'}"))
    expect(cell).toContain('const all = selected && expanded')
    expect(cell).toContain('const showLatest = onLatest !== undefined && (selected ? all || !favourite : live)')
    expect(cell).toContain('const showStar = selected ? all || favourite || onLatest === undefined : favourite')
    expect(cell).toContain('{all && onEdit ? (')
    expect(cell).toContain('{all && onReload ? (')
    expect(cell).toContain('{all && onDelete ? (')
    expect(cell).toContain('{showStar ? (')
    expect(cell).toContain("title={all ? 'Show one button' : 'Show all buttons'}")
    expect(guide).toContain('expanded={actionsAll}')
    expect(guide).toContain('onExpand={toggleActions}')
    expect(read('src/styles/guide.css')).toContain('  .channel-cell.is-selected .star,\n  .channel-cell .star.is-on { display: block; }')
    expect(cell).toContain('if (!confirming) return setConfirming(true)')
    expect(guide).toContain("onDelete={editorScope(channel) === 'user' ? () => channelAction(channel.number, tv.deleteUserChannel) : undefined}")
    expect(read('src/styles/guide.css')).toContain('  .channel-cell .star { display: none; }\n  .channel-cell .ch-extra { display: none; }')
  })

  it('folds to one button by default and remembers showing all', () => {
    const store = memory()
    expect(loadGuideActionsAll(store)).toBe(false)
    saveGuideActionsAll(true, store)
    expect(loadGuideActionsAll(store)).toBe(true)
    saveGuideActionsAll(false, store)
    expect(loadGuideActionsAll(store)).toBe(false)
  })

  it('LATEST is a switch: on schedules newest first from the very latest now, off brings the schedule back', () => {
    const provider = read('src/state/TvProvider.tsx')
    const latest = provider.slice(provider.indexOf('const latestFirst = useCallback('), provider.indexOf('const reloadChannel = useCallback('))
    expect(latest).toContain("if (opened.orderKind === 'latest' && opened.liveFromMs !== undefined && opened.order?.length) {")
    expect(latest).toContain('const before = takeScheduleBeforeLatest(number)')
    expect(latest).toContain('const current = await rescanChannelEdit(number, opened).then(')
    expect(latest).toContain('const order = latestVideos(pool).map((video) => video.id)')
    expect(latest).toContain('saveScheduleBeforeLatest(number, { order: opened.order, orderKind: opened.orderKind, scheduleSize: opened.scheduleSize })')
    expect(latest).toContain("orderKind: 'latest', liveFromMs: Date.now()")
    expect(latest).not.toContain('playFromGuideRef')
    const guide = read('src/components/Guide.tsx')
    expect(guide).toContain("channelAction(channel.number, tv.latestFirst, () => tv.dispatch({ type: 'cancel' }))")
    expect(guide).toContain('live={channel.liveFromMs !== undefined}')
    expect(guide).toContain('aria-pressed={live}')
  })

  it('remembers the schedule before LATEST once, per channel, and never a latest order', () => {
    const store = memory()
    expect(takeScheduleBeforeLatest(7, store)).toBeNull()
    saveScheduleBeforeLatest(7, { order: ['a', 'b'], orderKind: 'manual', scheduleSize: 2 }, store)
    saveScheduleBeforeLatest(8, {}, store)
    saveScheduleBeforeLatest(9, { order: ['a'], orderKind: 'latest' }, store)
    expect(takeScheduleBeforeLatest(7, store)).toEqual({ order: ['a', 'b'], orderKind: 'manual', scheduleSize: 2 })
    expect(takeScheduleBeforeLatest(7, store)).toBeNull()
    expect(takeScheduleBeforeLatest(8, store)).toEqual({})
    expect(takeScheduleBeforeLatest(9, store)).toEqual({})
  })

  it('RELOAD rescans and schedules the channel again; only an order arranged by hand is kept', () => {
    const provider = read('src/state/TvProvider.tsx')
    const reload = provider.slice(provider.indexOf('const reloadChannel = useCallback('), provider.indexOf('const loadMoreChannelSource = useCallback('))
    expect(reload).toContain('const result = await rescanChannelEdit(number, current)')
    expect(reload).toContain("if (kind === 'manual' || pool.length === 0) {")
    expect(reload).toContain("const orderKind: OrderKind = kind === 'az' || kind === 'random' ? kind : 'rebuilt'")
    expect(reload).toContain('liveFromMs: undefined')
    expect(reload).toContain("if (kind === 'latest' && next.liveFromMs !== undefined) {")
    expect(reload).toContain('replayIfWatching(number)')
    expect(read('src/components/Guide.tsx')).toContain('title="Reload: rescan the channel and schedule it again"')
  })

  it('picks the newest programme as scheduled, builds it when the schedule leaves it out, and falls back to the newest dated', () => {
    const built = channelsFromSources([record([youtube(videos)])])
    const channel = built.channels[0]
    const scheduled = built.programmes.get(channel.id)!
    const build = (video: ImportedVideo) => poolProgramme(video, channel.id, channel.name)
    const picked = newestProgramme(videos, scheduled, build)!
    expect(picked.videoId).toBe(newest[0].id)
    expect(picked.id.endsWith('-r')).toBe(false)
    expect(scheduled).toContain(picked)
    const fresh = { ...dated(1, 30)[0], published: '2026-12-31' }
    const off = newestProgramme([...videos, fresh], scheduled, build)!
    expect(off.videoId).toBe(fresh.id)
    expect(off.id).toBe(`${channel.id}-latest-${fresh.id}`)
    expect(off.thumbnail).toBe(`https://i.ytimg.com/vi/${fresh.id}/hqdefault.jpg`)
    expect(off.publishedAt).toBe('2026-12-31')
    const fallback = newestProgramme([], scheduled, build)!
    expect(fallback.videoId).toBe(newest[0].id)
    expect(newestProgramme([], scheduled.map(({ publishedAt: _day, ...programme }) => programme), build)).toBeNull()
  })
})

describe('TV SURF: wait for the programme to end (an option, off by default)', () => {
  it('is off until the viewer chooses it, and remembered', () => {
    const store = memory()
    expect(loadSurfUntilEnd(store)).toBe(false)
    saveSurfUntilEnd(true, store)
    expect(loadSurfUntilEnd(store)).toBe(true)
  })

  it('waits until the programme ends, a moment more; an end out of reach keeps the random wait', () => {
    expect(surfUntilEndMs(1_000_000 + 120_000, 1_000_000)).toBe(120_800)
    expect(surfUntilEndMs(1_000_000 + 200, 1_000_000)).toBe(1500)
    expect(surfUntilEndMs(1_000_000 + SURF_END_LIMIT_MS + 1, 1_000_000)).toBeNull()
    const provider = read('src/state/TvProvider.tsx')
    expect(provider).toContain('const untilEnd = watching ? surfUntilEndMs(onScreen(watching, now).current.endMs, now) : null')
    expect(provider).toContain('}, untilEnd ?? surfDelayMs(surfRange))')
    expect(read('src/components/GuideOptions.tsx')).toContain('<Row label="Wait for the end">')
    expect(read('src/components/TouchRemote.tsx')).toContain('Wait for the end')
  })
})
