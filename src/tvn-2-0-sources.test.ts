import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InfoActions } from './components/InfoActions.tsx'
import { channels, shippedChannel, shippedProgrammes } from './data/catalogue.ts'
import { padProps } from './info-pad.fixture.ts'
import { buildCentralCuration, checkCentralCuration, overridesFromExport, reconcileOverride } from './services/central-curation.ts'
import type { ChannelSource } from './services/channel-sources.ts'
import { buildCuratedEdit, clearCuratedEdit, loadCuratedEdits, saveCuratedEdit, tvnSource } from './services/curated-edits.ts'
import { curatedChannelManifest, manifestText } from './services/editorial-manifest.ts'
import { originalOverrideOf, originalSourcesOf, UNSOURCED_NAME, UNSOURCED_REF, type PoolEntry } from './services/original-sources.ts'
import { addToGuide, newGuide, type GuideRun } from './services/viewing-guides.ts'
import type { Channel } from './types/channel.ts'
import type { Programme } from './types/programme.ts'
import { addedSourceLabels, contributionsOf, contributionText, originalLineup } from './view/channel-provenance.ts'
import { guideEndAdvances } from './view/guide-following.ts'

const NOW = Date.parse('2026-10-02T12:00:00Z')
const memoryStore = () => {
  const memory = new Map<string, string>()
  return { memory, store: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value) } }
}

const shipped = channels.find((channel) => channel.number <= 999 && shippedProgrammes(channel.id).length >= 4)!
const ids = shippedProgrammes(shipped.id).map((programme) => programme.id)

// A channel's library pool: two registered sources, one id the register does not know, and programmes with no source.
const entry = (videoId: string, title: string, minutes: number, sourceId?: string): PoolEntry => ({ videoId, title, durationSeconds: minutes * 60, sourceId })
const pool: PoolEntry[] = [
  entry('aaaaaaaaaa1', 'Archive pilot', 30, 'src_archive'),
  entry('aaaaaaaaaa2', 'Archive finale', 35, 'src_archive'),
  entry('aaaaaaaaaa3', 'Archive special', 60, 'src_archive'),
  entry('bbbbbbbbbb1', 'Talk one', 45, 'src_talk'),
  entry('bbbbbbbbbb2', 'Talk two', 50, 'src_talk'),
  entry('ccccccccccc', 'Stray', 20, 'src_unknown'),
  entry('ddddddddddd', 'Loose reel', 10),
  entry('aaaaaaaaaa1', 'Archive pilot (again)', 30, 'src_archive'),
]
const register = {
  sources: {
    src_archive: { name: 'Archive House', provider: 'youtube', channelUrl: 'https://www.youtube.com/@ArchiveHouse' },
    src_talk: { name: 'Talk Hour', provider: 'youtube', channelUrl: 'https://www.youtube.com/@TalkHour' },
  },
}
const originals = originalSourcesOf(pool, register)
const archive = originals.find((source) => source.ref === 'src_archive')!

describe('TVN 2.0 · original sources of a central channel', () => {
  it('shows the original sources from recorded provenance, never invented', () => {
    expect(originals.map((source) => source.ref)).toEqual(['src_archive', 'src_talk', 'src_unknown', UNSOURCED_REF])
    expect(archive).toMatchObject({ name: 'Archive House', provider: 'youtube', url: 'https://www.youtube.com/@ArchiveHouse', registered: true })
    expect(archive.videos.map((video) => video.id)).toEqual(['aaaaaaaaaa1', 'aaaaaaaaaa2', 'aaaaaaaaaa3'])
    const unknown = originals.find((source) => source.ref === 'src_unknown')!
    expect(unknown).toMatchObject({ name: 'src_unknown · not in the source register', provider: null, registered: false })
    expect(unknown.url).toBeUndefined()
    expect(originals.at(-1)).toMatchObject({ ref: UNSOURCED_REF, name: UNSOURCED_NAME, provider: null, registered: false })
    expect(originals.at(-1)?.name).toBe('TVN catalogue · source unavailable')
  })

  it('an untouched channel keeps TVN scheduling and keeps no record', () => {
    const { store } = memoryStore()
    const noop = originalOverrideOf(archive, true, undefined)
    expect(noop).toBeNull()
    expect(saveCuratedEdit(shipped, { name: shipped.name, sources: [tvnSource()], originals: [{ ref: 'src_archive', enabled: true, name: 'Archive House', programmes: 3 }] }, NOW, store, ids, ['aaaaaaaaaa1'])).toBeNull()
    expect(loadCuratedEdits(store)).toEqual({})
    const renamed = saveCuratedEdit(shipped, { name: 'Only renamed', sources: [tvnSource()] }, NOW, store, ids)!
    const built = buildCuratedEdit(shipped, renamed, new Set(), shippedProgrammes(shipped.id), originals)
    expect(built.programmes).toBeNull()
    expect(built.channel.customLineup).toBe(shipped.customLineup)
  })

  it('disabling a source is a local override only: its programmes leave the channel, the catalogue is unchanged', () => {
    const before = JSON.stringify({ channel: shippedChannel(shipped.number), programmes: shippedProgrammes(shipped.id), originals })
    const { store } = memoryStore()
    const off = originalOverrideOf(archive, false, undefined)!
    expect(off).toEqual({ ref: 'src_archive', enabled: false, name: 'Archive House', programmes: 3 })
    const saved = saveCuratedEdit(shipped, { name: shipped.name, sources: [tvnSource()], originals: [off] }, NOW, store, ids)!
    expect(saved.originals).toEqual([off])
    expect(JSON.stringify(loadCuratedEdits(store))).not.toContain('Archive pilot')
    const built = buildCuratedEdit(shipped, saved, new Set(), shippedProgrammes(shipped.id), originals)
    const playing = built.programmes?.map((programme) => programme.videoId) ?? []
    expect(built.channel.customLineup).toBe(true)
    expect(playing.some((id) => id?.startsWith('aaaa'))).toBe(false)
    expect(playing).toEqual(expect.arrayContaining(['bbbbbbbbbb1', 'bbbbbbbbbb2', 'ccccccccccc', 'ddddddddddd']))
    expect(JSON.stringify({ channel: shippedChannel(shipped.number), programmes: shippedProgrammes(shipped.id), originals })).toBe(before)
  })

  it('Restore TVN original drops the override', () => {
    const { store } = memoryStore()
    saveCuratedEdit(shipped, { name: shipped.name, sources: [tvnSource()], originals: [originalOverrideOf(archive, false, undefined)!] }, NOW, store, ids)
    expect(Object.keys(loadCuratedEdits(store))).toEqual([String(shipped.number)])
    clearCuratedEdit(shipped.number, store)
    expect(loadCuratedEdits(store)).toEqual({})
  })

  it('an added source with programmes still carries the channel, as before', () => {
    const own: ChannelSource = {
      id: 's1',
      kind: 'youtube',
      url: 'https://www.youtube.com/playlist?list=PL0123456789',
      ref: 'PL0123456789',
      youtube: 'playlist',
      label: 'My list',
      enabled: true,
      videos: [{ id: 'eeeeeeeeee1', title: 'Mine', durationSec: 1500 }],
    }
    const { store } = memoryStore()
    const saved = saveCuratedEdit(shipped, { name: shipped.name, sources: [tvnSource(), own], originals: [originalOverrideOf(archive, false, undefined)!] }, NOW, store, ids)!
    const built = buildCuratedEdit(shipped, saved, new Set(), shippedProgrammes(shipped.id), originals)
    expect(built.programmes?.map((programme) => programme.videoId)).toEqual(['eeeeeeeeee1'])
    expect(saved.originals).toHaveLength(1)
  })

  it('a local filter over an original source keeps only its matching programmes', () => {
    const filtered = originalOverrideOf(archive, true, { include: { terms: ['pilot'] } })!
    expect(filtered.filter).toEqual({ include: { terms: ['pilot'] } })
    expect(originalOverrideOf(originals.at(-1)!, true, { include: { terms: ['reel'] } })).toBeNull()
    const { store } = memoryStore()
    const saved = saveCuratedEdit(shipped, { name: shipped.name, sources: [tvnSource()], originals: [filtered] }, NOW, store, ids)!
    const playing = buildCuratedEdit(shipped, saved, new Set(), shippedProgrammes(shipped.id), originals).programmes?.map((programme) => programme.videoId) ?? []
    expect([...new Set(playing.filter((id) => id?.startsWith('aaaa')))]).toEqual(['aaaaaaaaaa1'])
    expect(playing).toContain('bbbbbbbbbb1')
  })

  it('counts each source’s contribution to the channel as edited', () => {
    const { rows, total } = contributionsOf(originals, undefined)
    expect(total).toBe((30 + 35 + 60 + 45 + 50 + 20 + 10) * 60)
    expect(contributionText(rows[0], total)).toBe('3 programmes · 2h 05m · 50%')
    expect(contributionText(rows[3], total)).toBe('1 programme · 10m · 4%')
    const off = contributionsOf(originals, [originalOverrideOf(archive, false, undefined)!])
    expect(off.rows[0]).toMatchObject({ programmes: 0, seconds: 0 })
    expect(contributionText(off.rows[1], off.total)).toBe('2 programmes · 1h 35m · 76%')
  })

  it('labels each running-order programme with the source that supplied it', () => {
    const lineup = originalLineup(originals, [originalOverrideOf(originals[1], false, undefined)!])
    expect(lineup.map((video) => [video.id, video.from])).toEqual([
      ['aaaaaaaaaa1', 'Archive House'],
      ['aaaaaaaaaa2', 'Archive House'],
      ['aaaaaaaaaa3', 'Archive House'],
      ['ccccccccccc', 'src_unknown'],
      ['ddddddddddd', 'TVN catalogue'],
    ])
    const labels = addedSourceLabels([tvnSource(), { id: 's1', kind: 'collection', url: '', label: 'Mine', enabled: true, videos: [{ id: 'x1', title: 'X', durationSec: 60 }] }], (source) => source.label)
    expect([...labels]).toEqual([['x1', 'Mine']])
    const editor = readFileSync('src/components/ChannelEditor.tsx', 'utf8')
    expect(editor).toContain('<span className="editor-video-from"')
    expect(readFileSync('src/components/NowNextOverlay.tsx', 'utf8')).not.toContain('editor-video-from')
  })

  it('exports source decisions with their identity and restores them against the current shipped sources', () => {
    const { store } = memoryStore()
    const decisions = [originalOverrideOf(archive, false, undefined)!, originalOverrideOf(originals[1], true, { exclude: { terms: ['two'] } })!]
    const saved = saveCuratedEdit(shipped, { name: shipped.name, sources: [tvnSource()], originals: decisions, excluded: ['ccccccccccc'] }, NOW, store, ids, originals.flatMap((source) => source.videos.map((video) => video.id)))!
    expect(saved.excluded).toEqual(['ccccccccccc'])
    const central = buildCentralCuration([saved])
    const errors: string[] = []
    checkCentralCuration(central, 'central', errors)
    expect(errors).toEqual([])
    expect(central.overrides[0].originals).toEqual(decisions)
    expect(JSON.stringify(central)).not.toContain('Archive pilot')
    const [restored] = overridesFromExport(central)
    const result = reconcileOverride(restored, shipped, ids, originals)
    expect(result.conflicts).toEqual([])
    expect(result.edit?.originals).toEqual(decisions)
    expect(result.edit?.excluded).toEqual(['ccccccccccc'])
  })

  it('flags a shipped source that has gone or changed instead of misapplying the decision', () => {
    const { store } = memoryStore()
    const saved = saveCuratedEdit(shipped, { name: shipped.name, sources: [tvnSource()], originals: [originalOverrideOf(archive, false, undefined)!, originalOverrideOf(originals[1], false, undefined)!] }, NOW, store, ids)!
    const [restored] = overridesFromExport(buildCentralCuration([saved]))
    const later = originalSourcesOf(
      [entry('bbbbbbbbbb1', 'Talk one', 45, 'src_talk'), entry('zzzzzzzzzz1', 'New', 30, 'src_new')],
      { sources: { src_talk: { name: 'Talk Hour Classics', provider: 'youtube' } } },
    )
    const result = reconcileOverride(restored, shipped, ids, later)
    expect(result.conflicts.some((line) => /no longer ships Archive House/.test(line))).toBe(true)
    expect(result.conflicts.some((line) => /renamed .*Talk Hour to Talk Hour Classics/.test(line))).toBe(true)
    expect(result.edit?.originals?.map((item) => item.ref)).toEqual(['src_talk'])
    const shrunk = reconcileOverride(restored, shipped, ids, originalSourcesOf([entry('aaaaaaaaaa1', 'Archive pilot', 30, 'src_archive'), entry('bbbbbbbbbb1', 'Talk one', 45, 'src_talk'), entry('bbbbbbbbbb2', 'Talk two', 50, 'src_talk')], register))
    expect(shrunk.conflicts.some((line) => /Archive House .* has changed \(3 → 1 programmes\)/.test(line))).toBe(true)
  })

  it('the manifest separates shipped sources, local source overrides and added sources, with contribution', () => {
    const decisions = [originalOverrideOf(archive, false, undefined)!]
    const manifest = curatedChannelManifest(shipped.number, { name: shipped.name, sources: [tvnSource()], originals: decisions }, shippedProgrammes(shipped.id), originals)
    expect(manifest.provenance?.shippedSources.map((source) => [source.ref, source.enabled, source.shipped, source.programmes])).toEqual([
      ['src_archive', false, 3, 0],
      ['src_talk', true, 2, 2],
      ['src_unknown', true, 1, 1],
      [UNSOURCED_REF, true, 1, 1],
    ])
    expect(manifest.provenance?.localSourceOverrides).toEqual(decisions)
    expect(manifest.provenance?.addedSources).toEqual([])
    expect(manifest.current.programmeCount).toBe(4)
    const text = manifestText(manifest)
    expect(text).toContain('## SHIPPED SOURCES')
    expect(text).toContain('## LOCAL SOURCE OVERRIDES')
    expect(text).toContain('## ADDED SOURCES')
    expect(text).toContain('- Archive House: disabled')
  })
})

describe('TVN 2.0 · the Guide follows the player', () => {
  const first = { ...channels[0], id: 'end-a', number: 21, name: 'Alpha', origin: 'default', enabled: true } as Channel
  const a1 = { id: 'a1', title: 'Alpha one', videoId: 'aaaaaaaaaa1', durationSeconds: 1500, channelId: first.id, category: 'x', source: 'youtube', kind: 'programme', playbackMode: 'linear' } as Programme
  const a2 = { ...a1, id: 'a2', videoId: 'aaaaaaaaaa2', title: 'Alpha two' } as Programme
  const guide = addToGuide(addToGuide(newGuide('Evening', NOW), first, a1, NOW + 1), first, a2, NOW + 2)
  const run: GuideRun = { guide, index: 0, state: 'active', programmeId: 'guide-play-a1', endsAt: NOW + 1_500_000, skipped: [] }
  const playing = { channelNumber: 21, programmeId: 'guide-play-a1', videoId: 'aaaaaaaaaa1' }
  const provider = readFileSync('src/state/TvProvider.tsx', 'utf8')

  it('advances on the actual ENDED of the Guide item playing now', () => {
    expect(guideEndAdvances(run, { channelNumber: 21, videoId: 'aaaaaaaaaa1' }, playing)).toBe(true)
    const ended = provider.slice(provider.indexOf("if (status === 'ended') {"), provider.indexOf("if (status !== 'error') return"))
    expect(ended).toContain('if (guideEndAdvances(guideRunRef.current, asked, playing)) guideEngine.current.advance(true)')
  })

  it('ignores a stale ENDED', () => {
    expect(guideEndAdvances(run, { channelNumber: 21, videoId: 'aaaaaaaaaa2' }, playing)).toBe(false)
    expect(guideEndAdvances(run, { channelNumber: 34, videoId: 'aaaaaaaaaa1' }, playing)).toBe(false)
    expect(guideEndAdvances({ ...run, state: 'suspended' }, { channelNumber: 21, videoId: 'aaaaaaaaaa1' }, playing)).toBe(false)
    expect(guideEndAdvances({ ...run, programmeId: 'guide-play-other' }, { channelNumber: 21, videoId: 'aaaaaaaaaa1' }, playing)).toBe(false)
    expect(guideEndAdvances(run, { channelNumber: 21, videoId: 'aaaaaaaaaa1' }, null)).toBe(false)
    expect(guideEndAdvances(null, { channelNumber: 21, videoId: 'aaaaaaaaaa1' }, playing)).toBe(false)
    const stage = readFileSync('src/player/YoutubeStage.tsx', 'utf8')
    expect(stage).toContain("} else if (event.data === 0 && (actualId(event.target) ?? requestedRef.current) === requestedRef.current) {")
  })

  it('keeps the listed length as the fallback when no ENDED arrives', () => {
    expect(provider).toMatch(/if \(!manual \|\| manual\.programme\.id !== run\.programmeId\) \{\s+guideEngine\.current\.advance\(manual === null\)/)
  })

  it('GUIDE is green wherever an active Guide controls what plays next, the Guide screen included', () => {
    const pad = renderToStaticMarkup(createElement(InfoActions, { channel: first, programme: a1, ...padProps(), following: true }))
    expect(pad).toMatch(/class="tune-key info-pad-guide is-following"/)
    expect(pad).toContain('aria-label="Previous programme"')
    expect(pad).not.toContain('Previous item in the Guide')
    const guideView = readFileSync('src/components/Guide.tsx', 'utf8')
    expect(guideView).toContain("following={tv.guideRun?.state === 'active'}")
    expect(guideView).toMatch(/onNext=\{onNext\}\s+following=\{following\}/)
  })
})
