import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChannelEditor } from './components/ChannelEditor.tsx'
import { channels, shippedChannel, shippedProgrammes } from './data/catalogue.ts'
import { buildCentralCuration, CENTRAL_CURATION_FORMAT, overridesFromExport, reconcileOverride } from './services/central-curation.ts'
import { cleanEditorial, type ChannelEditorial, type SourceFilter } from './services/channel-curation.ts'
import { applyChannelEdit, editOf, type ChannelEdit } from './services/channel-editor.ts'
import type { ChannelSource } from './services/channel-sources.ts'
import type { StoredSource } from './services/channels-import.ts'
import {
  buildCuratedEdit,
  CURATED_EDITS_KEY,
  loadCuratedEdits,
  replaceCuratedEdits,
  saveCuratedEdit,
  shippedBaseline,
  tvnSource,
  type CuratedEdit,
} from './services/curated-edits.ts'
import { curatedChannelManifest, manifestText } from './services/editorial-manifest.ts'
import { buildTvnExport, readRestoreFile, readTvnExportFile, serialiseTvnExport, validateTvnExport, type PortableSettings } from './services/tvn-export.ts'
import { buildUserNetworkExport, validateUserNetworkExport } from './services/user-network-export.ts'
import { recordsFromExport } from './services/user-network-restore.ts'
import { DEFAULT_TRANSITION_SETTINGS } from './state/transitions.ts'
import { DEFAULT_SHORTCUTS } from './view/info-shortcuts.ts'

const NOW = Date.parse('2026-10-02T12:00:00Z')

const memoryStore = () => {
  const memory = new Map<string, string>()
  return { memory, store: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value) } }
}

const shipped = channels.find((channel) => channel.number <= 999 && shippedProgrammes(channel.id).length >= 4)!
const programmes = shippedProgrammes(shipped.id)
const ids = programmes.map((programme) => programme.id)

const videos = [
  { id: 'aaaaaaaaaaa', title: 'Pilot', durationSec: 1500 },
  { id: 'bbbbbbbbbbb', title: 'Finale', durationSec: 1600 },
]
const filter: SourceFilter = { include: { terms: ['Pilot'] }, exclude: { shorts: true } }
const ownSource = (extra: Partial<ChannelSource> = {}): ChannelSource => ({
  id: 's1',
  kind: 'youtube',
  url: 'https://www.youtube.com/playlist?list=PL0123456789',
  ref: 'PL0123456789',
  youtube: 'playlist',
  label: 'Archive list',
  enabled: true,
  videos,
  ...extra,
})
const research: ChannelEditorial = {
  purpose: 'Saturday morning cartoons',
  include: 'Original broadcasts',
  exclude: 'Reboots',
  eras: '1980s–1990s',
  gaps: 'Few idents',
  sourceNotes: 'Archive list is reliable',
  notes: 'Check the 1987 run again',
  status: 'reviewing',
  related: [12, 1004],
}

const settings: PortableSettings = {
  volume: 40,
  muted: false,
  subtitles: false,
  sleepMinutes: 0,
  guideSplit: 0.5,
  infoShortcuts: { ...DEFAULT_SHORTCUTS },
  surfRange: { minSeconds: 5, maxSeconds: 20 },
  transition: 'tv-tune',
  transitionStyle: { ...DEFAULT_TRANSITION_SETTINGS },
}

const userRecord = (): StoredSource =>
  applyChannelEdit(
    [{ id: 'slot:1001', name: 'Empty channel', videos: [], channelNumber: 1001, inLibrary: false, automatic: true, updatedAt: 1, channelSources: [], emptySlot: true }],
    1001,
    { name: 'Cartoons', sources: [ownSource({ filter, mode: 'archive' })], editorial: research },
    NOW,
  )[0]

const curatedOverride = (store: ReturnType<typeof memoryStore>['store']) =>
  saveCuratedEdit(
    shipped,
    {
      name: 'My cartoons',
      description: 'Curated by me',
      sources: [tvnSource(), ownSource({ filter, mode: 'archive' })],
      editorial: research,
    },
    NOW,
    store,
    ids,
  )!

describe('TVN 2.0 · central overrides', () => {
  it('saves a local override with sources, filters, modes, description, research, status and related, plus the shipped baseline', () => {
    const { store } = memoryStore()
    const saved = curatedOverride(store)
    expect(saved.channelNumber).toBe(shipped.number)
    expect(saved.name).toBe('My cartoons')
    expect(saved.description).toBe('Curated by me')
    const own = saved.sources.find((source) => source.kind === 'youtube')
    expect(own?.filter).toEqual(filter)
    expect(own?.mode).toBe('archive')
    expect(saved.editorial).toEqual(research)
    expect(saved.baseline).toEqual(shippedBaseline(shipped, ids))
    expect(loadCuratedEdits(store)[String(shipped.number)]).toEqual(saved)
  })

  it('notes alone make an override; an unchanged channel keeps no record', () => {
    const { store } = memoryStore()
    const noted = saveCuratedEdit(shipped, { name: shipped.name, sources: [tvnSource()], editorial: { status: 'curated' } }, NOW, store, ids)
    expect(noted?.editorial).toEqual({ status: 'curated' })
    expect(saveCuratedEdit(shipped, { name: shipped.name, sources: [tvnSource()], editorial: { status: 'unreviewed' } }, NOW, store, ids)).toBeNull()
    expect(loadCuratedEdits(store)).toEqual({})
  })

  it('never mutates the shipped catalogue', () => {
    const before = JSON.stringify({ channel: shippedChannel(shipped.number), programmes: shippedProgrammes(shipped.id) })
    const { store } = memoryStore()
    const saved = saveCuratedEdit(shipped, { name: 'Renamed', sources: [tvnSource()], order: [...ids].reverse(), excluded: [ids[0]] }, NOW, store, ids)!
    const built = buildCuratedEdit(shipped, saved, new Set(), programmes)
    built.programmes?.forEach((programme) => (programme.title = 'changed'))
    built.channel.name = 'changed'
    expect(JSON.stringify({ channel: shippedChannel(shipped.number), programmes: shippedProgrammes(shipped.id) })).toBe(before)
  })

  it('leaves out and reorders TVN programmes; untouched channels keep TVN scheduling', () => {
    const { store } = memoryStore()
    const saved = saveCuratedEdit(shipped, { name: shipped.name, sources: [tvnSource()], order: [ids[2], ids[0]], excluded: [ids[1]] }, NOW, store, ids)!
    expect(saved.order?.slice(0, 2)).toEqual([ids[2], ids[0]])
    const built = buildCuratedEdit(shipped, saved, new Set(), programmes)
    expect(built.channel.customLineup).toBe(true)
    expect(built.programmes?.map((programme) => programme.id).slice(0, 2)).toEqual([ids[2], ids[0]])
    expect(built.programmes?.some((programme) => programme.id === ids[1])).toBe(false)
    const named = saveCuratedEdit(shipped, { name: 'Only renamed', sources: [tvnSource()] }, NOW, store, ids)!
    const plain = buildCuratedEdit(shipped, named, new Set(), programmes)
    expect(plain.programmes).toBeNull()
    expect(plain.channel.customLineup).toBe(shipped.customLineup)
  })

  it('the curated manifest shows status, related channels and curator notes', () => {
    const { store } = memoryStore()
    const saved = curatedOverride(store)
    const manifest = curatedChannelManifest(shipped.number, saved, programmes)
    expect(manifest.scope).toBe('central')
    expect(manifest.editorial).toMatchObject({ status: 'reviewing', related: [12, 1004], curatorNotes: 'Check the 1987 run again' })
    const text = manifestText(manifest)
    expect(text).toContain('Status: REVIEWING')
    expect(text).toContain('## RELATED CHANNELS\n12, 1004')
    expect(text).toContain('## CURATOR NOTES\nCheck the 1987 run again')
  })
})

describe('TVN 2.0 · complete export carries central overrides', () => {
  const build = (curated: CuratedEdit[]) =>
    buildTvnExport({
      stored: [userRecord()],
      users: [],
      favourites: [shipped.number, 1001],
      settings,
      now: new Date(NOW),
      curated,
      shippedOf: () => programmes,
    })

  it('exports the overrides only, with baseline, and restores them into the override layer', () => {
    const { store } = memoryStore()
    const saved = curatedOverride(store)
    const document = build([saved])
    expect(document.central?.format).toBe(CENTRAL_CURATION_FORMAT)
    expect(document.central?.overrides).toHaveLength(1)
    expect(document.central?.overrides[0]).toMatchObject({ number: shipped.number, name: 'My cartoons', description: 'Curated by me', baseline: saved.baseline })
    const text = serialiseTvnExport(document)
    expect(text).not.toContain(programmes[programmes.length - 1].title)
    const read = readTvnExportFile(text)
    if (!read.ok) throw new Error(read.errors.join('; '))
    expect(read.overrides).toBe(1)
    const [restored] = overridesFromExport(read.value.central!)
    const result = reconcileOverride(restored, shipped, ids)
    expect(result.conflicts).toEqual([])
    const target = memoryStore()
    replaceCuratedEdits([result.edit!], target.store)
    const back = loadCuratedEdits(target.store)[String(shipped.number)]
    expect(back.name).toBe('My cartoons')
    expect(back.description).toBe('Curated by me')
    expect(back.editorial).toEqual(research)
    const own = back.sources.find((source) => source.kind === 'youtube')
    expect(own).toMatchObject({ filter, mode: 'archive', ref: 'PL0123456789' })
    expect(back.sources.find((source) => source.kind === 'tvn')?.id).toBe('tvn')
  })

  it('round-trips the whole export: User Network, research, status, related, favourites, settings and manifests', () => {
    const { store } = memoryStore()
    const document = build([curatedOverride(store)])
    const read = readTvnExportFile(serialiseTvnExport(document))
    if (!read.ok) throw new Error(read.errors.join('; '))
    expect(read.value.favourites).toEqual([shipped.number, 1001])
    expect(read.value.settings).toEqual(settings)
    expect(read.value.manifests.map((manifest) => [manifest.scope, manifest.channel.number])).toEqual([
      ['central', shipped.number],
      ['user', 1001],
    ])
    const [record] = recordsFromExport(read.value.userNetwork, NOW)
    expect(record.editorial).toEqual(research)
    expect(record.channelSources?.[0]).toMatchObject({ filter, mode: 'archive' })
    expect(read.value.central?.overrides[0].editorial).toEqual(research)
  })

  it('a shipped channel that has changed keeps what still fits and reports the rest; a vanished channel is skipped', () => {
    const { store } = memoryStore()
    const saved = saveCuratedEdit(shipped, { name: shipped.name, sources: [tvnSource()], order: [ids[1], ids[0]], excluded: [ids[2]] }, NOW, store, ids)!
    const [restored] = overridesFromExport(buildCentralCuration([saved]))
    const later = ids.filter((id) => id !== ids[2])
    const moved = reconcileOverride(restored, { ...shipped, name: 'TVN renamed it' }, later)
    expect(moved.conflicts.join(' ')).toMatch(/renamed/)
    expect(moved.conflicts.join(' ')).toMatch(/no longer in TVN's channel/)
    expect(moved.edit?.excluded).toBeUndefined()
    expect(moved.edit?.order?.slice(0, 2)).toEqual([ids[1], ids[0]])
    expect(moved.edit?.conflicts).toEqual(moved.conflicts)
    const gone = reconcileOverride(restored, undefined, [])
    expect(gone.edit).toBeNull()
    expect(gone.conflicts[0]).toMatch(/no longer in TVN/)
  })

  it('a legacy complete export without overrides is still valid and leaves overrides alone', () => {
    const legacy = build([])
    delete (legacy as { central?: unknown }).central
    const read = readRestoreFile(serialiseTvnExport(legacy))
    expect(read.kind).toBe('complete')
    if (!read.ok || read.kind !== 'complete') throw new Error('legacy file refused')
    expect(read.overrides).toBe(0)
    expect(read.value.central).toBeUndefined()
  })

  it('a malformed override refuses the whole file', () => {
    const { store } = memoryStore()
    const good = JSON.parse(serialiseTvnExport(build([curatedOverride(store)]))) as Record<string, any>
    const broken = (mutate: (override: Record<string, unknown>, file: Record<string, any>) => void) => {
      const file = structuredClone(good)
      mutate(file.central.overrides[0], file)
      return validateTvnExport(file)
    }
    expect(broken((override) => (override.number = 1001)).ok).toBe(false)
    expect(broken((override) => (override.number = 0)).ok).toBe(false)
    expect(broken((override) => (override.surprise = true)).ok).toBe(false)
    expect(broken((override) => ((override.editorial as ChannelEditorial).status = 'done' as never)).ok).toBe(false)
    expect(broken((override) => ((override.editorial as Record<string, unknown>).related = ['twelve'])).ok).toBe(false)
    expect(broken((override) => ((override.editorial as Record<string, unknown>).artwork = 'http://example.com/a.png')).ok).toBe(false)
    expect(broken((override) => (override.baseline = { name: 'x', programmes: 1, fingerprint: 'nope' })).ok).toBe(false)
    expect(broken((override) => ((override.sources as Record<string, unknown>[])[1].url = 'https://example.com/live.m3u8?token=abc')).ok).toBe(false)
    expect(broken((_override, file) => file.central.overrides.push(structuredClone(file.central.overrides[0]))).ok).toBe(false)
    expect(broken((_override, file) => (file.central.format = 'other')).ok).toBe(false)
    const read = readRestoreFile(JSON.stringify({ ...good, central: { format: CENTRAL_CURATION_FORMAT, overrides: [{ number: 5 }] } }))
    expect(read.ok).toBe(false)
  })
})

describe('TVN 2.0 · User Channel curation', () => {
  it('a User Channel keeps sources, filters, research, status and related through Edit Channel and the User Network export', () => {
    const record = userRecord()
    expect(record.editorial).toEqual(research)
    const edit = editOf(record)
    expect(edit.editorial).toEqual(research)
    const document = buildUserNetworkExport([record], new Date(NOW))
    expect(validateUserNetworkExport(JSON.parse(JSON.stringify(document))).ok).toBe(true)
    const [back] = recordsFromExport(document, NOW)
    expect(back.editorial).toEqual(research)
  })

  it('editorial cleaning keeps only valid status, related numbers and https artwork', () => {
    expect(cleanEditorial({ status: 'unreviewed' })).toBeUndefined()
    expect(cleanEditorial({ status: 'bogus', related: [12, 12, 0, 1.5, 1004], artwork: 'http://x.test/a.png' })).toEqual({ related: [12, 1004] })
    expect(cleanEditorial({ artwork: 'https://x.test/a.png', notes: '  Mine  ' })).toEqual({ artwork: 'https://x.test/a.png', notes: 'Mine' })
  })

  it('Edit Channel offers status, research, filters and description for a 001–999 channel', () => {
    const edit: ChannelEdit = { name: shipped.name, sources: [tvnSource(), ownSource()], editorial: research }
    const html = renderToStaticMarkup(
      createElement(ChannelEditor, {
        channel: shipped,
        scope: 'curated',
        initial: edit,
        onLoad: async () => edit,
        onSave: async () => '',
        onRescan: async () => ({ edit, message: '' }),
        onDelete: async () => '',
        onClose: () => {},
        onExport: async () => '',
      }),
    )
    expect(html).toContain('Research · editorial')
    expect(html).toContain('Reviewing')
    expect(html).toContain('Description')
    expect(html).toContain('several sources, each with its own mode and filter')
    expect(html).toContain('Restore TVN original')
    expect(html).not.toContain('Export channel')
    expect(CURATED_EDITS_KEY).toBe('tvn.channel-edits.v1')
  })
})
