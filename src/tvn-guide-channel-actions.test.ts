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
import { channelsFromSources, livePhase, type ImportedVideo, type StoredSource } from './services/channels-import.ts'
import { loadSurfUntilEnd, saveSurfUntilEnd, SURF_END_LIMIT_MS, surfUntilEndMs } from './state/surf.ts'
import type { Channel } from './types/channel.ts'
import { loadGuideActionsAll, saveGuideActionsAll } from './view/guide-actions-store.ts'

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

  it('the provider reads the sources again and plays the newest now on every press, and RELOAD keeps the kind of order', () => {
    const provider = read('src/state/TvProvider.tsx')
    const latest = provider.slice(provider.indexOf('const latestFirst = useCallback('), provider.indexOf('const reloadChannel = useCallback('))
    expect(latest).toContain('const current = await rescanChannelEdit(number, opened).then(')
    expect(latest).toContain('() => opened,')
    expect(latest).toContain("await saveChannelEdit(number, { ...current, order, orderKind: 'latest', liveFromMs: Date.now(), scheduleSize: undefined })")
    expect(latest).toContain('replayIfWatching(number)')
    expect(latest).not.toContain('LATEST FIRST OFF')
    expect(read('src/components/Guide.tsx')).toContain("channelAction(channel.number, tv.latestFirst, () => tv.dispatch({ type: 'cancel' }))")
    expect(provider).toContain('const result = await rescanChannelEdit(number, current)')
    expect(provider).toContain("kind === 'latest' ? latestVideos(pool) : kind === 'az' ? alphabeticalVideos(pool)")
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
