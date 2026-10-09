import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChannelEditor } from './components/ChannelEditor.tsx'
import { channels } from './data/catalogue.ts'
import { applyChannelEdit, editOf, rescanChannel, type ChannelEdit } from './services/channel-editor.ts'
import { inOrder } from './services/channel-sources.ts'
import { channelsFromSources, type ImportedVideo, type StoredSource } from './services/channels-import.ts'
import { buildCuratedEdit, curatedEditOf, loadCuratedEdit, saveCuratedEdit, tvnSource } from './services/curated-edits.ts'
import type { Channel } from './types/channel.ts'

const videos = (prefix: string, count: number): ImportedVideo[] =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}${String(index).padStart(11 - prefix.length, '0')}`, title: `${prefix} ${index + 1}`, durationSec: 900 + index * 60 }))

const record = (list = videos('alpha', 6)): StoredSource => ({
  id: 'yt:UCaaaa000000000000000001',
  name: 'Alpha',
  videos: list,
  channelNumber: 1001,
  inLibrary: false,
  automatic: true,
  updatedAt: 1,
})

function memoryStore() {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) }
}

const idsOf = (list: readonly { videoId: string | null }[]) => list.map((programme) => programme.videoId)

describe('the running order', () => {
  it('puts the listed programmes first, as listed, then the rest as the sources give them', () => {
    const list = videos('v', 4)
    expect(inOrder(list, [list[2].id, 'gone', list[0].id, list[2].id]).map((video) => video.id)).toEqual([list[2].id, list[0].id, list[1].id, list[3].id])
    expect(inOrder(list, undefined)).toEqual(list)
  })

  it('is saved with the channel, read back by the editor, and dropped by Reset to automatic', () => {
    const all = [record()]
    const edit = editOf(all[0])
    expect(edit.order).toBeUndefined()
    const reversed = [...videos('alpha', 6)].reverse().map((video) => video.id)
    const saved = applyChannelEdit(all, 1001, { ...edit, order: reversed }, 5)
    expect(saved[0].runningOrder).toEqual(reversed)
    expect(editOf(structuredClone(saved[0])).order).toEqual(reversed)
    const reset = applyChannelEdit(saved, 1001, { ...editOf(saved[0]), order: undefined }, 6)
    expect('runningOrder' in reset[0]).toBe(false)
  })

  it('plays exactly in the viewer order, on a loop, without TVN repeats', () => {
    const list = videos('alpha', 8)
    const automatic = channelsFromSources([record(list)]).programmes.get('user-yt:UCaaaa000000000000000001')!
    expect(idsOf(automatic)).toEqual(list.map((video) => video.id))
    const order = [list[5], list[1], list[7], list[0], list[2], list[3], list[4], list[6]].map((video) => video.id)
    const ordered = channelsFromSources([{ ...record(list), runningOrder: order }])
    expect(idsOf(ordered.programmes.get('user-yt:UCaaaa000000000000000001')!)).toEqual(order)
    expect(ordered.channels[0].description).toContain('in your running order')
  })

  it('survives a rescan, with newly found programmes joining at the end', async () => {
    const all = [record(videos('alpha', 3))]
    const edit: ChannelEdit = { ...editOf(all[0]), order: [videos('alpha', 3)[2].id] }
    const found = [...videos('alpha', 3), ...videos('fresh', 2)]
    const result = await rescanChannel(
      all,
      1001,
      edit,
      { resolveYouTube: async () => ({ channelId: 'UCaaaa000000000000000001', title: 'Alpha', videos: found }), probeStream: async () => 'online' },
      9,
    )
    expect(result.edit.order).toEqual(edit.order)
    expect(result.all[0].runningOrder).toEqual([found[2], found[0], found[1], found[3], found[4]].map((video) => video.id))
  })

  it('on a TVN channel with sources of its own, is kept in this browser and followed', () => {
    const shipped = channels.find((channel) => channel.number === 7)!
    const store = memoryStore()
    const own = videos('mine', 4)
    const source = { id: 's1', kind: 'youtube' as const, url: 'https://www.youtube.com/@mine', label: 'Mine', enabled: true, ref: 'UCmine', videos: own, status: { state: 'ready' as const, checkedAt: 1 } }
    const order = [own[3], own[1], own[0], own[2]].map((video) => video.id)
    const saved = saveCuratedEdit(shipped, { name: shipped.name, sources: [tvnSource(), source], order }, 3, store)!
    expect(saved.order).toEqual(order)
    expect(curatedEditOf(shipped, loadCuratedEdit(7, store)).order).toEqual(order)
    expect(idsOf(buildCuratedEdit(shipped, saved).programmes!)).toEqual(order)
  })

  it('an order alone is a change worth keeping on a TVN channel', () => {
    const shipped = channels.find((channel) => channel.number === 7)!
    expect(saveCuratedEdit(shipped, { name: shipped.name, sources: [tvnSource()] }, 1, memoryStore())).toBeNull()
  })
})

describe('the Channel Editor', () => {
  const render = (channel: Channel, edit: ChannelEdit, scope: 'user' | 'curated' = 'user') =>
    renderToStaticMarkup(
      createElement(ChannelEditor, {
        channel,
        scope,
        initial: edit,
        onLoad: async () => edit,
        onSave: async () => '',
        onRescan: async () => ({ edit, message: '' }),
        onDelete: async () => '',
        onClose: () => {},
      }),
    )
  const user = { ...channels[0], number: 1001, id: 'user-x', origin: 'user-import' } as Channel
  const own = videos('alpha', 3)
  const source = { id: 's1', kind: 'youtube' as const, url: 'https://www.youtube.com/@alpha', label: 'Alpha', enabled: true, videos: own, status: { state: 'ready' as const, checkedAt: 1 } }

  it('offers each scheduled source a + to list its programmes, without scanning', () => {
    const html = render(user, { name: 'Alpha', sources: [source] })
    expect(html).toMatch(/<button type="button" class="tab editor-expand" aria-expanded="false" aria-label="Show the details of Alpha"[^>]*>\+<\/button>/)
    const editor = readFileSync('src/components/ChannelEditor.tsx', 'utf8')
    expect(editor).toContain("if (source.kind !== 'tvn') return (source.videos ?? []).map((video) => ({ ...video, href: watchUrl(video.id) }))")
    expect(editor).toMatch(/onClick=\{\(\) => toggleOpen\(source\.id\)\}/)
  })

  it('lists the running order with moves, and Reset once the viewer has set one', () => {
    const automatic = render(user, { name: 'Alpha', sources: [source] })
    expect(automatic).toMatch(/Running order · <span class="editor-order-kind"[^>]*>Automatic<\/span>/)
    expect(automatic).not.toContain('Reset to automatic')
    expect(automatic).toMatch(/<ol class="editor-lineup"[^>]*><li[^>]*><span class="editor-lineup-pos">1<\/span><span class="editor-video-title">alpha 1<\/span>/)
    expect(automatic).toMatch(/aria-label="Move alpha 1 earlier" disabled=""/)
    const yours = render(user, { name: 'Alpha', sources: [source], order: [own[2].id] })
    expect(yours).toMatch(/Running order · <span class="editor-order-kind"[^>]*>Yours<\/span>/)
    expect(yours).toContain('Reset to automatic')
    expect(yours).toMatch(/editor-lineup-pos">1<\/span><span class="editor-video-title">alpha 3</)
  })

  it('explains a TVN channel with only its own programming, and a live stream', () => {
    const shipped = channels.find((channel) => channel.number === 7)!
    expect(render(shipped, { name: shipped.name, sources: [tvnSource()] }, 'curated')).toContain("TVN schedules this channel&#x27;s own programming")
    const stream = { id: 's2', kind: 'audio' as const, url: 'https://radio.example.com/live.mp3', label: 'Radio', enabled: true, status: { state: 'online' as const, checkedAt: 1 } }
    const html = render(user, { name: 'Alpha', sources: [stream] })
    expect(html).toContain('A live stream carries this channel')
    expect(html).toContain('Show the details of https://radio.example.com/live.mp3')
    expect(html).not.toContain('Programmes of Radio')
  })
})
