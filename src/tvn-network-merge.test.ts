import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mergeSources, sourceClips, type ChannelEdit } from './services/channel-editor.ts'
import type { ChannelSource } from './services/channel-sources.ts'
import { clipFlag, flagClipStart, toggledFlags } from './view/clip-flags.ts'
import type { Programme } from './types/programme.ts'

const video = (id: string) => ({ id, title: `Clip ${id}`, durationSec: 600 })
const youtube = (id: string, ref: string, videos: string[]): ChannelSource => ({ id, kind: 'youtube', url: `https://www.youtube.com/channel/${ref}`, ref, youtube: 'channel', label: `Channel ${ref}`, enabled: true, videos: videos.map(video) })
const tvn: ChannelSource = { id: 'tvn', kind: 'tvn', url: '', label: 'TVN programming', enabled: true }

describe('NETWORK → MERGE: a channel’s sources join another channel as a further set', () => {
  it('adds the other channel’s own sources with what they have read, never TVN programming or a source already there', () => {
    const target: ChannelEdit = { name: 'Science', sources: [tvn, youtube('s1', 'UCaaa', ['a1', 'a2'])], review: ['TVN has changed this channel'] }
    const result = mergeSources(target, [tvn, youtube('s1', 'UCbbb', ['b1']), youtube('s2', 'UCaaa', ['a1']), youtube('s3', 'UCccc', ['c1', 'c2', 'c3'])])
    expect(result.added).toBe(2)
    expect(result.already).toBe(1)
    expect(result.edit.review).toBeUndefined()
    expect(result.edit.name).toBe('Science')
    expect(result.edit.sources.map((source) => [source.id, source.ref ?? source.kind, source.videos?.length ?? 0])).toEqual([
      ['tvn', 'tvn', 0],
      ['s1', 'UCaaa', 2],
      ['s1-2', 'UCbbb', 1],
      ['s3', 'UCccc', 3],
    ])
  })

  it('leaves the channel merged from as it was', () => {
    const from = [youtube('s1', 'UCbbb', ['b1'])]
    const result = mergeSources({ name: 'Empty channel', sources: [] }, from)
    result.edit.sources[0].label = 'changed'
    expect(from[0].label).toBe('Channel UCbbb')
  })

  it('opening a row counts each source’s clips and what can air, with no titles', () => {
    const filtered: ChannelSource = { ...youtube('s2', 'UCbbb', ['b1', 'b2', 'b3']), removed: ['b2'] }
    const off: ChannelSource = { ...youtube('s3', 'UCccc', ['c1']), enabled: false }
    const stream: ChannelSource = { id: 's4', kind: 'audio', url: 'https://radio.example/live', label: 'Radio', enabled: true }
    const summary = sourceClips([tvn, youtube('s1', 'UCaaa', ['a1', 'a2']), filtered, off, stream])
    expect(summary.sources.map((source) => [source.label, source.clips, source.eligible])).toEqual([
      ['TVN programming', null, null],
      ['Channel UCaaa', 2, 2],
      ['Channel UCbbb', 3, 2],
      ['Channel UCccc', 1, 1],
      ['Radio', null, null],
    ])
    // Switched-off sources do not count towards the channel's totals.
    expect([summary.clips, summary.eligible]).toEqual([5, 4])
    expect(JSON.stringify(summary)).not.toContain('Clip ')
  })

  it('the Network Editor opens a row with ▸ to rename the channel, list its sources and merge them, in ALL and the User tabs', () => {
    const editor = readFileSync('src/components/NetworkEditor.tsx', 'utf8')
    expect(editor).toContain('aria-expanded={opened === channel.id}')
    expect(editor).toContain("await tv.saveChannelEdit(channel.number, { ...edit, name: name.trim() })")
    expect(editor).toContain('const result = mergeSources(targetEdit, detail.edit.sources)')
    expect(editor).toContain("{list !== 'favourites' ? (\n                    <div className=\"network-merge\">")
    // An empty channel takes the merged channel's name.
    expect(editor).toContain('const named = target.emptySlot ? { ...result.edit, name: detail.edit.name } : result.edit')
  })
})

describe('OPTIONS', () => {
  it('lists Picture & sound after Channel change', () => {
    const options = readFileSync('src/components/GuideOptions.tsx', 'utf8')
    expect(options.indexOf('<Card title="Channel change" wide>')).toBeLessThan(options.indexOf('<Card title="Picture & sound">'))
  })
})

describe('Flags set where clicked on a clip', () => {
  const programme = { id: 'p1', title: 'Rockets', durationSeconds: 1800, videoId: 'abc' } as Programme
  const channel = { number: 1001, name: 'Space' }
  const start = Date.UTC(2026, 9, 15, 9, 0, 0)
  const end = start + 1800_000

  it('flags the clip from the moment clicked, to the second, keeping the clip’s own start', () => {
    const flag = clipFlag(channel, programme, start, end, start + 600_400)
    expect(flag.startMs).toBe(start + 600_000)
    expect(flag.clipStartMs).toBe(start)
    expect(flag.endMs).toBe(end)
    expect(flagClipStart(flag)).toBe(start)
    // From its start, as before, when no moment is given or it falls outside the clip.
    expect(clipFlag(channel, programme, start, end).startMs).toBe(start)
    expect(clipFlag(channel, programme, start, end, end + 5).clipStartMs).toBeUndefined()
  })

  it('one flag to a clip: flagging it again anywhere inside takes it off', () => {
    const now = start - 60_000
    const on = toggledFlags([], clipFlag(channel, programme, start, end, start + 600_000), now)
    expect(on).toHaveLength(1)
    expect(toggledFlags(on, clipFlag(channel, programme, start, end, start + 900_000), now)).toEqual([])
    expect(toggledFlags(on, clipFlag(channel, programme, start, end), now)).toEqual([])
  })

  it('the Guide reads the moment under the pointer and marks it; OPTIONS → Guide chooses', () => {
    const guide = readFileSync('src/components/Guide.tsx', 'utf8')
    expect(guide).toContain('atMs: momentAt(event.currentTarget, event.clientX)')
    expect(guide).toContain("flagWhere === 'clicked' ? slot.atMs : undefined")
    expect(guide).toContain('className="prog-flag-at"')
    expect(readFileSync('src/components/GuideOptions.tsx', 'utf8')).toContain('aria-label="Flags set"')
  })
})
