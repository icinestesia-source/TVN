export type ProgrammeKind = 'programme' | 'ident' | 'bumper' | 'continuity' | 'retro-commercial'

/** Picture or sound. Radio channels are audio-first; the schedule is the same. */
export type MediaKind = 'video' | 'audio'

/**
 * Extensible listing type. Existing `kind` values stay for junction items.
 * Specialised behaviour for each type is not implemented yet.
 */
export type ProgrammeType =
  | 'episode'
  | 'film'
  | 'documentary'
  | 'short'
  | 'news'
  | 'sport'
  | 'gameplay'
  | 'classic-match'
  | 'highlights'
  | 'analysis'
  | 'music'
  | 'music-video'
  | 'music-block'
  | 'concert'
  | 'interview'
  | 'continuity'
  | 'ident'
  | 'advert'
  | 'trailer'
  | 'promo'
  | 'test-card'
  | 'closedown'
  | 'radio'
  | 'live'
  | 'webcam'
  /** An interactive website shown in a sandboxed frame for its slot. */
  | 'website'
  /** A public social post (an X post) shown through its provider's own embed. */
  | 'social-post'
  | 'generated'
  | 'unclassified'

export type ProgrammeSource = 'demo' | 'youtube' | 'imported'

/**
 * linear: the player seeks to the elapsed broadcast time.
 * loop-demo: the attached film is shorter than the slot. The schedule still
 * runs for the full duration; only the demonstration picture repeats.
 */
export type PlaybackMode = 'linear' | 'loop-demo'

export interface Programme {
  id: string
  title: string
  description: string
  /** Null when no playable media has been attached. The receiver shows a test card. */
  videoId: string | null
  /** A recorded media file the browser plays itself (a podcast episode), when the programme is not on YouTube. */
  mediaUrl?: string
  durationSeconds: number
  /** Length of the attached media when it differs from the scheduled slot. */
  mediaDurationSeconds?: number
  thumbnail?: string
  channelId: string
  category: string
  source: ProgrammeSource
  publishedAt?: string
  year?: number
  series?: string
  episode?: string
  rating?: string
  tags?: string[]
  /** Future: play this media object immediately before the programme. */
  identBefore?: string
  /** Future: play this media object immediately after the programme. */
  identAfter?: string
  kind: ProgrammeKind
  playbackMode: PlaybackMode
  /**
   * How a player should treat this item. The scheduler still uses duration only.
   * Live sources are not seeked as recordings.
   */
  playback?: 'seekable-recorded' | 'live' | 'audio' | 'generated'
  programmeType?: ProgrammeType
  mediaKind?: MediaKind
  /**
   * Opaque id of the playable source, such as `youtube:VIDEO` or `generated:ch-060`.
   * The scheduler never reads it.
   */
  sourceRef?: string
  /** Collection or publisher, when the schedule recorded one. */
  creator?: string
  /** That creator's own @handle (without the @), only when the provider's listing linked one. */
  creatorHandle?: string
  /** The creator's channel page, only when the provider's listing named it. */
  creatorUrl?: string
  /** A feed episode's own page, or failing that its publisher's site, when the feed gave one. */
  episodeUrl?: string
  /** A feed episode's publisher's own website, which names it (@site.com) while it links to the episode's page. */
  siteUrl?: string
  /** Presentation caption shown on the card when the programme has no picture. */
  caption?: string
  /** Parent programme block when this item is a child of a compiled running order. */
  blockId?: string
  blockTitle?: string
  /**
   * A continuous live stream with no programme boundaries: it has no duration, is joined where it is,
   * and is played by the browser's own media element rather than YouTube.
   */
  liveStream?: LiveStreamRef
  /** Shown on 000 TVN: the channel it airs on, which TVN refers to and does not claim. */
  relay?: { channelNumber: number; channelName: string }
}

export interface LiveStreamRef {
  url: string
  format: 'direct' | 'hls'
}
