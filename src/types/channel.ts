import type { MediaKind } from './programme.ts'

/** Where a channel's programmes may eventually be imported from. */
export type ChannelSourceKind = 'demo' | 'youtube-video' | 'youtube-playlist' | 'youtube-channel' | 'stream'

export interface ChannelSourceRef {
  kind: ChannelSourceKind
  id: string
  label: string
}

/**
 * Loop is the only mode in V0.1: the programme list repeats forever from a fixed epoch.
 * A later 'calendar' mode could pin items to wall-clock dates without changing callers
 * that only read the calculated snapshot.
 */
export type ScheduleMode = 'loop'

export interface Channel {
  id: string
  /** Stable viewer-facing number. Do not renumber existing channels. */
  number: number
  name: string
  shortName: string
  description: string
  /** Two-character mark drawn by the UI. Not an external image asset. */
  logo: string
  /** Accent for the generated mark only. */
  color: string
  category: string
  enabled: boolean
  sources: ChannelSourceRef[]
  scheduleMode: ScheduleMode
  /**
   * Seconds added before the modulo. Keeps neighbouring channels from sharing
   * a phase. Part of the channel definition, so it survives refresh.
   */
  phaseOffsetSeconds: number
  /** Defaults to video. Radio channels are audio. */
  mediaKind?: MediaKind
  /** default catalogue, imported collection, a future hand-built channel, or the temporary session channel 000. */
  origin?: 'default' | 'user-import' | 'user-created' | 'session'
  /** The named user whose User Network tab lists this user channel; none means TVN's. */
  owner?: string
  /** Stable filter id. Display name stays in `category`. */
  categoryId?: string
  /** Canonical plan group. Separate from the visible category label. */
  group?: string
  /** Raw category from the canonical manifest, when this is a default channel. */
  canonicalCategory?: string
  channelType?: string
  sourceStrategy?: string
  sourcePolicy?: string
  /** Policy only. Not evidence that a playable source exists. */
  sourceCapabilities?: readonly string[]
  /** Organisation named by the plan. Not a URL or an external id. */
  providerHint?: string
  /** Scheduled programmes (the default), or one continuous live stream with no schedule. */
  playbackType?: 'scheduled' | 'live-stream'
  /** When the live stream was last configured; its single airing starts here, so the player joins it once. */
  liveSinceMs?: number
  /** A curated channel the viewer has re-sourced in this browser: it plays its own list, not TVN's schedule. */
  customLineup?: boolean
  /** A cleared 1001+ slot: it keeps its number and can be filled again, but has nothing to air. */
  emptySlot?: boolean
}
