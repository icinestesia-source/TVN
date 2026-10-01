import { INDEPENDENT_SOURCES } from '../data/independent/network.ts'
import { createYouTubeMetadataProbe, type YoutubeMetadataProbe } from '../player/youtube-metadata.ts'
import { commitLibrarySession, commitPlayableMedia, librarySnapshot } from './store.ts'
import type { CollectionMembership, ImportSession, LibraryMedia } from './types.ts'

/**
 * An approved YouTube ID that is not playable until the player resolves it.
 * Channel eligibility is supplied with the record and is not widened here.
 */
export interface DiscoveryRecord {
  provider: 'youtube'
  providerItemId: string
  sourceId: string
  title?: string
  eligibleChannels: number[]
}

export interface DiscoveryResolution {
  added: number
  updated: number
  unchanged: number
  duplicatesMerged: number
  errors: string[]
  session: ImportSession
  resolved: LibraryMedia[]
}

/** One reused player. A second probe is the upper bound; further probes are ignored. */
export const MAX_DISCOVERY_PLAYERS = 2

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

export function acceptedDuration(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null
  const seconds = Math.round(value)
  return seconds > 0 ? seconds : null
}

function mediaIdFor(providerItemId: string): string {
  return `yt:${providerItemId}`
}

function isUserNetwork(item: LibraryMedia): boolean {
  return item.provenance === 'built-in-user' || item.provenance === 'user-imported' || item.ingestedFrom === 'retrotv-user-network'
}

function rejection(record: Partial<DiscoveryRecord> | null | undefined): string | null {
  if (!record || record.provider !== 'youtube') return 'unsupported provider'
  if (typeof record.providerItemId !== 'string' || !VIDEO_ID.test(record.providerItemId)) return 'invalid video id'
  if (typeof record.sourceId !== 'string' || record.sourceId.trim().length === 0) return 'missing source'
  if (!Array.isArray(record.eligibleChannels)) return 'eligible channels missing'
  for (const channel of record.eligibleChannels) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 999) return 'eligible channel outside 000-999'
  }
  return null
}

function uniqueChannels(channels: readonly number[]): number[] {
  const unique: number[] = []
  for (const channel of channels) {
    if (!unique.includes(channel)) unique.push(channel)
  }
  return unique
}

function sameChannels(left: readonly number[] | undefined, right: readonly number[] | undefined): boolean {
  const a = left ?? []
  const b = right ?? []
  return a.length === b.length && a.every((channel, index) => channel === b[index])
}

function mergeMemberships(previous: readonly CollectionMembership[], incoming: readonly CollectionMembership[]): CollectionMembership[] {
  const map = new Map(previous.map((membership) => [membership.sourceId, { ...membership }]))
  for (const membership of incoming) map.set(membership.sourceId, { ...membership, present: true })
  return [...map.values()].sort((left, right) => left.sourceId.localeCompare(right.sourceId))
}

function draftRecord(record: DiscoveryRecord, title: string, durationSec: number, now: number, titleFromPlayer: boolean): LibraryMedia {
  const channels = uniqueChannels(record.eligibleChannels)
  const source = INDEPENDENT_SOURCES.find((entry) => entry.id === record.sourceId)
  const sourceName = source?.name ?? record.sourceId
  return {
    id: mediaIdFor(record.providerItemId),
    title,
    durationSeconds: durationSec,
    durationSec,
    programmeType: 'unclassified',
    topics: [],
    subjects: [],
    provider: 'youtube',
    providerItemId: record.providerItemId,
    externalId: record.providerItemId,
    originalExternalId: record.providerItemId,
    sourceId: record.sourceId,
    sourceRef: `youtube:${record.providerItemId}`,
    mediaKind: 'video',
    playbackKind: 'seekable-recorded',
    live: false,
    isLive: false,
    canSeek: true,
    explicitChannelIncludes: channels,
    eligibleChannels: channels,
    metadataConfidence: 'high',
    metadataOrigins: {
      title: {
        origin: 'source',
        confidence: 'high',
        reason: titleFromPlayer ? 'YouTube IFrame Player API getVideoData()' : 'supplied with the discovery record',
        rule: titleFromPlayer ? 'player' : 'discovery',
      },
      durationSeconds: { origin: 'source', confidence: 'high', reason: 'YouTube IFrame Player API getDuration()', rule: 'player' },
    },
    classification: [],
    candidateTopics: [],
    ingestedAt: now,
    ingestedFrom: 'youtube-discovery',
    sourceCollection: sourceName,
    memberships: [{ sourceId: record.sourceId, sourceName, present: true }],
    watched: false,
    userEditedMetadata: [],
    availability: 'available',
    failureCount: 0,
    createdAt: now,
    updatedAt: now,
  }
}

function mergeExisting(existing: LibraryMedia, drafted: LibraryMedia): LibraryMedia {
  const edited = new Set(existing.userEditedMetadata)
  const channels = edited.has('explicitChannelIncludes') ? existing.explicitChannelIncludes : drafted.explicitChannelIncludes
  return {
    ...drafted,
    title: edited.has('title') ? existing.title : drafted.title,
    programmeType: edited.has('programmeType') ? existing.programmeType : drafted.programmeType,
    topics: edited.has('topics') ? existing.topics : drafted.topics,
    subjects: edited.has('subjects') ? existing.subjects : drafted.subjects,
    explicitChannelIncludes: channels,
    eligibleChannels: edited.has('explicitChannelIncludes') ? existing.eligibleChannels : drafted.eligibleChannels,
    memberships: mergeMemberships(existing.memberships, drafted.memberships),
    watched: existing.watched,
    userEditedMetadata: existing.userEditedMetadata,
    provenance: existing.provenance,
    ingestedFrom: existing.ingestedFrom || drafted.ingestedFrom,
    createdAt: existing.createdAt,
    ingestedAt: existing.ingestedAt,
    failureCount: existing.failureCount,
    lastFailureAt: existing.lastFailureAt,
    lastFailureReason: existing.lastFailureReason,
    availability: existing.availability === 'unavailable' ? existing.availability : drafted.availability,
    updatedAt: drafted.updatedAt,
  }
}

function samePlayable(left: LibraryMedia, right: LibraryMedia): boolean {
  return (
    left.title === right.title &&
    left.durationSeconds === right.durationSeconds &&
    left.sourceId === right.sourceId &&
    left.providerItemId === right.providerItemId &&
    sameChannels(left.eligibleChannels, right.eligibleChannels)
  )
}

function blankSession(now: number, count: number): ImportSession {
  return {
    id: `youtube-discovery-${now}`,
    startedAt: now,
    sourceFormat: 'youtube-discovery',
    sourceVersion: '1',
    sourceCounts: { collections: 0, videos: count },
    added: 0,
    updated: 0,
    unchanged: 0,
    duplicatesMerged: 0,
    userEditsPreserved: 0,
    missingFromImport: 0,
    errors: 0,
    status: 'saving',
  }
}

async function checkpoint(session: ImportSession, now: number): Promise<void> {
  session.completedAt = now
  session.status = 'complete'
  await commitLibrarySession(session)
}

/**
 * Resolves approved YouTube IDs into the existing media library.
 * At most two players run, and each player resolves one ID at a time.
 * Library writes are serialized. A failure is recorded and the batch continues.
 * Each success is saved before the next library write.
 */
export async function resolveDiscoveryRecords(
  records: readonly DiscoveryRecord[],
  options: { probes: readonly YoutubeMetadataProbe[]; now?: number },
): Promise<DiscoveryResolution> {
  const now = options.now ?? Date.now()
  const probes = options.probes.slice(0, MAX_DISCOVERY_PLAYERS)
  const session = blankSession(now, records.length)
  const errors: string[] = []
  const resolved: LibraryMedia[] = []
  if (probes.length === 0) {
    errors.push('player unavailable')
    session.errors = 1
    return { added: 0, updated: 0, unchanged: 0, duplicatesMerged: 0, errors, session, resolved }
  }

  let cursor = 0
  const take = (): DiscoveryRecord | undefined => {
    const index = cursor
    cursor += 1
    return records[index]
  }
  let gate = Promise.resolve()
  const exclusive = (task: () => Promise<void>): Promise<void> => {
    const run = gate.then(task, task)
    gate = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
  const noteFailure = async (label: string, reason: string): Promise<void> => {
    errors.push(`${label}: ${reason}`)
    session.errors = errors.length
    try {
      await checkpoint(session, now)
    } catch {
      errors.push(`${label}: could not save`)
      session.errors = errors.length
    }
  }

  const resolveOne = async (probe: YoutubeMetadataProbe): Promise<void> => {
    for (;;) {
      const record = take()
      if (!record) return
      const reason = rejection(record)
      const label = typeof record.providerItemId === 'string' && record.providerItemId ? record.providerItemId : 'record'
      if (reason) {
        await exclusive(() => noteFailure(label, reason))
        continue
      }

      let probed: Awaited<ReturnType<YoutubeMetadataProbe['resolve']>>
      try {
        probed = await probe.resolve(record.providerItemId)
      } catch {
        probed = { ok: false, reason: 'player error' }
      }
      await exclusive(async () => {
        if (!probed.ok) {
          await noteFailure(record.providerItemId, probed.reason)
          return
        }
        const durationSec = acceptedDuration(probed.durationSec)
        const suppliedTitle = record.title?.trim() ?? ''
        const title = suppliedTitle || probed.title?.trim() || ''
        if (durationSec === null) {
          await noteFailure(record.providerItemId, 'duration unavailable')
          return
        }
        if (!title) {
          await noteFailure(record.providerItemId, 'title unavailable')
          return
        }

        const existing = librarySnapshot().media.find((item) => item.externalId === record.providerItemId || item.id === mediaIdFor(record.providerItemId))
        if (existing && isUserNetwork(existing)) {
          session.unchanged += 1
          session.duplicatesMerged += 1
          return
        }

        const drafted = draftRecord(record, title, durationSec, now, suppliedTitle.length === 0)
        const next = existing ? mergeExisting(existing, drafted) : drafted
        if (existing && samePlayable(existing, next)) {
          session.unchanged += 1
          session.duplicatesMerged += 1
          if (!resolved.some((item) => item.id === existing.id)) resolved.push(existing)
          return
        }

        if (existing) {
          session.updated += 1
          session.duplicatesMerged += 1
        } else session.added += 1
        try {
          await commitPlayableMedia(next, { ...session, completedAt: now, status: 'complete' })
        } catch {
          if (existing) {
            session.updated -= 1
            session.duplicatesMerged -= 1
          } else session.added -= 1
          errors.push(`${record.providerItemId}: could not save`)
          session.errors = errors.length
          return
        }
        resolved.push(next)
      })
    }
  }

  await Promise.all(probes.map((probe) => resolveOne(probe)))
  session.errors = errors.length
  session.completedAt = now
  session.status = 'complete'
  return {
    added: session.added,
    updated: session.updated,
    unchanged: session.unchanged,
    duplicatesMerged: session.duplicatesMerged,
    errors,
    session,
    resolved,
  }
}

/** Resolves a batch through one reused official player, then releases that player. */
export async function resolveYouTubeDiscovery(
  records: readonly DiscoveryRecord[],
  options: { now?: number } = {},
): Promise<DiscoveryResolution> {
  const probe = createYouTubeMetadataProbe()
  try {
    return await resolveDiscoveryRecords(records, { probes: [probe], now: options.now })
  } finally {
    probe.close?.()
  }
}
