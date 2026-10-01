import type { ImportedSource, ImportedVideo, ParsedExport } from '../services/channels-import.ts'
import { classifyMedia } from './classify.ts'
import type {
  ClassificationNote,
  CollectionMembership,
  FieldOrigin,
  IngestReport,
  LibraryMedia,
  SourceRecord,
} from './types.ts'

/**
 * Watched merge policy: sticky-true.
 * A user edit of `watched` is kept.
 * Otherwise the item stays watched when either the stored record or the
 * incoming file says so. Omitting `watched` on a later import does not clear it.
 * Watched items stay eligible for television.
 *
 * A file is a snapshot of the collections it contains. Membership in those
 * collections is replaced. Collections absent from the file are marked not
 * present. Media records and source records are kept.
 */
export const WATCHED_MERGE_POLICY = 'sticky-true'

export interface ReconcileResult extends IngestReport {
  media: LibraryMedia[]
  sources: SourceRecord[]
}

function mediaIdFor(externalId: string): string {
  return `yt:${externalId}`
}

function videoWatched(video: ImportedVideo): boolean {
  return video.watched === true
}

function validVideo(video: ImportedVideo): boolean {
  return Boolean(video.id && video.title && video.durationSec > 0)
}

function userOrigin(reason = 'user correction'): FieldOrigin {
  return { origin: 'user', confidence: 'high', reason, rule: 'user' }
}

function userNote(field: string, value: string): ClassificationNote {
  return { field, value, reason: 'user correction', confidence: 'high', rule: 'user' }
}

function membershipsFor(
  previous: readonly CollectionMembership[] | undefined,
  appearances: readonly { sourceId: string; sourceName: string }[],
  incomingSourceIds: readonly string[],
): CollectionMembership[] {
  const incoming = new Set(incomingSourceIds)
  const bySource = new Map((previous ?? []).map((membership) => [membership.sourceId, { ...membership, present: false }]))
  for (const appearance of appearances) {
    bySource.set(appearance.sourceId, {
      sourceId: appearance.sourceId,
      sourceName: appearance.sourceName,
      present: true,
    })
  }
  for (const membership of bySource.values()) {
    if (!incoming.has(membership.sourceId)) membership.present = false
  }
  return [...bySource.values()].sort((left, right) => left.sourceId.localeCompare(right.sourceId))
}

function lostPresentMembership(before: readonly CollectionMembership[], after: readonly CollectionMembership[]): boolean {
  for (const membership of before) {
    if (!membership.present) continue
    const next = after.find((item) => item.sourceId === membership.sourceId)
    if (!next?.present) return true
  }
  return false
}

function fingerprint(item: LibraryMedia): string {
  return JSON.stringify({
    title: item.title,
    durationSeconds: item.durationSeconds,
    programmeType: item.programmeType,
    topics: item.topics ?? [],
    subjects: item.subjects ?? [],
    sport: item.sport ?? '',
    genres: item.genres ?? [],
    era: item.era ?? '',
    year: item.year ?? '',
    watched: item.watched,
    includes: item.explicitChannelIncludes ?? [],
    excludes: item.explicitChannelExcludes ?? [],
    priority: item.editorialPriority ?? '',
    memberships: item.memberships,
    confidence: item.metadataConfidence,
    candidates: item.candidateTopics,
  })
}

function buildMedia(
  externalId: string,
  appearances: readonly { sourceId: string; sourceName: string; video: ImportedVideo }[],
  existing: LibraryMedia | undefined,
  incomingSourceIds: readonly string[],
  now: number,
  filename: string | undefined,
  collectionHints?: readonly { programmeType?: LibraryMedia['programmeType']; topics?: string[]; subjects?: string[] }[],
): LibraryMedia {
  const video = appearances[0]?.video
  const title = video?.title ?? existing?.title ?? externalId
  const durationSeconds = video?.durationSec ?? existing?.durationSeconds ?? 0
  const names = [...new Set(appearances.map((appearance) => appearance.sourceName))]
  const classified = classifyMedia({ title, durationSeconds, collectionNames: names })
  const edited = new Set(existing?.userEditedMetadata ?? [])
  const hintedType = collectionHints?.find((hint) => hint.programmeType)?.programmeType
  const programmeType = edited.has('programmeType')
    ? existing!.programmeType
    : classified.programmeType !== 'unclassified'
      ? classified.programmeType
      : hintedType ?? classified.programmeType
  const hintedTopics = collectionHints?.flatMap((hint) => hint.topics ?? hint.subjects ?? []) ?? []
  const topics = edited.has('topics')
    ? (existing!.topics ?? [])
    : [...new Set([...classified.topics, ...hintedTopics])]
  const genres = edited.has('genres') ? existing!.genres : classified.genres
  const year = edited.has('year') ? existing!.year : classified.year
  const era = edited.has('era') ? existing!.era : classified.era
  const notes = classified.notes.filter((item) => !edited.has(item.field) && !(item.field === 'topics' && edited.has('topics')))
  const origins: Record<string, FieldOrigin> = { ...classified.origins }
  if (edited.has('programmeType')) {
    notes.unshift(userNote('programmeType', programmeType))
    origins.programmeType = userOrigin()
  }
  if (edited.has('topics')) origins.topics = userOrigin()
  if (edited.has('genres')) origins.genres = userOrigin()
  if (edited.has('year')) origins.year = userOrigin()
  if (edited.has('era')) origins.era = userOrigin()
  if (edited.has('explicitChannelIncludes')) origins.explicitChannelIncludes = userOrigin()
  if (edited.has('explicitChannelExcludes')) origins.explicitChannelExcludes = userOrigin()
  if (edited.has('editorialPriority')) origins.editorialPriority = userOrigin()
  const memberships = membershipsFor(existing?.memberships, appearances, incomingSourceIds)
  const present = memberships.filter((membership) => membership.present)
  const sourceCollection = present[0]?.sourceName ?? existing?.sourceCollection ?? names[0] ?? ''
  return {
    id: mediaIdFor(externalId),
    title,
    durationSeconds,
    programmeType,
    topics,
    subjects: edited.has('subjects') ? existing!.subjects : edited.has('topics') ? existing!.subjects : topics,
    sport: edited.has('sport') ? existing!.sport : classified.sport,
    teams: edited.has('teams') ? existing!.teams : classified.teams,
    genres,
    era,
    year,
    moods: edited.has('moods') ? existing!.moods : classified.moods,
    sourceRef: `youtube:${externalId}`,
    provider: 'youtube',
    externalId,
    originalExternalId: externalId,
    mediaKind: 'video',
    playbackKind: 'seekable-recorded',
    live: false,
    isLive: false,
    canSeek: true,
    metadataConfidence: edited.has('programmeType') ? 'high' : classified.confidence,
    metadataOrigins: origins,
    classification: notes,
    candidateTopics: edited.has('topics') ? (existing?.candidateTopics ?? []) : classified.candidateTopics,
    ingestedAt: existing?.ingestedAt ?? now,
    ingestedFrom: existing?.ingestedFrom ?? filename ?? 'channels-export',
    provenance:
      existing?.provenance ?? (filename === 'retrotv-user-network' ? 'built-in-user' : 'user-imported'),
    sourceCollection,
    memberships,
    watched: edited.has('watched') ? existing!.watched : Boolean(existing?.watched) || videoWatched(video ?? { id: '', title: '', durationSec: 0 }),
    userEditedMetadata: existing?.userEditedMetadata ?? [],
    explicitChannelIncludes: existing?.explicitChannelIncludes,
    explicitChannelExcludes: existing?.explicitChannelExcludes,
    editorialPriority: existing?.editorialPriority,
    availability: existing?.availability ?? 'unknown',
    failureCount: existing?.failureCount ?? 0,
    lastFailureAt: existing?.lastFailureAt,
    lastFailureReason: existing?.lastFailureReason,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

function sourceRecord(incoming: ImportedSource, previous: SourceRecord | undefined, now: number, mediaCount: number): SourceRecord {
  return {
    id: incoming.id,
    provider: 'youtube',
    sourceKind: 'collection',
    displayName: incoming.name,
    publisher: incoming.name,
    mediaKind: 'video',
    origin: 'user-import',
    verifiedOfficial: 'unknown',
    authorised: 'unknown',
    availability: previous?.availability ?? 'unknown',
    isLive: false,
    canSeek: true,
    categories: previous?.categories ?? [],
    editorial: previous?.editorial,
    notes: 'Imported from a user file. Official status was not supplied.',
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    mediaCount,
  }
}

export function reconcileLibrary(
  existingMedia: readonly LibraryMedia[],
  existingSources: readonly SourceRecord[],
  parsed: ParsedExport,
  now: number,
  filename?: string,
): ReconcileResult {
  const errors: string[] = []
  const incomingSourceIds = parsed.sources.map((source) => source.id)
  const incomingSourceSet = new Set(incomingSourceIds)
  const groups = new Map<string, { sourceId: string; sourceName: string; video: ImportedVideo }[]>()
  let appearances = 0

  for (const source of parsed.sources) {
    for (const video of source.videos) {
      if (!validVideo(video)) {
        errors.push(`Skipped a video on ${source.name}`)
        continue
      }
      const list = groups.get(video.id) ?? []
      list.push({ sourceId: source.id, sourceName: source.name, video })
      groups.set(video.id, list)
      appearances += 1
    }
  }

  const previousById = new Map(existingMedia.map((item) => [item.id, item]))
  const media: LibraryMedia[] = []
  let added = 0
  let updated = 0
  let unchanged = 0
  let userEditsPreserved = 0
  let missingFromImport = 0
  const seen = new Set<string>()

  for (const [externalId, group] of groups) {
    try {
      const id = mediaIdFor(externalId)
      const existing = previousById.get(id)
      const before = existing?.memberships ?? []
      const hints = group
        .map((appearance) => existingSources.find((source) => source.id === appearance.sourceId)?.editorial)
        .filter((hint): hint is NonNullable<typeof hint> => Boolean(hint))
      const item = buildMedia(externalId, group, existing, incomingSourceIds, now, filename, hints)
      if (lostPresentMembership(before, item.memberships)) missingFromImport += 1
      if (!existing) added += 1
      else if (fingerprint(existing) === fingerprint(item)) unchanged += 1
      else updated += 1
      if (existing && existing.userEditedMetadata.length > 0) userEditsPreserved += 1
      media.push(item)
      seen.add(id)
    } catch (caught) {
      errors.push(caught instanceof Error ? caught.message : `Could not read ${externalId}`)
    }
  }

  for (const existing of existingMedia) {
    if (seen.has(existing.id)) continue
    const memberships = existing.memberships.map((membership) => ({ ...membership, present: false }))
    const lost = lostPresentMembership(existing.memberships, memberships)
    if (lost) missingFromImport += 1
    media.push({ ...existing, memberships, updatedAt: lost ? now : existing.updatedAt })
    if (lost) updated += 1
    else unchanged += 1
    if (existing.userEditedMetadata.length > 0) userEditsPreserved += 1
  }

  const presentCount = new Map<string, number>()
  for (const item of media) {
    for (const membership of item.memberships) {
      if (!membership.present) continue
      presentCount.set(membership.sourceId, (presentCount.get(membership.sourceId) ?? 0) + 1)
    }
  }

  const previousSources = new Map(existingSources.map((source) => [source.id, source]))
  const sources: SourceRecord[] = parsed.sources.map((source) =>
    sourceRecord(source, previousSources.get(source.id), now, presentCount.get(source.id) ?? 0),
  )
  for (const source of existingSources) {
    if (incomingSourceSet.has(source.id)) continue
    sources.push({
      ...source,
      mediaCount: presentCount.get(source.id) ?? 0,
      updatedAt: now,
    })
  }

  media.sort((left, right) => left.id.localeCompare(right.id))
  sources.sort((left, right) => left.id.localeCompare(right.id))
  const duplicatesMerged = Math.max(0, appearances - groups.size)
  const session = {
    id: `import-${now}`,
    startedAt: now,
    completedAt: now,
    filename,
    sourceFormat: 'channels-txt',
    sourceVersion: parsed.version,
    sourceCounts: { collections: parsed.sources.length, videos: parsed.videoCount },
    added,
    updated,
    unchanged,
    duplicatesMerged,
    userEditsPreserved,
    missingFromImport,
    errors: errors.length,
    status: 'complete' as const,
  }
  return {
    added,
    updated,
    unchanged,
    duplicatesMerged,
    userEditsPreserved,
    missingFromImport,
    errors,
    session,
    media,
    sources,
  }
}
