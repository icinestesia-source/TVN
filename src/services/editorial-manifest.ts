import { cleanEditorial, eligibleOf, SOURCE_MODE_LABELS, sourceModeOf, videoYear, type ChannelEditorial, type SourceFilter, type SourceMode } from './channel-curation.ts'
import { sourcesOf } from './channel-editor.ts'
import { isStreamSource, liveStreamOf, SOURCE_TYPES, youTubeSourceType, type ChannelSource } from './channel-sources.ts'
import { programmeTypeFor, type StoredSource } from './channels-import.ts'

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
  tags: string[]
  targets: { hours: number | null; programmes: number | null }
}

export interface EditorialManifest {
  format: typeof EDITORIAL_MANIFEST_FORMAT
  scope: 'central' | 'user'
  channel: { number: number; name: string }
  current: ManifestCurrent
  editorial: ManifestEditorial
  /** Each scheduled source's rules: configuration, kept apart from both facts and intent. */
  filters: { source: string; label: string; mode: SourceMode; filter: SourceFilter | null }[]
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
    tags: clean.tags ?? [],
    targets: { hours: clean.targetHours ?? null, programmes: clean.targetProgrammes ?? null },
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

/**
 * The human-readable channel manifest (Markdown, also readable as plain text). The JSON channel file is
 * authoritative; this is for reading and sharing.
 */
export function manifestText(manifest: EditorialManifest, record?: StoredSource): string {
  const { channel, current, editorial } = manifest
  const share = (value: number) => `${Math.round(value * 100)}%`
  const out: string[] = []
  out.push(`# CHANNEL ${channel.number} · ${channel.name}`, '')
  out.push('## PURPOSE', or(editorial.purpose), '')
  out.push('## CURRENT SOURCES')
  if (current.sources.length === 0) out.push('(none)')
  for (const source of current.sources) {
    const mode = source.mode ? ` · ${SOURCE_MODE_LABELS[source.mode]}` : ''
    const held = source.held !== undefined ? ` · ${source.programmes} eligible of ${source.held} held` : ''
    out.push(`- ${source.label} (${source.sourceType}${source.enabled ? '' : ', disabled'})${mode}${held}`)
  }
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
