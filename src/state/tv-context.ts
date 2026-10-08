import { createContext, useContext, type RefObject } from 'react'
import type { StartHold } from '../player/autoplay.ts'
import type { MediaHandle } from '../session/remembered-media.ts'
import type { Channel } from '../types/channel.ts'
import type { TvCommand } from '../types/input.ts'
import type { GuideFilter, MultiviewMode } from '../types/preferences.ts'
import type { GuideMode } from '../view/guide-mode.ts'
import type { Corner, ShortcutAssignment, ShortcutId } from '../view/info-shortcuts.ts'
import type { PlayerHandle, PlayerStatus } from '../player/types.ts'
import type { ChannelEdit, LoadMoreOptions } from '../services/channel-editor.ts'
import type { ChannelSource } from '../services/channel-sources.ts'
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

/** A Guide created from words: what they were, which Guide holds the result, and how it was varied. */
export interface GuideSearchState {
  query: string
  guideId: string
  seed: number
  /** How many programmes answered the words at all. */
  matched: number
  /** Too few matched for RESCAN to vary much. */
  small: boolean
}

export interface TvContextValue {
  channel: Channel
  previousChannel: Channel | null
  /** Back and Forward through the channels watched this session are available. */
  canGoBack: boolean
  canGoForward: boolean
  /** What the browser held back at startup until the viewer's first key or tap. */
  startHold: StartHold
  /** SMART is on: the remote stays up after a channel number tunes; otherwise it closes. */
  smart: boolean
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
  /** Counts NOW presses that brought the Guide to the current time: each one centres the channel playing. */
  guideNowAsk: number
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
  /** TV Surf waits for the programme on screen to finish before the next hop (off by default). */
  surfUntilEnd: boolean
  setSurfUntilEnd: (untilEnd: boolean) => void
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
  /** The time slider: the programme on screen from this many seconds in. */
  screenSeek: (seconds: number) => void
  /** 000 TVN: choose another programme now. */
  chooseAnotherTvn: () => void
  /** TV Surf's right-click or hold: surf every channel, or only one User Network (the Guide's tab follows). */
  toggleSurfScope: () => void
  /** The User Network TV Surf surfs while restricted, by its own name. */
  surfScopeName: string
  /** Keeps the information bar up while the pointer is on it. */
  holdInfo: (held: boolean) => void
  /** The Guide being edited and the saved Guides (viewing sequences). */
  guideLibrary: import('../services/viewing-guides.ts').GuideLibrary
  /** The Guide being played: ACTIVE while it chooses what comes next, SUSPENDED once the viewer tuned away. */
  guideRun: import('../services/viewing-guides.ts').GuideRun | null
  /** The words the current Guide was created from, while it is the one on show; null otherwise. */
  guideSearch: GuideSearchState | null
  /** CREATE GUIDE FROM…: a new Guide from TVN's catalogue for these words, or RESCAN (`rescan`) of the last; the answer is a short line. */
  searchGuide: (query: string, rescan?: boolean) => string
  /** MY GUIDE SOURCES · ADD CHANNEL: the channel on this number becomes a source of the current Guide, kept by its identity. */
  addGuideSource: (channelNumber: number) => string
  /** A CHANNEL SOURCE as it is now: the channel it follows (by id) and the usable programming it offers. */
  guideSupply: (source: import('../services/viewing-guides.ts').GuideSource) => { channel: import('../types/channel.ts').Channel | undefined; programmes: number; seconds: number }
  /** BUILD MY GUIDE: the current Guide's programmes scheduled afresh from its MY GUIDE SOURCES; the answer is a short line. */
  buildChannelGuide: () => string
  /** ADD TO GUIDE: the programme joins the end of the current Guide (a new one if there is none). */
  addToGuide: (channelNumber: number, programme: import('../types/programme.ts').Programme) => string
  /** One Guide editor action (NEW, SAVE, RENAME, reorder…); the answer is a short line for the viewer. */
  editGuide: (action: import('../services/viewing-guides.ts').GuideAction) => string
  /** Plays the current Guide from an item (the first by default). */
  playGuide: (fromIndex?: number) => void
  /** Follows a suspended Guide again, from the item it was on. */
  resumeGuide: () => void
  /** Stops following the Guide; it stays loaded. */
  stopGuide: () => void
  /** The previous (-1) or next (1) Guide item. */
  guideStep: (direction: -1 | 1) => void
  dispatch: (command: TvCommand) => void
  syncLive: (nowMs: number) => void
  onPlayerReady: () => void
  onPlayerStatus: (status: PlayerStatus, detail?: string) => void
  playerRef: RefObject<PlayerHandle | null>
  focusGuide: (channelNumber: number, timeMs: number) => void
  /**
   * The Guide's select. On air: tune in (or, fromStart, play it from its beginning). Any other playable
   * programme plays from its beginning without touching the schedule. 1000 Local Media keeps Play Now.
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
  /** ADD CHANNELS: each YouTube link a channel of its own, in order, on the next free numbers; onProgress hears each one read. */
  addChannels: (links: readonly string[], owner?: string, onProgress?: (done: number, total: number) => void) => Promise<{ numbers: number[]; message: string }>
  /** What a website, feed or episode archive holds, read before it is added; null for a YouTube link, which adds directly. */
  previewSource: (link: string, onProgress?: (text: string) => void) => Promise<import('../services/podcast-source.ts').FoundFeed | null>
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
  /** Whether NEW would remove channels or changes the viewer made, not just the example network. */
  networkCustomised: () => Promise<boolean>
  /** NEW: clear the example network (and any channels) so this browser's network starts empty but for 000 and 1000. */
  startNewNetwork: () => Promise<string>
  /** A new, empty 1001+ channel for Edit Channel to fill; its number. */
  /** A new, empty channel after the User Network; `low` puts it at the first free number from 001 in a network of the viewer's own. */
  createEmptyChannel: (low?: boolean) => Promise<number>
  /** Download the User Network (1001+) as tvn-user-network-v1 JSON. Reads only: nothing is changed. */
  exportUserNetwork: () => Promise<string>
  /** Replace the User Network (1001+) with a validated, confirmed tvn-user-network-v1 document. */
  /** onProgress hears how the sources read after the restore are going. */
  importUserNetwork: (document: import('../services/user-network-export.ts').UserNetworkExport, onProgress?: (note: string) => void) => Promise<string>
  /** COMPLETE TVN EXPORT (tvn-export-v1): the User Network, Favourites and portable settings in one file. */
  exportTvn: () => Promise<string>
  /** Restores a confirmed complete export; a file that fails validation changes nothing. */
  /** ALL restores everything the file holds; USER only its User Network and that network's Favourites. */
  importTvn: (document: import('../services/tvn-export.ts').TvnExport, scope?: 'all' | 'user', onProgress?: (note: string) => void) => Promise<string>
  /**
   * The Channel Editor, for one channel at a time. A 1001+ channel is read from and saved to the User
   * Network; a curated channel's change is kept in this browser, over the shipped channel.
   */
  openChannelEdit: (channelNumber: number) => Promise<ChannelEdit | null>
  saveChannelEdit: (channelNumber: number, edit: ChannelEdit) => Promise<string>
  /** Re-resolve this channel's enabled sources and rebuild its inventory and schedule; no other channel is touched. */
  rescanChannelEdit: (channelNumber: number, edit: ChannelEdit) => Promise<{ edit: ChannelEdit; message: string }>
  /** LOAD MORE / LOAD ALL: one source read past its first batch. Reads only; the editor saves the result. */
  loadMoreChannelSource: (source: ChannelSource, options: LoadMoreOptions) => Promise<ChannelSource>
  /** A newly added source read for its first programmes, as RESCAN would read it; nothing is saved. */
  acquireChannelSource: (source: ChannelSource) => Promise<ChannelSource>
  /** Whether LOAD can read a source further (an imported list only when TVN knows its uploader). */
  canLoadChannelSource: (source: ChannelSource) => boolean
  /** LATEST FIRST: the channel's newest programme now, then newest to oldest; again, back to TVN's arrangement. A message for the viewer. */
  latestFirst: (channelNumber: number) => Promise<string>
  /** RELOAD: rescan the channel and put it back in its kind of order. A message for the viewer. */
  reloadChannel: (channelNumber: number) => Promise<string>
  /**
   * EXPORT CHANNEL: download one user channel, as the editor shows it, as a tvn-channel-v1 file (`json`) or its
   * readable manifest (`md`). Reads only: nothing is saved.
   */
  exportChannelFile: (channelNumber: number, edit: ChannelEdit, as: ChannelExportKind) => Promise<string>
  /** Add a validated tvn-channel-v1 file as a new channel for `owner`, on the lowest free user number. */
  importChannelFile: (text: string, owner: string) => Promise<{ message: string; number: number }>
  /** TVN's shipped back catalogue for a channel source, which ARCHIVE and ALL add to it; for the editor's preview. */
  sourceArchive: (source: import('../services/channel-sources.ts').ChannelSource) => readonly import('../services/channels-import.ts').ImportedVideo[]
  /** Play one of a channel's programmes (by its editor id) now; a message when it cannot, or null. */
  playChannelProgramme: (channelNumber: number, programmeId: string) => string | null
  /** Delete one user channel (after the editor's confirmation): it leaves the network, its Favourite with it. */
  deleteUserChannel: (channelNumber: number) => Promise<string>
  /** MOVE TO: a user channel inserted at User position `to`; every 1001+ channel is renumbered from 1001. */
  moveUserChannel: (channelNumber: number, to: number) => Promise<string>
  /** SORT A–Z or RANDOMISE the User Network once; the new order is its stored running order. */
  arrangeUserNetwork: (how: 'alphabetical' | 'shuffle') => Promise<string>
  /** Drops the viewer's change to a curated channel, so it is exactly as TVN ships it again. */
  restoreCuratedChannel: (channelNumber: number) => Promise<string>
  setSourceOverride: (channelNumber: number, videoId: string | null) => void
  /** Play Now on the session channel: this imported programme starts from the beginning. */
  playSession: (programmeId: string) => void
  /** Adds these files to a Local Media channel (991–1000). Resolves with the viewer-facing outcome ('' if superseded). */
  importSession: (files: readonly File[], channelNumber: number, handles?: readonly MediaHandle[]) => Promise<string>
  /** REMEMBER LOCAL MEDIA: loads every remembered Local Media channel again, as the viewer left it. */
  reloadLocalMedia: () => Promise<string>
  /** Takes one imported file out of its Local Media channel. */
  removeSessionFile: (programmeId: string) => void
  /** Moves one imported file to this position in its Local Media channel's running order; what is on air carries on. */
  moveSessionFile: (programmeId: string, to: number) => boolean
  /** Empties a Local Media channel; its name stays. */
  clearLocalChannel: (channelNumber: number) => void
  /** Names a Local Media channel; an empty name restores the default. */
  renameLocalChannel: (channelNumber: number, name: string) => boolean
}

export const TvContext = createContext<TvContextValue | null>(null)

export function useTv(): TvContextValue {
  const value = useContext(TvContext)
  if (!value) throw new Error('useTv must be used inside the television')
  return value
}
