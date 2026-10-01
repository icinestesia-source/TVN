import type { MediaItem } from '../director/types.ts'
import type { ProgrammeType } from '../types/programme.ts'

export type Provider = 'youtube' | 'local' | 'archive' | 'web' | 'audio' | 'generated'
export type SourceKind = 'channel' | 'playlist' | 'collection' | 'video' | 'live' | 'file' | 'feed'
export type Confidence = 'high' | 'medium' | 'low' | 'unknown'
export type TriState = true | false | 'unknown'
export type SourceAvailability = 'verified' | 'unknown' | 'unavailable'
export type MediaAvailability = 'unknown' | 'available' | 'temporarily_unavailable' | 'unavailable'

export type ImportPhase =
  | 'READING'
  | 'PARSING'
  | 'NORMALIZING'
  | 'CLASSIFYING'
  | 'RECONCILING'
  | 'SAVING'
  | 'COMPLETE'

/** Where one metadata field came from, and how sure that origin is. */
export interface FieldOrigin {
  origin: 'source' | 'inferred' | 'user'
  rule?: string
  confidence: Confidence
  reason?: string
}

export interface ClassificationNote {
  field: string
  value: string
  reason: string
  confidence: Confidence
  rule: string
}

export interface CollectionEditorial {
  subjects?: string[]
  topics?: string[]
  programmeType?: ProgrammeType
  confidence: Confidence
}

export interface CollectionMembership {
  sourceId: string
  sourceName: string
  present: boolean
}

/** Where a group of media originates. This is not a television channel. */
export interface SourceRecord {
  id: string
  provider: Provider
  sourceKind: SourceKind
  displayName: string
  publisher?: string
  externalId?: string
  mediaKind: 'video' | 'audio'
  origin: 'user-import' | 'independent-default'
  verifiedOfficial: TriState
  authorised: TriState
  availability: SourceAvailability
  isLive: boolean
  canSeek: boolean
  lastVerified?: number
  categories: string[]
  /** Editor-declared hints. They do not replace a title rule or a user correction. */
  editorial?: CollectionEditorial
  notes?: string
  createdAt: number
  updatedAt: number
  mediaCount: number
}

/**
 * One programme in the local library.
 * Scheduling fields live on MediaItem. Provenance fields say why they exist.
 */
export interface LibraryMedia extends MediaItem {
  programmeType: ProgrammeType
  provider: Provider
  externalId: string
  originalExternalId: string
  mediaKind: 'video' | 'audio'
  playbackKind: 'seekable-recorded' | 'live' | 'audio' | 'generated'
  isLive: boolean
  canSeek: boolean
  genres?: string[]
  era?: string
  year?: number
  moods?: string[]
  metadataConfidence: Confidence
  metadataOrigins: Record<string, FieldOrigin>
  classification: ClassificationNote[]
  /** Low-confidence hints. They are not copied onto topics, so they do not affect eligibility. */
  candidateTopics: string[]
  ingestedAt: number
  ingestedFrom: string
  /** User-network catalogues stay on 1001+. They do not enter 000–999. */
  provenance?: 'built-in-user' | 'user-imported'
  sourceCollection: string
  memberships: CollectionMembership[]
  watched: boolean
  userEditedMetadata: string[]
  availability: MediaAvailability
  failureCount: number
  lastFailureAt?: number
  lastFailureReason?: string
  createdAt: number
  updatedAt: number
  /** Same value as externalId. Present once a discovery record has been promoted. */
  providerItemId?: string
  /** Same value as durationSeconds. Present once a discovery record has been promoted. */
  durationSec?: number
  /** Approved independent source that supplied this item. */
  sourceId?: string
  /** Same channel list as explicitChannelIncludes. */
  eligibleChannels?: number[]
}

export interface ImportSession {
  id: string
  startedAt: number
  completedAt?: number
  filename?: string
  sourceFormat: string
  sourceVersion: string
  sourceCounts: { collections: number; videos: number }
  added: number
  updated: number
  unchanged: number
  duplicatesMerged: number
  userEditsPreserved: number
  missingFromImport: number
  errors: number
  status: 'saving' | 'complete' | 'failed'
}

export interface IngestCounts {
  collections: number
  videos: number
  added: number
  updated: number
  unchanged: number
  duplicatesMerged: number
  missingFromImport: number
  errors: number
}

export interface IngestReport {
  added: number
  updated: number
  unchanged: number
  duplicatesMerged: number
  userEditsPreserved: number
  missingFromImport: number
  errors: string[]
  session: ImportSession
  media: LibraryMedia[]
  sources: SourceRecord[]
}

export interface MediaEdit {
  programmeType?: ProgrammeType
  topics?: string[]
  subjects?: string[]
  genres?: string[]
  era?: string | null
  year?: number | null
  explicitChannelIncludes?: number[]
  /** Channels this individual programme was editorially routed to; its source's catalogue is not. */
  curatedChannels?: number[]
  /** Verified original year of the underlying work (film, recording, performance, episode, event), with provenance. Never the upload year. */
  original?: import('../library/metadata-channels.ts').OriginalYear
  /** Era channels this programme joined through its original year. */
  eraChannels?: number[]
  genreChannels?: number[]
  explicitChannelExcludes?: number[]
  editorialPriority?: number | null
}
