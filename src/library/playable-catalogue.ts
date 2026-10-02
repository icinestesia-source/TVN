import { eraChannelsFor, eraMembership, genreChannelsFor, viableGenreChannels, type OriginalYear } from './metadata-channels.ts'
import type { LibraryMedia } from './types.ts'

/** [videoId, title, durationSeconds, sourceId, channels, durationOrigin] */
export type PlayableRow = [string, string, number, string, number[], 'api' | 'player']

export interface PlayableCatalogueV2 {
  format: 'retrotv-playable-v2'
  generatedAt: number
  sources: Record<string, string>
  items: PlayableRow[]
  /** Programme-level routing: channel number -> the video ids editorially chosen for it. */
  programmeRoutes?: Record<string, string[]>
  /** DEDICATED_HOME or BROAD_PROGRAMME_ROUTED, for sources whose programmes are routed individually. */
  sourceClasses?: Record<string, string>
  /** videoId -> [year, basis, provenance, confidence, evidence], from scripts/original_years.py. */
  originals?: Record<string, [number, OriginalYear['basis'], OriginalYear['source'], OriginalYear['confidence'], string]>
  /** videoId -> genres from the publisher's structured genre field, from scripts/film_genres.py. */
  filmGenres?: Record<string, string[]>
  /** videoId -> [Wikidata QID, genres] for trailers matched on exact title and original year, from scripts/trailer_genres.py. */
  trailerGenres?: Record<string, [string, string[]]>
  /** videoId -> upload time (ISO) for rolling-channel programmes, from scripts/dynamic_refresh.py. */
  published?: Record<string, string>
}

const DURATION_REASON = {
  api: 'YouTube Data API videos.list contentDetails.duration',
  player: 'YouTube IFrame Player API getDuration()',
}

function mediaFromRow(
  row: PlayableRow,
  sources: Record<string, string>,
  stamp: number,
  routed: readonly number[] = [],
  original?: OriginalYear,
  eras: readonly number[] = [],
  genres: readonly number[] = [],
  publishedAt?: string,
): LibraryMedia | null {
  const [videoId, title, durationSeconds, sourceId, rawChannels, origin] = row
  const channels = [...new Set([...rawChannels, ...routed, ...eras, ...genres])].filter((number) => number >= 0 && number <= 999)
  if (!videoId || !title || !(durationSeconds > 0) || channels.length === 0) return null
  const sourceName = sources[sourceId] ?? sourceId
  return {
    id: `yt:${videoId}`,
    title,
    durationSeconds,
    durationSec: durationSeconds,
    programmeType: 'unclassified',
    topics: [],
    subjects: [],
    provider: 'youtube',
    providerItemId: videoId,
    externalId: videoId,
    originalExternalId: videoId,
    sourceId,
    sourceRef: `youtube:${videoId}`,
    mediaKind: 'video',
    playbackKind: 'seekable-recorded',
    live: false,
    isLive: false,
    canSeek: true,
    explicitChannelIncludes: channels,
    ...(routed.length ? { curatedChannels: [...routed] } : {}),
    ...(original ? { original } : {}),
    ...(eras.length ? { eraChannels: [...eras] } : {}),
    ...(genres.length ? { genreChannels: [...genres] } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    eligibleChannels: channels,
    metadataConfidence: 'high',
    metadataOrigins: {
      title: { origin: 'source', confidence: 'high', reason: 'supplied with the discovery record', rule: 'discovery' },
      durationSeconds: { origin: 'source', confidence: 'high', reason: DURATION_REASON[origin], rule: origin },
    },
    classification: [],
    candidateTopics: [],
    ingestedAt: stamp,
    ingestedFrom: 'youtube-discovery',
    sourceCollection: sourceName,
    memberships: [{ sourceId, sourceName, present: true }],
    watched: false,
    userEditedMetadata: [],
    availability: 'available',
    failureCount: 0,
    createdAt: stamp,
    updatedAt: stamp,
  }
}

const sameNumbers = (a: readonly number[] = [], b: readonly number[] = []) => a.length === b.length && a.every((value, index) => value === b[index])

/** What the shipped catalogue alone decides about a programme: its listing and every channel route. */
function sameCatalogueFacts(a: LibraryMedia, b: LibraryMedia): boolean {
  const memberships = (item: LibraryMedia) => (item.memberships ?? []).map((membership) => `${membership.sourceId}:${membership.present}`).join('|')
  return (
    a.title === b.title &&
    a.durationSeconds === b.durationSeconds &&
    a.sourceId === b.sourceId &&
    a.publishedAt === b.publishedAt &&
    a.original?.year === b.original?.year &&
    sameNumbers(a.explicitChannelIncludes, b.explicitChannelIncludes) &&
    sameNumbers(a.curatedChannels, b.curatedChannels) &&
    sameNumbers(a.eraChannels, b.eraChannels) &&
    sameNumbers(a.genreChannels, b.genreChannels) &&
    memberships(a) === memberships(b)
  )
}

/**
 * The shipped catalogue is the authority on its own programmes: a stored copy that lists or routes one
 * differently is replaced whatever its stamp says, since a stamp can be newer only because the browser
 * touched the record. A programme the viewer has corrected is kept unless the catalogue itself is newer.
 */
export function shippedRecordSupersedes(stored: LibraryMedia, shipped: LibraryMedia): boolean {
  if ((stored.userEditedMetadata ?? []).length > 0) return stored.updatedAt < shipped.updatedAt
  return !sameCatalogueFacts(stored, shipped) || stored.updatedAt < shipped.updatedAt
}

/** Accepts the compact v2 catalogue or the original array of full records. */
export function expandPlayableCatalogue(raw: unknown): LibraryMedia[] {
  if (Array.isArray(raw)) return raw as LibraryMedia[]
  const doc = raw as Partial<PlayableCatalogueV2> | null
  if (!doc || doc.format !== 'retrotv-playable-v2' || !Array.isArray(doc.items)) return []
  const stamp = doc.generatedAt ?? 0
  const sources = doc.sources ?? {}
  const routes = new Map<string, number[]>()
  for (const [channel, ids] of Object.entries(doc.programmeRoutes ?? {})) {
    for (const id of ids) routes.set(id, [...(routes.get(id) ?? []), Number(channel)])
  }
  const originals = doc.originals ?? {}
  const dated = doc.items.map((row) => {
    const entry = originals[row[0]]
    const original: OriginalYear | undefined = entry
      ? { year: entry[0], basis: entry[1], source: entry[2], confidence: entry[3], evidence: entry[4] }
      : undefined
    const eras = eraChannelsFor({ sourceId: row[3], title: row[1], durationSeconds: row[2], original })
    const genreChannels = genreChannelsFor({ sourceId: row[3], durationSeconds: row[2], genres: doc.filmGenres?.[row[0]] ?? doc.trailerGenres?.[row[0]]?.[1] })
    return { row, original, eras, genreChannels, sourceId: row[3], title: row[1], durationSeconds: row[2] }
  })
  const { viable, dropped } = eraMembership(dated)
  const viableGenres = viableGenreChannels(dated)
  const out: LibraryMedia[] = []
  for (const [index, { row, original, eras, genreChannels }] of dated.entries()) {
    const item = mediaFromRow(
      row,
      sources,
      stamp,
      routes.get(row[0]),
      original,
      eras.filter((channel) => viable.has(channel) && !dropped.get(channel)?.has(index)),
      genreChannels.filter((channel) => viableGenres.has(channel)),
      doc.published?.[row[0]],
    )
    if (item) out.push(item)
  }
  return out
}
