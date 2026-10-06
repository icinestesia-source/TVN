import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screenFace } from './app/screen-face.ts'
import { ChannelEditor } from './components/ChannelEditor.tsx'
import { GuideActions } from './components/GuideAdd.tsx'
import { InfoActions } from './components/InfoActions.tsx'
import { padProps } from './info-pad.fixture.ts'
import { channelByNumber, channels, programmesFor, shippedChannel, shippedProgrammes } from './data/catalogue.ts'
import { installCuratedEdits, installUserCatalogue } from './data/user-overlay.ts'
import { commandFromGamepad } from './input/gamepad.ts'
import { commandFromKey } from './input/keyboard.ts'
import { playbackCommand } from './player/command.ts'
import { routedPlayer, routeFor, type LocalPlayerHandle } from './player/routed.ts'
import type { PlayerHandle, PlayerLoadRequest } from './player/types.ts'
import { isOnAir } from './network/airing.ts'
import { liveKey } from './scheduler/calculate.ts'
import { broadcast, guideSlots } from './services/broadcast.ts'
import { applyChannelEdit, editOf, rescanChannel, sourcesOf, type ChannelEdit, type RescanDeps } from './services/channel-editor.ts'
import { classifySourceUrl, inventoryOf, newSource, sourceStatusText, type ChannelSource } from './services/channel-sources.ts'
import { channelsFromSources, type ImportedVideo, type StoredSource } from './services/channels-import.ts'
import { buildCuratedEdit, clearCuratedEdit, CURATED_EDITS_KEY, curatedEditOf, loadCuratedEdit, loadCuratedEdits, saveCuratedEdit } from './services/curated-edits.ts'
import { addChannelSource, removeUserChannels } from './services/user-network.ts'
import { SESSION_CHANNEL_NUMBER } from './session/session-channel.ts'
import type { Channel } from './types/channel.ts'
import { createLongPress, editorScope, LONG_PRESS_MS } from './view/channel-edit.ts'

const T0 = Date.UTC(2026, 8, 30, 12, 0, 0)
const HOUR = 3_600_000
const plain = { meta: false, ctrl: false, alt: false }
const guide = readFileSync('src/components/Guide.tsx', 'utf8')
const provider = readFileSync('src/state/TvProvider.tsx', 'utf8')
const localStage = readFileSync('src/player/LocalStage.tsx', 'utf8')

function videos(prefix: string, count: number, from = 0): ImportedVideo[] {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}${String(from + index).padStart(11 - prefix.length, '0')}`, title: `${prefix} ${from + index + 1}`, durationSec: 900 + index * 60 }))
}

function added(channelId: string, name: string, number: number, list = videos(channelId.slice(2, 6), 6)): StoredSource {
  return { id: `yt:${channelId}`, name, videos: list, channelNumber: number, inLibrary: false, automatic: true, updatedAt: 1 }
}

const A = 'UCaaaa000000000000000001'
const B = 'UCbbbb000000000000000002'
const C = 'UCcccc000000000000000003'
const network = () => [added(A, 'Alpha', 1001), added(B, 'Bravo', 1002), added(C, 'Charlie', 1003)]

function install(sources: readonly StoredSource[]) {
  const built = channelsFromSources(sources)
  installUserCatalogue(built.channels, built.programmes)
  return built
}

/** A lookup that answers per address and records what it was asked, so a rescan's reach can be measured. */
function lookups(answers: Record<string, { channelId: string; title: string; videos: ImportedVideo[] }>) {
  const asked: string[] = []
  const probed: string[] = []
  const deps: RescanDeps = {
    async resolveYouTube(url) {
      asked.push(url)
      const answer = answers[url]
      if (!answer) throw new Error('YouTube did not answer')
      return answer
    },
    async probeStream(source) {
      probed.push(source.url)
      return source.url.includes('dead') ? 'unavailable' : 'online'
    },
  }
  return { deps, asked, probed }
}

function withEdit(all: readonly StoredSource[], number: number, change: (edit: ChannelEdit) => ChannelEdit) {
  const record = all.find((item) => item.channelNumber === number)!
  return applyChannelEdit(all, number, change(editOf(record)), 5)
}

/** IndexedDB stores a structured clone; a reload reads back exactly that. */
const reload = <T,>(value: T): T => structuredClone(value)

afterEach(() => {
  installUserCatalogue([], new Map())
  installCuratedEdits([], new Map())
  vi.useRealTimers()
})

describe('opening the Channel Editor from the Guide', () => {
  it('right-click on a 1001+ channel opens its editor', () => {
    install(network())
    expect(editorScope(channelByNumber(1002)!)).toBe('user')
    expect(guide).toMatch(/onContextMenu=\{\(event: MouseEvent<HTMLButtonElement>\) => \{\s*if \(!onEdit\) return\s*event\.preventDefault\(\)\s*press\.opened\(\)\s*onEdit\(\)/)
    expect(guide).toContain("tv.dispatch({ type: 'guide-tool', tool: 'edit', channelNumber: channel.number })")
    expect(guide).toContain("tool === 'edit' && focusedChannel && editScope ? (")
    expect(provider).toContain("if (!guideOpenRef.current || !target || !editorScope(target)) return")
  })

  it('a deliberate long press opens it, and the lift that follows does not tune', () => {
    vi.useFakeTimers()
    const opened = vi.fn()
    const press = createLongPress(opened)
    press.down({ pointerType: 'touch', clientX: 10, clientY: 10 })
    vi.advanceTimersByTime(LONG_PRESS_MS - 1)
    expect(opened).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(opened).toHaveBeenCalledTimes(1)
    expect(press.swallowClick()).toBe(true)
    expect(press.swallowClick()).toBe(false)
  })

  it('a tap, a scroll, a mouse press or a right-click leaves the next click to tune', () => {
    vi.useFakeTimers()
    const opened = vi.fn()
    const press = createLongPress(opened)
    press.down({ pointerType: 'touch', clientX: 0, clientY: 0 })
    press.up()
    vi.advanceTimersByTime(2000)
    expect(press.swallowClick()).toBe(false)
    press.down({ pointerType: 'touch', clientX: 0, clientY: 0 })
    press.move({ pointerType: 'touch', clientX: 0, clientY: 40 })
    vi.advanceTimersByTime(2000)
    press.down({ pointerType: 'mouse', clientX: 0, clientY: 0 })
    vi.advanceTimersByTime(2000)
    press.opened()
    expect(opened).not.toHaveBeenCalled()
    expect(press.swallowClick()).toBe(false)
    expect(guide).toContain('if (!press.swallowClick()) onTune()')
    expect(guide).toContain("onPointerDown={(event) => (onEdit ? press.down(point(event)) : undefined)}")
  })

  it('keyboard, remote and gamepad reach it without a permanent Edit button', () => {
    expect(commandFromKey('e', plain, true)).toEqual({ type: 'guide-tool', tool: 'edit' })
    expect(commandFromKey('ContextMenu', plain, true)).toEqual({ type: 'guide-tool', tool: 'edit' })
    expect(commandFromKey('e', plain, false)).toEqual({ type: 'guide-tool', tool: 'edit' })
    expect(commandFromKey('Enter', plain, true)).toEqual({ type: 'confirm' })
    const pad = { buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: index === 3 })), axes: [0, 0] }
    expect(commandFromGamepad(pad, new Set(), true).command).toEqual({ type: 'guide-tool', tool: 'edit' })
    expect(commandFromGamepad(pad, new Set(), false).command).toBeNull()
    const actions = renderToStaticMarkup(createElement(GuideActions, { tool: null, picked: false, onNow: () => {}, onTool: () => {} }))
    expect(actions).not.toMatch(/>Edit</)
    const info = readFileSync('src/components/InfoActions.tsx', 'utf8')
    expect(info).not.toContain('to edit')
    expect(info).not.toContain('Remove channel')
  })

  it('inside the editor, Enter never tunes and Escape returns to the Guide', () => {
    expect(provider).toContain('if (guideOpenRef.current && editingRef.current()) break')
    expect(provider).toContain('else if (guideOpenRef.current && (editingRef.current() || panelOpenRef.current())) closeGuideTool()')
  })
})

describe('the editor', () => {
  const edit: ChannelEdit = {
    name: 'Alpha',
    sources: [
      { id: 's1', kind: 'youtube', url: 'https://www.youtube.com/channel/UCaaaa000000000000000001', label: 'Alpha', enabled: true, ref: A, videos: videos('aaaa', 127), status: { state: 'ready', playable: 127, checkedAt: 1 } },
      { id: 's2', kind: 'audio', url: 'https://radio.example.com/live', label: 'radio.example.com', enabled: true, status: { state: 'online', checkedAt: 1 } },
      { id: 's3', kind: 'video-hls', url: 'https://tv.example.com/dead.m3u8', label: '', enabled: false, status: { state: 'unavailable', checkedAt: 1 } },
    ],
  }
  const render = (scope: 'user' | 'curated') =>
    renderToStaticMarkup(
      createElement(ChannelEditor, {
        channel: { ...channels[0], number: scope === 'user' ? 1001 : 42 } as Channel,
        scope,
        initial: edit,
        onLoad: async () => edit,
        onSave: async () => '',
        onRescan: async () => ({ edit, message: '' }),
        onDelete: async () => '',
        onClose: () => {},
      }),
    )

  it('shows the name, each source with a short status, Add source, Rescan and Save', () => {
    const html = render('user')
    expect(html).toContain('value="Alpha"')
    expect(html).toContain('YouTube uploader · 127 playable')
    expect(html).toContain('Live audio · online')
    expect(html).toContain('Disabled')
    expect(html).toContain('+ Add source')
    expect(html).toContain('Rescan channel')
    expect(html).toContain('>Save<')
    expect(html).not.toMatch(/Error|stack|HTTP \d/)
  })

  it('offers Delete for a user channel and Restore for a TVN channel, apart from Rescan and behind a confirmation', () => {
    const user = render('user')
    const danger = user.slice(user.indexOf('editor-danger'))
    expect(danger).toContain('Delete channel…')
    expect(user.indexOf('editor-actions')).toBeLessThan(user.indexOf('editor-danger'))
    expect(user.slice(user.indexOf('editor-actions'), user.indexOf('editor-actions-help'))).not.toContain('Delete')
    expect(user).not.toContain('Yes, delete')
    const curated = render('curated')
    expect(curated).not.toContain('Delete channel')
    expect(curated).toContain('Restore TVN original…')
    expect(curated).toContain('kept in this browser and in your complete export')
    expect(curated.slice(curated.indexOf('editor-actions'), curated.indexOf('editor-actions-help'))).not.toContain('Restore')
  })

  it('states failures in plain words', () => {
    const at = { checkedAt: 1 }
    const yt: ChannelSource = { id: 's', kind: 'youtube', url: 'https://www.youtube.com/@x', label: '', enabled: true }
    expect(sourceStatusText({ ...yt, status: { state: 'failed', ...at } })).toBe('Resolution failed')
    expect(sourceStatusText({ ...yt, url: 'https://www.youtube.com/playlist?list=PLabcdefghij12' })).toBe('YouTube playlist · not scanned yet')
    expect(sourceStatusText({ ...yt, kind: 'audio-hls', status: { state: 'online', ...at } })).toBe('HLS audio · verified')
    expect(sourceStatusText({ ...yt, kind: 'video-hls', status: { state: 'online', ...at } })).toBe('HLS stream · verified')
    expect(sourceStatusText({ ...yt, kind: 'audio', status: { state: 'unavailable', ...at } })).toBe('Unavailable')
  })
})

describe('editing one user channel', () => {
  it('a rename persists through a save and a reload', () => {
    const saved = reload(withEdit(network(), 1002, (edit) => ({ ...edit, name: '  Bravo   Classics ' })))
    expect(saved.find((item) => item.channelNumber === 1002)!.name).toBe('Bravo Classics')
    install(saved)
    expect(channelByNumber(1002)!.name).toBe('Bravo Classics')
    expect(editOf(saved.find((item) => item.channelNumber === 1002)!).name).toBe('Bravo Classics')
  })

  it('an added source persists', () => {
    const saved = reload(withEdit(network(), 1001, (edit) => ({ ...edit, sources: [...edit.sources, newSource(edit.sources, 'https://www.youtube.com/@AlphaTwo')] })))
    const sources = sourcesOf(saved.find((item) => item.channelNumber === 1001)!)
    expect(sources.map((source) => [source.id, source.kind, source.url])).toEqual([
      ['s1', 'youtube', `https://www.youtube.com/channel/${A}`],
      ['s2', 'youtube', 'https://www.youtube.com/@AlphaTwo'],
    ])
    expect(() => newSource(sources, 'https://www.youtube.com/@AlphaTwo')).toThrow('already on this channel')
  })

  it('a disabled source persists, drops out of the schedule, and comes back when re-enabled', () => {
    const two = withEdit(network(), 1001, (edit) => ({
      ...edit,
      sources: [...edit.sources, { ...newSource(edit.sources, 'https://www.youtube.com/@AlphaTwo'), videos: videos('two', 4), status: { state: 'ready', checkedAt: 2 } }],
    }))
    const off = reload(withEdit(two, 1001, (edit) => ({ ...edit, sources: edit.sources.map((source) => (source.id === 's1' ? { ...source, enabled: false } : source)) })))
    const record = off.find((item) => item.channelNumber === 1001)!
    expect(record.channelSources!.find((source) => source.id === 's1')!.enabled).toBe(false)
    expect(record.channelSources!.find((source) => source.id === 's1')!.videos).toHaveLength(6)
    const scheduled = (list: readonly StoredSource[]) => (channelsFromSources(list).programmes.get(`user-yt:${A}`) ?? []).map((item) => item.videoId)
    expect(scheduled(off).every((id) => id!.startsWith('two'))).toBe(true)
    const on = withEdit(off, 1001, (edit) => ({ ...edit, sources: edit.sources.map((source) => ({ ...source, enabled: true })) }))
    expect(new Set(scheduled(on))).toEqual(new Set([...videos(A.slice(2, 6), 6), ...videos('two', 4)].map((video) => video.id)))
  })

  it('a removed source is gone, and a channel with nothing enabled stays listed with a plain holding card', () => {
    const empty = withEdit(network(), 1003, (edit) => ({ ...edit, sources: [] }))
    expect(empty.find((item) => item.channelNumber === 1003)!.channelSources).toEqual([])
    install(empty)
    const channel = channelByNumber(1003)!
    const now = broadcast(channel, T0).current.programme
    expect(now.videoId).toBeNull()
    expect(now.caption).toBe('NO PROGRAMMES · EDIT THIS CHANNEL IN NETWORK')
  })

  it('opening and saving without a change keeps the schedule exactly as it was', () => {
    const before = channelsFromSources(network()).programmes.get(`user-yt:${B}`)
    const after = channelsFromSources(withEdit(network(), 1002, (edit) => edit)).programmes.get(`user-yt:${B}`)
    expect(after).toEqual(before)
  })

  it('adding the same link again refreshes that source only and keeps the viewer’s name and other sources', () => {
    const edited = withEdit(network(), 1001, (edit) => ({
      name: 'My Alpha',
      sources: [...edit.sources, { ...newSource(edit.sources, 'https://radio.example.com/a.mp3'), status: { state: 'online', checkedAt: 1 } }],
    }))
    const again = addChannelSource(edited, { channelId: A, title: 'Alpha', videos: videos('new', 3) }, 9)
    const record = again.sources.find((item) => item.channelNumber === 1001)!
    expect(record.name).toBe('My Alpha')
    expect(record.channelSources!.map((source) => source.kind)).toEqual(['youtube', 'audio'])
    expect(record.channelSources![0].videos!.map((video) => video.id)).toEqual(videos('new', 3).map((video) => video.id))
  })
})

describe('RESCAN CHANNEL', () => {
  const answers = {
    [`https://www.youtube.com/channel/${A}`]: { channelId: A, title: 'Alpha', videos: videos('afresh', 8) },
    'https://www.youtube.com/@AlphaTwo': { channelId: 'UCaaaa000000000000000009', title: 'Alpha Two', videos: videos('atwo', 5) },
    [`https://www.youtube.com/channel/${B}`]: { channelId: B, title: 'Bravo', videos: videos('bfresh', 8) },
  }

  it('re-resolves only the chosen channel’s enabled sources and leaves every other channel exactly as it was', async () => {
    const all = withEdit(network(), 1001, (edit) => ({ ...edit, sources: [...edit.sources, newSource(edit.sources, 'https://www.youtube.com/@AlphaTwo')] }))
    const { deps, asked } = lookups(answers)
    const before = channelsFromSources(all)
    const result = await rescanChannel(all, 1001, editOf(all[0]), deps, 10)
    expect(asked.sort()).toEqual([`https://www.youtube.com/channel/${A}`, 'https://www.youtube.com/@AlphaTwo'].sort())
    expect(result.all[1]).toBe(all[1])
    expect(result.all[2]).toBe(all[2])
    expect(JSON.stringify(result.all.slice(1))).toBe(JSON.stringify(all.slice(1)))
    const after = channelsFromSources(result.all)
    for (const id of [`user-yt:${B}`, `user-yt:${C}`]) expect(after.programmes.get(id)).toEqual(before.programmes.get(id))
    expect(inventoryOf(result.edit.sources).map((video) => video.id)).toEqual([...videos('afresh', 8), ...videos('atwo', 5)].map((video) => video.id))
    expect(result.message).toBe('RESCANNED · 13 PROGRAMMES')
  })

  it('neighbouring schedules are unchanged on the air and in the Guide', async () => {
    install(network())
    const neighbour = channelByNumber(1002)!
    const slotsBefore = guideSlots(neighbour, T0, T0 + 6 * HOUR)
    const nowBefore = broadcast(neighbour, T0 + HOUR)
    const result = await rescanChannel(network(), 1001, editOf(network()[0]), lookups(answers).deps, 10)
    install(result.all)
    expect(guideSlots(channelByNumber(1002)!, T0, T0 + 6 * HOUR)).toEqual(slotsBefore)
    expect(broadcast(channelByNumber(1002)!, T0 + HOUR)).toEqual(nowBefore)
    expect(channelByNumber(1001)!.description).toContain('8 programmes')
  })

  it('a disabled source takes no part in the rescan', async () => {
    const all = withEdit(network(), 1001, (edit) => ({
      ...edit,
      sources: [{ ...edit.sources[0], enabled: false }, newSource(edit.sources, 'https://www.youtube.com/@AlphaTwo')],
    }))
    const { deps, asked } = lookups(answers)
    const result = await rescanChannel(all, 1001, editOf(all[0]), deps, 10)
    expect(asked).toEqual(['https://www.youtube.com/@AlphaTwo'])
    expect(result.edit.sources[0]).toEqual(editOf(all[0]).sources[0])
    expect(inventoryOf(result.edit.sources).every((video) => video.id.startsWith('atwo'))).toBe(true)
  })

  it('a source that fails keeps its programmes and says so plainly', async () => {
    const all = network()
    const result = await rescanChannel(all, 1003, editOf(all[2]), lookups({}).deps, 10)
    expect(result.edit.sources[0].status?.state).toBe('failed')
    expect(result.edit.sources[0].videos).toHaveLength(6)
    expect(result.all[2].videos).toHaveLength(6)
    expect(result.message).toBe('RESCANNED · 6 PROGRAMMES · 1 SOURCE FAILED')
  })

  it('keeps each YouTube source to its own uploader', async () => {
    const all = network()
    const result = await rescanChannel(all, 1002, editOf(all[1]), lookups(answers).deps, 10)
    const ids = result.all[1].videos.map((video) => video.id)
    expect(ids.every((id) => id.startsWith('bfresh'))).toBe(true)
    expect(result.all[0].videos.some((video) => video.id.startsWith('bfresh'))).toBe(false)
  })

  it('refuses a channel that is not in the User Network', async () => {
    await expect(rescanChannel(network(), 42, { name: 'x', sources: [] }, lookups({}).deps, 10)).rejects.toThrow('no longer in your User Network')
    expect(() => applyChannelEdit(network(), 1, { name: 'x', sources: [] }, 1)).toThrow('no longer in your User Network')
  })
})

describe('direct audio and live streams', () => {
  const radio = () =>
    withEdit(network(), 1002, (edit) => ({ ...edit, name: 'Bravo Radio', sources: [...edit.sources, newSource(edit.sources, 'https://radio.example.com/stream.mp3')] }))

  it('reads stream addresses as the right kind of source', () => {
    expect(classifySourceUrl('https://radio.example.com/stream.mp3').kind).toBe('audio')
    expect(classifySourceUrl('https://icecast.example.com:8000/live').kind).toBe('audio')
    expect(classifySourceUrl('https://radio.example.com/hls/radio.m3u8').kind).toBe('audio-hls')
    expect(classifySourceUrl('https://tv.example.com/channel/index.m3u8').kind).toBe('video-hls')
    expect(classifySourceUrl('https://cdn.example.com/film.mp4').kind).toBe('video')
    expect(classifySourceUrl('https://tv.example.com/x.m3u8', 'audio-hls').kind).toBe('audio-hls')
    expect(classifySourceUrl('youtu.be/Bu9SOZwn2Oo').kind).toBe('youtube')
    expect(() => classifySourceUrl('https://radio.example.com/listen.pls')).toThrow('inside that playlist file')
    expect(() => classifySourceUrl('ftp://radio.example.com/a.mp3')).toThrow()
    expect(() => classifySourceUrl('https://example.com/x', 'youtube')).toThrow('not a YouTube address')
  })

  it('makes a live audio channel that plays in the browser’s own media element', async () => {
    const { deps, probed } = lookups({ [`https://www.youtube.com/channel/${B}`]: { channelId: B, title: 'Bravo', videos: videos('b', 3) } })
    const result = await rescanChannel(radio(), 1002, editOf(radio()[1]), deps, 20)
    expect(probed).toEqual(['https://radio.example.com/stream.mp3'])
    expect(sourceStatusText(result.edit.sources[1])).toBe('Live audio · online')
    expect(result.message).toBe('RESCANNED · LIVE AUDIO · ONLINE')
    install(result.all)
    const channel = channelByNumber(1002)!
    expect(channel).toMatchObject({ name: 'Bravo Radio', playbackType: 'live-stream', mediaKind: 'audio' })
    const snap = broadcast(channel, T0)
    const command = playbackCommand(snap.current.programme, snap.current.seekSeconds, null)
    expect(command).toMatchObject({ videoId: null, streamUrl: 'https://radio.example.com/stream.mp3', hls: false, live: true, startSeconds: 0 })
    expect(routeFor(command)).toBe('local')
    expect(screenFace(channel, snap.current.programme, 'playing')).toBe('radio')
  })

  it('needs no invented schedule: one airing with no duration and no end, joined once', () => {
    install(radio())
    const channel = channelByNumber(1002)!
    const now = broadcast(channel, T0)
    const later = broadcast(channel, T0 + 5 * HOUR)
    expect(now.current.programme).toMatchObject({ durationSeconds: 0, videoId: null, playback: 'live', liveStream: { url: 'https://radio.example.com/stream.mp3', format: 'direct' } })
    expect(now.current.endMs).toBe(Number.POSITIVE_INFINITY)
    expect(liveKey(channel.id, later.current.programme.id, later.current.startMs)).toBe(liveKey(channel.id, now.current.programme.id, now.current.startMs))
    expect(guideSlots(channel, T0, T0 + 3 * HOUR)).toEqual([{ programme: now.current.programme, index: 0, startMs: T0, endMs: T0 + 3 * HOUR }])
  })

  it('leaving a stream stops and releases it; returning loads it again', async () => {
    const calls: string[] = []
    const handle = (name: string): LocalPlayerHandle => ({
      load: async (request: PlayerLoadRequest) => {
        calls.push(`${name}.load:${request.streamUrl ?? request.videoId ?? 'silence'}`)
        return 'playing'
      },
      stop: () => calls.push(`${name}.stop`),
      play: () => {},
      pause: () => {},
      seek: () => {},
      setAudible: () => {},
      currentTime: () => 0,
      actualVideoId: () => null,
    })
    const local = handle('local')
    const youtube: PlayerHandle = handle('youtube')
    const player = routedPlayer(() => youtube, () => local, () => {})
    const stream = { videoId: null, streamUrl: 'https://radio.example.com/stream.mp3', live: true, startSeconds: 0, loop: false }
    await player.load(stream)
    await player.load({ videoId: 'Bu9SOZwn2Oo', startSeconds: 30, loop: false })
    await player.load(stream)
    expect(calls).toEqual([
      'youtube.load:silence',
      'local.load:https://radio.example.com/stream.mp3',
      'local.stop',
      'youtube.load:Bu9SOZwn2Oo',
      'youtube.load:silence',
      'local.load:https://radio.example.com/stream.mp3',
    ])
    expect(localStage).toContain('video.removeAttribute(\'src\')')
  })

  it('a stream that fails, drops or cannot play here shows TVN’s unavailable card', () => {
    install(radio())
    const channel = channelByNumber(1002)!
    const programme = broadcast(channel, T0).current.programme
    expect(screenFace(channel, programme, 'error')).toBe('card')
    expect(localStage).toContain("fail(id, 'stream format unsupported')")
    expect(localStage).toContain("fail(requestId.current, 'stream ended')")
    expect(readFileSync('src/components/TestCard.tsx', 'utf8')).toContain('LIVE STREAM CURRENTLY UNAVAILABLE')
  })

  it('a live stream is single-view only, like the session channel', () => {
    expect(provider).toContain("(target.origin === 'session' || isLiveStreamChannel(target)) && multiviewRef.current !== '1'")
    expect(provider).toContain("item.origin !== 'session' && !isLiveStreamChannel(item)")
  })
})

describe('DELETE CHANNEL', () => {
  it('removes only the chosen user channel; its neighbours keep their numbers and content', () => {
    const all = network()
    const left = removeUserChannels(all, [1002])
    expect(left.map((item) => item.channelNumber)).toEqual([1001, 1003])
    expect(left).toEqual([all[0], all[2]])
    install(left)
    expect(channelByNumber(1002)).toBeUndefined()
    expect(channelByNumber(1003)!.name).toBe('Charlie')
    expect(provider).toContain("if (scopeOf(number).scope !== 'user') throw new Error('Only your own channels can be deleted')")
  })
})

describe('editing curated 001–999 channels', () => {
  const memoryStore = () => {
    const memory = new Map<string, string>()
    return { memory, store: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value) } }
  }
  const layOver = (store: ReturnType<typeof memoryStore>['store']) => {
    const built: Channel[] = []
    const programmes = new Map()
    for (const edit of Object.values(loadCuratedEdits(store))) {
      const made = buildCuratedEdit(shippedChannel(edit.channelNumber)!, edit)
      built.push(made.channel)
      if (made.programmes) programmes.set(made.channel.id, made.programmes)
    }
    installCuratedEdits(built, programmes)
  }

  it('every curated channel opens the editor; 1000 never does and 000 opens the TVN settings', () => {
    install(network())
    expect(editorScope(channelByNumber(1)!)).toBe('curated')
    expect(editorScope(channelByNumber(42)!)).toBe('curated')
    expect(editorScope(channelByNumber(SESSION_CHANNEL_NUMBER)!)).toBeNull()
    expect(editorScope({ number: 1000, origin: 'user-import' })).toBeNull()
    expect(editorScope(channelByNumber(0)!)).toBe('tvn')
    expect(editorScope({ number: 0, origin: 'default' })).toBeNull()
    expect(() => applyChannelEdit(network(), 1, { name: 'Taken over', sources: [] }, 1)).toThrow()
  })

  it('opens as shipped, with TVN programming as a source that can be switched off but not removed', () => {
    const shipped = shippedChannel(2)!
    const edit = curatedEditOf(shipped, null)
    expect(edit.name).toBe(shipped.name)
    expect(edit.sources.map((source) => source.kind)).toEqual(['tvn'])
    expect(sourceStatusText(edit.sources[0], edit.sources)).toBe('TVN programming · on air')
    const html = renderToStaticMarkup(
      createElement(ChannelEditor, { channel: shipped, scope: 'curated', initial: edit, onLoad: async () => edit, onSave: async () => '', onRescan: async () => ({ edit, message: '' }), onDelete: async () => '', onClose: () => {} }),
    )
    expect(html).toContain('TVN programming')
    expect(html).not.toContain('Remove source TVN programming')
  })

  it('a rename is kept in this browser and survives a reload; the schedule is unchanged', () => {
    const { memory, store } = memoryStore()
    const shipped = shippedChannel(2)!
    const before = broadcast(channelByNumber(2)!, T0).current.programme.id
    saveCuratedEdit(shipped, { ...curatedEditOf(shipped, null), name: '  My   Two ' }, 5, store)
    const reloaded = memoryStore()
    for (const [key, value] of memory) reloaded.store.setItem(key, value)
    layOver(reloaded.store)
    expect(channelByNumber(2)!.name).toBe('My Two')
    expect(channelByNumber(2)!.customLineup).toBeUndefined()
    expect(broadcast(channelByNumber(2)!, T0).current.programme.id).toBe(before)
    expect([...memory.keys()]).toEqual([CURATED_EDITS_KEY])
  })

  it('added sources join only that channel, alongside its own programming; its neighbours and the shipped catalogue are untouched', async () => {
    const { store } = memoryStore()
    const shipped = shippedChannel(5)!
    const neighbours = [4, 6].map((number) => structuredClone(channelByNumber(number)))
    const withSource = { ...curatedEditOf(shipped, null), sources: [...curatedEditOf(shipped, null).sources, newSource([], `https://www.youtube.com/channel/${A}`)] }
    const scan = lookups({ [`https://www.youtube.com/channel/${A}`]: { channelId: A, title: 'Alpha', videos: videos('aaaa', 9) } })
    const result = await rescanChannel([added(A, 'Alpha', 1001)], 1001, withSource, scan.deps, 7)
    expect(scan.asked).toEqual([`https://www.youtube.com/channel/${A}`])
    saveCuratedEdit(shipped, result.edit, 7, store)
    layOver(store)
    const edited = channelByNumber(5)!
    expect(edited.customLineup).toBe(true)
    expect(isOnAir(edited)).toBe(true)
    expect(edited.id).toBe(shipped.id)
    const playing = new Set(programmesFor(edited.id).map((programme) => programme.videoId))
    for (const video of videos('aaaa', 9)) expect(playing.has(video.id)).toBe(true)
    for (const programme of shippedProgrammes(shipped.id)) if (programme.videoId) expect(playing.has(programme.videoId)).toBe(true)
    expect(broadcast(edited, T0).current.programme.videoId).toBeTruthy()
    expect(sourceStatusText(result.edit.sources[0], result.edit.sources)).toBe('TVN programming · with your added sources')
    expect([4, 6].map((number) => channelByNumber(number))).toEqual(neighbours)
    expect(shippedChannel(5)).toBe(shipped)
  })

  it('switching TVN programming off with nothing else leaves a holding card, and Restore brings the channel back', () => {
    const { store } = memoryStore()
    const shipped = shippedChannel(3)!
    saveCuratedEdit(shipped, { name: shipped.name, sources: [{ ...curatedEditOf(shipped, null).sources[0], enabled: false }] }, 1, store)
    layOver(store)
    expect(broadcast(channelByNumber(3)!, T0).current.programme.caption).toBe('NO PROGRAMMES · EDIT THIS CHANNEL IN NETWORK')
    clearCuratedEdit(3, store)
    layOver(store)
    expect(channelByNumber(3)).toBe(shipped)
    expect(loadCuratedEdit(3, store)).toBeNull()
  })

  it('saving a channel back to exactly as shipped drops its record; other channels keep theirs', () => {
    const { store } = memoryStore()
    saveCuratedEdit(shippedChannel(2)!, { name: 'Channel Two', sources: [] }, 1, store)
    saveCuratedEdit(shippedChannel(3)!, { name: 'Channel Three', sources: [] }, 2, store)
    expect(saveCuratedEdit(shippedChannel(2)!, curatedEditOf(shippedChannel(2)!, null), 3, store)).toBeNull()
    expect(Object.keys(loadCuratedEdits(store))).toEqual(['3'])
    expect(loadCuratedEdit(3, store)!.sources.map((source) => source.kind)).toEqual(['tvn'])
    expect(() => saveCuratedEdit({ number: 1001, name: 'x' }, { name: 'x', sources: [] }, 1, store)).toThrow('001–999')
  })

  it('edits never reach 000 or 1000', async () => {
    install(network())
    const session = channelByNumber(SESSION_CHANNEL_NUMBER)!
    const result = await rescanChannel(network(), 1001, editOf(network()[0]), lookups({}).deps, 10)
    install(withEdit(result.all, 1002, (edit) => ({ ...edit, name: 'Renamed' })))
    expect(channelByNumber(SESSION_CHANNEL_NUMBER)).toBe(session)
    expect(channelByNumber(1000)?.origin).toBe('session')
    expect(channelByNumber(1)!.origin).not.toBe('user-import')
  })
})

describe('existing Guide interactions', () => {
  it('keeps NOW, ADD, MEDIA, SEARCH, programme selection and the ADD CHANNEL row', () => {
    const actions = renderToStaticMarkup(createElement(GuideActions, { tool: null, picked: false, onNow: () => {}, onTool: () => {} }))
    expect(actions).toMatch(/>Options<[\s\S]*>Now<[\s\S]*>Add<[\s\S]*>Media</)
    expect(actions).not.toMatch(/>Import</)
    expect(commandFromKey('Home', plain, true)).toEqual({ type: 'guide-now' })
    expect(commandFromKey('u', plain, false)).toEqual({ type: 'media' })
    expect(commandFromKey('r', plain, false)).toEqual({ type: 'random-channel' })
    expect(commandFromKey('Backspace', plain, false)).toEqual({ type: 'digit-back' })
    expect(guide).toContain('<GuideSearch query={tv.guideQuery} onChange={tv.setGuideQuery} />')
    expect(guide).toContain('<SessionImportTools onImport={tv.importSession} />')
    expect(guide).toContain('<AddChannelForm nextNumber={nextNumber} onAdd={addLink} onPreview={tv.previewSource} onExport={tv.exportUserNetwork} onNewChannel={newChannel} onRestore={restoreNetwork} onFocus={openAddRow} inputRef={addInput} />')
    expect(guide).toContain('onActivate={() => tv.activateGuide()}')
    expect(provider).toContain('const playFromGuide = (target: Channel, programme: Programme, slot?: { startMs: number; endMs: number }) => {')
  })
})

describe('one information bar, in the Guide and over the picture', () => {
  const overlay = readFileSync('src/components/NowNextOverlay.tsx', 'utf8')
  const screen = readFileSync('src/app/TvScreen.tsx', 'utf8')
  const bar = (programme: Partial<import('./types/programme.ts').Programme>, channel: Partial<Channel> = {}) =>
    renderToStaticMarkup(
      createElement(InfoActions, {
        channel: { ...channels[0], number: 5, ...channel } as Channel,
        programme: { id: 'p', title: 'T', videoId: 'abcdefghijk', durationSeconds: 600, channelId: 'c', category: 'x', source: 'imported', kind: 'programme', playbackMode: 'linear', ...programme } as import('./types/programme.ts').Programme,
        ...padProps(),
      }),
    )

  it('both bars use the same actions', () => {
    expect(guide).toContain('<InfoActions')
    expect(overlay).toContain('<InfoActions')
    for (const source of [guide, overlay]) {
      expect(source).toContain('corners={cornerActions(tv)}')
      expect(source).toContain('channels={channelActions(tv)}')
    }
    expect(overlay).toContain('history={historyActions(tv)}')
  })

  it('the gold centre key is always Guide, and From start has given way to Prev', () => {
    const airing = bar({})
    expect(airing).toMatch(/class="tune-key info-pad-guide"[^>]*>Guide</)
    expect(airing).not.toContain('From start')
    expect(airing).not.toContain('to edit')
    expect(airing).not.toContain('Remove')
    expect(airing).not.toContain('>Watch<')
    expect(airing).not.toContain('>Play<')
    const radio = bar({ videoId: null, durationSeconds: 0, liveStream: { url: 'https://r.example/live', format: 'direct' } }, { mediaKind: 'audio' })
    expect(radio).toMatch(/class="tune-key info-pad-guide"[^>]*>Guide</)
    expect(radio).not.toContain('>Listen<')
    expect(radio).not.toContain('to edit')
  })

  it('over the picture, a right-click, a hold or E opens the Channel Editor where the bar sits', () => {
    expect(overlay).toContain("useEditPress(editable ? () => tv.dispatch({ type: 'guide-tool', tool: 'edit' }) : undefined)")
    expect(overlay).toContain('{...handlers}')
    const press = readFileSync('src/components/use-edit-press.ts', 'utf8')
    expect(press).toMatch(/onContextMenu: \(event: MouseEvent<HTMLElement>\) => \{\s*if \(!editRef\.current \|\| inPad\(event\.target\)\) return\s*event\.preventDefault\(\)\s*press\.opened\(\)\s*editRef\.current\(\)/)
    expect(screen).toContain('{tv.screenEdit !== null ? <ScreenEditor /> : info ? <NowNextOverlay')
    expect(provider).toContain("if (kind === 'edit' && !guideOpenRef.current) {")
    expect(provider).toContain('if (screenEditRef.current !== null && !SCREEN_EDIT_COMMANDS.has(command.type)) return')
    expect(provider).toContain('else if (screenEditRef.current !== null) closeScreenEdit()')
  })

  it('Watch over the picture returns to the broadcast at NOW after a pick; Prev and Next play from the beginning', () => {
    expect(provider).toMatch(/const screenAction = useCallback\(\(\) => \{[\s\S]*?if \(clearManual\(\)\) \{\s*loadedKey\.current = ''/)
    expect(provider).toMatch(/const target = stepFrom\(here, Date\.now\(\), direction\)\s*if \(hasPicture\(target\.programme\)\) playFromGuide\(here, target\.programme, target\)/)
  })
})

describe('Edit Channel toolbar', () => {
  it('runs REFRESH to CLOSE across the top, before the channel itself, and keeps it there while the editor scrolls', () => {
    const editor = readFileSync('src/components/ChannelEditor.tsx', 'utf8')
    expect(editor.indexOf('editor-actions editor-toolbar')).toBeLessThan(editor.indexOf('<div className="info-main">'))
    expect(readFileSync('src/styles/guide.css', 'utf8')).toMatch(/\.guide-editor > \.editor-toolbar \{\s*grid-column: 1 \/ -1;\s*position: sticky;/)
  })
})
