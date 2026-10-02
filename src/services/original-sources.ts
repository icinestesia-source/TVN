import type { MediaItem } from '../director/types.ts'
import { cleanFilter, eligibleOf, type SourceFilter } from './channel-curation.ts'
import type { ImportedVideo } from './channels-import.ts'
import type { ChannelSource } from './channel-sources.ts'

/**
 * The sources behind a TVN 001–999 channel's own programming, read from the records TVN already keeps: each
 * library programme's recorded source id, named by the generated source register. Nothing is inferred from
 * a title or uploader name; a programme with no recorded source is listed under the TVN catalogue, honestly
 * unsourced. These are computed every time and never stored: only the viewer's decisions about them are.
 */

export const UNSOURCED_REF = 'tvn-catalogue'
export const UNSOURCED_NAME = 'TVN catalogue · source unavailable'
export const ORIGINAL_ID_PREFIX = 'tvn:'
export const ORIGINAL_LIMITS = { overrides: 200, ref: 120, name: 200 } as const

export interface OriginalSource {
  /** The register's source id (`src_…`), or UNSOURCED_REF. */
  ref: string
  name: string
  /** The originating service, when the register records one. */
  provider: string | null
  /** The publisher's page, when the register records one. */
  url?: string
  /** Named in the source register. False for an unregistered id and for the unsourced group. */
  registered: boolean
  /** TVN's playable programmes from this source on this channel, each video once. */
  videos: ImportedVideo[]
}

/** The viewer's decision about one original source; a source with no decision plays as TVN ships it. */
export interface OriginalOverride {
  ref: string
  enabled: boolean
  /** A local filter over TVN's programmes from this source. Nothing is fetched. */
  filter?: SourceFilter
  /** The source as it was when decided, so a later TVN can tell whether it is still the same source. */
  name: string
  programmes: number
}

interface RegisterLike {
  sources: Readonly<Record<string, { name: string; provider?: string; channelUrl?: string; website?: string }>>
}

/** What the grouping needs of a programme. */
export interface PoolEntry {
  videoId: string | null
  title: string
  durationSeconds: number
  sourceId?: string
  year?: number
  publishedAt?: string
}

export function poolEntryOf(item: MediaItem): PoolEntry {
  const sourceId = (item as { sourceId?: unknown }).sourceId
  return {
    videoId: item.provider === 'youtube' && item.externalId ? item.externalId : null,
    title: item.title,
    durationSeconds: item.durationSeconds,
    sourceId: typeof sourceId === 'string' && sourceId ? sourceId : undefined,
    year: item.original?.year ?? item.year,
    publishedAt: item.publishedAt,
  }
}

const httpUrl = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

/** The channel's original sources, largest contribution first; unsourced programmes last. */
export function originalSourcesOf(pool: readonly PoolEntry[], register: RegisterLike = { sources: {} }): OriginalSource[] {
  const groups = new Map<string, OriginalSource>()
  const seen = new Set<string>()
  for (const entry of pool) {
    if (!entry.videoId || seen.has(entry.videoId)) continue
    seen.add(entry.videoId)
    const ref = entry.sourceId ?? UNSOURCED_REF
    let group = groups.get(ref)
    if (!group) {
      const recorded = entry.sourceId ? register.sources[entry.sourceId] : undefined
      group = {
        ref,
        name: recorded?.name ?? (entry.sourceId ? `${entry.sourceId} · not in the source register` : UNSOURCED_NAME),
        provider: recorded?.provider ?? null,
        url: httpUrl(recorded?.channelUrl) ?? httpUrl(recorded?.website),
        registered: Boolean(recorded),
        videos: [],
      }
      groups.set(ref, group)
    }
    group.videos.push({
      id: entry.videoId,
      title: entry.title,
      durationSec: entry.durationSeconds,
      ...(entry.publishedAt ? { published: entry.publishedAt.slice(0, 10) } : {}),
      ...(entry.year ? { year: entry.year } : {}),
    })
  }
  return [...groups.values()].sort((a, b) => Number(a.ref === UNSOURCED_REF) - Number(b.ref === UNSOURCED_REF) || b.videos.length - a.videos.length || a.name.localeCompare(b.name))
}

/** A filter needs a real source behind it; the unsourced group can only be switched on or off. */
export function canFilter(source: Pick<OriginalSource, 'ref'>): boolean {
  return source.ref !== UNSOURCED_REF
}

/**
 * An original source as a channel source, for the filter preview and for building the viewer's channel. It
 * is made on demand from TVN's records and never saved.
 */
export function originalChannelSource(source: OriginalSource, override?: OriginalOverride): ChannelSource {
  return {
    id: `${ORIGINAL_ID_PREFIX}${source.ref}`,
    kind: 'collection',
    url: source.url ?? '',
    label: source.name,
    enabled: override?.enabled ?? true,
    ref: source.ref,
    videos: source.videos,
    ...(override?.filter && canFilter(source) ? { filter: override.filter } : {}),
  }
}

export interface Contribution {
  programmes: number
  seconds: number
}

/** What a source gives the channel now: through its filter, nothing when switched off. */
export function contributionOf(source: OriginalSource, override?: OriginalOverride): Contribution {
  const made = originalChannelSource(source, override)
  const videos = made.enabled ? eligibleOf(made) : []
  return { programmes: videos.length, seconds: videos.reduce((sum, video) => sum + video.durationSec, 0) }
}

/** The decision to keep: a switched-off or filtered source, with the identity it was made against. */
export function originalOverrideOf(source: OriginalSource, enabled: boolean, filter: SourceFilter | undefined): OriginalOverride | null {
  const clean = canFilter(source) ? cleanFilter(filter) : undefined
  if (enabled && !clean) return null
  return { ref: source.ref, enabled, ...(clean ? { filter: clean } : {}), name: source.name, programmes: source.videos.length }
}

/** Replaces (or drops) one source's decision in a list of decisions. */
export function withOriginalOverride(list: readonly OriginalOverride[] | undefined, ref: string, next: OriginalOverride | null): OriginalOverride[] | undefined {
  const rest = (list ?? []).filter((item) => item.ref !== ref)
  const out = next ? [...rest, next] : rest
  return out.length ? out : undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Stored or imported decisions in canonical form: valid ones only, each source once, no-op decisions dropped. */
export function cleanOriginals(raw: unknown): OriginalOverride[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const seen = new Set<string>()
  const out: OriginalOverride[] = []
  for (const item of raw) {
    if (!isRecord(item) || typeof item.ref !== 'string' || !item.ref || item.ref.length > ORIGINAL_LIMITS.ref || seen.has(item.ref)) continue
    if (typeof item.enabled !== 'boolean') continue
    const filter = item.ref === UNSOURCED_REF ? undefined : cleanFilter(item.filter)
    if (item.enabled && !filter) continue
    const name = typeof item.name === 'string' ? item.name.slice(0, ORIGINAL_LIMITS.name) : ''
    const programmes = typeof item.programmes === 'number' && Number.isInteger(item.programmes) && item.programmes >= 0 ? item.programmes : 0
    seen.add(item.ref)
    out.push({ ref: item.ref, enabled: item.enabled, ...(filter ? { filter } : {}), name, programmes })
    if (out.length >= ORIGINAL_LIMITS.overrides) break
  }
  return out.length ? out : undefined
}

/** Problems with one override in an export: the whole section is refused if any is found. */
export function checkOriginals(value: unknown, at: string, errors: string[]): void {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length > ORIGINAL_LIMITS.overrides) {
    errors.push(`${at} is not a list of at most ${ORIGINAL_LIMITS.overrides} source decisions`)
    return
  }
  const allowed = new Set(['ref', 'enabled', 'filter', 'name', 'programmes'])
  value.forEach((item, index) => {
    const where = `${at}[${index}]`
    if (!isRecord(item)) {
      errors.push(`${where} is not a source decision`)
      return
    }
    for (const key of Object.keys(item)) if (!allowed.has(key)) errors.push(`${where}.${key} is not a source decision field`)
    if (typeof item.ref !== 'string' || !item.ref || item.ref.length > ORIGINAL_LIMITS.ref) errors.push(`${where}.ref is not a source id`)
    if (typeof item.enabled !== 'boolean') errors.push(`${where}.enabled is not true or false`)
    if (typeof item.name !== 'string') errors.push(`${where}.name is missing`)
    if (typeof item.programmes !== 'number' || !Number.isInteger(item.programmes) || item.programmes < 0) errors.push(`${where}.programmes is not a count`)
    if (item.filter !== undefined && !cleanFilter(item.filter)) errors.push(`${where}.filter is not a source filter`)
  })
}

/**
 * Decisions that still fit the channel TVN ships now. A source TVN no longer ships is set aside and reported,
 * never applied to another; a renamed or much changed source keeps its decision and is reported. With no
 * library to compare against (it has not loaded), everything is kept as it was.
 */
export function reconcileOriginals(
  overrides: readonly OriginalOverride[] | undefined,
  current: readonly OriginalSource[],
  label: string,
): { kept: OriginalOverride[] | undefined; conflicts: string[] } {
  if (!overrides?.length) return { kept: undefined, conflicts: [] }
  if (current.length === 0) return { kept: [...overrides], conflicts: [] }
  const conflicts: string[] = []
  const kept: OriginalOverride[] = []
  for (const override of overrides) {
    const now = current.find((source) => source.ref === override.ref)
    const was = override.name || override.ref
    if (!now) {
      conflicts.push(`TVN no longer ships ${was} on ${label} · your decision about it was set aside`)
      continue
    }
    if (now.registered && override.name && override.name !== now.name) conflicts.push(`TVN renamed ${label}'s source ${override.name} to ${now.name}`)
    else if (override.programmes > 0 && Math.abs(now.videos.length - override.programmes) > override.programmes / 2) {
      conflicts.push(`${now.name} on ${label} has changed (${override.programmes} → ${now.videos.length} programmes) · check your decision`)
    }
    kept.push(override)
  }
  return { kept: kept.length ? kept : undefined, conflicts }
}

/** The decisions that apply now: only those naming a source TVN still ships on the channel. */
export function activeOriginals(overrides: readonly OriginalOverride[] | undefined, current: readonly OriginalSource[]): OriginalOverride[] {
  if (!overrides?.length) return []
  const refs = new Set(current.map((source) => source.ref))
  return overrides.filter((override) => refs.has(override.ref))
}

/** Every original source as a channel source, with its decision laid over it. */
export function originalChannelSources(current: readonly OriginalSource[], overrides: readonly OriginalOverride[] | undefined): ChannelSource[] {
  return current.map((source) => originalChannelSource(source, overrides?.find((item) => item.ref === source.ref)))
}
