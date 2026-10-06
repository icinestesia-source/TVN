import type { ChannelSource } from './channel-sources.ts'
import type { ImportedVideo } from './channels-import.ts'

/**
 * Curation for User Network channels: what a scheduled source contributes (its filter), how much of the
 * source's history TVN reaches for (its mode), and the viewer's own editorial notes about the channel.
 *
 * SOURCE → FILTER → ELIGIBLE PROGRAMMES → RUNNING ORDER / SCHEDULER. A source keeps everything its last
 * scan found; the filter only decides which of those programmes are eligible, so changing or clearing a
 * filter never needs a rescan and never loses anything. Editorial notes describe intent and never decide
 * what plays.
 */

/**
 * RECENT: the source's newest uploads, newest weighted (TVN's original behaviour).
 * ARCHIVE: every upload the source's page lists plus TVN's shipped back catalogue, spread evenly across the span.
 * ALL: as ARCHIVE, and every rescan adds to what was found before instead of replacing it.
 */
export type SourceMode = 'recent' | 'archive' | 'all'
export const SOURCE_MODES: readonly SourceMode[] = ['recent', 'archive', 'all']
export const SOURCE_MODE_LABELS: Record<SourceMode, string> = { recent: 'Recent', archive: 'Archive', all: 'All matching' }
/** A source never holds more than this many programmes, whatever its mode or however many batches are loaded. */
export const MAX_SOURCE_VIDEOS = 2000

/**
 * A small structured filter, not a language. Include rules narrow: a programme must match one of the
 * terms or come from one of the playlists (when either is set), and must fall inside the duration and
 * era bounds. Exclude rules always win.
 */
export interface SourceFilter {
  include?: {
    /** Title contains any of these (case and accents ignored). */
    terms?: string[]
    /** YouTube playlist ids; their programmes are read at rescan and count as matching. */
    playlists?: string[]
    minSeconds?: number
    maxSeconds?: number
    /** Era bounds, applied where the programme's year is known (its title or upload date). */
    yearFrom?: number
    yearTo?: number
    /** What an era filter does with a programme whose year is unknown. Kept unless set to drop. */
    unknownYear?: 'keep' | 'drop'
  }
  exclude?: {
    terms?: string[]
    /** YouTube Shorts: a minute or less, or tagged #shorts in the title. */
    shorts?: boolean
  }
}

export const FILTER_LIMITS = { terms: 20, termLength: 80, playlists: 10, maxSeconds: 24 * 3600, firstYear: 1900, lastYear: 2100 } as const
const PLAYLIST_ID = /^(?:PL|OL|UU|FL)[0-9A-Za-z_-]{10,64}$/
const SHORTS_SECONDS = 60

export function sourceModeOf(source: Pick<ChannelSource, 'mode'>): SourceMode {
  return source.mode && SOURCE_MODES.includes(source.mode) ? source.mode : 'recent'
}

function normalise(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, ' ')
    .trim()
}

/** Terms typed by the viewer: separated by commas, semicolons or new lines. */
export function parseTerms(text: string): string[] {
  return cleanTerms(text.split(/[,;\n]+/))
}

export function formatTerms(terms: readonly string[] | undefined): string {
  return (terms ?? []).join(', ')
}

function cleanTerms(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const term = item.replace(/\s+/g, ' ').trim().slice(0, FILTER_LIMITS.termLength)
    const key = normalise(term)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(term)
    if (out.length >= FILTER_LIMITS.terms) break
  }
  return out
}

/** A playlist id, from the id itself or any YouTube address carrying `list=`. */
export function playlistIdOf(text: string): string | null {
  const trimmed = text.trim()
  if (PLAYLIST_ID.test(trimmed)) return trimmed
  const match = trimmed.match(/[?&]list=([0-9A-Za-z_-]+)/)
  return match && PLAYLIST_ID.test(match[1]) ? match[1] : null
}

function cleanPlaylists(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const ids = raw.flatMap((item) => (typeof item === 'string' ? (playlistIdOf(item) ?? []) : []))
  return [...new Set(ids)].slice(0, FILTER_LIMITS.playlists)
}

function cleanSeconds(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.min(Math.round(raw), FILTER_LIMITS.maxSeconds) : undefined
}

function cleanYear(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= FILTER_LIMITS.firstYear && raw <= FILTER_LIMITS.lastYear ? raw : undefined
}

/** The filter in its canonical shape, or undefined when it asks for nothing. Anything malformed is dropped, never guessed. */
export function cleanFilter(raw: unknown): SourceFilter | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const { include: inc, exclude: exc } = raw as { include?: unknown; exclude?: unknown }
  const i = inc && typeof inc === 'object' && !Array.isArray(inc) ? (inc as Record<string, unknown>) : {}
  const e = exc && typeof exc === 'object' && !Array.isArray(exc) ? (exc as Record<string, unknown>) : {}
  const terms = cleanTerms(i.terms)
  const playlists = cleanPlaylists(i.playlists)
  let minSeconds = cleanSeconds(i.minSeconds)
  let maxSeconds = cleanSeconds(i.maxSeconds)
  if (minSeconds !== undefined && maxSeconds !== undefined && minSeconds > maxSeconds) [minSeconds, maxSeconds] = [maxSeconds, minSeconds]
  let yearFrom = cleanYear(i.yearFrom)
  let yearTo = cleanYear(i.yearTo)
  if (yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo) [yearFrom, yearTo] = [yearTo, yearFrom]
  const era = yearFrom !== undefined || yearTo !== undefined
  const include = {
    ...(terms.length ? { terms } : {}),
    ...(playlists.length ? { playlists } : {}),
    ...(minSeconds !== undefined ? { minSeconds } : {}),
    ...(maxSeconds !== undefined ? { maxSeconds } : {}),
    ...(yearFrom !== undefined ? { yearFrom } : {}),
    ...(yearTo !== undefined ? { yearTo } : {}),
    ...(era && i.unknownYear === 'drop' ? { unknownYear: 'drop' as const } : {}),
  }
  const excludeTerms = cleanTerms(e.terms)
  const exclude = { ...(excludeTerms.length ? { terms: excludeTerms } : {}), ...(e.shorts === true ? { shorts: true } : {}) }
  const out: SourceFilter = { ...(Object.keys(include).length ? { include } : {}), ...(Object.keys(exclude).length ? { exclude } : {}) }
  return Object.keys(out).length ? out : undefined
}

/** The year a programme belongs to, when TVN knows it: a stated year, a year in its title, or its upload date. */
export function videoYear(video: Pick<ImportedVideo, 'title' | 'year' | 'published'>): number | null {
  if (cleanYear(video.year) !== undefined) return video.year as number
  const titled = video.title.match(/(?:^|[^0-9])((?:19|20)\d\d)(?![0-9])/)
  if (titled && cleanYear(Number(titled[1])) !== undefined) return Number(titled[1])
  const uploaded = video.published?.match(/^(\d{4})-/)
  return uploaded && cleanYear(Number(uploaded[1])) !== undefined ? Number(uploaded[1]) : null
}

export function isShort(video: Pick<ImportedVideo, 'title' | 'durationSec'>): boolean {
  return video.durationSec <= SHORTS_SECONDS || /#shorts?\b/i.test(video.title)
}

/** Why a programme is left out, or null when it is eligible. */
export function filterVerdict(video: ImportedVideo, filter: SourceFilter | undefined): string | null {
  if (!filter) return null
  const title = normalise(video.title)
  const has = (term: string) => {
    const key = normalise(term)
    return key.length > 0 && title.includes(key)
  }
  const { include = {}, exclude = {} } = filter
  if (exclude.shorts && isShort(video)) return 'Short'
  const banned = exclude.terms?.find(has)
  if (banned) return `Excluded term “${banned}”`
  const selectors = (include.terms?.length ?? 0) + (include.playlists?.length ?? 0)
  if (selectors > 0) {
    const termed = include.terms?.some(has) ?? false
    const listed = include.playlists?.some((id) => video.lists?.includes(id)) ?? false
    if (!termed && !listed) return 'No matching term or playlist'
  }
  if (include.minSeconds !== undefined && video.durationSec < include.minSeconds) return 'Too short'
  if (include.maxSeconds !== undefined && video.durationSec > include.maxSeconds) return 'Too long'
  if (include.yearFrom !== undefined || include.yearTo !== undefined) {
    const year = videoYear(video)
    if (year === null) return include.unknownYear === 'drop' ? 'Year unknown' : null
    if (include.yearFrom !== undefined && year < include.yearFrom) return 'Before the era'
    if (include.yearTo !== undefined && year > include.yearTo) return 'After the era'
  }
  return null
}

export function applyFilter(videos: readonly ImportedVideo[], filter: SourceFilter | undefined): ImportedVideo[] {
  return filter ? videos.filter((video) => filterVerdict(video, filter) === null) : [...videos]
}

/** Visit a list at 1/2, 1/4, 3/4, 1/8 … of its length, so any stretch of the loop samples the whole span. */
export function spread<T>(list: readonly T[]): T[] {
  const out: T[] = []
  const used = new Set<number>()
  for (let denominator = 2; used.size < list.length && denominator <= list.length * 2; denominator *= 2) {
    for (let numerator = 1; numerator < denominator; numerator += 2) {
      const index = Math.floor((numerator / denominator) * list.length)
      if (used.has(index)) continue
      used.add(index)
      out.push(list[index])
    }
  }
  list.forEach((item, index) => {
    if (!used.has(index)) out.push(item)
  })
  return out
}

/** The programmes a scheduled source makes eligible, in the order its mode gives them. */
export function eligibleOf(source: Pick<ChannelSource, 'videos' | 'filter' | 'mode' | 'removed'>): ImportedVideo[] {
  const removed = new Set(source.removed ?? [])
  const matching = applyFilter(removed.size ? (source.videos ?? []).filter((video) => !removed.has(video.id)) : (source.videos ?? []), source.filter)
  return sourceModeOf(source) === 'recent' ? matching : spread(matching)
}

/** True when the channel reaches past recent uploads: TVN then neither repeats the newest nor caps the back catalogue. */
export function reachesArchive(sources: readonly Pick<ChannelSource, 'enabled' | 'kind' | 'mode'>[]): boolean {
  return sources.some((source) => source.enabled && (source.kind === 'youtube' || source.kind === 'collection') && sourceModeOf(source) !== 'recent')
}

/** A source in ARCHIVE or ALL mode with TVN's shipped back catalogue added after what it already holds. */
export function widenSource(source: ChannelSource, archive: readonly ImportedVideo[]): ChannelSource {
  if (sourceModeOf(source) === 'recent' || archive.length === 0) return source
  const held = source.videos ?? []
  const seen = new Set(held.map((video) => video.id))
  const extra = archive.filter((video) => !seen.has(video.id))
  if (extra.length === 0) return source
  return { ...source, videos: [...held, ...extra.map((video) => ({ ...video }))].slice(0, MAX_SOURCE_VIDEOS) }
}

export interface FilterPreview {
  matches: number
  excluded: number
  matchSeconds: number
  /** The first eligible programmes, in the order the mode gives them. */
  sample: ImportedVideo[]
  /** Left-out programmes with the reason, so the viewer can see what the rules remove. */
  excludedSample: { video: ImportedVideo; reason: string }[]
}

/** What a filter and mode would make eligible from a source's current scan. Reads only; nothing is saved or reordered. */
export function previewFilter(source: Pick<ChannelSource, 'videos'>, filter: SourceFilter | undefined, mode: SourceMode, size = 8): FilterPreview {
  const all = source.videos ?? []
  const eligible = eligibleOf({ videos: all, filter, mode })
  const left = all.flatMap((video) => {
    const reason = filterVerdict(video, filter)
    return reason ? [{ video, reason }] : []
  })
  return {
    matches: eligible.length,
    excluded: left.length,
    matchSeconds: eligible.reduce((sum, video) => sum + video.durationSec, 0),
    sample: eligible.slice(0, size),
    excludedSample: left.slice(0, size),
  }
}

/** A rescan's programmes: ALL keeps everything found before (newest first, bounded); the other modes take the fresh list. */
/** Fresh copies of programmes, each keeping the upload date an earlier read found when this read gave none. */
export function keepingDates(fresh: readonly ImportedVideo[], held: readonly ImportedVideo[] = []): ImportedVideo[] {
  const dated = new Map(held.flatMap((video) => (video.published ? [[video.id, video.published] as const] : [])))
  return fresh.map((video) => {
    const published = video.published ?? dated.get(video.id)
    return published ? { ...video, published } : { ...video }
  })
}

export function rescanned(fresh: readonly ImportedVideo[], held: readonly ImportedVideo[] = [], mode: SourceMode = 'recent', deep = false): ImportedVideo[] {
  const out = keepingDates(fresh, held)
  if (mode === 'all' || deep) {
    const seen = new Set(out.map((video) => video.id))
    for (const video of held) if (!seen.has(video.id)) out.push({ ...video })
  }
  return out.slice(0, MAX_SOURCE_VIDEOS)
}

/**
 * The viewer's own editorial notes on a user channel: intent, never facts and never programming. TVN does
 * not write any of it; every field is blank until the viewer fills it.
 */
export interface ChannelEditorial {
  purpose?: string
  include?: string
  exclude?: string
  sourceNotes?: string
  desired?: string
  gaps?: string
  tags?: string[]
  eras?: string
  /** The curator's freeform research notes. */
  notes?: string
  targetHours?: number
  targetProgrammes?: number
  /** Where the curator has got to with this channel. Absent means unreviewed. Never affects playback. */
  status?: CurationStatus
  /** Other TVN channel numbers this one relates to. Metadata only: no hierarchy, nothing merged. */
  related?: number[]
  /** A web address for the channel's artwork, kept for a later Information Overlay. Nothing shows it yet. */
  artwork?: string
}

export const CURATION_STATUSES = ['unreviewed', 'reviewing', 'curated', 'revisit'] as const
export type CurationStatus = (typeof CURATION_STATUSES)[number]

export const EDITORIAL_TEXT_FIELDS = ['purpose', 'include', 'exclude', 'sourceNotes', 'desired', 'gaps', 'eras', 'notes'] as const
export const EDITORIAL_LIMITS = { text: 2000, tags: 20, tag: 40, hours: 10_000, programmes: 100_000, related: 50, artwork: 500 } as const
/** Every TVN channel number a related channel may name: 001–999 and the User Network. */
export const RELATED_NUMBER_MAX = 99_999

export function parseRelated(text: string): number[] {
  return cleanRelated(text.split(/[\s,;]+/).map((item) => Number(item)))
}

function cleanRelated(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const out: number[] = []
  for (const item of raw) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 1 || item > RELATED_NUMBER_MAX || out.includes(item)) continue
    out.push(item)
    if (out.length >= EDITORIAL_LIMITS.related) break
  }
  return out
}

/** An https address without credentials, or nothing. */
export function cleanArtwork(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > EDITORIAL_LIMITS.artwork) return undefined
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export function parseTags(text: string): string[] {
  return cleanTags(text.split(/[,;\n]+/))
}

function cleanTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const tag = item.replace(/\s+/g, ' ').trim().slice(0, EDITORIAL_LIMITS.tag)
    if (!tag || seen.has(tag.toLowerCase())) continue
    seen.add(tag.toLowerCase())
    out.push(tag)
    if (out.length >= EDITORIAL_LIMITS.tags) break
  }
  return out
}

/** Editorial notes in their canonical shape, or undefined when the viewer has written nothing. */
export function cleanEditorial(raw: unknown): ChannelEditorial | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const out: ChannelEditorial = {}
  for (const field of EDITORIAL_TEXT_FIELDS) {
    const value = record[field]
    if (typeof value !== 'string') continue
    const text = value.replace(/\r\n?/g, '\n').trim().slice(0, EDITORIAL_LIMITS.text)
    if (text) out[field] = text
  }
  const tags = cleanTags(record.tags)
  if (tags.length) out.tags = tags
  const hours = record.targetHours
  if (typeof hours === 'number' && Number.isFinite(hours) && hours > 0) out.targetHours = Math.min(Math.round(hours * 10) / 10, EDITORIAL_LIMITS.hours)
  const programmes = record.targetProgrammes
  if (typeof programmes === 'number' && Number.isFinite(programmes) && programmes > 0) out.targetProgrammes = Math.min(Math.round(programmes), EDITORIAL_LIMITS.programmes)
  if ((CURATION_STATUSES as readonly unknown[]).includes(record.status) && record.status !== 'unreviewed') out.status = record.status as CurationStatus
  const related = cleanRelated(record.related)
  if (related.length) out.related = related
  const artwork = cleanArtwork(record.artwork)
  if (artwork) out.artwork = artwork
  return Object.keys(out).length ? out : undefined
}

/** A source's mode and filter as set in Edit Channel but not yet applied. */
export interface SourceDraft {
  filter: SourceFilter | undefined
  mode: SourceMode
}

/**
 * The sources with these drafts applied, so a rescan uses the mode and filter the curator has just set. Sources
 * without a draft are returned as they are; Recent is stored as no mode.
 */
export function withSourceDrafts<T extends Pick<ChannelSource, 'id' | 'filter' | 'mode'>>(sources: readonly T[], drafts: ReadonlyMap<string, SourceDraft>): T[] {
  return sources.map((source) => {
    const draft = drafts.get(source.id)
    if (!draft) return source
    return { ...source, filter: cleanFilter(draft.filter), mode: draft.mode === 'recent' ? undefined : draft.mode }
  })
}
