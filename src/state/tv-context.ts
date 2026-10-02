import { createContext, useContext, type RefObject } from 'react'
import type { StartHold } from '../player/autoplay.ts'
import type { Channel } from '../types/channel.ts'
import type { TvCommand } from '../types/input.ts'
import type { GuideFilter, MultiviewMode } from '../types/preferences.ts'
import type { GuideMode } from '../view/guide-mode.ts'
import type { Corner, ShortcutAssignment, ShortcutId } from '../view/info-shortcuts.ts'
import type { PlayerHandle, PlayerStatus } from '../player/types.ts'
import type { ChannelEdit } from '../services/channel-editor.ts'
import type { ChannelExportKind } from '../services/channel-file.ts'

export interface GuideCursor {
  channelNumber: number
  timeMs: number
}

export type OverlayMode = 'none' | 'info' | 'volume'
export type GuideNote = 'later' | 'ended' | null

/** An IMPORT or ADD opened in the Guide. It stands while the Guide cursor is still the one it placed. */
export interface GuideToolState {
  kind: import('../types/input.ts').GuideTool
  cursor: GuideCursor
}

export interface TvContextValue {
  channel: Channel
  previousChannel: Channel | null
  /** Back and Forward through the channels watched this session are available. */
  canGoBack: boolean
  canGoForward: boolean
  /** What the browser held back at startup until the viewer's first key or tap. */
  startHold: StartHold
  visibleChannels: readonly Channel[]
  /** The channel being watched, shown in the Guide although the selected tab does not list it; null when it does. */
  guideVisiting: number | null
  volume: number
  muted: boolean
  paused: boolean
  subtitles: boolean
  favourites: readonly number[]
  guideFilter: GuideFilter
  /** Narrows the listed guide rows only; tuning, favourites and airing ignore it. */
  guideQuery: string
  setGuideQuery: (query: string) => void
  /** The Guide's timeline zoom: chosen for the listings when the Guide opens, then the viewer's; NOW restores 1. */
  guideZoom: number
  setGuideZoom: (zoom: number) => void
  guideOpen: boolean
  guideMode: GuideMode
  guideSplit: number
  multiviewMode: MultiviewMode
  tiles: readonly number[]
  audioFocus: number
  multiviewPage: number
  guideTool: GuideToolState | null
  remoteOpen: boolean
  /** The credit roll fills the picture; the channel keeps its place and is not retuned. */
  credits: boolean
  guideCursor: GuideCursor
  guideWindow: { startMs: number; endMs: number }
  guideNote: GuideNote
  tuningNumber: number | null
  /** The airing the player was last asked for has reached PLAYING; until then TVN's noise owns the picture. */
  /** The channel whose picture last played; the cover over it while the next clip loads is a plain cut. */
  pictureChannel: number | null
  pictureLive: boolean
  /** The first channel is on screen (playing, a card, or the player gave up); the startup logo holds until then. */
  startupSettled: boolean
  numeric: string
  overlay: OverlayMode
  playerStatus: PlayerStatus
  playerDetail: string
  notice: string | null
  debugOpen: boolean
  hintsOn: boolean
  /** The television and its controls are live only once this is 'ready'. */
  startupPhase: import('./startup.ts').StartupPhase
  /** 0–100, from the loading steps completed so far. */
  startupProgress: number
  /** Idle minutes before streaming stops; 0 is off. */
  sleepMinutes: number
  /** Streaming has stopped for inactivity; any key, click or touch wakes the television. */
  asleep: boolean
  wake: () => void
  /** The Random Cycle (surf): random channels, each after a random wait within `surfRange`. */
  surfing: boolean
  toggleSurf: () => void
  surfRange: import('./surf.ts').SurfRange
  /** A TVN setting; `moved` is the end the viewer changed, which wins if the two cross. */
  setSurfRange: (range: import('./surf.ts').SurfRange, moved?: 'min' | 'max') => void
  /** How a channel change is presented (src/state/transitions.ts), a saved setting. Never waits for the player. */
  transition: import('./transitions.ts').TransitionSettings
  setTransition: (settings: import('./transitions.ts').TransitionSettings) => void
  /** The channel change being presented, if one is: its effect and title card, for the newest channel asked for. */
  presentation: import('./transitions.ts').Presentation | null
  /** Ends this presentation once the picture is on screen; a newer one is left alone. */
  endTransition: (session: number) => void
  /** The actions in the corners of the information overlay's control pad, a saved setting. */
  infoShortcuts: ShortcutAssignment
  /** Puts an action in a corner, swapping it with the corner's current action. */
  setInfoShortcut: (corner: Corner, id: ShortcutId) => void
  resetInfoShortcuts: () => void
  /** The channel being edited over the picture, outside the Guide; null when none is. */
  screenEdit: number | null
  /** The information bar's Watch over the picture: the channel at NOW. */
  screenAction: () => void
  /** The information bar's Prev (-1) and Next (1) over the picture: that programme, from its start. */
  screenStep: (direction: -1 | 1) => void
  /** Keeps the information bar up while the pointer is on it. */
  holdInfo: (held: boolean) => void
  dispatch: (command: TvCommand) => void
  syncLive: (nowMs: number) => void
  onPlayerReady: () => void
  onPlayerStatus: (status: PlayerStatus, detail?: string) => void
  playerRef: RefObject<PlayerHandle | null>
  focusGuide: (channelNumber: number, timeMs: number) => void
  /**
   * The Guide's select. On air: tune in (or, fromStart, play it from its beginning). Any other playable
   * programme plays from its beginning without touching the schedule. Channel 000 keeps Play Now.
   */
  activateGuide: (options?: { fromStart?: boolean }) => void
  extendGuide: (edge: 'start' | 'end') => void
  applyImport: (
    parsed: import('../services/channels-import.ts').ParsedExport,
    mode: { library: boolean; automatic: boolean },
    options?: {
      filename?: string
      /** The named user whose tab lists the channels this import adds. */
      owner?: string
      onPhase?: (
        phase: import('../library/types.ts').ImportPhase,
        counts?: import('../library/types.ts').IngestCounts,
      ) => void
    },
  ) => Promise<void>
  /** Add a YouTube channel from a channel or video link as the last user channel (or refresh it if present); `owner` lists it on that user's tab. */
  addChannel: (link: string, owner?: string) => Promise<{ number: number | null; message: string }>
  /** Named users, each a User Network tab after TVN (src/data/user-network/users.ts). */
  networkUsers: readonly import('../data/user-network/users.ts').NetworkUser[]
  /** Create a named user and show its (empty) tab. Throws a viewer-readable reason for a refused name. */
  createNetworkUser: (name: string, closePanel?: boolean) => import('../data/user-network/users.ts').NetworkUser
  /** Rename a named user; throws a viewer-readable reason for a refused name. */
  renameNetworkUser: (id: string, name: string) => string
  /** Delete a named user (after OPTIONS asks): its channels move to TVN, or are removed with it. */
  deleteNetworkUser: (id: string, channels: 'move' | 'remove') => Promise<string>
  /** Add the bundled starter network after the viewer's own channels, skipping any already present. */
  loadTestChannels: () => Promise<string>
  /** Remove the starter network's channels (edited or not) and remember that the viewer removed it. */
  removeStarterNetwork: () => Promise<string>
  /** Deliberately remove the given user channels, or all of them. */
  removeUserChannels: (numbers: 'all' | readonly number[]) => Promise<string>
  /** Download the User Network (1001+) as tvn-user-network-v1 JSON. Reads only: nothing is changed. */
  exportUserNetwork: () => Promise<string>
  /** Replace the User Network (1001+) with a validated, confirmed tvn-user-network-v1 document. */
  importUserNetwork: (document: import('../services/user-network-export.ts').UserNetworkExport) => Promise<string>
  /** COMPLETE TVN EXPORT (tvn-export-v1): the User Network, Favourites and portable settings in one file. */
  exportTvn: () => Promise<string>
  /** Restores a confirmed complete export; a file that fails validation changes nothing. */
  importTvn: (document: import('../services/tvn-export.ts').TvnExport) => Promise<string>
  /**
   * The Channel Editor, for one channel at a time. A 1001+ channel is read from and saved to the User
   * Network; a curated channel's change is kept in this browser, over the shipped channel.
   */
  openChannelEdit: (channelNumber: number) => Promise<ChannelEdit | null>
  saveChannelEdit: (channelNumber: number, edit: ChannelEdit) => Promise<string>
  /** Re-resolve this channel's enabled sources and rebuild its inventory and schedule; no other channel is touched. */
  rescanChannelEdit: (channelNumber: number, edit: ChannelEdit) => Promise<{ edit: ChannelEdit; message: string }>
  /**
   * EXPORT CHANNEL: download one user channel, as the editor shows it, as a tvn-channel-v1 file (`json`) or its
   * readable manifest (`md`). Reads only: nothing is saved.
   */
  exportChannelFile: (channelNumber: number, edit: ChannelEdit, as: ChannelExportKind) => Promise<string>
  /** Add a validated tvn-channel-v1 file as a new channel for `owner`, on the lowest free user number. */
  importChannelFile: (text: string, owner: string) => Promise<{ message: string; number: number }>
  /** TVN's shipped back catalogue for a channel source, which ARCHIVE and ALL add to it; for the editor's preview. */
  sourceArchive: (source: import('../services/channel-sources.ts').ChannelSource) => readonly import('../services/channels-import.ts').ImportedVideo[]
  /** Clear one user channel (after the editor's confirmation); its number stays as an empty slot. */
  deleteUserChannel: (channelNumber: number) => Promise<string>
  /** Drops the viewer's change to a curated channel, so it is exactly as TVN ships it again. */
  restoreCuratedChannel: (channelNumber: number) => Promise<string>
  setSourceOverride: (channelNumber: number, videoId: string | null) => void
  /** Play Now on the session channel: this imported programme starts from the beginning. */
  playSession: (programmeId: string) => void
  /** Makes channel 000 from these files, replacing it. Resolves with the viewer-facing outcome ('' if superseded). */
  importSession: (files: readonly File[]) => Promise<string>
}

export const TvContext = createContext<TvContextValue | null>(null)

export function useTv(): TvContextValue {
  const value = useContext(TvContext)
  if (!value) throw new Error('useTv must be used inside the television')
  return value
}
