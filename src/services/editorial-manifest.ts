import {
  cleanEditorial,
  eligibleOf,
  SOURCE_MODE_LABELS,
  sourceModeOf,
  videoYear,
  type ChannelEditorial,
  type CurationStatus,
  type SourceFilter,
  type SourceMode,
} from './channel-curation.ts'
import { sourcesOf, type ChannelEdit } from './channel-editor.ts'
import { isStreamSource, liveStreamOf, SOURCE_TYPES, youTubeSourceType, type ChannelSource } from './channel-sources.ts'
import { programmeTypeFor, type StoredSource } from './channels-import.ts'
import { contributionOf, originalChannelSource, type OriginalOverride, type OriginalSource } from './original-sources.ts'

/**
 * tvn-editorial-manifest-v1: one channel described in two strictly separate halves.
 *
 * CURRENT FACTS are calculated from what the channel holds now (programmes, hours, sources, how much of it
 * one source supplies). EDITORIAL INTENT is what a person has written about the channel (purpose, what to
 * include and exclude, desired coverage, gaps, eras, targets). TVN never writes intent: a field nobody has
 * written is null. The same shape describes a curated 001–999 channel (scope `central`, written only by the
 * network's own tooling) and a viewer's 1001+ channel (scope `user`, written from Edit Channel).
 */
export const EDITORIAL_MANIFEST_FORMAT = 'tvn-editorial-manifest-v1'

export interface ManifestSourceFact {
  id: string
  label: string
  sourceType: string
  enabled: boolean
  /** Programmes this source makes eligible (after its filter), counted once per channel. */
  programmes: number
  seconds: number
  /** Everything the source's last scan holds, before its filter. */
  held?: number
  mode?: SourceMode
}

export interface ManifestCurrent {
  programmeCount: number
  totalSeconds: number
  hours: number
  sourceCount: number
  sources: ManifestSourceFact[]
  sourceConcentration: { largestSource: string | null; programmeShare: number; hoursShare: number }
  programmeTypes: Record<string, number>
  earliestKnownYear: number | null
  latestKnownYear: number | null
  /** On the air from a continuous live stream rather than scheduled programmes. */
  live: boolean
}

export interface ManifestEditorial {
  purpose: string | null
  include: string | null
  exclude: string | null
  sourceNotes: string | null
  desiredCoverage: string | null
  gaps: string | null
  eras: string | null
  curatorNotes: string | null
  tags: string[]
  targets: { hours: number | null; programmes: number | null }
  status: CurationStatus
  related: number[]
  artwork: string | null
}

export interface EditorialManifest {
  format: typeof EDITORIAL_MANIFEST_FORMAT
  scope: 'central' | 'user'
  channel: { number: number; name: string }
  current: ManifestCurrent
  editorial: ManifestEditorial
  /** Each scheduled source's rules: configuration, kept apart from both facts and intent. */
  filters: { source: string; label: string; mode: SourceMode; filter: SourceFilter | null }[]
  /** A 001–999 channel only: where its programming comes from, and what the viewer has changed about that. */
  provenance?: ManifestProvenance
}

/** One of the sources TVN ships the channel's programming from, as recorded, with what it gives the channel now. */
export interface ManifestShippedSource {
  ref: string
  name: string
  provider: string | null
  url: string | null
  /** Named in TVN's source register. */
  registered: boolean
  /** TVN's programmes from it on this channel. */
  shipped: number
  enabled: boolean
  filtered: boolean
  /** What it gives the channel as curated: after the viewer's decision, before programmes left out one by one. */
  programmes: number
  seconds: number
  /** Its part of the original sources' running time, 0–1. */
  share: number
}

export interface ManifestProvenance {
  shippedSources: ManifestShippedSource[]
  /** The viewer's decisions about shipped sources, exactly as kept. */
  localSourceOverrides: OriginalOverride[]
  addedSources: { id: string; label: string; sourceType: string; enabled: boolean; programmes: number; seconds: number }[]
  /** Added sources with programmes carry the channel in place of TVN's own. */
  tvnReplaced: boolean
}

const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places

/** Facts from a list of programmes attributed to sources. Shared by user channels and the central network report. */
export function currentFacts(
  programmes: readonly { sourceId: string; durationSec: number; programmeType: string; year: number | null }[],
  sources: readonly Omit<ManifestSourceFact, 'programmes' | 'seconds'>[],
  live = false,
): ManifestCurrent {
  const totalSeconds = programmes.reduce((sum, programme) => sum + programme.durationSec, 0)
  const bySource = new Map<string, { programmes: number; seconds: number }>()
  const types: Record<string, number> = {}
  const years: number[] = []
  for (const programme of programmes) {
    const tally = bySource.get(programme.sourceId) ?? { programmes: 0, seconds: 0 }
    tally.programmes += 1
    tally.seconds += programme.durationSec
    bySource.set(programme.sourceId, tally)
    types[programme.programmeType] = (types[programme.programmeType] ?? 0) + 1
    if (programme.year !== null) years.push(programme.year)
  }
  const facts = sources.map((source) => ({ ...source, programmes: bySource.get(source.id)?.programmes ?? 0, seconds: bySource.get(source.id)?.seconds ?? 0 }))
  const contributing = facts.filter((source) => source.programmes > 0)
  const largest = [...contributing].sort((a, b) => b.programmes - a.programmes || b.seconds - a.seconds || a.id.localeCompare(b.id))[0]
  return {
    programmeCount: programmes.length,
    totalSeconds,
    hours: round(totalSeconds / 3600),
    sourceCount: contributing.length,
    sources: facts,
    sourceConcentration: largest
      ? { largestSource: largest.id, programmeShare: round(largest.programmes / programmes.length, 3), hoursShare: totalSeconds > 0 ? round(largest.seconds / totalSeconds, 3) : 0 }
      : { largestSource: null, programmeShare: 0, hoursShare: 0 },
    programmeTypes: Object.fromEntries(Object.entries(types).sort(([a], [b]) => a.localeCompare(b))),
    earliestKnownYear: years.length ? Math.min(...years) : null,
    latestKnownYear: years.length ? Math.max(...years) : null,
    live,
  }
}

/** Intent exactly as a person wrote it; null and empty wherever nobody has. */
export function editorialIntent(notes: ChannelEditorial | undefined): ManifestEditorial {
  const clean = cleanEditorial(notes) ?? {}
  return {
    purpose: clean.purpose ?? null,
    include: clean.include ?? null,
    exclude: clean.exclude ?? null,
    sourceNotes: clean.sourceNotes ?? null,
    desiredCoverage: clean.desired ?? null,
    gaps: clean.gaps ?? null,
    eras: clean.eras ?? null,
    curatorNotes: clean.notes ?? null,
    tags: clean.tags ?? [],
    targets: { hours: clean.targetHours ?? null, programmes: clean.targetProgrammes ?? null },
    status: clean.status ?? 'unreviewed',
    related: clean.related ?? [],
    artwork: clean.artwork ?? null,
  }
}

function sourceTypeOf(source: ChannelSource): string {
  if (source.kind === 'youtube') return youTubeSourceType(source) === 'playlist' ? 'youtube-playlist' : 'youtube-channel'
  return source.kind
}

/** The manifest of one user channel, from what it holds now. Reads only. */
export function userChannelManifest(record: StoredSource): EditorialManifest {
  const sources = record.emptySlot ? [] : sourcesOf(record)
  const live = liveStreamOf(sources) !== null
  const scheduled = sources.filter((source) => !isStreamSource(source) && source.kind !== 'tvn')
  const seen = new Set<string>()
  const programmes: { sourceId: string; durationSec: number; programmeType: string; year: number | null }[] = []
  if (!live) {
    for (const source of scheduled) {
      if (!source.enabled) continue
      for (const video of eligibleOf(source)) {
        if (seen.has(video.id)) continue
        seen.add(video.id)
        programmes.push({ sourceId: source.id, durationSec: video.durationSec, programmeType: programmeTypeFor(video.durationSec), year: videoYear(video) })
      }
    }
  }
  const facts = sources.map((source) => ({
    id: source.id,
    label: source.label || source.url || SOURCE_TYPES[source.kind].label,
    sourceType: sourceTypeOf(source),
    enabled: source.enabled,
    ...(isStreamSource(source) || source.kind === 'tvn' ? {} : { held: source.videos?.length ?? 0, mode: sourceModeOf(source) }),
  }))
  return {
    format: EDITORIAL_MANIFEST_FORMAT,
    scope: 'user',
    channel: { number: record.channelNumber ?? 0, name: record.name },
    current: currentFacts(programmes, facts, live),
    editorial: editorialIntent(record.editorial),
    filters: scheduled.map((source) => ({ source: source.id, label: source.label, mode: sourceModeOf(source), filter: source.filter ? structuredClone(source.filter) : null })),
  }
}

/**
 * The manifest of a 001–999 channel as the viewer has curated it. While TVN's own programming carries the
 * channel, the facts are its shipped programmes less any the viewer has left out.
 */
export function curatedChannelManifest(
  number: number,
  edit: Pick<ChannelEdit, 'name' | 'sources' | 'order' | 'excluded' | 'editorial' | 'originals'>,
  shippedList: readonly { id: string; durationSeconds: number; year?: number }[],
  originals: readonly OriginalSource[] = [],
): EditorialManifest {
  const own = edit.sources.filter((source) => source.kind !== 'tvn')
  const record: StoredSource = { id: `tvn-${number}`, name: edit.name, videos: [], channelNumber: number, inLibrary: false, automatic: true, updatedAt: 0, channelSources: edit.sources, runningOrder: edit.order, editorial: edit.editorial }
  const base = { ...userChannelManifest(record), scope: 'central' as const }
  const tvnOn = edit.sources.some((source) => source.kind === 'tvn' && source.enabled)
  const replaced = Boolean(liveStreamOf(own)) || own.some((source) => source.enabled && eligibleOf(source).length > 0)
  const manifest = { ...base, provenance: provenanceOf(edit, originals, base.current.sources, replaced) }
  if (!tvnOn || replaced) return manifest
  const left = new Set(edit.excluded ?? [])
  if (originals.length > 0) {
    const seen = new Set<string>()
    const programmes = originals.flatMap((source) => {
      const made = originalChannelSource(source, edit.originals?.find((item) => item.ref === source.ref))
      if (!made.enabled) return []
      return eligibleOf(made).flatMap((video) => {
        if (left.has(video.id) || seen.has(video.id)) return []
        seen.add(video.id)
        return [{ sourceId: made.id, durationSec: video.durationSec, programmeType: programmeTypeFor(video.durationSec), year: videoYear(video) }]
      })
    })
    const facts = [
      ...manifest.current.sources,
      ...originals.map((source) => ({ id: originalChannelSource(source).id, label: source.name, sourceType: 'tvn-original', enabled: edit.originals?.find((item) => item.ref === source.ref)?.enabled ?? true, held: source.videos.length })),
    ]
    return { ...manifest, current: currentFacts(programmes, facts) }
  }
  const programmes = shippedList
    .filter((programme) => !left.has(programme.id))
    .map((programme) => ({ sourceId: 'tvn', durationSec: programme.durationSeconds, programmeType: programmeTypeFor(programme.durationSeconds), year: programme.year ?? null }))
  return { ...manifest, current: currentFacts(programmes, manifest.current.sources) }
}

function provenanceOf(
  edit: Pick<ChannelEdit, 'originals'>,
  originals: readonly OriginalSource[],
  facts: readonly ManifestSourceFact[],
  replaced: boolean,
): ManifestProvenance {
  const rows = originals.map((source) => {
    const override = edit.originals?.find((item) => item.ref === source.ref)
    return { source, override, ...contributionOf(source, override) }
  })
  const total = rows.reduce((sum, row) => sum + row.seconds, 0)
  return {
    shippedSources: rows.map(({ source, override, programmes, seconds }) => ({
      ref: source.ref,
      name: source.name,
      provider: source.provider,
      url: source.url ?? null,
      registered: source.registered,
      shipped: source.videos.length,
      enabled: override?.enabled ?? true,
      filtered: Boolean(override?.filter),
      programmes,
      seconds,
      share: total > 0 ? round(seconds / total, 3) : 0,
    })),
    localSourceOverrides: (edit.originals ?? []).map((override) => structuredClone(override)),
    addedSources: facts
      .filter((fact) => fact.sourceType !== 'tvn')
      .map(({ id, label, sourceType, enabled, programmes, seconds }) => ({ id, label, sourceType, enabled, programmes, seconds })),
    tvnReplaced: replaced,
  }
}

function filterLines(filter: SourceFilter | null): string[] {
  if (!filter) return ['everything the source holds']
  const lines: string[] = []
  const inc = filter.include ?? {}
  const exc = filter.exclude ?? {}
  if (inc.terms?.length) lines.push(`include titles containing: ${inc.terms.join(', ')}`)
  if (inc.playlists?.length) lines.push(`include playlists: ${inc.playlists.join(', ')}`)
  if (inc.minSeconds !== undefined) lines.push(`at least ${Math.round(inc.minSeconds / 60)} min`)
  if (inc.maxSeconds !== undefined) lines.push(`at most ${Math.round(inc.maxSeconds / 60)} min`)
  if (inc.yearFrom !== undefined || inc.yearTo !== undefined)
    lines.push(`era ${inc.yearFrom ?? '…'}–${inc.yearTo ?? '…'}${inc.unknownYear === 'drop' ? ' (unknown years left out)' : ''}`)
  if (exc.terms?.length) lines.push(`exclude titles containing: ${exc.terms.join(', ')}`)
  if (exc.shorts) lines.push('exclude Shorts')
  return lines.length ? lines : ['everything the source holds']
}

const or = (text: string | null) => text ?? '(not written)'

function provenanceLines(provenance: ManifestProvenance): string[] {
  const hm = (seconds: number) => {
    const minutes = Math.round(seconds / 60)
    return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`
  }
  const out = ['', '## SHIPPED SOURCES']
  if (provenance.shippedSources.length === 0) out.push('(none recorded)')
  for (const source of provenance.shippedSources) {
    const who = [source.provider, source.url].filter(Boolean).join(' · ')
    const now = source.enabled ? `${source.programmes} programmes · ${hm(source.seconds)} · ${Math.round(source.share * 100)}%${source.filtered ? ' · filtered' : ''}` : 'disabled'
    out.push(`- ${source.name}${who ? ` (${who})` : ''} · ${source.shipped} shipped · now ${now}`)
  }
  if (provenance.tvnReplaced) out.push('Added sources carry this channel in place of these.')
  out.push('', '## LOCAL SOURCE OVERRIDES')
  if (provenance.localSourceOverrides.length === 0) out.push('(none)')
  for (const override of provenance.localSourceOverrides) {
    out.push(`- ${override.name || override.ref}: ${override.enabled ? 'enabled' : 'disabled'}${override.filter ? ` · filter: ${filterLines(override.filter).join('; ')}` : ''}`)
  }
  out.push('', '## ADDED SOURCES')
  if (provenance.addedSources.length === 0) out.push('(none)')
  for (const source of provenance.addedSources) out.push(`- ${source.label} (${source.sourceType}${source.enabled ? '' : ', disabled'}) · ${source.programmes} programmes · ${hm(source.seconds)}`)
  return out
}

/**
 * The human-readable channel manifest (Markdown, also readable as plain text). The JSON channel file is
 * authoritative; this is for reading and sharing.
 */
export function manifestText(manifest: EditorialManifest, record?: StoredSource): string {
  const { channel, current, editorial } = manifest
  const share = (value: number) => `${Math.round(value * 100)}%`
  const out: string[] = []
  out.push(`# CHANNEL ${channel.number} · ${channel.name}`, '')
  out.push(`Status: ${editorial.status.toUpperCase()}`, '')
  out.push('## PURPOSE', or(editorial.purpose), '')
  out.push('## CURRENT SOURCES')
  if (current.sources.length === 0) out.push('(none)')
  for (const source of current.sources) {
    const mode = source.mode ? ` · ${SOURCE_MODE_LABELS[source.mode]}` : ''
    const held = source.held !== undefined ? ` · ${source.programmes} eligible of ${source.held} held` : ''
    out.push(`- ${source.label} (${source.sourceType}${source.enabled ? '' : ', disabled'})${mode}${held}`)
  }
  if (manifest.provenance) out.push(...provenanceLines(manifest.provenance))
  out.push('', '## FILTERS')
  if (manifest.filters.length === 0) out.push('(no scheduled sources)')
  for (const entry of manifest.filters) out.push(`- ${entry.label || entry.source} · ${SOURCE_MODE_LABELS[entry.mode]}: ${filterLines(entry.filter).join('; ')}`)
  out.push('', '## PROGRAMMES', current.live ? 'A continuous live stream.' : String(current.programmeCount), '')
  out.push('## HOURS', current.hours.toFixed(2), '')
  out.push('## PROGRAMME TYPES')
  const types = Object.entries(current.programmeTypes)
  out.push(types.length ? types.map(([type, count]) => `${type} ${count}`).join(' · ') : '(none)')
  if (current.sourceConcentration.largestSource) {
    const largest = current.sources.find((source) => source.id === current.sourceConcentration.largestSource)
    out.push(
      '',
      `Largest source: ${largest?.label ?? current.sourceConcentration.largestSource} · ${share(current.sourceConcentration.programmeShare)} of programmes · ${share(current.sourceConcentration.hoursShare)} of hours`,
    )
  }
  if (current.earliestKnownYear !== null) out.push(`Known years: ${current.earliestKnownYear}–${current.latestKnownYear}`)
  out.push('', '## EDITORIAL NOTES')
  out.push(`Include: ${or(editorial.include)}`, `Exclude: ${or(editorial.exclude)}`, `Sources: ${or(editorial.sourceNotes)}`, `Eras: ${or(editorial.eras)}`)
  out.push(`Desired coverage: ${or(editorial.desiredCoverage)}`, `Tags: ${editorial.tags.length ? editorial.tags.join(', ') : '(none)'}`)
  out.push('', '## KNOWN GAPS', or(editorial.gaps), '')
  out.push('## RELATED CHANNELS', editorial.related.length ? editorial.related.join(', ') : '(none)', '')
  out.push('## CURATOR NOTES', or(editorial.curatorNotes), '')
  out.push('## TARGETS')
  out.push(`Hours: ${editorial.targets.hours ?? '(not set)'}${editorial.targets.hours ? ` · now ${current.hours.toFixed(1)}` : ''}`)
  out.push(`Programmes: ${editorial.targets.programmes ?? '(not set)'}${editorial.targets.programmes ? ` · now ${current.programmeCount}` : ''}`)
  if (record?.runningOrder?.length) {
    const titles = new Map(sourcesOf(record).flatMap((source) => (source.videos ?? []).map((video) => [video.id, video.title] as const)))
    out.push('', '## RUNNING ORDER')
    record.runningOrder.forEach((id, index) => out.push(`${index + 1}. ${titles.get(id) ?? id}`))
  }
  out.push('', `Generated by TVN from ${EDITORIAL_MANIFEST_FORMAT}. Facts are calculated; editorial notes are the channel owner's own.`, '')
  return out.join('\n')
}
