import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { channelByNumber, channels, listChannels, programmesFor, randomChannel, shippedChannel } from '../data/catalogue.ts'
import { channelMatchesFilter, inFavouriteOrder } from '../data/network.ts'
import { subscribeCatalogue } from '../data/user-overlay.ts'
import {
  GUIDE_EXTEND_MS,
  GUIDE_MAX_WINDOW_MS,
  windowAround,
} from '../epg/geometry.ts'
import { searchGuideChannels } from '../epg/navigation.ts'
import { clampZoom } from '../epg/zoom.ts'
import { guideOpeningZoom } from '../epg/opening-zoom.ts'
import { commandFromGamepad } from '../input/gamepad.ts'
import { commandFromKeyEvent, isEditableTarget } from '../input/keyboard.ts'
import { createSpaceHold } from '../input/space-hold.ts'
import { webInteraction } from '../player/web-interaction.ts'
import { deliver, playbackCommand, type PlaybackCommand } from '../player/command.ts'
import { notePlayback } from '../player/trace.ts'
import { notePhase, notePress } from '../player/tune-timing.ts'
import { commitTune } from './tune-commit.ts'
import { liveAiring } from '../player/viewing.ts'
import { clearManual, manualAiring, onScreen, pickTunes, resumeProgramme, selectProgramme } from '../player/manual.ts'
import { afterRefusal, arrive, fallbackProgramme, giveUp, type Recovery } from '../player/refusal-fallback.ts'
import type { PlayerHandle, PlayerStatus } from '../player/types.ts'
import { liveKey } from '../scheduler/calculate.ts'
import { slotContaining } from '../scheduler/window.ts'
import { beginScheduleBootstrap } from '../director/cache.ts'
import { setChannelIdentity } from '../director/director.ts'
import { loadUserLibraryMode, setUserLibraryMode } from '../library/mode.ts'
import { ensureDefaultNetwork, subscribeLibrary } from '../library/store.ts'
import { broadcast, guideSlots } from '../services/broadcast.ts'
import { claimStarterInstall } from '../data/user-network/starter.ts'
import {
  type StoredSource,
} from '../services/channels-import.ts'
import {
  loadCuratedEdits,
} from '../services/curated-edits.ts'
import { isLiveStreamChannel } from '../dynamic/stream.ts'
import { editorScope } from '../view/channel-edit.ts'
import { subscribeOverrides, videoOverride } from '../services/overrides.ts'
import { defaultFavouritesDue, loadPreferences, savePreferences } from '../services/preferences.ts'
import {
  liveFavourites,
} from '../services/network-order.ts'
import {
  type ShortcutAssignment,
} from '../view/info-shortcuts.ts'
import { refusedVideos } from '../services/embed-refusals.ts'
import { sourceArchive } from '../services/user-archive.ts'
import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'
import type { GuideTool, TvCommand } from '../types/input.ts'
import type { GuideFilter, MultiviewMode } from '../types/preferences.ts'
import { padChannel, sleep } from '../utils/time.ts'
import { clipFlags, dueFlag, saveClipFlags } from '../view/clip-flags.ts'
import { sleepPhase } from './sleep.ts'
import { loadSurfRange, loadSurfUntilEnd, surfDelayMs, surfUntilEndMs, type SurfRange } from './surf.ts'
import {
  loadGuideLibrary,
  type GuideAction,
  type GuideSource,
  type GuideLibrary,
  type GuideRun,
} from '../services/viewing-guides.ts'
import type { ChannelEditorial } from '../services/channel-curation.ts'
import {
  DEFAULT_TRANSITION_SETTINGS,
  loadTransitionSettings,
  transitionTiming,
  type Presentation,
  type TransitionSettings,
  type TransitionTiming,
} from './transitions.ts'
import { currentEntryMode, surfsOnEntry } from './entry.ts'
import { createStartupRestore } from './startup-channel.ts'
import { commitTuned, fallForwardTarget, guideRows, type Tuned } from './tuning.ts'
import { browserCanPlay, buildSessionItems, commitImport, filesInDirectory, probeDuration, sniffRemux, type DirectoryHandleLike, type FileHandleLike } from '../session/import.ts'
import { forgetFlvSource, registerFlvSource } from '../player/flv.ts'
import { arrangeRemembered, readable, rememberedChannels, rememberHandles, rememberOrder, type MediaHandle } from '../session/remembered-media.ts'
import {
  SESSION_CHANNEL_NUMBER,
  clearSession,
  hasPicture,
  isLocalMediaNumber,
  moveSessionProgramme,
  sessionProgrammes,
  setUrlRevoker,
  rebaseSession,
  removeSessionProgramme,
  renameLocalChannel,
  searchSession,
  sessionActive,
  sessionBroadcast,
  sessionChoice,
  sessionNumberFor,
  sessionRefresh,
  subscribeSession,
} from '../session/session-channel.ts'
import { chooseAnotherTvn, driveTvn, enterTvn, TVN_CHANNEL_NUMBER, tvnChoice } from '../tvn/tvn-channel.ts'
import { type StartupPhase } from './startup.ts'

import { guidePickAction, guideTuneDecision, type GuideMode } from '../view/guide-mode.ts'
import { guideToolTarget } from '../view/guide-tool.ts'
import {
  clampPipSize,
  loadPipSize,
  pipToRemember,
  savePipChannel,
  savePipSize,
  replaceFocusedTile,
  surfTile,
} from '../view/multiview.ts'
import { isOnAir } from '../network/airing.ts'
import { confirmStart, soundHeld, soundRefused, viewerInteracted, type StartHold } from '../player/autoplay.ts'
import { canGoBack, canGoForward, commitHistory, EMPTY_HISTORY, visit, type ViewingHistory } from './history.ts'
import { useNoticeAcknowledged } from '../legal/about-store.ts'
import { VOLUME_FULL } from '../player/volume.ts'
import { loadUsers, saveUsers, type NetworkUser } from '../data/user-network/users.ts'
import {
  TvContext,
  type GuideCursor,
  type GuideNote,
  type GuideSearchState,
  type GuideToolState,
  type OverlayMode,
  type TvContextValue,
} from './tv-context.ts'
import { useViewingGuides } from './provider/use-viewing-guides.ts'
import { INFO_MS, readsOriginals, installCurated, type SessionControls } from './provider/shared.ts'
import { useChannelEditing } from './provider/use-channel-editing.ts'
import { historyWithout } from '../services/network-order.ts'
import { useChannelLibrary } from './provider/use-channel-library.ts'
import { useTvCommands } from './provider/use-tv-commands.ts'
import { useScreenControls } from './provider/use-screen-controls.ts'
import { useStartupLoad } from './provider/use-startup-load.ts'
import { usePlayerEvents } from './provider/use-player-events.ts'

setChannelIdentity((channel) => shippedChannel(channel.number)?.name ?? channel.name)

export function TvProvider({ children }: { children: ReactNode }) {
  setUserLibraryMode(loadUserLibraryMode())
  ensureDefaultNetwork()
  beginScheduleBootstrap()
  const [starterDue] = useState(() => claimStarterInstall())
  // The first channel is on screen: playing, paused, a slate, or a failure its replacement did not follow in time.
  // The startup logo holds until then.
  const [startupSettled, setStartupSettled] = useState(false)
  const startupSettledRef = useRef(false)
  startupSettledRef.current = startupSettled
  const [startupFailed, setStartupFailed] = useState(false)
  const [favouritesSeeded] = useState(() => defaultFavouritesDue())
  const stored = useRef(loadPreferences()).current
  const initialNumber = channelByNumber(stored.lastChannelNumber)?.number ?? 1
  const initialPrevious =
    stored.previousChannelNumber !== null &&
    stored.previousChannelNumber !== initialNumber &&
    channelByNumber(stored.previousChannelNumber)
      ? stored.previousChannelNumber
      : null

  const [channelNumber, setChannelNumber] = useState(initialNumber)
  const [previousNumber, setPreviousNumber] = useState<number | null>(initialPrevious)
  const [volume, setVolume] = useState(stored.volume)
  const [muted, setMuted] = useState(stored.muted)
  const [paused, setPaused] = useState(false)
  const [subtitles, setSubtitles] = useState(stored.subtitles)
  const [favourites, setFavourites] = useState<number[]>(stored.favouriteChannelNumbers)
  const [guideFilter, setGuideFilter] = useState<GuideFilter>(stored.guideFilter)
  const [networkUsers, setNetworkUsers] = useState<NetworkUser[]>(() => loadUsers())
  const usersRef = useRef<NetworkUser[]>(networkUsers)
  const userIds = () => new Set(usersRef.current.map((user) => user.id))
  /** The named users, kept, stored and listed at once, so channels built straight after see them. */
  const commitUsers = (next: NetworkUser[]) => {
    usersRef.current = next
    saveUsers(next)
    setNetworkUsers(next)
  }
  const [guideMode, setGuideMode] = useState<GuideMode>('closed')
  const [guideSplit, setGuideSplit] = useState(stored.guideSplit)
  const [multiviewMode, setMultiviewMode] = useState<MultiviewMode>(stored.multiviewMode)
  const [tiles, setTiles] = useState<number[]>(stored.multiviewChannels)
  const [audioFocus, setAudioFocus] = useState(stored.audioFocusIndex)
  const [multiviewPage, setMultiviewPage] = useState(0)
  const [guideTool, setGuideTool] = useState<GuideToolState | null>(null)
  const guideToolRef = useRef<GuideToolState | null>(null)
  const editingRef = useRef<() => boolean>(() => false)
  const panelOpenRef = useRef<() => GuideTool | null>(() => null)
  /** The Channel Editor opened over the picture (outside the Guide), for this channel number. */
  const [screenEdit, setScreenEdit] = useState<number | null>(null)
  const screenEditRef = useRef<number | null>(null)
  const [remoteOpen, setRemoteOpen] = useState(false)
  const [credits, setCredits] = useState(false)
  const creditsRef = useRef(false)
  const [catalogueVersion, setCatalogueVersion] = useState(0)
  const [guideCursor, setGuideCursor] = useState<GuideCursor>(() => ({
    channelNumber: initialNumber,
    timeMs: Date.now(),
  }))
  const [guideWindow, setGuideWindow] = useState(() => windowAround(Date.now()))
  const [guideNote, setGuideNote] = useState<GuideNote>(null)
  const [tuningNumber, setTuningNumber] = useState<number | null>(null)
  const [pictureLive, setPictureLive] = useState(false)
  /** The channel whose picture last played: a cover over that same channel is a change of clip, not of channel. */
  const [pictureChannel, setPictureChannel] = useState<number | null>(null)
  const pictureLiveRef = useRef(false)
  /** The automatic recovery from refused programmes since the viewer's last tune or the last picture that played. */
  const recoveryRef = useRef<Recovery | null>(null)
  /** A refusal that arrived while its tune was still settling, for the channel that tune commits to. */
  const recoveryDue = useRef<{ channelNumber: number; cause: 'refused' | 'unplayable' } | null>(null)
  /** The next tune is the recovery falling forward, not the viewer: it keeps the recovery going. */
  const autoTuneRef = useRef(false)
  const recoverRef = useRef<(channelNumber: number, cause: 'refused' | 'unplayable') => void>(() => {})
  const [guideLibrary, setGuideLibraryState] = useState<GuideLibrary>(() => loadGuideLibrary())
  const guideLibraryRef = useRef(guideLibrary)
  const [guideRun, setGuideRunState] = useState<GuideRun | null>(null)
  const [guideSearch, setGuideSearchState] = useState<GuideSearchState | null>(null)
  const guideSearchRef = useRef<GuideSearchState | null>(null)
  /** The 1001+ channels' editorial notes, for CREATE GUIDE FROM… . */
  const userEditorialRef = useRef(new Map<number, ChannelEditorial>())
  const guideRunRef = useRef<GuideRun | null>(null)
  /** The tune or pick in progress is the Guide's own, not the viewer's: it does not suspend the Guide. */
  const guideDrivingRef = useRef(false)
  /** The Guide's playback steps, rebuilt every render so the once-made callbacks reach the current ones. */
  const guideEngine = useRef({
    advance: (_finished: boolean) => {},
    skipFailed: (_channelNumber: number): boolean => false,
    suspend: () => {},
    step: (_direction: -1 | 1) => {},
  })
  const [numeric, setNumeric] = useState('')
  const [overlay, setOverlay] = useState<OverlayMode>('none')
  const [playerStatus, setPlayerStatus] = useState<PlayerStatus>('loading-api')
  const [playerDetail, setPlayerDetail] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [debugOpen, setDebugOpen] = useState(false)
  const [hintsOn, setHintsOn] = useState(true)
  const [startupPhase, setStartupPhase] = useState<StartupPhase>('loading')
  const [startupProgress, setStartupProgress] = useState(0)
  const phaseRef = useRef<StartupPhase>('loading')
  const [sleepMinutes, setSleepMinutes] = useState(stored.sleepMinutes)
  const [asleep, setAsleep] = useState(false)
  const sleepMinutesRef = useRef(stored.sleepMinutes)
  const asleepRef = useRef(false)
  const activityRef = useRef(Date.now())
  const sleepWarnedRef = useRef(false)
  const goToSleepRef = useRef<() => void>(() => {})
  // The address decides whether Surf starts running: tvn.lol/tvn does, tvn.lol/ waits for the TVN button.
  const [surfing, setSurfing] = useState(() => surfsOnEntry(currentEntryMode()))
  const surfingRef = useRef(surfing)
  const [surfHops, setSurfHops] = useState(0)
  const [surfRange, setSurfRangeState] = useState<SurfRange>(() => loadSurfRange())
  const [pipSize, setPipSizeState] = useState(() => loadPipSize())
  const setPipSize = useCallback((size: number) => {
    const next = clampPipSize(size)
    savePipSize(next)
    setPipSizeState(next)
    return next
  }, [])
  const pipSizeRef = useRef(pipSize)
  pipSizeRef.current = pipSize
  // The inset changed under a main picture that stayed: the viewer chose it, so the next PiP starts with it.
  const pipSeenRef = useRef<number[] | null>(null)
  useEffect(() => {
    if (multiviewMode !== 'pip') {
      pipSeenRef.current = null
      return
    }
    const chosen = pipToRemember(pipSeenRef.current, tiles)
    pipSeenRef.current = tiles
    if (chosen !== null) savePipChannel(chosen)
  }, [multiviewMode, tiles])
  const [surfUntilEnd, setSurfUntilEndState] = useState(() => loadSurfUntilEnd())
  const [transition, setTransitionState] = useState<TransitionSettings>(() => loadTransitionSettings())
  const transitionRef = useRef(transition)
  /** The transition presenting the current tune, if one is; tunes during it take it over. */
  const [presentation, setPresentation] = useState<Presentation | null>(null)
  const presentationRef = useRef<Presentation | null>(null)
  const presentationSession = useRef(0)
  /** The timing of the tune in progress, fixed at its first press. */
  const tuneTiming = useRef<TransitionTiming>(transitionTiming(DEFAULT_TRANSITION_SETTINGS))
  const [infoShortcuts, setInfoShortcuts] = useState<ShortcutAssignment>(stored.infoShortcuts)
  const noticeSeen = useNoticeAcknowledged()

  const playerRef = useRef<PlayerHandle | null>(null)
  const channelRef = useRef(initialNumber)
  const previousRef = useRef<number | null>(initialPrevious)
  const historyRef = useRef<ViewingHistory>(visit(EMPTY_HISTORY, initialNumber))
  const [history, setHistory] = useState<ViewingHistory>(historyRef.current)
  /** The history entry a Back or Forward tune in progress is aiming for; any other tune clears it. */
  const historyAimRef = useRef<number | null>(null)
  const historyNavRef = useRef<number | null>(null)
  const volumeRef = useRef(stored.volume)
  const mutedRef = useRef(stored.muted)
  const subtitlesRef = useRef(stored.subtitles)
  const pausedRef = useRef(false)
  const tuningRef = useRef(false)
  const guideOpenRef = useRef(false)
  const guideModeRef = useRef<GuideMode>('closed')
  const multiviewRef = useRef<MultiviewMode>(stored.multiviewMode)
  const tilesRef = useRef<number[]>(stored.multiviewChannels)
  const audioFocusRef = useRef(stored.audioFocusIndex)
  const catalogueReadyRef = useRef(false)
  const cursorRef = useRef(guideCursor)
  const windowRef = useRef(guideWindow)
  const visibleRef = useRef<Channel[]>([])
  const playerReadyRef = useRef(false)
  const bootedRef = useRef(false)
  const [startHold, setStartHold] = useState<StartHold>(null)
  const startHoldRef = useRef<StartHold>(null)
  const soundReleasedAt = useRef(0)
  const startCheckRef = useRef(false)
  const loadedKey = useRef('')
  const loadToken = useRef(0)
  const tokenRef = useRef(0)
  const pendingOrigin = useRef<number | null>(null)
  const pendingNumberRef = useRef<number | null>(null)
  const staticSince = useRef(0)
  const settleTimer = useRef(0)
  /** The channel and video the single-view player was last asked for: a player error belongs to this. */
  const askedRef = useRef<{ channelNumber: number; videoId: string | null } | null>(null)
  const failureTimer = useRef(0)
  const failuresRef = useRef<{ videoId: string; reason: string }[]>([])
  const failureScopes = useRef(new Set<'library' | 'user'>())
  const numericTimer = useRef(0)
  const [smart, setSmartState] = useState(false)
  const smartRef = useRef(false)
  const setSmart = (on: boolean) => {
    smartRef.current = on
    setSmartState(on)
  }
  const overlayTimer = useRef(0)
  const noticeTimer = useRef(0)
  const bufferRef = useRef('')
  const dispatchRef = useRef<(command: TvCommand) => void>(() => {})
  /** A schedule key (R, X, L, Z) is at work; another waits for it. */
  const scheduleBusyRef = useRef(false)
  /** Playlists just added, read to their end one channel after another. */
  const readWholeRef = useRef<(number: number) => void>(() => {})
  const playlistQueue = useRef<Promise<void>>(Promise.resolve())
  const toggleSurfScopeRef = useRef<() => void>(() => {})
  /** The website or post on screen when TVN paused, and how far into its slot. */
  const pausedWebRef = useRef<{ channelNumber: number; programme: Programme; elapsedSeconds: number; slot: { startMs: number; endMs: number } } | null>(null)
  const commitTuneRef = useRef<(generation: number, number: number, origin: number) => Promise<void>>(
    async () => {},
  )
  const commitNumericRef = useRef<() => void>(() => {})
  const sessionRef = useRef<SessionControls>({
    play: () => {},
    import: async () => '',
    reload: async () => '',
    remove: () => {},
    clear: () => {},
  })
  const importToken = useRef(0)
  const bootRef = useRef<() => void>(() => {})
  const [startup] = useState(createStartupRestore)

  const channel = channelByNumber(channelNumber) ?? listChannels()[0] ?? channels[0]
  const previousChannel = previousNumber !== null ? (channelByNumber(previousNumber) ?? null) : null
  const guideOpen = guideMode !== 'closed'
  const [guideQuery, setGuideQuery] = useState('')
  const [guideZoom, setGuideZoomState] = useState(1)
  const [guideNowAsk, setGuideNowAsk] = useState(0)
  // The cursor NOW last placed: while it is still the cursor, a second NOW goes back to the picture.
  const nowCursorRef = useRef<GuideCursor | null>(null)
  const setGuideZoom = useCallback((zoom: number) => setGuideZoomState(clampZoom(zoom)), [])
  const guideList = useMemo(() => {
    const listed = listChannels().filter((item) => channelMatchesFilter(item, guideFilter, favourites))
    return guideRows(guideFilter === 'favourites' ? inFavouriteOrder(listed, favourites) : listed, channelByNumber(channelNumber), guideFilter)
  }, [catalogueVersion, favourites, guideFilter, channelNumber])
  const guideVisiting = guideList.visiting
  const visibleChannels = useMemo(
    () => searchGuideChannels(guideList.rows, guideQuery, (item, needle) => item.origin === 'session' && searchSession(needle, item.number).length > 0),
    [guideList, guideQuery],
  )
  const guideQueryRef = useRef(guideQuery)
  guideQueryRef.current = guideQuery

  volumeRef.current = volume
  mutedRef.current = muted
  const favouritesRef = useRef(favourites)
  favouritesRef.current = favourites
  const guideSplitRef = useRef(guideSplit)
  guideSplitRef.current = guideSplit
  const infoShortcutsRef = useRef(infoShortcuts)
  infoShortcutsRef.current = infoShortcuts
  const surfRangeRef = useRef(surfRange)
  surfRangeRef.current = surfRange
  pausedRef.current = paused
  guideOpenRef.current = guideOpen
  guideModeRef.current = guideMode
  multiviewRef.current = multiviewMode
  tilesRef.current = tiles
  audioFocusRef.current = audioFocus
  cursorRef.current = guideCursor
  windowRef.current = guideWindow
  visibleRef.current = visibleChannels as Channel[]

  /** The one writer of the tuned channel: the ref the controls step from and the state on screen move together. */
  const commitChannel = (next: Tuned, record = true) => {
    // Boost belongs to Local Media: anywhere else the volume comes back to full.
    if (!isLocalMediaNumber(next.channelNumber) && volumeRef.current > VOLUME_FULL) {
      volumeRef.current = VOLUME_FULL
      setVolume(VOLUME_FULL)
    }
    channelRef.current = next.channelNumber
    previousRef.current = next.previousNumber
    setChannelNumber(next.channelNumber)
    setPreviousNumber(next.previousNumber)
    if (record) {
      historyRef.current = commitHistory(historyRef.current, next.channelNumber, historyAimRef.current)
      setHistory(historyRef.current)
    }
    historyAimRef.current = null
  }
  const tuned = (): Tuned => ({ channelNumber: channelRef.current, previousNumber: previousRef.current })

  /**
   * MULTI: the selected window becomes the channel heard, and the one information bar (the same INFO as
   * single viewing) shows what that window is airing. Multi View stays as it is.
   */
  const selectTile = (index: number): number | undefined => {
    audioFocusRef.current = index
    setAudioFocus(index)
    return tilesRef.current[index]
  }

  const showOverlay = (mode: OverlayMode, ms: number) => {
    setOverlay(mode)
    window.clearTimeout(overlayTimer.current)
    if (mode === 'none') return
    overlayTimer.current = window.setTimeout(() => setOverlay('none'), ms)
  }

  const flash = (message: string, ms = 1200) => {
    setNotice(message)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), ms)
  }

  // A video already known to refuse embedding never reaches YouTube, whose player would sit on a dead play button.
  const deliverLive = async (player: PlayerHandle, command: PlaybackCommand, channelNumber: number) => {
    askedRef.current = { channelNumber, videoId: command.videoId }
    pictureLiveRef.current = false
    setPictureLive(false)
    if (!command.videoId || !refusedVideos().has(command.videoId)) return deliver(player, command)
    await deliver(player, { ...command, videoId: null, kind: 'holding' })
    setPlayerStatus('error')
    setPlayerDetail('150')
    // Nothing on this channel within reach will play: the recovery moves on from it.
    recoverRef.current(channelNumber, 'unplayable')
    return 'error' as const
  }

  const loadProgramme = async (target: Channel, nowMs: number) => {
    const load = ++loadToken.current
    if (target.origin === 'tvn') driveTvn(nowMs)
    passRefused(target, nowMs)
    const scheduleStart = performance.now()
    const airing = liveAiring(target, nowMs, videoOverride(target.number))
    notePhase(target.number, 'programmeAt', { scheduleMs: performance.now() - scheduleStart })
    loadedKey.current = airing.key
    const player = playerRef.current
    if (!player) {
      setStartupSettled(true)
      return 'slate' as const
    }
    const command = airing.command
    notePlayback({
      channelNumber: target.number,
      provider: airing.programme.source,
      externalId: airing.programme.videoId,
    })
    notePhase(target.number, 'requestAt')
    const result = await deliverLive(player, command, target.number)
    notePhase(target.number, 'answeredAt', { result })
    // A later load owns the player now; this one must not seek or replace what it is showing.
    if (load !== loadToken.current) return result
    if (result === 'slate') setStartupSettled(true)
    if (result === 'error') setStartupFailed(true)
    if (pausedRef.current) {
      player.pause()
      return result
    }
    const fresh = onScreen(target, Date.now())
    const sameAiring =
      fresh.current.programme.id === airing.programme.id &&
      Math.abs(fresh.current.startMs - airing.startMs) < 2000
    if (result === 'playing' && sameAiring) {
      const liveSeek = playbackCommand(fresh.current.programme, fresh.current.seekSeconds, videoOverride(target.number)).startSeconds
      if (fresh.current.programme.videoId === command.videoId && Math.abs(liveSeek - command.startSeconds) > 1.5) {
        player.seek(liveSeek)
      }
      loadedKey.current = liveKey(target.id, fresh.current.programme.id, fresh.current.startMs)
      return result
    }
    if (!sameAiring) {
      const next = playbackCommand(fresh.current.programme, fresh.current.seekSeconds, videoOverride(target.number))
      notePlayback({ channelNumber: target.number, provider: fresh.current.programme.source, externalId: fresh.current.programme.videoId })
      await deliverLive(player, next, target.number)
      if (load !== loadToken.current) return result
    }
    loadedKey.current = liveKey(target.id, fresh.current.programme.id, fresh.current.startMs)
    return result
  }

  /**
   * When the programme due on this channel is known to be refused, its next programme that will play is
   * played instead, from its beginning: a fallback over the schedule, which is not changed. True when the
   * channel has something to play.
   */
  /** The channel the viewer is on: the one a settling tune is committing to, else the one tuned. */
  const watchingNumber = () => (tuningRef.current ? (pendingNumberRef.current ?? channelRef.current) : channelRef.current)

  const passRefused = (target: Channel, nowMs: number): boolean => {
    // 000 refers to other channels' programmes: a refused one is simply replaced by another choice.
    if (target.origin === 'tvn') {
      const shown = onScreen(target, nowMs).current.programme.videoId
      return !shown || !refusedVideos().has(shown) || chooseAnotherTvn(nowMs)
    }
    const snap = onScreen(target, nowMs)
    const videoId = snap.current.programme.videoId
    const refused = refusedVideos()
    if (!videoId || !refused.has(videoId) || videoOverride(target.number)) return true
    const picked = manualAiring(target.number, nowMs)
    const from = picked?.slot ?? snap.current
    const next = fallbackProgramme(target, from, refused)
    if (!next) return false
    selectProgramme(target.number, next.programme, nowMs, { startMs: next.startMs, endMs: next.endMs }, picked?.shiftMs !== undefined ? target : undefined)
    return true
  }

  recoverRef.current = (channelNumber, cause) => {
    if (multiviewRef.current !== '1' || channelNumber !== watchingNumber()) return
    if (!tuningRef.current && guideEngine.current.skipFailed(channelNumber)) return
    if (tuningRef.current) {
      recoveryDue.current = { channelNumber, cause }
      return
    }
    const current = channelByNumber(channelNumber)
    if (!current) return
    const now = Date.now()
    const step = cause === 'refused' ? afterRefusal(recoveryRef.current, channelNumber) : { action: 'next-channel' as const, recovery: giveUp(recoveryRef.current, channelNumber) }
    recoveryRef.current = step.recovery
    if (step.action === 'next-programme') {
      if (passRefused(current, now)) {
        loadedKey.current = ''
        void loadProgramme(current, now)
        return
      }
      recoveryRef.current = giveUp(step.recovery, channelNumber)
    }
    const failed = new Set(recoveryRef.current.failedChannels)
    const target = fallForwardTarget(channelNumber, { filter: guideFilter, favourites }, failed)
    // Every channel worth trying has been tried: the unavailable card stays rather than going round again.
    if (target === null) return
    recoveryRef.current = arrive(recoveryRef.current, target)
    autoTuneRef.current = true
    requestTune(target)
  }

  const resumeViewing = () => {
    pausedRef.current = false
    setPaused(false)
    const current = channelByNumber(channelRef.current)
    // A website's schedule truly stood still while paused: it carries on from there, not from the wall clock.
    const held = pausedWebRef.current
    pausedWebRef.current = null
    if (held && current?.number === held.channelNumber) resumeProgramme(held.channelNumber, held.programme, held.elapsedSeconds, Date.now(), held.slot)
    const player = playerRef.current
    loadedKey.current = ''
    if (!current || !player || multiviewRef.current !== '1' || tuningRef.current || !playerReadyRef.current) return
    void loadProgramme(current, Date.now())
  }

  commitTuneRef.current = async (generation, number, origin) => {
    if (generation !== tokenRef.current) return
    const target = channelByNumber(number)
    if (!target) {
      tuningRef.current = false
      pendingOrigin.current = null
      pendingNumberRef.current = null
      staticSince.current = 0
      setTuningNumber(null)
      return
    }
    // Coming to 000 chooses, unless its choice is still running; even with auto-next off.
    const choosing = target.origin === 'tvn' && Date.now() >= (tvnChoice()?.untilMs ?? 0)
    if (target.origin === 'tvn') enterTvn(Date.now())

    if (target.number === origin) {
      if (choosing && playerRef.current && playerReadyRef.current) {
        loadedKey.current = ''
        void loadProgramme(target, Date.now())
      }
      tuningRef.current = false
      pendingOrigin.current = null
      pendingNumberRef.current = null
      staticSince.current = 0
      setTuningNumber(null)
      playerRef.current?.setAudible(true, volumeRef.current, mutedRef.current || soundHeld(startHoldRef.current, startCheckRef.current, viewerInteracted()))
      if (pausedRef.current) resumeViewing()
      showOverlay('info', INFO_MS)
      return
    }

    pausedRef.current = false
    setPaused(false)

    if (!playerRef.current || !playerReadyRef.current) {
      commitChannel(commitTuned(tuned(), target.number, origin))
      notePhase(target.number, 'committedAt')
      loadedKey.current = ''
      tuningRef.current = false
      pendingOrigin.current = null
      pendingNumberRef.current = null
      staticSince.current = 0
      setTuningNumber(null)
      return
    }

    await commitTune({
      current: () => generation === tokenRef.current,
      load: () => loadProgramme(target, Date.now()),
      holdStatic: async () => {
        const remain = tuneTiming.current.durationMs - (performance.now() - staticSince.current)
        if (remain > 0) await sleep(remain)
      },
      // Whatever was asked for an abandoned channel must not stay on the one still being watched.
      abandon: () => {
        loadedKey.current = ''
      },
      commit: () => {
        commitChannel(commitTuned(tuned(), target.number, origin))
        notePhase(target.number, 'committedAt')
        tuningRef.current = false
        pendingOrigin.current = null
        pendingNumberRef.current = null
        staticSince.current = 0
        setTuningNumber(null)
        playerRef.current?.setAudible(true, volumeRef.current, mutedRef.current || soundHeld(startHoldRef.current, startCheckRef.current, viewerInteracted()))
        showOverlay('info', INFO_MS)
        const due = recoveryDue.current
        recoveryDue.current = null
        if (due?.channelNumber === target.number) recoverRef.current(due.channelNumber, due.cause)
      },
    })
  }

  // Credits are a presentation layer over the picture: the programme, the player and the tuner carry on
  // exactly as they were, whichever way the credits are switched.
  const setCreditsOn = (on: boolean) => {
    if (creditsRef.current === on) return
    creditsRef.current = on
    setCredits(on)
  }

  const closeGuide = () => {
    guideModeRef.current = 'closed'
    guideOpenRef.current = false
    setGuideMode('closed')
    setGuideQuery('')
    guideToolRef.current = null
    setGuideTool(null)
  }

  const closeGuideTool = () => {
    guideToolRef.current = null
    setGuideTool(null)
  }

  const openScreenEdit = (number: number) => {
    screenEditRef.current = number
    setScreenEdit(number)
    window.clearTimeout(overlayTimer.current)
  }

  /** Back to the information bar, which then fades as usual; `quiet` leaves the screen clear. */
  const closeScreenEdit = (quiet = false) => {
    if (screenEditRef.current === null) return
    screenEditRef.current = null
    setScreenEdit(null)
    if (quiet) setOverlay('none')
    else showOverlay('info', INFO_MS)
  }

  const openGuide = (mode: GuideMode) => {
    if (guideModeRef.current === 'closed' && mode !== 'closed') {
      const now = Date.now()
      const nextWindow = windowAround(now)
      const nextCursor = { channelNumber: channelRef.current, timeMs: now }
      windowRef.current = nextWindow
      cursorRef.current = nextCursor
      setGuideWindow(nextWindow)
      setGuideCursor(nextCursor)
      setGuideNote(null)
      setGuideZoomState(guideOpeningZoom(visibleRef.current, nextCursor.channelNumber, now, window.innerWidth, window.innerHeight))
    }
    guideModeRef.current = mode
    guideOpenRef.current = mode !== 'closed'
    setGuideMode(mode)
  }

  /**
   * MEDIA, IMPORT and ADD open the Guide where they happen: 1000 Local Media for MEDIA, the foot of the User
   * Network for IMPORT and ADD. The tool holds until the viewer moves the Guide cursor on.
   */
  const openGuideTool = (kind: GuideTool, channelNumber?: number) => {
    if (kind === 'edit' && !guideOpenRef.current) {
      // Over the picture: the menu key, a right-click or a hold on the information bar edits the channel being watched.
      if (screenEditRef.current !== null) {
        closeScreenEdit()
        return
      }
      const here = channelByNumber(channelRef.current)
      if (here && editorScope(here) && multiviewRef.current === '1') openScreenEdit(here.number)
      return
    }
    if (kind === 'edit' && guideOpenRef.current && editorScope(channelByNumber(channelNumber ?? cursorRef.current.channelNumber) ?? { number: -1 }) === 'local') {
      // Editing a Local Media channel is MEDIA for that channel: its name, its files, more files.
      kind = 'media'
      channelNumber = channelNumber ?? cursorRef.current.channelNumber
    }
    if (kind === 'edit') {
      const number = channelNumber ?? cursorRef.current.channelNumber
      const target = channelByNumber(number)
      if (!guideOpenRef.current || !target || !editorScope(target)) return
      // E on a channel whose editor is already open closes it again.
      if (channelNumber === undefined && editingRef.current()) {
        closeGuideTool()
        return
      }
    } else if (panelOpenRef.current() === kind && (channelNumber === undefined || channelNumber === cursorRef.current.channelNumber)) {
      // + and OPTIONS close again when pressed a second time.
      closeGuideTool()
      return
    } else {
      if (guideModeRef.current === 'closed') openGuide('expanded')
      setGuideQuery('')
    }
    const target = guideToolTarget(kind, guideFilter, favourites, cursorRef.current, listChannels(), Date.now(), channelNumber)
    // Editing a channel the selected tab does not list (from the Network Editor) shows it under ALL.
    const editing = kind === 'edit' ? channelByNumber(target.cursor.channelNumber) : undefined
    setGuideFilter(editing && !channelMatchesFilter(editing, target.filter, favourites) ? 'all' : target.filter)
    const next = target.cursor
    cursorRef.current = next
    setGuideCursor(next)
    setGuideNote(null)
    guideToolRef.current = { kind, cursor: next }
    setGuideTool(guideToolRef.current)
  }

  /** The Channel Editor stands while the Guide cursor is still on the channel it opened for. */
  editingRef.current = () => guideToolRef.current?.kind === 'edit' && guideToolRef.current.cursor === cursorRef.current
  /** The + (new user) or OPTIONS panel standing in the Guide, if either is. */
  panelOpenRef.current = () => {
    const held = guideToolRef.current
    if (held?.kind === 'guides' || held?.kind === 'editor') return held.kind
    return held && (held.kind === 'users' || held.kind === 'options' || held.kind === 'bookmarks' || held.kind === 'flags') && held.cursor === cursorRef.current ? held.kind : null
  }

  /** Every channel change comes through here and leaves a Guide pick behind, unless it is the tune that plays one. */
  const requestTune = (number: number, keepPick = false) => {
    historyAimRef.current = historyNavRef.current
    historyNavRef.current = null
    const target = channelByNumber(number)
    if (!target) {
      flash('NO CHANNEL')
      return
    }
    if (!keepPick) clearManual()
    if (!guideDrivingRef.current) guideEngine.current.suspend()
    const byViewer = !autoTuneRef.current
    if (byViewer) recoveryRef.current = null
    autoTuneRef.current = false
    // The viewer's own change ends the start: the logo gives way at once, and the change gets its static and
    // title card instead of waiting behind the first channel's picture.
    if (byViewer && phaseRef.current === 'ready' && !startupSettledRef.current) {
      startupSettledRef.current = true
      setStartupSettled(true)
    }
    recoveryDue.current = null
    notePress(target.number)
    closeScreenEdit(true)
    startup.noteUserTune()
    const generation = ++tokenRef.current
    closeGuide()
    if ((target.origin === 'session' || isLiveStreamChannel(target)) && multiviewRef.current !== '1') {
      // Local files and live streams play in single view only; the grid's tiles are network players.
      multiviewRef.current = '1'
      setMultiviewMode('1')
      setMultiviewPage(0)
    }
    if (multiviewRef.current !== '1') {
      const nextTiles = replaceFocusedTile(tilesRef.current, audioFocusRef.current, target.number)
      tilesRef.current = nextTiles
      setTiles(nextTiles)
      commitChannel(commitTuned(tuned(), target.number))
      notePhase(target.number, 'committedAt')
      showOverlay('info', INFO_MS)
      return
    }
    if (pendingOrigin.current === null) pendingOrigin.current = channelRef.current
    const origin = pendingOrigin.current
    pendingNumberRef.current = number
    // The viewer's transition presents a channel change; the start-up sequence keeps its own presentation.
    const settings = transitionRef.current
    const presents = startupSettledRef.current && settings.id !== 'instant'
    if (!tuningRef.current) {
      staticSince.current = performance.now()
      tuneTiming.current = transitionTiming(presents || settings.id === 'instant' ? settings : DEFAULT_TRANSITION_SETTINGS)
    }
    const held = presentationRef.current
    presentationRef.current = presents ? (held ? { session: held.session, number, settings: held.settings } : { session: ++presentationSession.current, number, settings }) : null
    setPresentation(presentationRef.current)
    tuningRef.current = true
    setTuningNumber(number)
    // INSTANT keeps the current sound until the destination takes over; the player hands it on exactly once.
    if (settings.id !== 'instant' || multiviewRef.current !== '1') playerRef.current?.setAudible(false, 0, true)
    window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(() => {
      void commitTuneRef.current(generation, number, origin)
    }, tuneTiming.current.settleMs)
  }

  commitNumericRef.current = () => {
    window.clearTimeout(numericTimer.current)
    const raw = bufferRef.current
    bufferRef.current = ''
    setNumeric('')
    if (!raw) return
    const number = Number(raw)
    if (!channelByNumber(number)) {
      // The remote stays open for the number to be typed again.
      flash('NO CHANNEL')
      return
    }
    closeGuide()
    requestTune(number)
    // A channel number tunes and puts the remote away; SMART keeps it up for the next number.
    if (!smartRef.current) {
      setRemoteOpen(false)
      const focused = document.activeElement
      if (focused instanceof HTMLElement && focused.closest('.remote-panel')) focused.blur()
    }
  }

  bootRef.current = () => {
    if (bootedRef.current) return
    if (multiviewRef.current !== '1') return
    const current = channelByNumber(channelRef.current)
    if (!current || !playerRef.current) return
    bootedRef.current = true
    // A browser that says outright it allows only muted play (Firefox) starts muted, rather than waiting on a
    // refused start; any key or tap then brings the sound.
    const refused = soundRefused()
    if (refused) {
      startHoldRef.current = 'sound'
      setStartHold('sound')
    }
    playerRef.current.setAudible(true, volumeRef.current, mutedRef.current || refused)
    if (!pausedRef.current) {
      startCheckRef.current = !refused
      void loadProgramme(current, Date.now()).then((result) => {
        const player = playerRef.current
        if (refused || result !== 'playing' || !player) {
          startCheckRef.current = false
          return
        }
        const load = loadToken.current
        const stillFirst = () =>
          load === loadToken.current && playerRef.current === player && !pausedRef.current && !tuningRef.current && multiviewRef.current === '1'
        void confirmStart(player, stillFirst, sleep).then((hold) => {
          startCheckRef.current = false
          if (hold) {
            startHoldRef.current = hold
            setStartHold(hold)
            return
          }
          // Sound is allowed: a tune made while the check ran kept it off, so it comes back now.
          if (playerRef.current === player && multiviewRef.current === '1' && !pausedRef.current && !tuningRef.current) {
            player.setAudible(true, volumeRef.current, mutedRef.current)
            player.play()
          }
        })
      })
    }
    showOverlay('info', INFO_MS)
  }

  // A click or key while the first start is still being checked (CONTINUE on the welcome notice) allows
  // sound at once, rather than leaving the viewer to tap the picture again once the check ends.
  useEffect(() => {
    const early = () => {
      if (!startCheckRef.current) return
      const player = playerRef.current
      if (!player || multiviewRef.current !== '1' || pausedRef.current || tuningRef.current) return
      player.setAudible(true, volumeRef.current, mutedRef.current)
      player.play()
    }
    window.addEventListener('pointerdown', early, true)
    window.addEventListener('keydown', early, true)
    return () => {
      window.removeEventListener('pointerdown', early, true)
      window.removeEventListener('keydown', early, true)
    }
  }, [])

  // The viewer's first key or tap is the interaction the browser waits for: sound (or the picture) starts
  // on the programme already selected, and whatever that key or tap does happens as usual.
  useEffect(() => {
    if (!startHold) return
    const release = () => {
      if (startHoldRef.current === 'sound') soundReleasedAt.current = Date.now()
      startHoldRef.current = null
      setStartHold(null)
      const player = playerRef.current
      if (!player || multiviewRef.current !== '1' || pausedRef.current) return
      player.setAudible(!tuningRef.current, volumeRef.current, mutedRef.current)
      player.play()
    }
    window.addEventListener('pointerdown', release, true)
    window.addEventListener('keydown', release, true)
    return () => {
      window.removeEventListener('pointerdown', release, true)
      window.removeEventListener('keydown', release, true)
    }
  }, [startHold])

  /**
   * Show a Local Media channel's schedule as it now stands: reload in place when watching it, tune to it
   * otherwise. `keepGuide` (MEDIA, adding or removing files) never tunes away and leaves the Guide open.
   */
  const showSession = (number: number, keepGuide = false) => {
    const session = channelByNumber(number)
    if (!session) return
    if (sessionRefresh(channelRef.current, tuningRef.current, multiviewRef.current === '1', number) === 'tune') {
      if (!keepGuide) requestTune(number)
      return
    }
    // Same channel, new running order: not a channel change, so Previous is untouched.
    if (!keepGuide) closeGuide()
    startup.noteUserTune()
    loadedKey.current = ''
    pausedRef.current = false
    setPaused(false)
    if (playerRef.current && playerReadyRef.current) void loadProgramme(session, Date.now())
    if (!keepGuide) showOverlay('info', INFO_MS)
  }

  const localTitles = (number: number) => sessionProgrammes(number).map((programme) => programme.title)
  const buildLocal = (files: readonly File[], onNote?: (note: string) => void) => {
    const token = ++importToken.current
    return buildSessionItems(files, {
      convertAvi: async (file) => {
        const { convertAvi } = await import('../player/avi-convert.ts')
        return convertAvi(file, (note) => {
          if (token !== importToken.current) return
          if (onNote) onNote(note)
          else if (!guideOpenRef.current) flash(note, 2000)
        })
      },
      canPlay: browserCanPlay,
      createUrl: (file, remux) => {
        const url = URL.createObjectURL(file)
        if (remux) registerFlvSource(url, file)
        return url
      },
      sniff: sniffRemux,
      revokeUrl: (url) => {
        URL.revokeObjectURL(url)
        forgetFlvSource(url)
      },
      probe: (url, kind, remux) => probeDuration(url, kind, remux),
      cancelled: () => token !== importToken.current,
    })
  }

  sessionRef.current = {
    play(programmeId) {
      const number = sessionNumberFor(programmeId)
      if (number !== null && rebaseSession(programmeId, Date.now())) showSession(number)
    },
    async import(files, number, handles = [], onNote) {
      const target = isLocalMediaNumber(number) ? number : SESSION_CHANNEL_NUMBER
      const result = await buildLocal(files, onNote)
      const wasEmpty = !sessionActive(target)
      const summary = commitImport(result, Date.now(), target)
      if (result.cancelled || result.items.length === 0) return summary
      void rememberHandles(target, handles, localTitles(target))
      // Added files join the end of the running order; only a channel that was empty has a new programme on air.
      if (wasEmpty) showSession(target, guideOpenRef.current)
      if (!guideOpenRef.current) flash(summary, 4000)
      return summary
    },
    async reload() {
      const records = await rememberedChannels()
      if (records.length === 0) return 'NOTHING TO RELOAD'
      let channels = 0
      let programmes = 0
      let refused = 0
      for (const record of records) {
        if (!isLocalMediaNumber(record.number)) continue
        const files: File[] = []
        for (const handle of record.handles) {
          if (!(await readable(handle))) {
            refused += 1
            continue
          }
          try {
            if (handle.kind === 'directory') files.push(...(await filesInDirectory(handle as unknown as DirectoryHandleLike)))
            else files.push(await (handle as unknown as FileHandleLike).getFile())
          } catch {
            // A folder or file that has moved or gone is passed over.
          }
        }
        if (files.length === 0) continue
        const result = await buildLocal(files)
        if (result.cancelled || result.items.length === 0) continue
        // The channel comes back as the viewer left it, in place of anything it holds now.
        const items = arrangeRemembered(result.items, record)
        const wasEmpty = !sessionActive(record.number)
        clearSession(record.number)
        commitImport({ ...result, items }, Date.now(), record.number)
        if (wasEmpty || channelRef.current === record.number) showSession(record.number, true)
        channels += 1
        programmes += items.length
      }
      if (channels === 0) return refused > 0 ? 'TVN WAS NOT ALLOWED TO READ THOSE FOLDERS' : 'THE REMEMBERED MEDIA COULD NOT BE FOUND'
      return `RELOADED ${channels} ${channels === 1 ? 'CHANNEL' : 'CHANNELS'} · ${programmes} ${programmes === 1 ? 'PROGRAMME' : 'PROGRAMMES'}`
    },
    remove(programmeId) {
      const number = sessionNumberFor(programmeId)
      if (number === null) return
      const onAir = sessionBroadcast(Date.now(), number).current.programme.id === programmeId
      if (removeSessionProgramme(programmeId, Date.now()) && onAir) showSession(number, true)
      void rememberOrder(number, localTitles(number))
    },
    clear(number) {
      if (!sessionActive(number)) return
      clearSession(number)
      showSession(number, true)
      void rememberOrder(number, [])
    },
  }

  /** 000 surfing on is TVN changing channel inside 000: the viewer's transition, then the bar naming the new origin. */
  const presentTvnSurf = () => {
    const settings = transitionRef.current
    if (startupSettledRef.current && settings.id !== 'instant') {
      const sampled = tvnChoice()?.channelNumber
      presentationRef.current = { session: ++presentationSession.current, number: TVN_CHANNEL_NUMBER, settings, ...(sampled !== undefined ? { cardNumber: sampled } : {}) }
      setPresentation(presentationRef.current)
    }
    showOverlay('info', INFO_MS)
  }
  const { syncLive, onPlayerReady, onPlayerStatus } = usePlayerEvents({
    multiviewRef,
    tuningRef,
    pausedRef,
    playerReadyRef,
    bootedRef,
    channelRef,
    guideRunRef,
    guideEngine,
    passRefused,
    loadedKey,
    presentTvnSurf,
    playerRef,
    askedRef,
    pictureLiveRef,
    loadToken,
    deliverLive,
    catalogueReadyRef,
    bootRef,
    loadProgramme,
    failureTimer,
    failuresRef,
    failureScopes,
    userIds,
    setPlayerStatus,
    setPlayerDetail,
    setPictureLive,
    setStartupSettled,
    setPictureChannel,
    watchingNumber,
    recoveryRef,
    recoverRef,
  })

  const focusGuide = useCallback((nextChannel: number, timeMs: number) => {
    const next = { channelNumber: nextChannel, timeMs }
    cursorRef.current = next
    setGuideCursor(next)
    setGuideNote(null)
  }, [])

  const extendGuide = useCallback((edge: 'start' | 'end') => {
    const current = windowRef.current
    if (current.endMs - current.startMs >= GUIDE_MAX_WINDOW_MS) return
    const next =
      edge === 'end'
        ? { ...current, endMs: current.endMs + GUIDE_EXTEND_MS }
        : { ...current, startMs: current.startMs - GUIDE_EXTEND_MS }
    windowRef.current = next
    setGuideWindow(next)
  }, [])

  /**
   * Plays a Guide programme from its beginning, outside the schedule. Only this viewing changes: the
   * schedule is untouched, and on the channel already being watched Previous is left alone. Picked from its
   * slot in the schedule, the channel then plays on through the programmes after it until NOW or a tune.
   */
  const requestTuneRef = useRef(requestTune)
  requestTuneRef.current = requestTune
  const playFromGuide = (target: Channel, programme: Programme, slot?: { startMs: number; endMs: number }, fromSeconds = 0) => {
    if (!guideDrivingRef.current) guideEngine.current.suspend()
    selectProgramme(target.number, programme, Date.now(), slot && { startMs: slot.startMs, endMs: slot.endMs }, slot && !guideDrivingRef.current && target.origin !== 'tvn' && target.origin !== 'session' ? target : undefined, fromSeconds)
    if (multiviewRef.current !== '1') {
      multiviewRef.current = '1'
      setMultiviewMode('1')
      setMultiviewPage(0)
    }
    if (pickTunes(target.number, channelRef.current, tuningRef.current)) {
      requestTune(target.number, true)
      return
    }
    closeGuide()
    startup.noteUserTune()
    loadedKey.current = ''
    pausedRef.current = false
    setPaused(false)
    if (playerRef.current && playerReadyRef.current) void loadProgramme(target, Date.now())
    showOverlay('info', INFO_MS)
  }

  /** PLAY LATEST in Edit Channel: one programme of a channel, from its beginning, as a Guide pick plays it. */
  const playChannelRef = useRef<(channelNumber: number, programmeId: string) => string | null>(() => null)
  playChannelRef.current = (channelNumber, programmeId) => {
    const target = channelByNumber(channelNumber)
    if (!target) return 'THAT CHANNEL IS NOT IN THE NETWORK'
    const found = programmesFor(target.id).filter(
      (programme) => programme.id === programmeId || programme.videoId === programmeId || programme.id.endsWith(`-${programmeId}`),
    )
    const programme = found.find((item) => !item.id.endsWith('-r')) ?? found[0]
    if (!programme) return 'SAVE THE CHANNEL FIRST, THEN PLAY IT'
    playFromGuide(target, programme)
    return null
  }
  const playChannelProgramme = useCallback((channelNumber: number, programmeId: string) => playChannelRef.current(channelNumber, programmeId), [])

  /**
   * A sub-channel from the Guide: what it airs now, joined where its own clock has it, or a programme picked
   * from its row. Either way what follows is the sub-channel's next programme, not the channel's.
   */
  const playSubChannelRef = useRef<(sub: Channel, picked?: { startMs: number; endMs: number; programmeId: string }) => void>(() => {})
  playSubChannelRef.current = (sub, picked) => {
    const now = Date.now()
    const airing = broadcast(sub, now).current
    const slot = picked && !(now >= picked.startMs && now < picked.endMs && guideTuneDecision(picked.startMs, picked.endMs, now) === 'tune') ? picked : null
    if (slot) {
      const programme = programmesFor(sub.id).find((item) => item.id === slot.programmeId)
      if (programme && hasPicture(programme)) playFromGuide(sub, programme, slot)
      else setGuideNote(now < slot.startMs ? 'later' : 'ended')
      return
    }
    if (!hasPicture(airing.programme)) return
    playFromGuide(sub, airing.programme, { startMs: airing.startMs, endMs: airing.endMs }, (now - airing.startMs) / 1000)
  }
  const playSubChannel = useCallback((sub: Channel, picked?: { startMs: number; endMs: number; programmeId: string }) => playSubChannelRef.current(sub, picked), [])
  const playFromGuideRef = useRef(playFromGuide)
  playFromGuideRef.current = playFromGuide

  const {
    setGuideLibrary,
    addToGuideAction,
    guideSupplyAction,
    addGuideSourceAction,
    buildChannelGuideAction,
    searchGuideAction,
    editGuideAction,
    playGuideAction,
    resumeGuideAction,
    stopGuideAction,
    guideStepAction,
  } = useViewingGuides({
    guideLibraryRef,
    setGuideLibraryState,
    guideRunRef,
    setGuideRunState,
    loadedKey,
    flash,
    guideDrivingRef,
    playFromGuide,
    guideEngine,
    userEditorialRef,
    guideSearchRef,
    setGuideSearchState,
  })
  const activateGuide = useCallback((options?: { fromStart?: boolean }) => {
    const cursor = cursorRef.current
    const selected = channelByNumber(cursor.channelNumber)
    if (!selected) return
    const slots = guideSlots(selected, windowRef.current.startMs, windowRef.current.endMs)
    const slot = slotContaining(slots, cursor.timeMs)
    if (selected.origin === 'session') {
      // Choosing an imported programme, from the grid or from a search, is Play Now.
      const chosen = sessionChoice(guideQueryRef.current, slot?.programme ?? null, selected.number)
      if (chosen) sessionRef.current.play(chosen.id)
      else requestTuneRef.current(selected.number)
      return
    }
    if (!slot) return
    const action = guidePickAction(slot.startMs, slot.endMs, Date.now(), hasPicture(slot.programme), options?.fromStart)
    if (action === 'tune') {
      closeGuide()
      requestTuneRef.current(selected.number)
      return
    }
    if (action === 'play') {
      playFromGuideRef.current(selected, slot.programme, slot)
      return
    }
    setGuideNote(action)
  }, [])

  const goToSleep = () => {
    asleepRef.current = true
    surfingRef.current = false
    setSurfing(false)
    tokenRef.current += 1
    tuningRef.current = false
    pendingOrigin.current = null
    pendingNumberRef.current = null
    staticSince.current = 0
    playerReadyRef.current = false
    setPictureLive(false)
    loadedKey.current = ''
    closeGuide()
    setRemoteOpen(false)
    setTuningNumber(null)
    setNotice(null)
    setOverlay('none')
    setAsleep(true)
    // Honoured only for windows a script opened; everywhere else the sleep screen has already stopped every player.
    try {
      window.close()
    } catch {
      // Closing is best effort.
    }
  }

  const wake = useCallback(() => {
    if (!asleepRef.current) return
    asleepRef.current = false
    activityRef.current = Date.now()
    sleepWarnedRef.current = false
    pausedRef.current = false
    setPaused(false)
    setAsleep(false)
  }, [])

  goToSleepRef.current = goToSleep

  const dispatch = useCallback((command: TvCommand) => {
    dispatchRef.current(command)
  }, [])

  useEffect(() => {
    const space = createSpaceHold({
      surf: () => dispatchRef.current({ type: 'random-channel' }),
      toggle: () => toggleSurfScopeRef.current(),
    })
    // Space alone, over the picture, outside a text field: the keyboard's TV Surf button.
    const surfKey = (event: KeyboardEvent) =>
      event.key === ' ' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !guideOpenRef.current && !isEditableTarget(event.target)
    const onKey = (event: KeyboardEvent) => {
      // A website the viewer is using owns the keyboard; only Esc (taken before this) comes back to TVN.
      if (webInteraction().interacting) return
      if (surfKey(event)) {
        event.preventDefault()
        space.down(event.repeat)
        return
      }
      const command = commandFromKeyEvent(event, guideOpenRef.current, multiviewRef.current !== '1')
      if (!command) return
      event.preventDefault()
      dispatchRef.current(command)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== ' ') return
      if (webInteraction().interacting) {
        space.cancel()
        return
      }
      if (surfKey(event)) event.preventDefault()
      space.up()
    }
    const onBlur = () => space.cancel()
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      space.cancel()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // A curation built from TVN's original sources follows the library: it may load after the start, and a refusal changes it.
  useEffect(
    () =>
      subscribeLibrary(() => {
        if (Object.values(loadCuratedEdits()).some(readsOriginals)) installCurated()
      }),
    [],
  )

  useEffect(() => {
    const held = new Set<number>()
    let frame = 0
    const poll = () => {
      frame = window.requestAnimationFrame(poll)
      const pads = navigator.getGamepads?.() ?? []
      for (const pad of pads) {
        if (!pad) continue
        const step = commandFromGamepad(pad, held, guideOpenRef.current)
        held.clear()
        for (const index of step.held) held.add(index)
        if (step.command) dispatchRef.current(step.command)
      }
    }
    frame = window.requestAnimationFrame(poll)
    return () => window.cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (startupPhase !== 'ready') return
    const active = () => {
      activityRef.current = Date.now()
    }
    const events = ['pointerdown', 'pointermove', 'wheel', 'touchstart', 'keydown'] as const
    for (const name of events) window.addEventListener(name, active, { passive: true })
    const check = window.setInterval(() => {
      if (asleepRef.current) return
      const phase = sleepPhase(activityRef.current, sleepMinutesRef.current, Date.now())
      if (phase === 'due') goToSleepRef.current()
      else if (phase === 'warning' && !sleepWarnedRef.current) {
        sleepWarnedRef.current = true
        window.clearTimeout(noticeTimer.current)
        setNotice('SLEEPING IN 1 MINUTE · PRESS ANY KEY TO KEEP WATCHING')
      } else if (phase !== 'warning' && sleepWarnedRef.current) {
        sleepWarnedRef.current = false
        setNotice(null)
      }
    }, 5000)
    return () => {
      for (const name of events) window.removeEventListener(name, active)
      window.clearInterval(check)
    }
  }, [startupPhase])

  useEffect(() => {
    if (startupPhase !== 'ready') return
    const check = () => {
      const flags = clipFlags()
      if (flags.length === 0) return
      const { fire, flags: kept, changed } = dueFlag(flags, Date.now())
      if (!changed) return
      saveClipFlags(kept)
      if (!fire || asleepRef.current) return
      if (channelRef.current !== fire.channelNumber) dispatchRef.current({ type: 'tune', channelNumber: fire.channelNumber })
      flash(`⚑\uFE0E FLAG · ${padChannel(fire.channelNumber)} · ${fire.title}`, 2600)
    }
    check()
    const timer = window.setInterval(check, 1000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startupPhase])

  useEffect(() => subscribeCatalogue(() => setCatalogueVersion((version) => version + 1)), [])
  useEffect(() => subscribeSession(() => setCatalogueVersion((version) => version + 1)), [])
  useEffect(() => {
    setUrlRevoker((url) => {
      URL.revokeObjectURL(url)
      forgetFlvSource(url)
    })
  }, [])

  const playSession = useCallback((programmeId: string) => sessionRef.current.play(programmeId), [])
  const importSession = useCallback(
    (files: readonly File[], number: number, handles?: readonly MediaHandle[], onNote?: (note: string) => void) => sessionRef.current.import(files, number, handles, onNote),
    [],
  )
  const reloadLocalMedia = useCallback(() => sessionRef.current.reload(), [])
  const removeSessionFile = useCallback((programmeId: string) => sessionRef.current.remove(programmeId), [])
  const moveSessionFile = useCallback((programmeId: string, to: number) => {
    const number = sessionNumberFor(programmeId)
    const moved = moveSessionProgramme(programmeId, to, Date.now())
    if (moved && number !== null) void rememberOrder(number, localTitles(number))
    return moved
  }, [])
  const clearLocalChannel = useCallback((number: number) => sessionRef.current.clear(number), [])
  const renameLocal = useCallback((number: number, name: string) => renameLocalChannel(number, name), [])

  useEffect(() => {
    if (!import.meta.env.DEV || new URLSearchParams(window.location.search).get('acquire') !== '1') return
    void import('../library/acquire-run.ts').then((mod) => mod.runQueuedAcquisition())
  }, [])

  useEffect(
    () =>
      subscribeOverrides(() => {
        loadedKey.current = ''
        syncLive(Date.now())
      }),
    [syncLive],
  )

  useStartupLoad({
    setStartupProgress,
    starterDue,
    favouritesSeeded,
    setFavourites,
    userIds,
    phaseRef,
    setStartupPhase,
    startup,
    stored,
    commitChannel,
    historyRef,
    setHistory,
    tilesRef,
    setTiles,
    catalogueReadyRef,
    bootRef,
    startupPhase,
  })
  /** Favourites, Multi View, history and the channel watched lose channels that are gone, all at once. */
  const forgetChannels = (gone: ReadonlySet<number>, sources: readonly StoredSource[]) => {
    setFavourites((current) => liveFavourites(current.filter((item) => !gone.has(item)), sources))
    historyRef.current = historyWithout(historyRef.current, gone)
    setHistory(historyRef.current)
    if (tilesRef.current.some((item) => gone.has(item))) {
      const kept = tilesRef.current.filter((item) => !gone.has(item))
      tilesRef.current = kept
      setTiles(kept)
    }
    if (previousRef.current !== null && gone.has(previousRef.current)) commitChannel({ channelNumber: channelRef.current, previousNumber: null }, false)
  }

  /** CHOOSE ANOTHER on 000: a new choice now, played at once when 000 is on screen. */
  const chooseAnotherOnTvn = useCallback(() => {
    const now = Date.now()
    chooseAnotherTvn(now)
    const here = channelByNumber(channelRef.current)
    if (here?.origin !== 'tvn' || tuningRef.current || multiviewRef.current !== '1' || !playerRef.current || !playerReadyRef.current) return
    loadedKey.current = ''
    presentTvnSurf()
    void loadProgramme(here, now)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const {
    setSourceOverride,
    applyImport,
    installSources,
    previewSource,
    addChannel,
    createBookmarkChannel,
    addChannels,
    addCombinedChannel,
    createNetworkUser,
    loadTestChannels,
    removeStarterNetwork,
    removeUserChannels,
    networkCustomised,
    startNewNetwork,
    createEmptyChannel,
    renameNetworkUser,
    deleteNetworkUser,
    exportUserNetwork,
    exportTvn,
    exportRange,
    scopeOf,
    importUserNetwork,
    importTvn,
    importTvnRange,
  } = useChannelLibrary({
    userIds,
    flash,
    userEditorialRef,
    channelRef,
    requestTune,
    readWholeRef,
    usersRef,
    commitUsers,
    setGuideFilter,
    closeGuideTool,
    startupPhase,
    startupSettled,
    setStartupSettled,
    startupFailed,
    starterDue,
    favouritesSeeded,
    setFavourites,
    forgetChannels,
    chooseAnotherOnTvn,
    guideFilter,
    favouritesRef,
    volumeRef,
    mutedRef,
    subtitlesRef,
    sleepMinutesRef,
    guideSplitRef,
    infoShortcutsRef,
    surfRangeRef,
    transitionRef,
    guideLibraryRef,
    setGuideLibrary,
    setVolume,
    setMuted,
    setSubtitles,
    setSleepMinutes,
    setGuideSplit,
    setInfoShortcuts,
    setSurfRangeState,
    setTransitionState,
    playerRef,
    tuningRef,
  })

  const {
    openChannelEdit,
    saveChannelEdit,
    acquireChannelSource,
    rescanChannelEdit,
    arrangeChannel,
    latestFirst,
    reloadChannel,
    loadMoreChannelSource,
    loadAllAndExportUser,
    loadAll,
    startLoadAll,
    stopLoadAll,
    canLoadChannelSource,
    exportChannelFile,
    importChannelFile,
    restoreCuratedChannel,
    deleteUserChannel,
    deleteNetworkChannel,
    moveUserChannel,
    arrangeUserNetwork,
  } = useChannelEditing({
    forgetChannels,
    scopeOf,
    installSources,
    channelRef,
    multiviewRef,
    loadedKey,
    tuningRef,
    playerRef,
    playerReadyRef,
    loadProgramme,
    exportUserNetwork,
    guideOpenRef,
    flash,
    readWholeRef,
    playlistQueue,
    closeGuideTool,
    closeScreenEdit,
    visibleRef,
    focusGuide,
    cursorRef,
    setFavourites,
    historyRef,
    setHistory,
    tilesRef,
    setTiles,
    previousRef,
    commitChannel,
    guideLibraryRef,
    setGuideLibrary,
    setGuideCursor,
    presentationRef,
  })

  const {
    screenAction,
    screenSeek,
    screenStep,
    surfScopeName,
    toggleSurfScope,
    holdInfo,
    toggleSurf,
    setSurfUntilEnd,
    setSurfRange,
    setTransition,
    endTransition,
    setInfoShortcut,
    resetInfoShortcuts,
  } = useScreenControls({
    channelRef,
    sessionRef,
    loadedKey,
    pausedRef,
    setPaused,
    playerRef,
    playerReadyRef,
    loadProgramme,
    showOverlay,
    multiviewRef,
    showSession,
    guideDrivingRef,
    guideRunRef,
    guideEngine,
    chooseAnotherOnTvn,
    playFromGuide,
    guideFilter,
    channelNumber,
    networkUsers,
    setGuideFilter,
    flash,
    toggleSurfScopeRef,
    overlayTimer,
    setOverlay,
    activityRef,
    surfingRef,
    setSurfing,
    setSurfUntilEndState,
    setSurfRangeState,
    transitionRef,
    setTransitionState,
    presentationRef,
    setPresentation,
    setInfoShortcuts,
  })

  // Surfing hops without counting as the viewer's activity, so SLEEP still ends an unattended session.
  useEffect(() => {
    // A first visit stays on its first channel until the welcome notice is dismissed.
    if (!surfing || asleep || guideOpen || screenEdit !== null || startupPhase !== 'ready' || !noticeSeen) return
    // Waiting for the programme to end: the hop comes as it finishes; 000, Multi View and a programme with no end in reach keep the random wait.
    const watching = surfUntilEnd && multiviewRef.current === '1' && channelRef.current !== TVN_CHANNEL_NUMBER ? channelByNumber(channelRef.current) : undefined
    const now = Date.now()
    const untilEnd = watching ? surfUntilEndMs(onScreen(watching, now).current.endMs, now) : null
    const id = window.setTimeout(() => {
      if (multiviewRef.current === '1') {
        // 000 is itself TVN surfing, on the same wait: the Random Cycle leaves the viewer there.
        if (channelRef.current === TVN_CHANNEL_NUMBER) return setSurfHops((hops) => hops + 1)
        const picked = randomChannel(channelRef.current)
        if (picked) requestTune(picked.number)
      } else {
        // In Multi View one tile changes per hop, never the selected one, so the wall changes a tile at a time.
        const candidates = listChannels()
          .filter((item) => item.enabled && item.origin !== 'session' && !isLiveStreamChannel(item) && isOnAir(item))
          .map((item) => item.number)
        const next = surfTile(tilesRef.current, audioFocusRef.current, candidates)
        if (next) {
          tilesRef.current = next
          setTiles(next)
        }
      }
      setSurfHops((hops) => hops + 1)
    }, untilEnd ?? surfDelayMs(surfRange))
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfing, surfHops, surfRange, surfUntilEnd, channelNumber, asleep, guideOpen, screenEdit, multiviewMode, startupPhase, noticeSeen])

  useEffect(() => {
    if (!hintsOn || startupPhase !== 'ready') return
    const id = window.setTimeout(() => setHintsOn(false), 8000)
    return () => window.clearTimeout(id)
  }, [hintsOn, startupPhase])

  useEffect(() => {
    // Before the start is committed the channel values are placeholders; saving them would overwrite the
    // restored channel and previous channel if the viewer reloads while RetroTV is still loading.
    if (startupPhase !== 'ready') return
    savePreferences({
      version: 2,
      lastChannelNumber: channelNumber,
      previousChannelNumber: previousNumber,
      volume,
      muted,
      favouriteChannelNumbers: favourites,
      guideFilter,
      guideSplit,
      multiviewMode,
      audioFocusIndex: audioFocus,
      multiviewChannels: tiles,
      subtitles,
      sleepMinutes,
      infoShortcuts,
      defaultFavouritesOffered: true,
    })
  }, [
    audioFocus,
    channelNumber,
    sleepMinutes,
    infoShortcuts,
    favourites,
    guideFilter,
    guideSplit,
    multiviewMode,
    muted,
    previousNumber,
    startupPhase,
    subtitles,
    tiles,
    volume,
  ])

  useEffect(() => {
    return () => {
      window.clearTimeout(settleTimer.current)
      window.clearTimeout(numericTimer.current)
      window.clearTimeout(overlayTimer.current)
      window.clearTimeout(noticeTimer.current)
    }
  }, [])

  const guideActions = () => ({
    add: addToGuideAction,
    edit: editGuideAction,
    play: playGuideAction,
    resume: resumeGuideAction,
    stop: stopGuideAction,
    step: guideStepAction,
    search: searchGuideAction,
    addSource: addGuideSourceAction,
    supply: guideSupplyAction,
    buildFromChannels: buildChannelGuideAction,
  })
  const guideApi = useRef(guideActions())
  guideApi.current = guideActions()
  const addGuideSource = useCallback((channelNumber: number) => guideApi.current.addSource(channelNumber), [])
  const guideSupply = useCallback((source: GuideSource) => guideApi.current.supply(source), [])
  const buildChannelGuideFromSources = useCallback(() => guideApi.current.buildFromChannels(), [])
  const searchGuide = useCallback((query: string, rescan?: boolean) => guideApi.current.search(query, rescan), [])
  const addToGuide = useCallback((channelNumber: number, programme: Programme) => guideApi.current.add(channelNumber, programme), [])
  const editGuide = useCallback((action: GuideAction) => guideApi.current.edit(action), [])
  const playGuide = useCallback((fromIndex?: number) => guideApi.current.play(fromIndex), [])
  const resumeGuide = useCallback(() => guideApi.current.resume(), [])
  const stopGuide = useCallback(() => guideApi.current.stop(), [])
  const guideStep = useCallback((direction: -1 | 1) => guideApi.current.step(direction), [])

  useTvCommands({
    dispatchRef,
    phaseRef,
    activityRef,
    asleepRef,
    wake,
    sleepWarnedRef,
    setNotice,
    screenEditRef,
    closeScreenEdit,
    tokenRef,
    settleTimer,
    tuningRef,
    pendingOrigin,
    pendingNumberRef,
    staticSince,
    setTuningNumber,
    playerRef,
    volumeRef,
    mutedRef,
    bufferRef,
    setNumeric,
    numericTimer,
    commitNumericRef,
    tuned,
    guideFilter,
    favourites,
    tilesRef,
    audioFocusRef,
    multiviewRef,
    flash,
    requestTune,
    toggleSurf,
    guideOpenRef,
    screenStep,
    channelRef,
    previousRef,
    historyAimRef,
    historyRef,
    historyNavRef,
    editingRef,
    activateGuide,
    setMultiviewMode,
    setMultiviewPage,
    loadedKey,
    showOverlay,
    debugOpen,
    setDebugOpen,
    remoteOpen,
    setRemoteOpen,
    setSmart,
    panelOpenRef,
    closeGuideTool,
    closeGuide,
    creditsRef,
    setCreditsOn,
    setOverlay,
    guideModeRef,
    openGuide,
    guideToolRef,
    guideRunRef,
    openGuideTool,
    setGuideSplit,
    guideEngine,
    setTiles,
    setAudioFocus,
    startup,
    commitChannel,
    selectTile,
    setGuideFilter,
    usersRef,
    smartRef,
    sleepMinutesRef,
    setSleepMinutes,
    setPipSize,
    pipSizeRef,
    overlay,
    pausedRef,
    resumeViewing,
    pausedWebRef,
    setPaused,
    soundReleasedAt,
    setMuted,
    subtitlesRef,
    setSubtitles,
    setVolume,
    cursorRef,
    favouritesRef,
    setFavourites,
    scheduleBusyRef,
    reloadChannel,
    arrangeChannel,
    exportTvn,
    setGuideZoomState,
    nowCursorRef,
    playerReadyRef,
    loadProgramme,
    setGuideCursor,
    setGuideNowAsk,
    windowRef,
    setGuideWindow,
    setGuideNote,
    setHintsOn,
    visibleRef,
  })

  const value = useMemo<TvContextValue>(
    () => ({
      channel,
      previousChannel,
      canGoBack: canGoBack(history),
      canGoForward: canGoForward(history),
      startHold,
      smart,
      visibleChannels,
      guideVisiting,
      volume,
      // Sound the browser holds back until the viewer interacts shows as Muted, so UNMUTE is what brings it.
      muted: muted || startHold === 'sound',
      paused,
      subtitles,
      favourites,
      guideFilter,
      guideQuery,
      setGuideQuery,
      guideZoom,
      setGuideZoom,
      guideNowAsk,
      guideOpen,
      guideMode,
      guideSplit,
      multiviewMode,
      pipSize,
      setPipSize,
      tiles,
      audioFocus,
      multiviewPage,
      guideTool,
      remoteOpen,
      credits,
      guideCursor,
      guideWindow,
      guideNote,
      tuningNumber,
      pictureLive,
      pictureChannel,
      startupSettled,
      numeric,
      overlay,
      playerStatus,
      playerDetail,
      notice,
      debugOpen,
      hintsOn,
      startupPhase,
      startupProgress,
      sleepMinutes,
      asleep,
      wake,
      surfing,
      toggleSurf,
      surfRange,
      surfUntilEnd,
      setSurfUntilEnd,
      setSurfRange,
      transition,
      setTransition,
      presentation,
      endTransition,
      infoShortcuts,
      setInfoShortcut,
      resetInfoShortcuts,
      screenEdit,
      screenAction,
      screenStep,
      screenSeek,
      chooseAnotherTvn: chooseAnotherOnTvn,
      toggleSurfScope,
      surfScopeName,
      holdInfo,
      guideLibrary,
      guideRun,
      guideSearch,
      searchGuide,
      addGuideSource,
      guideSupply,
      buildChannelGuide: buildChannelGuideFromSources,
      addToGuide,
      editGuide,
      playGuide,
      resumeGuide,
      stopGuide,
      guideStep,
      dispatch,
      syncLive,
      onPlayerReady,
      onPlayerStatus,
      playerRef,
      focusGuide,
      activateGuide,
      extendGuide,
      applyImport,
      addChannel,
      addChannels,
      createBookmarkChannel,
      addCombinedChannel,
      playSubChannel,
      previewSource,
      networkUsers,
      createNetworkUser,
      renameNetworkUser,
      deleteNetworkUser,
      loadTestChannels,
      removeStarterNetwork,
      removeUserChannels,
      networkCustomised,
      startNewNetwork,
      createEmptyChannel,
      exportUserNetwork,
      loadAllAndExportUser,
      loadAll,
      startLoadAll,
      stopLoadAll,
      importUserNetwork,
      exportTvn,
      importTvn,
      exportRange,
      importTvnRange,
      openChannelEdit,
      saveChannelEdit,
      rescanChannelEdit,
      loadMoreChannelSource,
      acquireChannelSource,
      canLoadChannelSource,
      latestFirst,
      arrangeChannel,
      reloadChannel,
      exportChannelFile,
      importChannelFile,
      sourceArchive,
      playChannelProgramme,
      deleteUserChannel,
      deleteNetworkChannel,
      moveUserChannel,
      arrangeUserNetwork,
      restoreCuratedChannel,
      setSourceOverride,
      playSession,
      importSession,
      removeSessionFile,
      moveSessionFile,
      reloadLocalMedia,
      clearLocalChannel,
      renameLocalChannel: renameLocal,
    }),
    [
      openChannelEdit,
      saveChannelEdit,
      rescanChannelEdit,
      loadMoreChannelSource,
      acquireChannelSource,
      canLoadChannelSource,
      latestFirst,
      arrangeChannel,
      reloadChannel,
      exportChannelFile,
      importChannelFile,
      playChannelProgramme,
      deleteUserChannel,
      deleteNetworkChannel,
      moveUserChannel,
      arrangeUserNetwork,
      restoreCuratedChannel,
      playSession,
      importSession,
      removeSessionFile,
      moveSessionFile,
      reloadLocalMedia,
      clearLocalChannel,
      renameLocal,
      addChannel,
      addChannels,
      createBookmarkChannel,
      addCombinedChannel,
      playSubChannel,
      previewSource,
      networkUsers,
      createNetworkUser,
      renameNetworkUser,
      deleteNetworkUser,
      loadTestChannels,
      removeStarterNetwork,
      removeUserChannels,
      networkCustomised,
      startNewNetwork,
      createEmptyChannel,
      exportUserNetwork,
      loadAllAndExportUser,
      loadAll,
      startLoadAll,
      stopLoadAll,
      importUserNetwork,
      exportTvn,
      importTvn,
      exportRange,
      importTvnRange,
      activateGuide,
      channel,
      debugOpen,
      dispatch,
      extendGuide,
      favourites,
      focusGuide,
      guideCursor,
      guideFilter,
      guideNote,
      guideOpen,
      guideQuery,
      guideZoom,
      setGuideZoom,
      guideNowAsk,
      guideMode,
      guideSplit,
      guideWindow,
      hintsOn,
      muted,
      notice,
      numeric,
      onPlayerReady,
      onPlayerStatus,
      overlay,
      paused,
      playerDetail,
      playerStatus,
      previousChannel,
      history,
      startHold,
    smart,
      startupPhase,
      startupProgress,
      sleepMinutes,
      asleep,
      wake,
      surfing,
      toggleSurf,
      toggleSurfScope,
      surfScopeName,
      surfRange,
      surfUntilEnd,
      setSurfUntilEnd,
      setSurfRange,
      transition,
      setTransition,
      presentation,
      endTransition,
      infoShortcuts,
      setInfoShortcut,
      resetInfoShortcuts,
      screenEdit,
      screenAction,
      screenStep,
      screenSeek,
      chooseAnotherOnTvn,
      holdInfo,
      guideLibrary,
      guideRun,
      guideSearch,
      searchGuide,
      addGuideSource,
      guideSupply,
      buildChannelGuideFromSources,
      addToGuide,
      editGuide,
      playGuide,
      resumeGuide,
      stopGuide,
      guideStep,
      subtitles,
      syncLive,
      tuningNumber,
      pictureLive,
      pictureChannel,
      startupSettled,
      visibleChannels,
      guideVisiting,
      volume,
      multiviewMode,
      pipSize,
      setPipSize,
      tiles,
      audioFocus,
      multiviewPage,
      guideTool,
      remoteOpen,
      credits,
      applyImport,
      setSourceOverride,
    ],
  )

  return <TvContext.Provider value={value}>{children}</TvContext.Provider>
}
