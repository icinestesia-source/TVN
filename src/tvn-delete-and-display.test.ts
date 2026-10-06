import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChannelEditor } from './components/ChannelEditor.tsx'
import { channels } from './data/catalogue.ts'
import type { ChannelEdit } from './services/channel-editor.ts'
import { inventoryOf, type ChannelSource } from './services/channel-sources.ts'
import { channelsFromSources, type ImportedVideo, type StoredSource } from './services/channels-import.ts'
import { exportSource } from './services/user-network-export.ts'
import { channelSource } from './services/user-network-restore.ts'
import type { Channel } from './types/channel.ts'
import { asDisplayQuality, DISPLAY_QUALITIES, loadDisplayQuality, qualityFrame, setDisplayQuality } from './view/display-quality.ts'

const videos = (prefix: string, count: number): ImportedVideo[] =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}${String(index).padStart(11 - prefix.length, '0')}`, title: `${prefix} ${index + 1}`, durationSec: 900 + index * 60 }))

function memoryStore() {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) }
}

describe('DELETE on a programme in the Channel Editor schedule', () => {
  const own = videos('alpha', 3)
  const source: ChannelSource = { id: 's1', kind: 'youtube', url: 'https://www.youtube.com/@alpha', label: 'Alpha', enabled: true, videos: own, status: { state: 'ready', checkedAt: 1 } }
  const user = { ...channels[0], number: 1001, id: 'user-x', origin: 'user-import' } as Channel
  const render = (edit: ChannelEdit) =>
    renderToStaticMarkup(
      createElement(ChannelEditor, {
        channel: user,
        scope: 'user',
        initial: edit,
        onLoad: async () => edit,
        onSave: async () => '',
        onRescan: async () => ({ edit, message: '' }),
        onDelete: async () => '',
        onClose: () => {},
      }),
    )

  it('offers a delete button on every programme in the running order', () => {
    const html = render({ name: 'Alpha', sources: [source] })
    for (const video of own) expect(html).toContain(`aria-label="Delete ${video.title}"`)
    expect(html).not.toContain('Restore')
  })

  it('takes a deleted programme off the list and out of the schedule, and RESTORE brings it back', () => {
    const removed = { ...source, removed: [own[1].id] }
    const html = render({ name: 'Alpha', sources: [removed] })
    expect(html).not.toContain('alpha 2')
    expect(html).toContain('Restore 1 deleted')
    expect(inventoryOf([removed]).map((video) => video.id)).toEqual([own[0].id, own[2].id])
    const record: StoredSource = { id: 'yt:UCaaaa000000000000000001', name: 'Alpha', videos: own, channelSources: [removed], channelNumber: 1001, inLibrary: false, automatic: true, updatedAt: 1 }
    const aired = channelsFromSources([record]).programmes.get('user-yt:UCaaaa000000000000000001')!
    expect(aired.some((programme) => programme.videoId === own[1].id)).toBe(false)
    expect(aired.some((programme) => programme.videoId === own[0].id)).toBe(true)
  })

  it('keeps a deletion through a rescan, and in a TVN export file', () => {
    const removed = { ...source, removed: [own[1].id] }
    const rescanned = { ...removed, videos: [...videos('alpha', 3), ...videos('beta', 1)] }
    expect(inventoryOf([rescanned]).map((video) => video.id)).not.toContain(own[1].id)
    const exported = exportSource(removed, () => null)
    expect(exported.removed).toEqual([own[1].id])
    expect(channelSource(exported, 0).removed).toEqual([own[1].id])
  })

  it("leaves one of TVN's own programmes out, so ticking it brings it back", () => {
    const editor = readFileSync('src/components/ChannelEditor.tsx', 'utf8')
    expect(editor).toContain('if (tvnLineup || video.original) {')
    expect(editor).toContain("change({ ...edit, excluded: [...left, video.id], orderKind: edit.orderKind ?? 'manual' })")
  })
})

describe('DISPLAY in Settings', () => {
  it('offers Auto, SD 480p, HD 720p and HD 1080p, kept in this browser', () => {
    expect(DISPLAY_QUALITIES.map((quality) => quality.label)).toEqual(['Auto', 'SD 480p', 'HD 720p', 'HD 1080p'])
    const store = memoryStore()
    expect(loadDisplayQuality(store)).toBe('auto')
    setDisplayQuality('720', store)
    expect(loadDisplayQuality(store)).toBe('720')
    setDisplayQuality('auto', store)
    expect(asDisplayQuality('4k')).toBe('auto')
    const options = readFileSync('src/components/GuideOptions.tsx', 'utf8')
    expect(options).toContain('<Card title="Display">')
    expect(options).toContain('onClick={() => setDisplayQuality(id)}')
  })

  it("lays YouTube's player out at the chosen height in device pixels and scales it to fill the screen", () => {
    expect(qualityFrame('auto', { width: 1920, height: 1080 }, 1)).toBeNull()
    expect(qualityFrame('480', { width: 0, height: 0 }, 1)).toBeNull()
    expect(qualityFrame('480', { width: 1920, height: 1080 }, 1)).toEqual({ width: 853.3333333333334, height: 480, scale: 2.25 })
    expect(qualityFrame('720', { width: 1280, height: 720 }, 2)).toEqual({ width: 640, height: 360, scale: 2 })
    const frame = qualityFrame('1080', { width: 800, height: 450 }, 1)!
    expect(frame.height).toBe(1080)
    expect(frame.width * frame.scale).toBeCloseTo(800)
    const stage = readFileSync('src/player/YoutubeStage.tsx', 'utf8')
    expect(stage).toContain('<div className="yt-frame" ref={frameRef} style={frameStyle}>')
    expect(stage).toContain('const frame = preview ? null : qualityFrame(')
  })
})
