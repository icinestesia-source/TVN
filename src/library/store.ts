import { independentSourceRecords } from '../data/independent/network.ts'
import { defaultNetworkItems } from '../data/network/catalog.ts'
import { setMediaLibrary } from '../director/library.ts'
import { readAllPaged } from './idb-read.ts'
import { expandPlayableCatalogue, shippedRecordSupersedes } from './playable-catalogue.ts'
import { programmeForDirector } from './source-editorial.ts'
import { userLibraryMode } from './mode.ts'
import { reconcileLibrary } from './ingest.ts'
import type { ImportPhase, ImportSession, IngestCounts, IngestReport, LibraryMedia, MediaEdit, SourceRecord } from './types.ts'
import type { ParsedExport } from '../services/channels-import.ts'
import { isRefusedVideo } from '../services/embed-refusals.ts'
import { siteName } from '../app/site.ts'

type PhaseCallback = (phase: ImportPhase, counts?: IngestCounts) => void

export interface LibrarySnapshot {
  media: LibraryMedia[]
  sources: SourceRecord[]
}

export interface LibraryWriter {
  write(snapshot: LibrarySnapshot & { session: IngestReport['session'] }): Promise<void>
  read(): Promise<LibrarySnapshot>
}

const DB_NAME = siteName('retrotv-library')
const DB_VERSION = 1

let media: LibraryMedia[] = []
let sources: SourceRecord[] = []
const listeners = new Set<() => void>()
let writer: LibraryWriter | null = null
let hydrated = false

function countsFrom(report: IngestReport): IngestCounts {
  return {
    collections: report.sources.length,
    videos: report.media.length,
    added: report.added,
    updated: report.updated,
    unchanged: report.unchanged,
    duplicatesMerged: report.duplicatesMerged,
    missingFromImport: report.missingFromImport,
    errors: report.errors.length,
  }
}

function forDirector(item: LibraryMedia): boolean {
  if (item.ingestedFrom === 'youtube-discovery') return true
  if (userLibraryMode() === 'allow-eligible') return true
  return item.provenance === 'built-in-user' || item.ingestedFrom === 'retrotv-user-network'
}

const directorCopies = new WeakMap<LibraryMedia, LibraryMedia>()

function directorCopy(item: LibraryMedia): LibraryMedia {
  let copy = directorCopies.get(item)
  if (!copy) {
    copy = programmeForDirector(item)
    directorCopies.set(item, copy)
  }
  return copy
}

function publish(): void {
  // A video whose publisher refuses embedded playback stays in the library but is never scheduled.
  const directed = media.filter((item) => forDirector(item) && !isRefusedVideo(item.externalId)).map(directorCopy)
  setMediaLibrary([...defaultNetworkItems(), ...directed])
  for (const listener of listeners) listener()
}

function withIndependentSources(current: readonly SourceRecord[]): SourceRecord[] {
  const known = new Set(current.map((source) => source.id))
  const added = independentSourceRecords().filter((source) => !known.has(source.id))
  return added.length > 0 ? [...current, ...added] : [...current]
}

export function librarySnapshot(): LibrarySnapshot {
  return { media, sources: withIndependentSources(sources) }
}

export function subscribeLibrary(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setLibraryWriter(next: LibraryWriter | null): void {
  writer = next
}

export function resetLibraryForTests(): void {
  media = []
  sources = []
  writer = null
  deferredSave = null
  hydrated = false
  hydrating = null
  defaultsReady = false
  setMediaLibrary([])
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('sources')) db.createObjectStore('sources', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('media')) {
        const store = db.createObjectStore('media', { keyPath: 'id' })
        store.createIndex('provider', 'provider', { unique: false })
        store.createIndex('programmeType', 'programmeType', { unique: false })
        store.createIndex('externalId', 'externalId', { unique: false })
      }
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the media library'))
  })
}

function requestAll<T>(store: IDBObjectStore): Promise<T[]> {
  return readAllPaged<T>(store, 'Could not read the media library')
}

const idbWriter: LibraryWriter = {
  async read() {
    if (typeof indexedDB === 'undefined') return { media: [], sources: [] }
    const db = await openDb()
    try {
      const tx = db.transaction(['media', 'sources'], 'readonly')
      const [storedMedia, storedSources] = await Promise.all([
        requestAll<LibraryMedia>(tx.objectStore('media')),
        requestAll<SourceRecord>(tx.objectStore('sources')),
      ])
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('Could not read the media library'))
      })
      return { media: storedMedia, sources: storedSources }
    } finally {
      db.close()
    }
  },
  async write(snapshot) {
    if (typeof indexedDB === 'undefined') return
    const db = await openDb()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['media', 'sources', 'sessions'], 'readwrite')
        const mediaStore = tx.objectStore('media')
        const sourceStore = tx.objectStore('sources')
        mediaStore.clear()
        sourceStore.clear()
        for (const item of snapshot.media) mediaStore.put(item)
        for (const source of snapshot.sources) sourceStore.put(source)
        tx.objectStore('sessions').put(snapshot.session)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('Could not save the media library'))
      })
    } finally {
      db.close()
    }
  },
}

/** A save the start left for later. Every write stores the whole library, so any that succeeds first covers it. */
let deferredSave: ImportSession | null = null

async function activeWriter(): Promise<LibraryWriter> {
  const target = writer ?? idbWriter
  return {
    read: () => target.read(),
    write: async (snapshot) => {
      const due = deferredSave
      await target.write(snapshot)
      if (deferredSave === due) deferredSave = null
    },
  }
}

/** Makes the save the start deferred, unless a later write already has. */
export async function saveDeferredLibrary(): Promise<void> {
  const session = deferredSave
  if (!session) return
  await (await activeWriter()).write({ media, sources, session })
}

export async function hydrateLibrary(): Promise<LibrarySnapshot> {
  if (hydrated) return librarySnapshot()
  hydrating ??= (async () => {
    try {
      const stored = await (await activeWriter()).read()
      if (hydrated) return
      media = stored.media
      sources = stored.sources
      hydrated = true
      publish()
    } finally {
      hydrating = null
    }
  })()
  await hydrating
  return librarySnapshot()
}

let hydrating: Promise<void> | null = null

export async function ingestParsed(
  parsed: ParsedExport,
  options: { filename?: string; now?: number; onPhase?: PhaseCallback } = {},
): Promise<IngestReport> {
  const now = options.now ?? Date.now()
  options.onPhase?.('NORMALIZING', { collections: parsed.sources.length, videos: parsed.videoCount, added: 0, updated: 0, unchanged: 0, duplicatesMerged: 0, missingFromImport: 0, errors: 0 })
  options.onPhase?.('CLASSIFYING', { collections: parsed.sources.length, videos: parsed.videoCount, added: 0, updated: 0, unchanged: 0, duplicatesMerged: 0, missingFromImport: 0, errors: 0 })
  const report = reconcileLibrary(media, sources, parsed, now, options.filename)
  options.onPhase?.('RECONCILING', countsFrom(report))
  options.onPhase?.('SAVING', countsFrom(report))
  const persistence = await activeWriter()
  try {
    await persistence.write({ media: report.media, sources: report.sources, session: { ...report.session, status: 'complete' } })
  } catch (caught) {
    report.session.status = 'failed'
    throw caught
  }
  media = report.media
  sources = report.sources
  hydrated = true
  publish()
  options.onPhase?.('COMPLETE', countsFrom(report))
  return report
}

function withUserField(item: LibraryMedia, field: string, patch: Partial<LibraryMedia>): LibraryMedia {
  const userEditedMetadata = item.userEditedMetadata.includes(field)
    ? item.userEditedMetadata
    : [...item.userEditedMetadata, field]
  return {
    ...item,
    ...patch,
    userEditedMetadata,
    metadataConfidence: field === 'programmeType' ? 'high' : item.metadataConfidence,
    metadataOrigins: {
      ...item.metadataOrigins,
      [field]: { origin: 'user', confidence: 'high', reason: 'user correction', rule: 'user' },
    },
    classification: [
      { field, value: String(patch[field as keyof LibraryMedia] ?? ''), reason: 'user correction', confidence: 'high', rule: 'user' },
      ...item.classification.filter((note) => note.field !== field),
    ],
    updatedAt: Date.now(),
  }
}

export async function correctMedia(id: string, edit: MediaEdit): Promise<LibraryMedia | null> {
  const index = media.findIndex((item) => item.id === id)
  if (index < 0) return null
  let next = media[index]
  if (!next) return null
  if (edit.programmeType) next = withUserField(next, 'programmeType', { programmeType: edit.programmeType })
  if (edit.topics) next = withUserField(next, 'topics', { topics: edit.topics.filter(Boolean) })
  if (edit.subjects) next = withUserField(next, 'subjects', { subjects: edit.subjects.filter(Boolean) })
  if (edit.genres) next = withUserField(next, 'genres', { genres: edit.genres.filter(Boolean) })
  if (edit.era !== undefined) next = withUserField(next, 'era', { era: edit.era ?? undefined })
  if (edit.year !== undefined) next = withUserField(next, 'year', { year: edit.year ?? undefined })
  if (edit.explicitChannelIncludes) {
    next = withUserField(next, 'explicitChannelIncludes', { explicitChannelIncludes: edit.explicitChannelIncludes })
  }
  if (edit.explicitChannelExcludes) {
    next = withUserField(next, 'explicitChannelExcludes', { explicitChannelExcludes: edit.explicitChannelExcludes })
  }
  if (edit.editorialPriority !== undefined) {
    next = withUserField(next, 'editorialPriority', { editorialPriority: edit.editorialPriority ?? undefined })
  }
  const previous = media
  const previousSources = sources
  media = media.map((item) => (item.id === id ? next : item))
  try {
    await (await activeWriter()).write({
      media,
      sources,
      session: {
        id: `edit-${next.updatedAt}`,
        startedAt: next.updatedAt,
        completedAt: next.updatedAt,
        sourceFormat: 'local-edit',
        sourceVersion: '',
        sourceCounts: { collections: sources.length, videos: media.length },
        added: 0,
        updated: 1,
        unchanged: media.length - 1,
        duplicatesMerged: 0,
        userEditsPreserved: 1,
        missingFromImport: 0,
        errors: 0,
        status: 'complete',
      },
    })
  } catch (caught) {
    media = previous
    sources = previousSources
    throw caught
  }
  publish()
  return next
}

/** A playback failure stays on the record. It does not delete the item or the schedule. */
export async function recordPlaybackFailure(externalId: string, reason: string, now = Date.now()): Promise<LibraryMedia | null> {
  const item = media.find((entry) => entry.externalId === externalId || entry.id === externalId)
  if (!item) return null
  const next: LibraryMedia = {
    ...item,
    availability: item.failureCount + 1 >= 3 ? 'unavailable' : 'temporarily_unavailable',
    failureCount: item.failureCount + 1,
    lastFailureAt: now,
    lastFailureReason: reason,
    updatedAt: now,
  }
  const previous = media
  media = media.map((entry) => (entry.id === item.id ? next : entry))
  // Availability is bookkeeping the director never schedules from: keeping its copy lets the republish
  // below reuse every network-wide cache instead of rebuilding them for identical programming.
  const copy = directorCopies.get(item)
  if (copy) directorCopies.set(next, copy)
  try {
    await (await activeWriter()).write({
      media,
      sources,
      session: {
        id: `failure-${now}`,
        startedAt: now,
        completedAt: now,
        sourceFormat: 'playback-failure',
        sourceVersion: '',
        sourceCounts: { collections: sources.length, videos: media.length },
        added: 0,
        updated: 1,
        unchanged: media.length - 1,
        duplicatesMerged: 0,
        userEditsPreserved: 0,
        missingFromImport: 0,
        errors: 0,
        status: 'complete',
      },
    })
  } catch (caught) {
    media = previous
    throw caught
  }
  publish()
  return next
}

export function republishLibrary(): void {
  publish()
}

function syncIndependentSourceCount(sourceId: string | undefined, now: number): void {
  if (!sourceId) return
  const approved = independentSourceRecords(now).find((source) => source.id === sourceId)
  if (!approved) return
  const mediaCount = media.filter(
    (item) => item.sourceId === sourceId || item.memberships.some((membership) => membership.present && membership.sourceId === sourceId),
  ).length
  const existing = sources.find((source) => source.id === sourceId)
  const next: SourceRecord = { ...(existing ?? approved), mediaCount, updatedAt: now }
  sources = existing ? sources.map((source) => (source.id === sourceId ? next : source)) : [...sources, next]
}

/** Writes one playable library record through the existing library store. */
export async function commitPlayableMedia(item: LibraryMedia, session: ImportSession): Promise<void> {
  const previousMedia = media
  const previousSources = sources
  const index = media.findIndex((entry) => entry.id === item.id || entry.externalId === item.externalId)
  media = index < 0 ? [...media, item] : media.map((entry, position) => (position === index ? item : entry))
  syncIndependentSourceCount(item.sourceId, session.completedAt ?? session.startedAt)
  try {
    await (await activeWriter()).write({ media, sources, session })
  } catch (caught) {
    media = previousMedia
    sources = previousSources
    throw caught
  }
  publish()
}

function isUserNetworkMedia(item: LibraryMedia): boolean {
  return item.provenance === 'built-in-user' || item.provenance === 'user-imported' || item.ingestedFrom === 'retrotv-user-network'
}

/** Writes resolved independent programmes in one library save. User-network records stay as they are. */
export async function commitPlayableCatalogue(
  items: readonly LibraryMedia[],
  session: ImportSession,
  authoritative = false,
  persisted: 'await' | 'deferred' = 'await',
): Promise<number> {
  const previousMedia = media
  const previousSources = sources
  const shipped = new Set(items.map((item) => item.externalId))
  const kept = authoritative
    ? media.filter((item) => item.ingestedFrom !== 'youtube-discovery' || isUserNetworkMedia(item) || shipped.has(item.externalId))
    : media
  const removed = media.length - kept.length
  const next = kept.slice()
  const index = new Map(next.map((item, position) => [item.externalId, position]))
  let added = 0
  const touched = new Set<string>()
  if (removed > 0) {
    const keptSet = new Set(kept)
    for (const item of media) if (!keptSet.has(item) && item.sourceId) touched.add(item.sourceId)
  }
  for (const item of items) {
    if (item.ingestedFrom !== 'youtube-discovery') continue
    const at = index.get(item.externalId)
    if (at === undefined) {
      index.set(item.externalId, next.length)
      next.push(item)
      added += 1
      if (item.sourceId) touched.add(item.sourceId)
      continue
    }
    const existing = next[at]
    if (existing && isUserNetworkMedia(existing)) continue
    if (existing?.ingestedFrom === 'youtube-discovery' && !shippedRecordSupersedes(existing, item)) continue
    next[at] = item
    if (item.sourceId) touched.add(item.sourceId)
  }
  if (added === 0 && touched.size === 0 && removed === 0) return 0
  media = next
  const now = session.completedAt ?? session.startedAt
  for (const sourceId of touched) syncIndependentSourceCount(sourceId, now)
  if (persisted === 'deferred') {
    deferredSave = session
    publish()
    return added
  }
  try {
    await (await activeWriter()).write({ media, sources, session })
  } catch (caught) {
    media = previousMedia
    sources = previousSources
    throw caught
  }
  publish()
  return added
}

/**
 * Loads programmes the resolver has already accepted. They are fetched and compared on every start, so
 * saving them never holds the start (see saveDeferredLibrary): a save that is lost is made again next time.
 */
export async function loadShippedIndependentCatalogue(): Promise<number> {
  let response: Response
  try {
    response = await fetch('/independent/playable.json')
  } catch {
    return 0
  }
  if (!response.ok) return 0
  let items: LibraryMedia[]
  try {
    items = expandPlayableCatalogue(await response.json())
  } catch {
    return 0
  }
  if (items.length === 0) return 0
  const now = Date.now()
  return commitPlayableCatalogue(items, {
    id: `youtube-discovery-shipped-${now}`,
    startedAt: now,
    completedAt: now,
    sourceFormat: 'youtube-discovery',
    sourceVersion: '1',
    sourceCounts: { collections: 0, videos: items.length },
    added: 0,
    updated: 0,
    unchanged: 0,
    duplicatesMerged: 0,
    userEditsPreserved: 0,
    missingFromImport: 0,
    errors: 0,
    status: 'complete',
  }, true, 'deferred')
}

/** Records an import session without adding a playable item. */
export async function commitLibrarySession(session: ImportSession): Promise<void> {
  await (await activeWriter()).write({ media, sources, session })
}

let defaultsReady = false

/** Publish the shipped network before the first picture is chosen. */
export function ensureDefaultNetwork(): void {
  if (defaultsReady) return
  defaultsReady = true
  republishLibrary()
}

let undoSnapshot: LibraryMedia[] | null = null

export function bulkTargetCount(ids: readonly string[]): number {
  const wanted = new Set(ids)
  return media.filter((item) => wanted.has(item.id)).length
}

/** Applies one user correction to many records and keeps a single undo snapshot. */
export async function applyBulkEdit(ids: readonly string[], edit: MediaEdit): Promise<number> {
  const wanted = new Set(ids)
  const targets = media.filter((item) => wanted.has(item.id))
  if (targets.length === 0) return 0
  undoSnapshot = media.map((item) => ({ ...item, memberships: item.memberships.map((entry) => ({ ...entry })) }))
  const next = new Map<string, LibraryMedia>()
  for (const item of targets) {
    const corrected = await correctMedia(item.id, edit)
    if (corrected) next.set(item.id, corrected)
  }
  return next.size
}

export async function undoBulkEdit(): Promise<boolean> {
  if (!undoSnapshot) return false
  const restored = undoSnapshot
  undoSnapshot = null
  media = restored
  await (await activeWriter()).write({
    media,
    sources,
    session: {
      id: `undo-${Date.now()}`,
      startedAt: Date.now(),
      completedAt: Date.now(),
      sourceFormat: 'bulk-undo',
      sourceVersion: '',
      sourceCounts: { collections: sources.length, videos: media.length },
      added: 0,
      updated: media.length,
      unchanged: 0,
      duplicatesMerged: 0,
      userEditsPreserved: media.length,
      missingFromImport: 0,
      errors: 0,
      status: 'complete',
    },
  })
  publish()
  return true
}

export async function setCollectionEditorial(sourceId: string, editorial: SourceRecord['editorial']): Promise<void> {
  sources = sources.map((source) => (source.id === sourceId ? { ...source, editorial, updatedAt: Date.now() } : source))
  await (await activeWriter()).write({
    media,
    sources,
    session: {
      id: `editorial-${Date.now()}`,
      startedAt: Date.now(),
      completedAt: Date.now(),
      sourceFormat: 'collection-editorial',
      sourceVersion: '',
      sourceCounts: { collections: sources.length, videos: media.length },
      added: 0,
      updated: 0,
      unchanged: media.length,
      duplicatesMerged: 0,
      userEditsPreserved: 0,
      missingFromImport: 0,
      errors: 0,
      status: 'complete',
    },
  })
  publish()
}
