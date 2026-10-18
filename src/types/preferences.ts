import type { ShortcutAssignment } from '../view/info-shortcuts.ts'
import type { SpaceAction } from '../view/space-action.ts'

export type GuideFilter =
  | 'all'
  | 'retrotv'
  | 'dormant'
  | 'favourites'
  | 'user'
  | 'main'
  | 'films'
  | 'entertainment'
  | 'sport'
  | 'history'
  | 'music'
  | 'business'
  | 'lifestyle'
  | 'specialist'
  | 'live-world'
  | 'news'
  | 'radio'
  | 'documentary'
  | 'geography'
  | 'law'
  | 'science'
  /** One named user's User Network tab (src/data/user-network/users.ts). */
  | `user:${string}`

/** 'pip': picture in picture, the selected channel full screen with a second one inset in the corner. */
export type MultiviewMode = '1' | '2' | '4' | '9' | 'pip'

export interface UserPreferences {
  version: 1 | 2
  lastChannelNumber: number
  previousChannelNumber: number | null
  /** 0–100 */
  volume: number
  muted: boolean
  favouriteChannelNumbers: number[]
  guideFilter: GuideFilter
  /** Share of the desktop width given to the picture while the guide is docked. */
  guideSplit: number
  multiviewMode: MultiviewMode
  audioFocusIndex: number
  multiviewChannels: number[]
  /** YouTube captions on the programmes that provide them; off unless the viewer turns them on. */
  subtitles: boolean
  /** Idle minutes before RetroTV stops streaming; 0 is off. */
  sleepMinutes: number
  /** The actions in the corners of the information overlay's control pad. */
  infoShortcuts: ShortcutAssignment
  /** What Space does over the picture. */
  spaceAction: SpaceAction
  /** Set once the starter Favourites have been offered; from then on the list is the viewer's own, even if empty. */
  defaultFavouritesOffered?: boolean
}
