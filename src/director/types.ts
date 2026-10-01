import type { ProgrammeType } from '../types/programme.ts'
import type { DayKind } from './time.ts'

export type ScheduleStyle =
  | 'general'
  | 'movies'
  | 'documentary'
  | 'history'
  | 'music'
  | 'sport'
  | 'sportOfficial'
  | 'news'
  | 'kids'
  | 'entertainment'
  | 'live'
  | 'webcam'
  | 'radio'
  | 'archive'
  | 'closedown'

export type ContentStrategy = 'feature' | 'segments' | 'hold'

export interface Eligibility {
  includeTopics?: string[]
  includeSubjects?: string[]
  includeTypes?: ProgrammeType[]
  excludeTopics?: string[]
  excludeSubjects?: string[]
  excludeTypes?: ProgrammeType[]
  explicitInclude?: string[]
  explicitExclude?: string[]
  /** Only items whose explicitChannelIncludes name this channel may air. */
  routedOnly?: boolean
  /** Sibling channels whose routed items an aggregate channel may also air. */
  routedFrom?: number[]
}

/** Optional catalogue record. Missing fields stay unknown. Nothing here is invented about a real title. */
export interface MediaItem {
  id: string
  title: string
  durationSeconds: number
  programmeType: ProgrammeType
  topics?: string[]
  /** What the programme is about. Separate from programme type. */
  subjects?: string[]
  sport?: string
  genres?: string[]
  era?: string
  year?: number
  moods?: string[]
  audience?: string
  sourceRef?: string
  provider?: string
  /** Provider media id, such as a YouTube video id. Stable across imports. */
  externalId?: string
  mediaKind?: 'video' | 'audio'
  playbackKind?: 'seekable-recorded' | 'live' | 'audio' | 'generated'
  live?: boolean
  /** False only when the item is known not to be seekable. */
  canSeek?: boolean
  quality?: string
  language?: string
  series?: string
  episode?: string
  creator?: string
  artist?: string
  teams?: string[]
  competition?: string
  explicitChannelIncludes?: number[]
  /** Channels this individual programme was editorially routed to; its source's catalogue is not. */
  curatedChannels?: number[]
  /** Verified original year of the underlying work (film, recording, performance, episode, event), with provenance. Never the upload year. */
  original?: import('../library/metadata-channels.ts').OriginalYear
  /** Era channels this programme joined through its original year. */
  eraChannels?: number[]
  genreChannels?: number[]
  /** Upload time (ISO). Currentness evidence for rolling channels only; never an original year. */
  publishedAt?: string
  explicitChannelExcludes?: number[]
  editorialPriority?: number
  truncatable?: boolean
}

export interface RepeatRule {
  minimumGapDays: number
  preferredGapDays: number
  maxBroadcasts7d: number
  maxBroadcasts30d: number
}

export interface DaypartRule {
  id: string
  start: string
  end: string
  weights: Partial<Record<ProgrammeType, number>>
}

export interface TemplateBlock {
  id: string
  title: string
  start: string
  hardStart?: boolean
  eligibility?: Eligibility
  strategy: ContentStrategy
  segmentSeconds?: number
  programmeType: ProgrammeType
  preferTypes?: ProgrammeType[]
  /** Future event provider may replace this block's running order. The compiler does not call one. */
  eventHook?: string
  continuityPolicy?: 'generated-fill'
}

export interface DayTemplate {
  id: DayKind
  blocks: TemplateBlock[]
}

export interface SpecialEventRule {
  id: string
  /** MM-DD in the network calendar. */
  monthDay: string
  dayKind?: DayKind
  titleOverrides?: Record<string, string>
  weightTopics?: Record<string, number>
}

export interface ProgrammingPolicy {
  channelNumber: number
  scheduleStyle: ScheduleStyle
  archetype: string
  eligibility: Eligibility
  topics?: string[]
  dayTemplates: Partial<Record<DayKind, DayTemplate>>
  dayparts: DaypartRule[]
  repetition: RepeatRule
  typeRepeats?: Partial<Record<ProgrammeType, RepeatRule>>
  junctionRules: string[]
  specialEventRules: SpecialEventRule[]
  fallbackPolicy: 'generated'
  broadcastDayStart: string
  /** 1 repeats specialist material freely. Lower values soften diversity penalties. */
  diversityScale: number
}

export interface BroadcastUse {
  mediaItemId: string
  broadcastDate: string
  primeTime: boolean
  programmeType: ProgrammeType
}

export interface ScheduleChild {
  id: string
  title: string
  startMs: number
  endMs: number
  durationSeconds: number
  programmeType: ProgrammeType
  playback: 'seekable-recorded' | 'live' | 'audio' | 'generated'
  sourceRef: string
  /** Supplied provider id when this child is a real recording. */
  videoId?: string
  fallback: boolean
  mediaItemId?: string
  series?: string
  creator?: string
  topics?: string[]
  score?: number
  penalties?: string[]
}

export interface ScheduleBlock {
  id: string
  title: string
  start: string
  startMs: number
  endMs: number
  hardStart: boolean
  programmeType: ProgrammeType
  eventHook?: string
  children: ScheduleChild[]
}

export interface FrozenDailySchedule {
  scheduleId: string
  channelId: string
  channelNumber: number
  broadcastDate: string
  scheduleVersion: number
  policyVersion: string
  catalogueVersion: string
  seed: string
  generatedAt: number
  generation: number
  dayStartMs: number
  dayEndMs: number
  dayKind: DayKind
  style: ScheduleStyle
  blocks: ScheduleBlock[]
  /** Programmes the channel could draw on at compile time. Older stored days omit it. */
  poolSize?: number
  /** Provider config a live or rolling channel's day was compiled under. */
  dynamicVersion?: string
}
