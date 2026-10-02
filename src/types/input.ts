import type { GuideFilter } from './preferences.ts'

export type NavDirection = 'up' | 'down' | 'left' | 'right'

/**
 * Guide actions that happen inside the Guide: MEDIA at 1000 Local Media, IMPORT (a User Network file) and ADD
 * at the foot of the User Network, and EDIT, the Channel Editor for one channel (right-click, long-press, or E).
 */
export type GuideTool = 'media' | 'network' | 'add' | 'edit' | 'users' | 'options' | 'guides'

/**
 * Commands a keyboard, on-screen remote, or future gamepad can emit.
 * The television shell is the only place that interprets them.
 */
export type TvCommand =
  | { type: 'channel-up' }
  | { type: 'channel-down' }
  | { type: 'digit'; digit: number }
  | { type: 'digit-back' }
  | { type: 'confirm' }
  | { type: 'cancel' }
  | { type: 'last-channel' }
  /** Back or Forward through the channels watched this session. */
  | { type: 'history-back' }
  | { type: 'history-forward' }
  | { type: 'random-channel' }
  | { type: 'surf' }
  /** Prev (-1) or Next (1) along the channel: in the Guide, or over the picture. */
  | { type: 'step'; direction: -1 | 1 }
  | { type: 'guide' }
  | { type: 'guide-expand' }
  | { type: 'guide-dock' }
  | { type: 'guide-split'; share: number }
  | { type: 'multiview' }
  | { type: 'multiview-page'; page: number }
  | { type: 'focus-move'; direction: NavDirection }
  | { type: 'focus-tile'; index: number }
  | { type: 'tune'; channelNumber: number }
  | { type: 'user-channels' }
  /** U: MEDIA, 1000 Local Media from files on this device. */
  | { type: 'media' }
  | { type: 'guide-tool'; tool: GuideTool; channelNumber?: number }
  | { type: 'remote' }
  /** CREDITS on the remote: the credit roll over the picture, on and off. */
  | { type: 'credits' }
  /** The next sleep choice, or exactly `minutes` (OPTIONS). */
  | { type: 'sleep-cycle'; minutes?: number }
  | { type: 'info' }
  | { type: 'play-pause' }
  | { type: 'mute' }
  | { type: 'subtitles' }
  | { type: 'volume-up' }
  | { type: 'volume-down' }
  | { type: 'fullscreen' }
  | { type: 'favourite'; channelNumber?: number }
  | { type: 'debug' }
  | { type: 'guide-filter'; filter?: GuideFilter }
  | { type: 'guide-now' }
  | { type: 'hints' }
  | { type: 'nav'; direction: NavDirection; rows?: number }

/** A future gamepad or infrared remote implements this and nothing else. */
export interface CommandSource {
  subscribe(handler: (command: TvCommand) => void): () => void
}
