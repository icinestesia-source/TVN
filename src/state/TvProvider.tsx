import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { channelByNumber, channels, listChannels, programmesFor, randomChannel, shippedChannel, shippedProgrammes } from '../data/catalogue.ts'
import { channelMatchesFilter, inFavouriteOrder, USER_NUMBER_LIMIT, USER_NUMBER_START } from '../data/network.ts'
import { installCuratedEdits, installUserCatalogue, subscribeCatalogue } from '../data/user-overlay.ts'
import {
  GUIDE_EXTEND_MS,
  GUIDE_MAX_WINDOW_MS,
  windowAround,
} from '../epg/geometry.ts'
import { searchGuideChannels, stepGuideChannel } from '../epg/navigation.ts'
import { clampZoom } from '../epg/zoom.ts'
import { guideOpeningZoom } from '../epg/opening-zoom.ts'
import { commandFromGamepad } from '../input/gamepad.ts'
import { commandFromKeyEvent } from '../input/keyboard.ts'
import { tunerStep } from '../input/tuner.ts'
import { deliver, playbackCommand, type PlaybackCommand } from '../player/command.ts'
import { subtitlesNotice } from '../player/captions.ts'
import { notePlayback } from '../player/trace.ts'
import { notePhase, notePress } from '../player/tune-timing.ts'
import { commitTune } from './tune-commit.ts'
import { liveAiring, pauseViewing } from '../player/viewing.ts'
import { clearManual, manualAiring, onScreen, pickTunes, selectProgramme, stepFrom } from '../player/manual.ts'
import { afterRefusal, arrive, fallbackProgramme, giveUp, type Recovery } from '../player/refusal-fallback.ts'
import type { PlayerHandle, PlayerStatus } from '../player/types.ts'
import { liveKey } from '../scheduler/calculate.ts'
import { adjacentSlotTime, slotContaining } from '../scheduler/window.ts'
import { beginScheduleBootstrap, endScheduleBootstrap, hydrateDirector } from '../director/cache.ts'
import { primeDirector } from '../director/director.ts'
import { markLiveUnavailable } from '../dynamic/runtime.ts'
import { loadUserLibraryMode, setUserLibraryMode, userLibraryMode } from '../library/mode.ts'
import { ensureDefaultNetwork, hydrateLibrary, ingestParsed, librarySnapshot, loadShippedIndependentCatalogue, recordPlaybackFailure, republishLibrary, saveDeferredLibrary, subscribeLibrary } from '../library/store.ts'
import { loadRegister } from '../credits/load.ts'
import type { SourceRegister } from '../credits/provenance.ts'
import { reconcileOriginals, type OriginalSource } from '../services/original-sources.ts'
import { channelOriginals } from '../view/channel-provenance.ts'
import { lookUpFeed } from '../services/podcast-source.ts'
import { guideEndAdvances } from '../view/guide-following.ts'
import { guideSlots } from '../services/broadcast.ts'
import { BUILT_IN_CATALOGUE_ID, bootstrapUserNetwork, readStarterNetwork, readStarterTemplate } from '../data/user-network/bootstrap.ts'
import { claimStarterInstall, setStarterState, starterIds, starterState, withoutStarter } from '../data/user-network/starter.ts'
import { afterPaint } from './after-paint.ts'
import { keepCalculatedPools, offerSavedPools, readSavedPools } from '../library/pool-cache.ts'
import { PLAYER_LOAD_TIMEOUT_MS } from '../player/picture.ts'
import {
  channelsFromSources,
  emptySlotRecord,
  firstEmptySlot,
  migrateLegacyUserNumbers,
  planImport,
  type ParsedExport,
  type StoredSource,
} from '../services/channels-import.ts'
import { lookUpChannel } from '../services/add-channel.ts'
import { addChannelSource, addPodcastChannel, clearUserChannel, planStarterNetwork, removeUserChannels as withoutUserChannels, starterCollections } from '../services/user-network.ts'
import { applyChannelEdit, editOf, rescanChannel, rescanSources, rescanSummary, widenSources, type ChannelEdit } from '../services/channel-editor.ts'
import { addChannelFromFile, buildChannelFile, channelFilename, readChannelFile, serialiseChannelFile, type ChannelExportKind } from '../services/channel-file.ts'
import { curatedChannelManifest, manifestText, userChannelManifest } from '../services/editorial-manifest.ts'
import { overrideRecord, overridesFromExport, reconcileOverride, type CentralCuration } from '../services/central-curation.ts'
import type { SourceMode } from '../services/channel-curation.ts'
import { classifySourceUrl, type ChannelSource } from '../services/channel-sources.ts'
import {
  baselineChanged,
  buildCuratedEdit,
  canonicalEdit,
  clearCuratedEdit,
  curatedEditOf,
  loadCuratedEdit,
  loadCuratedEdits,
  replaceCuratedEdits,
  saveCuratedEdit,
  shippedBaseline,
  type CuratedEdit,
} from '../services/curated-edits.ts'
import { probeStream } from '../player/stream.ts'
import { isLiveStreamChannel } from '../dynamic/stream.ts'
import { editorScope } from '../view/channel-edit.ts'
import { loadOverrides, setVideoOverride, subscribeOverrides, videoOverride } from '../services/overrides.ts'
import { defaultFavouritesDue, loadPreferences, savePreferences } from '../services/preferences.ts'
import { placeStarterFavourites, starterFavouriteSources } from '../services/default-favourites.ts'
import {
  asShortcuts,
  assignShortcut,
  DEFAULT_SHORTCUTS,
  fullscreenAvailable,
  type Corner,
  type ShortcutAssignment,
  type ShortcutId,
} from '../view/info-shortcuts.ts'
import { loadStoredSources, saveStoredSources } from '../services/user-db.ts'
import { buildUserNetworkExport, downloadText, exportFilename, serialiseUserNetworkExport, type UserNetworkExport } from '../services/user-network-export.ts'
import { favouritesAfterRestore, recordsFromExport, resolveRestored, restoreUserNetwork, usersFromExport } from '../services/user-network-restore.ts'
import { isRefusalCode, learnRefusal, refusedVideos } from '../services/embed-refusals.ts'
import { sourceArchive, uploaderArchive, uploaderIdFor } from '../services/user-archive.ts'
import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'
import type { GuideTool, TvCommand } from '../types/input.ts'
import type { GuideFilter, MultiviewMode } from '../types/preferences.ts'
import { clamp, sleep } from '../utils/time.ts'
import { nextSleepMinutes, SLEEP_CHOICES, sleepPhase } from './sleep.ts'
import { asSurfRange, loadSurfRange, saveSurfOn, saveSurfRange, surfDelayMs, type SurfRange } from './surf.ts'
import {
  addToGuide as addProgrammeToGuide,
  applyGuideAction,
  DEFAULT_GUIDE_NAME,
  guideId,
  libraryFrom,
  loadGuideLibrary,
  newGuide,
  nextPlayable,
  resolveItem,
  saveGuideLibrary,
  type GuideAction,
  type GuideItem,
  type GuideLibrary,
  type GuideRun,
  type ItemLookup,
} from '../services/viewing-guides.ts'
import { buildSearchGuide, SEARCH_TARGET } from '../services/guide-search.ts'
import { searchIndex } from '../services/guide-search-pool.ts'
import { shippedEditorial } from '../data/central-editorial.ts'
import type { ChannelEditorial } from '../services/channel-curation.ts'
import { buildTvnExport, serialiseTvnExport, tvnExportFilename, validateTvnExport, type TvnExport } from '../services/tvn-export.ts'
import {
  asTransitionSettings,
  DEFAULT_TRANSITION_SETTINGS,
  loadTransitionSettings,
  saveTransitionSettings,
  transitionTiming,
  type Presentation,
  type TransitionSettings,
  type TransitionTiming,
} from './transitions.ts'
import { currentEntryMode, surfsOnEntry } from './entry.ts'
import { createStartupRestore } from './startup-channel.ts'
import { commitTuned, emptyUniverseNote, fallForwardTarget, guideRows, randomTarget, stepTarget, type Tuned } from './tuning.ts'
import { browserCanPlay, buildSessionItems, commitImport, probeDuration } from '../session/import.ts'
import { SESSION_CHANNEL_NUMBER, hasPicture, rebaseSession, searchSession, sessionChoice, sessionRefresh, subscribeSession } from '../session/session-channel.ts'
import { chooseAnotherTvn, enterTvn, setTvnChannelSettings, tvnChannelSettings, tvnChoice } from '../tvn/tvn-channel.ts'
import { independentNetworkLoaded, resolveStartupTuning, runStartup, startupAccepts, type StartupPhase } from './startup.ts'

/** RESTORE and channel-file IMPORT read YouTube sources at their own modes and add TVN's shipped back catalogue to ARCHIVE and ALL. */
const restoreDeps = {
  resolveYouTube: (url: string, options?: { mode?: SourceMode }) => lookUpChannel(url, fetch, { ...options }),
  resolveFeed: (url: string, options?: { mode?: SourceMode }) => lookUpFeed(url, fetch, { ...options }),
  archiveOf: sourceArchive,
}
import { loadYouTubeApi } from '../player/load-api.ts'
import { clampGuideSplit, guideTuneDecision, type GuideMode } from '../view/guide-mode.ts'
import { guideToolTarget } from '../view/guide-tool.ts'
import {
  cycleMultiview,
  fillTiles,
  focusStep,
  gridDelta,
  multiviewLayout,
  replaceFocusedTile,
  surfTile,
  tileCount,
} from '../view/multiview.ts'
import { isOnAir } from '../network/airing.ts'
import { confirmStart, soundHeld, viewerInteracted, type StartHold } from '../player/autoplay.ts'
import { canGoBack, canGoForward, commitHistory, EMPTY_HISTORY, historyStep, visit, type ViewingHistory } from './history.ts'
import { useNoticeAcknowledged } from '../legal/about-store.ts'
import { addUser, checkUserName, loadUsers, releaseUserChannels, saveUsers, userFilter, type NetworkUser } from '../data/user-network/users.ts'
import {
  TvContext,
  type GuideCursor,
  type GuideNote,
  type GuideSearchState,
  type GuideToolState,
  type OverlayMode,
  type TvContextValue,
} from './tv-context.ts'

const INFO_MS = 6000
const VOLUME_MS = 1200
const NUMERIC_MS = 1600
// A refused or failed first programme is usually replaced within a second or two (the refusal fallback).
const STARTUP_RETRY_MS = 4000
/** Loading shown after director cache, library, shipped network and user network; 100 once tuned. */
const STARTUP_STEPS = [10, 30, 75, 90] as const

const shippedIds = (shipped: Channel) => shippedProgrammes(shipped.id).map((programme) => programme.id)

/** A TVN channel's original sources, from the library as published now (names are added where shown). */
const originalsOf = (number: number, register?: SourceRegister): OriginalSource[] => channelOriginals(number, register)
const poolIdsOf = (number: number) => originalsOf(number).flatMap((source) => source.videos.map((video) => video.id))
/** Only an override that decides about original sources, or arranges TVN's programmes, reads them. */
const readsOriginals = (edit: CuratedEdit) => Boolean(edit.originals?.length || edit.order?.length || edit.excluded?.length || edit.sources.some((source) => source.kind !== 'tvn' && source.enabled))

/** Lay the viewer's saved changes to curated channels over the shipped ones, in this browser only. */
function installCurated() {
  const built: Channel[] = []
  const programmes = new Map<string, Programme[]>()
  for (const edit of Object.values(loadCuratedEdits())) {
    const shipped = shippedChannel(edit.channelNumber)
    if (!shipped) continue
    const made = buildCuratedEdit(shipped, edit, refusedVideos(), shippedProgrammes(shipped.id), readsOriginals(edit) ? originalsOf(shipped.number) : [])
    built.push(made.channel)
    if (made.programmes) programmes.set(shipped.id, made.programmes)
  }
  installCuratedEdits(built, programmes)
}

/** What still works while a channel is edited over the picture; anything else could change the channel. */
const SCREEN_EDIT_COMMANDS: ReadonlySet<TvCommand['type']> = new Set([
  'cancel',
  'guide',
  'guide-tool',
  'mute',
  'volume-up',
  'volume-down',
  'play-pause',
  'fullscreen',
  'debug',
])


/** The channel pools worked out this visit, kept for the next once the set is on screen. */
const keepPools = () => void keepCalculatedPools().catch(() => undefined)

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
  const overlayTimer = useRef(0)
  const noticeTimer = useRef(0)
  const bufferRef = useRef('')
  const dispatchRef = useRef<(command: TvCommand) => void>(() => {})
  const commitTuneRef = useRef<(generation: number, number: number, origin: number) => Promise<void>>(
    async () => {},
  )
  const commitNumericRef = useRef<() => void>(() => {})
  const sessionRef = useRef<{ play: (programmeId: string) => void; import: (files: readonly File[]) => Promise<string> }>({
    play: () => {},
    import: async () => '',
  })
  const importToken = useRef(0)
  const bootRef = useRef<() => void>(() => {})
  const [startup] = useState(createStartupRestore)

  const channel = channelByNumber(channelNumber) ?? listChannels()[0] ?? channels[0]
  const previousChannel = previousNumber !== null ? (channelByNumber(previousNumber) ?? null) : null
  const guideOpen = guideMode !== 'closed'
  const [guideQuery, setGuideQuery] = useState('')
  const [guideZoom, setGuideZoomState] = useState(1)
  const setGuideZoom = useCallback((zoom: number) => setGuideZoomState(clampZoom(zoom)), [])
  const guideList = useMemo(() => {
    const listed = listChannels().filter((item) => channelMatchesFilter(item, guideFilter, favourites))
    return guideRows(guideFilter === 'favourites' ? inFavouriteOrder(listed, favourites) : listed, channelByNumber(channelNumber), guideFilter)
  }, [catalogueVersion, favourites, guideFilter, channelNumber])
  const guideVisiting = guideList.visiting
  const visibleChannels = useMemo(
    () => searchGuideChannels(guideList.rows, guideQuery, (item, needle) => item.origin === 'session' && searchSession(needle).length > 0),
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
    const from = manualAiring(target.number, nowMs)?.slot ?? snap.current
    const next = fallbackProgramme(target, from, refused)
    if (!next) return false
    selectProgramme(target.number, next.programme, nowMs, { startMs: next.startMs, endMs: next.endMs })
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
    const choosing = target.origin === 'tvn' && Date.now() >= (tvnChoice()?.endMs ?? 0)
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
      // Over the picture: E, a right-click or a hold on the information bar edits the channel being watched.
      if (screenEditRef.current !== null) {
        closeScreenEdit()
        return
      }
      const here = channelByNumber(channelRef.current)
      if (here && editorScope(here) && multiviewRef.current === '1') openScreenEdit(here.number)
      return
    }
    if (kind === 'edit') {
      const number = channelNumber ?? cursorRef.current.channelNumber
      const target = channelByNumber(number)
      if (!guideOpenRef.current || !target || !editorScope(target)) return
      // E on a channel whose editor is already open closes it again.
      if (channelNumber === undefined && editingRef.current()) {
        setGuideTool(null)
        return
      }
    } else if (panelOpenRef.current() === kind) {
      // + and OPTIONS close again when pressed a second time.
      closeGuideTool()
      return
    } else {
      if (guideModeRef.current === 'closed') openGuide('expanded')
      setGuideQuery('')
    }
    const target = guideToolTarget(kind, guideFilter, favourites, cursorRef.current, listChannels(), Date.now(), channelNumber)
    setGuideFilter(target.filter)
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
    if (held?.kind === 'guides') return held.kind
    return held && (held.kind === 'users' || held.kind === 'options') && held.cursor === cursorRef.current ? held.kind : null
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
    if (!autoTuneRef.current) recoveryRef.current = null
    autoTuneRef.current = false
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
    presentationRef.current = presents ? (held ? { ...held, number } : { session: ++presentationSession.current, number, settings }) : null
    setPresentation(presentationRef.current)
    tuningRef.current = true
    setTuningNumber(number)
    playerRef.current?.setAudible(false, 0, true)
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
      flash('NO CHANNEL')
      return
    }
    closeGuide()
    requestTune(number)
  }

  bootRef.current = () => {
    if (bootedRef.current) return
    if (multiviewRef.current !== '1') return
    const current = channelByNumber(channelRef.current)
    if (!current || !playerRef.current) return
    bootedRef.current = true
    playerRef.current.setAudible(true, volumeRef.current, mutedRef.current)
    if (!pausedRef.current) {
      startCheckRef.current = true
      void loadProgramme(current, Date.now()).then((result) => {
        const player = playerRef.current
        if (result !== 'playing' || !player) {
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
          }
        })
      })
    }
    showOverlay('info', INFO_MS)
  }

  // The viewer's first key or tap is the interaction the browser waits for: sound (or the picture) starts
  // on the programme already selected, and whatever that key or tap does happens as usual.
  useEffect(() => {
    if (!startHold) return
    const release = () => {
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

  /** Show the session channel's schedule as it now stands: reload in place when watching it, tune to it otherwise. */
  const showSession = () => {
    const session = channelByNumber(SESSION_CHANNEL_NUMBER)
    if (!session) return
    if (sessionRefresh(channelRef.current, tuningRef.current, multiviewRef.current === '1') === 'tune') {
      requestTune(SESSION_CHANNEL_NUMBER)
      return
    }
    // Same channel, new running order: not a channel change, so Previous is untouched.
    closeGuide()
    startup.noteUserTune()
    loadedKey.current = ''
    pausedRef.current = false
    setPaused(false)
    if (playerRef.current && playerReadyRef.current) void loadProgramme(session, Date.now())
    showOverlay('info', INFO_MS)
  }

  sessionRef.current = {
    play(programmeId) {
      if (rebaseSession(programmeId, Date.now())) showSession()
    },
    async import(files) {
      const token = ++importToken.current
      const result = await buildSessionItems(files, {
        canPlay: browserCanPlay,
        createUrl: (file) => URL.createObjectURL(file),
        revokeUrl: (url) => URL.revokeObjectURL(url),
        probe: (url, kind) => probeDuration(url, kind),
        cancelled: () => token !== importToken.current,
      })
      const summary = commitImport(result, Date.now())
      if (result.cancelled || result.items.length === 0) return summary
      showSession()
      flash(summary, 4000)
      return summary
    },
  }

  const syncLive = useCallback((nowMs: number) => {
    if (multiviewRef.current !== '1') return
    if (tuningRef.current || pausedRef.current || !playerReadyRef.current || !bootedRef.current) return
    const current = channelByNumber(channelRef.current)
    if (!current) return
    const run = guideRunRef.current
    if (run?.state === 'active' && run.programmeId) {
      const manual = manualAiring(current.number, nowMs)
      if (!manual || manual.programme.id !== run.programmeId) {
        guideEngine.current.advance(manual === null)
        return
      }
    }
    passRefused(current, nowMs)
    const snap = onScreen(current, nowMs)
    const key = liveKey(current.id, snap.current.programme.id, snap.current.startMs)
    if (key === loadedKey.current) return
    loadedKey.current = key
    const player = playerRef.current
    if (!player) return
    const command = playbackCommand(snap.current.programme, snap.current.seekSeconds, videoOverride(current.number))
    // The same video already playing at the same place (a refresh after a failure elsewhere): nothing to reload.
    const asked = askedRef.current
    if (asked?.channelNumber === current.number && asked.videoId === command.videoId && pictureLiveRef.current && Math.abs(player.currentTime() - command.startSeconds) < 3) return
    notePlayback({
      channelNumber: current.number,
      provider: snap.current.programme.source,
      externalId: snap.current.programme.videoId,
    })
    loadToken.current += 1
    void deliverLive(player, command, current.number)
  }, [])

  const onPlayerReady = useCallback(() => {
    playerReadyRef.current = true
    if (!bootedRef.current) {
      if (catalogueReadyRef.current) bootRef.current()
      return
    }
    if (multiviewRef.current !== '1' || pausedRef.current) return
    const current = channelByNumber(channelRef.current)
    if (current) void loadProgramme(current, Date.now())
  }, [])

  /**
   * What a playback failure changes (the failure on the library record, a refused video leaving the
   * schedule) is whole-network work that takes seconds on the main thread. It waits until the tune in
   * progress has committed, and several failures share one refresh.
   */
  const refreshAfterFailure = useCallback(() => {
    window.clearTimeout(failureTimer.current)
    const run = () => {
      if (tuningRef.current) {
        failureTimer.current = window.setTimeout(run, 200)
        return
      }
      failureTimer.current = 0
      const failures = failuresRef.current.splice(0)
      const user = failureScopes.current.has('user')
      const library = failureScopes.current.has('library')
      failureScopes.current.clear()
      void (async () => {
        let published = false
        for (const failure of failures) {
          if (await recordPlaybackFailure(failure.videoId, failure.reason).catch(() => null)) published = true
        }
        if (user) {
          const sources = await loadStoredSources()
          const built = channelsFromSources(migrateLegacyUserNumbers(sources).sources, { refused: refusedVideos(), archive: uploaderArchive, users: userIds() })
          installUserCatalogue(built.channels, built.programmes)
          loadedKey.current = ''
          syncLive(Date.now())
        }
        if (!library) return
        if (published) {
          loadedKey.current = ''
          syncLive(Date.now())
          return
        }
        republishLibrary()
        loadedKey.current = ''
        syncLive(Date.now())
      })()
    }
    failureTimer.current = window.setTimeout(run, 0)
  }, [syncLive])

  const onPlayerStatus = useCallback((status: PlayerStatus, detail?: string) => {
    setPlayerStatus(status)
    setPlayerDetail(detail ?? '')
    const asked = askedRef.current
    if (status === 'playing' && asked) notePhase(asked.channelNumber, 'playingAt')
    if (status === 'playing') {
      pictureLiveRef.current = true
      setPictureLive(true)
      setStartupSettled(true)
      if (asked) setPictureChannel(asked.channelNumber)
      if (asked?.channelNumber === watchingNumber()) recoveryRef.current = null
    }
    // A paused picture is the picture: a start the browser would not autoplay shows it, not the logo.
    if (status === 'paused') setStartupSettled(true)
    if (status === 'ended') {
      pictureLiveRef.current = false
      setPictureLive(false)
      const watching = watchingNumber()
      const manual = multiviewRef.current === '1' && !tuningRef.current ? manualAiring(watching, Date.now()) : null
      const playing = manual ? { channelNumber: watching, programmeId: manual.programme.id, videoId: manual.programme.videoId } : null
      if (guideEndAdvances(guideRunRef.current, asked, playing)) guideEngine.current.advance(true)
    }
    if (status !== 'error') return
    // The failure belongs to what the player was asked for, not to whichever channel is on screen now.
    const channel = asked ? channelByNumber(asked.channelNumber) : undefined
    if (!asked || !channel) return
    const now = Date.now()
    const videoId = asked.videoId
    if (videoId && markLiveUnavailable(videoId, now, channel.number)) {
      loadedKey.current = ''
      syncLive(Date.now())
      return
    }
    if (videoId) {
      failuresRef.current.push({ videoId, reason: detail || 'playback failed' })
      refreshAfterFailure()
    }
    // A publisher refusal is permanent: remembered, and the channel plays its next programme instead. It
    // counts only when it is the refusal of what this channel is meant to be playing now.
    const meant = videoId !== null && channel.number === watchingNumber() && liveAiring(channel, now, videoOverride(channel.number)).command.videoId === videoId
    if (videoId && isRefusalCode(detail) && refusedVideos().has(videoId)) {
      if (meant) recoverRef.current(channel.number, 'refused')
      return
    }
    if (!videoId || !isRefusalCode(detail) || !learnRefusal(videoId)) return
    failureScopes.current.add(channel.origin === 'user-import' ? 'user' : 'library')
    if (meant) recoverRef.current(channel.number, 'refused')
  }, [syncLive, refreshAfterFailure])

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
   * schedule is untouched, and on the channel already being watched Previous is left alone.
   */
  const playFromGuide = (target: Channel, programme: Programme, slot?: { startMs: number; endMs: number }) => {
    if (!guideDrivingRef.current) guideEngine.current.suspend()
    selectProgramme(target.number, programme, Date.now(), slot && { startMs: slot.startMs, endMs: slot.endMs })
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

  // ── GUIDES: the viewer's own viewing sequences, played through the same picks as the Guide grid ──

  const setGuideLibrary = (next: GuideLibrary) => {
    guideLibraryRef.current = next
    setGuideLibraryState(next)
    saveGuideLibrary(next)
  }
  const setGuideRun = (next: GuideRun | null) => {
    guideRunRef.current = next
    setGuideRunState(next)
  }
  const guideLookup = (): ItemLookup => ({ channelByNumber, programmesFor, refused: refusedVideos() })

  /**
   * Plays the run's item at `index`, or the nearest one in `direction` that can play; an item that cannot
   * is passed for this run only. Going on past the last item ends the Guide and leaves the channel to NOW.
   */
  const playGuideFrom = (run: GuideRun, index: number, direction: 1 | -1): boolean => {
    const skipped = new Set(run.skipped)
    const lookup = guideLookup()
    const at = nextPlayable(run.guide, index, direction, (item) => {
      if (skipped.has(item.id)) return false
      const ok = resolveItem(item, lookup).ok
      if (!ok) skipped.add(item.id)
      return ok
    })
    if (at === null) {
      if (direction === 1) {
        setGuideRun(null)
        if (clearManual()) loadedKey.current = ''
        flash(run.guide.items.length > 0 && skipped.size >= run.guide.items.length ? 'NOTHING IN THIS GUIDE CAN PLAY' : 'GUIDE FINISHED · BACK TO NOW', 2400)
      }
      return false
    }
    const resolved = resolveItem(run.guide.items[at], lookup)
    if (!resolved.ok) return false
    const now = Date.now()
    setGuideRun({ ...run, index: at, state: 'active', programmeId: resolved.programme.id, endsAt: now + resolved.programme.durationSeconds * 1000, skipped: [...skipped] })
    guideDrivingRef.current = true
    try {
      playFromGuide(resolved.channel, resolved.programme)
    } finally {
      guideDrivingRef.current = false
    }
    return true
  }

  guideEngine.current = {
    /** The programme the Guide asked for has ended (or something else replaced it): on to the next item. */
    advance: (finished) => {
      const run = guideRunRef.current
      if (!run || run.state !== 'active') return
      const item = run.guide.items[run.index]
      const next = finished || !item ? run : { ...run, skipped: [...new Set([...run.skipped, item.id])] }
      playGuideFrom(next, run.index + 1, 1)
    },
    /** A Guide item that will not play is passed for this run, rather than the channel falling forward. */
    skipFailed: (channelNumber) => {
      const run = guideRunRef.current
      if (!run || run.state !== 'active' || run.guide.items[run.index]?.channelNumber !== channelNumber) return false
      guideEngine.current.advance(false)
      return true
    },
    /** The viewer chose something else: the Guide stays loaded but stops choosing. */
    suspend: () => {
      const run = guideRunRef.current
      if (run?.state === 'active') setGuideRun({ ...run, state: 'suspended' })
    },
    step: (direction) => guideStepAction(direction),
  }

  const addToGuideAction = (channelNumber: number, programme: Programme): string => {
    const channel = channelByNumber(channelNumber)
    if (!channel) throw new Error('That channel is not available')
    const now = Date.now()
    const library = guideLibraryRef.current
    const current = addProgrammeToGuide(library.current ?? newGuide(DEFAULT_GUIDE_NAME, now), channel, programme, now)
    setGuideLibrary({ ...library, current })
    return `ADDED TO ${current.name.toUpperCase()} · ${current.items.length} ${current.items.length === 1 ? 'ITEM' : 'ITEMS'}`
  }

  /**
   * CREATE GUIDE FROM…: a new, unsaved Guide named after the words, built from TVN's own catalogue. RESCAN
   * (`rescan`) rebuilds the same words differently; the Guide on show stays until its replacement is ready.
   */
  const searchGuideAction = (text: string, rescan = false): string => {
    const state = guideSearchRef.current
    const library = guideLibraryRef.current
    const again = rescan && state !== null && library.current?.id === state.guideId
    const query = (again ? state.query : text).replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!query) throw new Error('Type what the Guide should be about')
    const edits = loadCuratedEdits()
    const editorialFor = (number: number) => (number <= 999 ? (edits[String(number)]?.editorial ?? shippedEditorial(number)) : userEditorialRef.current.get(number))
    const stamp = JSON.stringify([Object.values(edits).map((edit) => [edit.channelNumber, edit.editorial ?? null]), [...userEditorialRef.current]])
    const index = searchIndex(editorialFor, refusedVideos(), stamp)
    const keyOf = (item: GuideItem) => item.programme.videoId || item.programme.mediaUrl || ''
    const previous = again && library.current ? new Set(library.current.items.map(keyOf)) : undefined
    const seed = again ? state.seed + 1 : 0
    const built = buildSearchGuide(index, query, { seed, previous })
    if (built.picks.length === 0) return again ? 'NOTHING ELSE MATCHES' : `NOTHING IN TVN MATCHES ${query.toUpperCase()}`
    if (previous && built.picks.every((pick) => previous.has(pick.entry.key)) && built.picks.length === previous.size) {
      guideSearchRef.current = { ...state!, seed, small: true }
      setGuideSearchState(guideSearchRef.current)
      return `ONLY ${built.matched} ${built.matched === 1 ? 'PROGRAMME MATCHES' : 'PROGRAMMES MATCH'} · NOTHING DIFFERENT TO RESCAN`
    }
    const now = Date.now()
    const items: GuideItem[] = built.picks.map((pick) => ({
      id: guideId('i', now),
      channelNumber: pick.entry.channel.number,
      channelName: pick.entry.channel.name,
      programme: pick.entry.programme.guide ?? { id: pick.entry.programme.id, title: pick.entry.programme.title, videoId: pick.entry.programme.videoId ?? null, durationSeconds: pick.entry.programme.durationSeconds, source: 'imported' },
    }))
    if (!again) editGuideAction({ type: 'new', name: query })
    editGuideAction({ type: 'fill', items })
    const guide = guideLibraryRef.current.current!
    guideSearchRef.current = { query, guideId: guide.id, seed, matched: built.matched, small: built.small }
    setGuideSearchState(guideSearchRef.current)
    const channels = new Set(items.map((item) => item.channelNumber)).size
    const hours = Math.round(built.seconds / 60)
    const length = hours >= 60 ? `${Math.floor(hours / 60)}H ${String(hours % 60).padStart(2, '0')}M` : `${hours}M`
    const summary = `${items.length} ${items.length === 1 ? 'PROGRAMME' : 'PROGRAMMES'} · ${length} · ${channels} ${channels === 1 ? 'CHANNEL' : 'CHANNELS'}`
    if (built.small) return `${summary} · ONLY ${built.matched} MATCH${again ? ' · RESCAN CANNOT VARY IT MUCH' : ''}`
    return built.seconds < SEARCH_TARGET.min ? `${summary} · ALL THAT MATCHES` : summary
  }

  const editGuideAction = (action: GuideAction): string => {
    const before = guideLibraryRef.current
    const next = applyGuideAction(before, action, Date.now())
    setGuideLibrary(next)
    const run = guideRunRef.current
    if (run && action.type === 'delete' && before.current?.id === run.guide.id) setGuideRun(null)
    else if (run && next.current && next.current.id === run.guide.id && action.type !== 'load') {
      // The Guide being played follows its edits; the item playing keeps its place if it is still there.
      const playing = run.guide.items[run.index]?.id
      const index = next.current.items.findIndex((item) => item.id === playing)
      setGuideRun({ ...run, guide: structuredClone(next.current), index: index >= 0 ? index : Math.min(run.index, Math.max(0, next.current.items.length - 1)) })
    }
    const name = next.current?.name.toUpperCase() ?? ''
    switch (action.type) {
      case 'new':
        return 'NEW GUIDE'
      case 'save':
        return `${name} SAVED`
      case 'duplicate':
        return `${name} SAVED AS A COPY`
      case 'delete':
        return 'GUIDE DELETED'
      case 'load':
        return `${name} LOADED`
      case 'clear':
        return 'GUIDE CLEARED'
      case 'rename':
        return `RENAMED ${name}`
      default:
        return ''
    }
  }

  const playGuideAction = (fromIndex = 0) => {
    const current = guideLibraryRef.current.current
    if (!current || current.items.length === 0) {
      flash('THIS GUIDE IS EMPTY')
      return
    }
    playGuideFrom({ guide: structuredClone(current), index: fromIndex, state: 'active', programmeId: null, endsAt: null, skipped: [] }, fromIndex, 1)
  }

  /** Follows the Guide again from the item it was on, played from its beginning. */
  const resumeGuideAction = () => {
    const run = guideRunRef.current
    if (!run) return
    playGuideFrom(run, run.index, 1)
  }

  const stopGuideAction = () => {
    if (!guideRunRef.current) return
    setGuideRun(null)
    flash('GUIDE STOPPED')
  }

  const guideStepAction = (direction: -1 | 1) => {
    const run = guideRunRef.current
    if (!run) return
    if (direction === 1) {
      playGuideFrom({ ...run, state: 'active' }, run.index + 1, 1)
      return
    }
    if (!playGuideFrom({ ...run, state: 'active' }, run.index - 1, -1)) playGuideFrom({ ...run, state: 'active' }, run.index, 1)
  }

  const activateGuide = useCallback((options?: { fromStart?: boolean }) => {
    const cursor = cursorRef.current
    const selected = channelByNumber(cursor.channelNumber)
    if (!selected) return
    const slots = guideSlots(selected, windowRef.current.startMs, windowRef.current.endMs)
    const slot = slotContaining(slots, cursor.timeMs)
    if (selected.origin === 'session') {
      // Choosing an imported programme, from the grid or from a search, is Play Now.
      const chosen = sessionChoice(guideQueryRef.current, slot?.programme ?? null)
      if (chosen) sessionRef.current.play(chosen.id)
      else requestTune(selected.number)
      return
    }
    if (!slot) return
    const now = Date.now()
    const airing = now >= slot.startMs && now < slot.endMs
    if (airing && !options?.fromStart && guideTuneDecision(slot.startMs, slot.endMs, now) === 'tune') {
      closeGuide()
      requestTune(selected.number)
      return
    }
    if (hasPicture(slot.programme)) {
      playFromGuide(selected, slot.programme, slot)
      return
    }
    setGuideNote(now < slot.startMs ? 'later' : 'ended')
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

  dispatchRef.current = (command) => {
    if (!startupAccepts(phaseRef.current, command)) return
    activityRef.current = Date.now()
    if (asleepRef.current) {
      wake()
      return
    }
    if (sleepWarnedRef.current) {
      sleepWarnedRef.current = false
      setNotice(null)
    }
    // While a channel is edited over the picture, nothing may change the channel beneath it.
    if (screenEditRef.current !== null && !SCREEN_EDIT_COMMANDS.has(command.type)) return
    if (command.type === 'guide') closeScreenEdit(true)
    if (command.type === 'digit') {
      tokenRef.current += 1
      window.clearTimeout(settleTimer.current)
      if (tuningRef.current) {
        tuningRef.current = false
        pendingOrigin.current = null
        pendingNumberRef.current = null
        staticSince.current = 0
        setTuningNumber(null)
        playerRef.current?.setAudible(true, volumeRef.current, mutedRef.current)
      }
      const next = `${bufferRef.current}${command.digit}`.slice(0, 6)
      bufferRef.current = next
      setNumeric(next)
      window.clearTimeout(numericTimer.current)
      const numbers = listChannels().map((item) => item.number)
      if (tunerStep(next, numbers) === 'commit') commitNumericRef.current()
      else numericTimer.current = window.setTimeout(() => commitNumericRef.current(), NUMERIC_MS)
      return
    }

    if (command.type === 'digit-back' && bufferRef.current) {
      const next = bufferRef.current.slice(0, -1)
      bufferRef.current = next
      setNumeric(next)
      window.clearTimeout(numericTimer.current)
      if (next) numericTimer.current = window.setTimeout(() => commitNumericRef.current(), NUMERIC_MS)
      return
    }

    if (command.type === 'confirm' && bufferRef.current) {
      commitNumericRef.current()
      return
    }

    if (command.type === 'cancel' && bufferRef.current) {
      bufferRef.current = ''
      setNumeric('')
      window.clearTimeout(numericTimer.current)
      return
    }

    switch (command.type) {
      case 'channel-up':
      case 'channel-down': {
        const pending = tuningRef.current ? pendingNumberRef.current : null
        const target = stepTarget(tuned(), pending, command.type === 'channel-up' ? 1 : -1, { filter: guideFilter, favourites })
        if (target === null) flash(emptyUniverseNote(guideFilter))
        else requestTune(target)
        break
      }
      case 'surf':
        toggleSurf()
        break
      case 'step':
        if (guideOpenRef.current) stepGuideTime(command.direction)
        else if (multiviewRef.current === '1') screenStep(command.direction)
        break
      case 'random-channel': {
        const picked = randomTarget(channelRef.current, { filter: guideFilter, favourites })
        if (picked) requestTune(picked.number)
        else flash(emptyUniverseNote(guideFilter))
        break
      }
      case 'digit-back':
      case 'last-channel': {
        const previous = previousRef.current
        if (previous === null || !channelByNumber(previous)) {
          flash('NO PREVIOUS CHANNEL')
          break
        }
        requestTune(previous)
        break
      }
      case 'history-back':
      case 'history-forward': {
        // Pressed again before the last one settled, it steps on from where that one was heading.
        const aimed = tuningRef.current ? historyAimRef.current : null
        const from = aimed !== null ? { ...historyRef.current, index: aimed } : historyRef.current
        const step = historyStep(from, command.type === 'history-back' ? -1 : 1)
        if (!step || !channelByNumber(step.channelNumber)) break
        historyNavRef.current = step.index
        requestTune(step.channelNumber)
        break
      }
      case 'confirm':
        // Enter inside the Channel Editor belongs to the editor, never to a tune.
        if (guideOpenRef.current && editingRef.current()) break
        if (guideOpenRef.current) activateGuide()
        else if (multiviewRef.current !== '1') {
          const heard = tilesRef.current[audioFocusRef.current] ?? channelRef.current
          multiviewRef.current = '1'
          setMultiviewMode('1')
          setMultiviewPage(0)
          if (heard !== channelRef.current) requestTune(heard)
          else loadedKey.current = ''
        } else showOverlay('info', INFO_MS)
        break
      case 'cancel':
        if (debugOpen) setDebugOpen(false)
        else if (remoteOpen) setRemoteOpen(false)
        else if (screenEditRef.current !== null) closeScreenEdit()
        else if (guideOpenRef.current && (editingRef.current() || panelOpenRef.current())) closeGuideTool()
        else if (guideOpenRef.current) {
          closeGuide()
          showOverlay('info', INFO_MS)
        } else if (creditsRef.current) setCreditsOn(false)
        else setOverlay('none')
        break
      case 'guide':
        if (guideModeRef.current === 'closed') openGuide('expanded')
        else {
          closeGuide()
          showOverlay('info', INFO_MS)
          break
        }
        // A Guide being played opens with it in view, not behind a menu.
        if (guideRunRef.current) openGuideTool('guides')
        break
      case 'guide-expand':
        openGuide('expanded')
        break
      case 'guide-dock':
        openGuide('expanded')
        break
      case 'guide-split':
        setGuideSplit(clampGuideSplit(command.share))
        break
      case 'multiview': {
        guideEngine.current.suspend()
        const nextMode = cycleMultiview(multiviewRef.current)
        const ordered = listChannels()
          .filter((item) => item.enabled && item.origin !== 'session' && !isLiveStreamChannel(item))
          .map((item) => item.number)
        const focusChannel = tilesRef.current[audioFocusRef.current] ?? channelRef.current
        if (nextMode === '1') {
          multiviewRef.current = '1'
          setMultiviewMode('1')
          setMultiviewPage(0)
          if (focusChannel !== channelRef.current) requestTune(focusChannel)
          else loadedKey.current = ''
          break
        }
        clearManual()
        const nextTiles = fillTiles(focusChannel, ordered, tileCount(nextMode), tilesRef.current)
        tilesRef.current = nextTiles
        setTiles(nextTiles)
        audioFocusRef.current = Math.min(audioFocusRef.current, Math.max(0, nextTiles.length - 1))
        setAudioFocus(audioFocusRef.current)
        const heard = nextTiles[audioFocusRef.current] ?? focusChannel
        startup.noteUserTune()
        commitChannel({ channelNumber: heard, previousNumber: previousRef.current }, false)
        multiviewRef.current = nextMode
        setMultiviewMode(nextMode)
        setMultiviewPage(0)
        break
      }
      case 'focus-move': {
        if (multiviewRef.current === '1') break
        const layout = multiviewLayout(multiviewRef.current, window.innerWidth)
        const nextFocus = focusStep(
          audioFocusRef.current,
          gridDelta(command.direction, layout.columns),
          tilesRef.current.length,
        )
        const heard = selectTile(nextFocus)
        if (!heard) break
        startup.noteUserTune()
        commitChannel({ channelNumber: heard, previousNumber: previousRef.current }, false)
        showOverlay('info', INFO_MS)
        break
      }
      case 'focus-tile': {
        if (multiviewRef.current === '1') break
        const heard = selectTile(Math.min(Math.max(command.index, 0), Math.max(0, tilesRef.current.length - 1)))
        if (!heard) break
        startup.noteUserTune()
        commitChannel({ channelNumber: heard, previousNumber: previousRef.current }, false)
        showOverlay('info', INFO_MS)
        break
      }
      case 'media':
        openGuideTool('media')
        break
      case 'guide-tool':
        openGuideTool(command.tool, command.channelNumber)
        break
      case 'user-channels':
        setGuideFilter('user')
        if (guideModeRef.current === 'closed') openGuide('expanded')
        break
      case 'tune':
        requestTune(command.channelNumber)
        break
      case 'remote':
        setRemoteOpen((open) => !open)
        break
      case 'credits':
        setCreditsOn(!creditsRef.current)
        break
      case 'sleep-cycle': {
        const next = command.minutes !== undefined && SLEEP_CHOICES.includes(command.minutes) ? command.minutes : nextSleepMinutes(sleepMinutesRef.current)
        sleepMinutesRef.current = next
        setSleepMinutes(next)
        flash(next > 0 ? `SLEEP IN ${next} MINUTES` : 'SLEEP OFF', 1600)
        break
      }
      case 'multiview-page':
        setMultiviewPage(Math.max(0, command.page))
        break
      case 'info':
        // I (or a tap on the picture) shows the information bar, and closes it again while it is up.
        if (overlay === 'info') showOverlay('none', 0)
        else showOverlay('info', INFO_MS)
        break
      case 'play-pause':
        if (pausedRef.current) resumeViewing()
        else {
          pausedRef.current = true
          setPaused(true)
          pauseViewing(playerRef.current)
        }
        break
      case 'mute': {
        const nextMuted = !mutedRef.current
        mutedRef.current = nextMuted
        setMuted(nextMuted)
        playerRef.current?.setAudible(!tuningRef.current, volumeRef.current, nextMuted)
        showOverlay('volume', VOLUME_MS)
        break
      }
      case 'subtitles': {
        const nextSubtitles = !subtitlesRef.current
        subtitlesRef.current = nextSubtitles
        setSubtitles(nextSubtitles)
        flash(subtitlesNotice(nextSubtitles))
        break
      }
      case 'volume-up':
      case 'volume-down': {
        const delta = command.type === 'volume-up' ? 5 : -5
        const nextVolume = clamp(volumeRef.current + delta, 0, 100)
        volumeRef.current = nextVolume
        setVolume(nextVolume)
        if (nextVolume > 0 && mutedRef.current) {
          mutedRef.current = false
          setMuted(false)
        }
        playerRef.current?.setAudible(!tuningRef.current, nextVolume, nextVolume === 0)
        showOverlay('volume', VOLUME_MS)
        break
      }
      case 'fullscreen':
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
        else if (fullscreenAvailable(document)) void document.documentElement.requestFullscreen().catch(() => {})
        break
      case 'favourite': {
        const number =
          command.channelNumber ??
          (guideOpenRef.current ? cursorRef.current.channelNumber : channelRef.current)
        // Favourites keep the viewer's order: a new one joins the end.
        setFavourites((current) =>
          current.includes(number) ? current.filter((item) => item !== number) : [...current, number],
        )
        break
      }
      case 'debug':
        setDebugOpen((open) => !open)
        break
      case 'guide-filter': {
        const nextFilter = command.filter ?? (guideFilter === 'favourites' ? 'all' : 'favourites')
        setGuideFilter(nextFilter)
        break
      }
      case 'guide-now': {
        // Back to television as it is airing: a Guide pick ends and the broadcast resumes in place.
        guideEngine.current.suspend()
        if (clearManual()) {
          loadedKey.current = ''
          const current = channelByNumber(channelRef.current)
          if (current && multiviewRef.current === '1' && !tuningRef.current && !pausedRef.current && playerRef.current && playerReadyRef.current) {
            void loadProgramme(current, Date.now())
          }
          if (!guideOpenRef.current) showOverlay('info', INFO_MS)
        }
        if (!guideOpenRef.current) break
        setGuideZoomState(1)
        const now = Date.now()
        const nextCursor = { ...cursorRef.current, timeMs: now }
        cursorRef.current = nextCursor
        setGuideCursor(nextCursor)
        if (now < windowRef.current.startMs || now > windowRef.current.endMs) {
          const nextWindow = windowAround(now)
          windowRef.current = nextWindow
          setGuideWindow(nextWindow)
        }
        setGuideNote(null)
        break
      }
      case 'hints':
        setHintsOn(true)
        break
      case 'nav': {
        if (!guideOpenRef.current) break
        if (command.direction === 'up' || command.direction === 'down') {
          const list = visibleRef.current
          if (list.length === 0) break
          const delta = (command.direction === 'down' ? 1 : -1) * (command.rows ?? 1)
          const nextCursor = stepGuideChannel(
            list.map((item) => item.number),
            cursorRef.current,
            delta,
          )
          cursorRef.current = nextCursor
          setGuideCursor(nextCursor)
          setGuideNote(null)
          break
        }
        stepGuideTime(command.direction === 'right' ? 1 : -1)
        break
      }
      default:
        break
    }
  }

  function stepGuideTime(direction: -1 | 1) {
    const cursor = cursorRef.current
    const selected = channelByNumber(cursor.channelNumber)
    if (!selected) return
    let frame = windowRef.current
    let slots = guideSlots(selected, frame.startMs, frame.endMs)
    let result = adjacentSlotTime(slots, cursor.timeMs, direction)

    if (result && 'edge' in result && frame.endMs - frame.startMs < GUIDE_MAX_WINDOW_MS) {
      frame =
        result.edge === 'end'
          ? { ...frame, endMs: frame.endMs + GUIDE_EXTEND_MS }
          : { ...frame, startMs: frame.startMs - GUIDE_EXTEND_MS }
      windowRef.current = frame
      setGuideWindow(frame)
      slots = guideSlots(selected, frame.startMs, frame.endMs)
      result = adjacentSlotTime(slots, cursor.timeMs, direction)
    }

    if (result && 'timeMs' in result) {
      const nextCursor = { ...cursor, timeMs: result.timeMs }
      cursorRef.current = nextCursor
      setGuideCursor(nextCursor)
      setGuideNote(null)
    }
  }

  const dispatch = useCallback((command: TvCommand) => {
    dispatchRef.current(command)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const command = commandFromKeyEvent(event, guideOpenRef.current, multiviewRef.current !== '1')
      if (!command) return
      event.preventDefault()
      dispatchRef.current(command)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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

  useEffect(() => subscribeCatalogue(() => setCatalogueVersion((version) => version + 1)), [])
  useEffect(() => subscribeSession(() => setCatalogueVersion((version) => version + 1)), [])

  const playSession = useCallback((programmeId: string) => sessionRef.current.play(programmeId), [])
  const importSession = useCallback((files: readonly File[]) => sessionRef.current.import(files), [])

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

  useEffect(() => {
    let cancel = false
    setUserLibraryMode(loadUserLibraryMode())
    // The player API has nothing to wait for; fetching it alongside the catalogue keeps it off the ready path.
    void loadYouTubeApi().catch(() => undefined)
    const load = async () => {
      const reached = (step: number) => {
        if (!cancel) setStartupProgress(STARTUP_STEPS[step])
      }
      try {
        const savedPools = readSavedPools().catch(() => null)
        await hydrateDirector().catch(() => undefined)
        reached(0)
        offerSavedPools(await savedPools)
        await hydrateLibrary()
        reached(1)
        await loadShippedIndependentCatalogue().catch(() => 0)
        reached(2)
        const network = await bootstrapUserNetwork().catch(() => null)
        reached(3)
        if (cancel) return false
        republishLibrary()
        loadOverrides()
        installCurated()
        if (network) {
          const migrated = migrateLegacyUserNumbers(network.sources)
          if (migrated.migrated > 0) await saveStoredSources(migrated.sources)
          const built = channelsFromSources(migrated.sources, { refused: refusedVideos(), archive: uploaderArchive, users: userIds() })
          installUserCatalogue(built.channels, built.programmes)
        }
        return independentNetworkLoaded(librarySnapshot().media)
      } finally {
        endScheduleBootstrap()
      }
    }
    const fail = () => {
      phaseRef.current = 'failed'
      setStartupPhase('failed')
    }
    const stop = runStartup(load, (phase) => {
      if (cancel) return
      if (phase === 'failed') return fail()
      const tuning = resolveStartupTuning(startup, stored)
      const start = tuning ? channelByNumber(tuning.channelNumber) : undefined
      if (!tuning || !start) return fail()
      commitChannel(tuning, false)
      historyRef.current = visit(EMPTY_HISTORY, tuning.channelNumber)
      setHistory(historyRef.current)
      if (stored.multiviewMode !== '1') {
        const live = stored.multiviewChannels.filter((number) => channelByNumber(number))
        if (live.length > 0) {
          tilesRef.current = live
          setTiles(live)
        }
      }
      primeDirector(start, Date.now())
      setStartupProgress(100)
      catalogueReadyRef.current = true
      phaseRef.current = 'ready'
      setStartupPhase('ready')
      bootRef.current()
    })
    return () => {
      cancel = true
      stop()
    }
  }, [startup, stored])

  // The library save the start left for later waits until the set has painted, and behind a starter install,
  // whose own library write already covers it.
  useEffect(() => {
    if (startupPhase !== 'ready' || starterDue) return
    return afterPaint(() => void saveDeferredLibrary().catch(() => undefined).then(keepPools))
  }, [startupPhase, starterDue])

  const setSourceOverride = useCallback((channelNumber: number, videoId: string | null) => {
    setVideoOverride(channelNumber, videoId)
  }, [])

  const applyImport = useCallback(
    async (
      parsed: ParsedExport,
      mode: { library: boolean; automatic: boolean },
      options?: {
        filename?: string
        owner?: string
        onPhase?: (phase: import('../library/types.ts').ImportPhase, counts?: import('../library/types.ts').IngestCounts) => void
      },
    ) => {
      const report = await ingestParsed(parsed, { filename: options?.filename, onPhase: options?.onPhase })
      const existing = await loadStoredSources()
      const plan = planImport(
        existing,
        parsed,
        mode,
        channels.map((item) => item.number),
        Date.now(),
      )
      const before = new Set(existing.map((source) => source.id))
      const owner = options?.owner
      if (owner) plan.sources = plan.sources.map((source) => (before.has(source.id) ? source : { ...source, owner }))
      await saveStoredSources(plan.sources)
      const built = channelsFromSources(plan.sources, { refused: refusedVideos(), archive: uploaderArchive, users: userIds() })
      installUserCatalogue(built.channels, built.programmes)
      const hours = (parsed.totalSeconds / 3600).toFixed(1)
      const scheduleNote =
        userLibraryMode() === 'off'
          ? 'User library programming is off until that setting is changed.'
          : 'Imported media will be used in newly generated schedules.'
      flash(
        `${scheduleNote} ${parsed.sources.length} sources · ${parsed.videoCount} videos · ${hours} h · ${report.added} added · ${report.updated} updated`,
      )
    },
    [],
  )

  /** Rebuild 1001+ from the stored sources; a removed channel that was on screen hands over to 001. */
  const installSources = useCallback((sources: readonly StoredSource[]) => {
    userEditorialRef.current = new Map(sources.flatMap((source) => (source.channelNumber && source.editorial ? [[source.channelNumber, source.editorial] as const] : [])))
    const built = channelsFromSources(sources, { refused: refusedVideos(), archive: uploaderArchive, users: userIds() })
    installUserCatalogue(built.channels, built.programmes)
    if (!channelByNumber(channelRef.current)) requestTune(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addChannel = useCallback(
    async (link: string, owner?: string) => {
      const kind = (() => {
        try {
          return classifySourceUrl(link).kind
        } catch {
          return 'youtube'
        }
      })()
      if (kind === 'podcast') {
        // A website or feed: its announced public feed becomes a channel named after the publisher.
        const feed = await lookUpFeed(link, fetch, { fresh: true, mode: 'all' })
        const existing = migrateLegacyUserNumbers(await loadStoredSources()).sources
        const result = addPodcastChannel(existing, feed, Date.now())
        if (result.status === 'full') throw new Error('The User Network is full')
        if (result.status === 'duplicate') return { number: result.number, message: `${feed.title} IS ALREADY ON ${result.number}` }
        if (owner) result.sources = result.sources.map((source) => (source.channelNumber === result.number ? { ...source, owner } : source))
        await saveStoredSources(result.sources)
        installSources(result.sources)
        return { number: result.number, message: `${feed.title} ADDED ON ${result.number} · ${feed.episodes.length} EPISODES` }
      }
      if (kind !== 'youtube') throw new Error('ADD takes a YouTube link, a podcast or a website')
      const found = await lookUpChannel(link)
      const existing = migrateLegacyUserNumbers(await loadStoredSources()).sources
      const result = addChannelSource(existing, found, Date.now(), uploaderIdFor)
      if (result.status === 'full') throw new Error('The User Network is full')
      if (result.status === 'duplicate') return { number: result.number, message: `${found.title} IS ALREADY ON ${result.number}` }
      if (owner && result.status === 'added') {
        result.sources = result.sources.map((source) => (source.channelNumber === result.number ? { ...source, owner } : source))
      }
      await saveStoredSources(result.sources)
      installSources(result.sources)
      const verb = result.status === 'updated' ? 'UPDATED' : 'ADDED'
      return { number: result.number, message: `${found.title} ${verb} ON ${result.number} · ${found.videos.length} VIDEOS` }
    },
    [installSources],
  )

  const createNetworkUser = useCallback(
    (name: string, closePanel = false) => {
      const next = addUser(usersRef.current, name, Date.now())
      commitUsers(next.users)
      setGuideFilter(userFilter(next.user.id))
      if (closePanel) closeGuideTool()
      return next.user
    },
    [],
  )

  /**
   * The starter's YouTube channels and playlists arrive as addresses: they are read through the keyless
   * lookup after the install, a few at a time, and each fills in only if the viewer has not changed it since.
   */
  const resolveStarterSources = useCallback(
    async (pending: readonly StoredSource[]) => {
      if (pending.length === 0) return
      const resolved = await resolveRestored(pending, restoreDeps, Date.now())
      const found = new Map(resolved.records.map((record) => [record.id, record]))
      const latest = migrateLegacyUserNumbers(await loadStoredSources()).sources
      let changed = false
      const next = latest.map((record) => {
        const read = found.get(record.id)
        if (!read || read.videos.length === 0 || record.videos.length > 0 || record.channelNumber !== read.channelNumber) return record
        changed = true
        return {
          ...record,
          videos: read.videos,
          ...(read.channelSources ? { channelSources: read.channelSources } : {}),
          ...(read.runningOrder?.length ? { runningOrder: read.runningOrder } : {}),
        }
      })
      if (!changed) return
      await saveStoredSources(next)
      installSources(next)
    },
    [installSources],
  )

  /** Add the starter network after the viewer's own channels; anything already present is left as it is. */
  const loadTestChannels = useCallback(
    async (automatic = false) => {
      if (automatic && starterState() !== 'pending') return ''
      const now = Date.now()
      const starter = recordsFromExport(await readStarterNetwork(), now)
      const existing = migrateLegacyUserNumbers(await loadStoredSources()).sources
      await ingestParsed(starterCollections(starter), { filename: BUILT_IN_CATALOGUE_ID })
      const plan = planStarterNetwork(existing, starter, now, uploaderIdFor)
      if (plan.added.length > 0) await saveStoredSources(plan.sources)
      setStarterState('installed')
      if (plan.added.length === 0) return 'THE STARTER NETWORK IS ALREADY INSTALLED'
      installSources(plan.sources)
      const added = new Set(plan.added)
      void resolveStarterSources(plan.sources.filter((record) => added.has(record.channelNumber ?? -1) && !record.emptySlot && record.videos.length === 0)).catch(() => undefined)
      const range = plan.added.length === 1 ? `${plan.added[0]}` : `${plan.added[0]}–${plan.added[plan.added.length - 1]}`
      return `${plan.added.length} STARTER CHANNELS ADDED ON ${range}${plan.skipped > 0 ? ` · ${plan.skipped} ALREADY PRESENT` : ''}`
    },
    [installSources, resolveStarterSources],
  )

  // However the first load goes (blocked autoplay, a load that never starts, a card or radio), the logo gives way
  // once the player's own load timeout has passed.
  useEffect(() => {
    if (startupPhase !== 'ready' || startupSettled) return
    const timer = window.setTimeout(() => setStartupSettled(true), PLAYER_LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [startupPhase, startupSettled])

  // A failed first programme keeps the logo up while its replacement loads, but not for the whole load timeout.
  useEffect(() => {
    if (startupPhase !== 'ready' || startupSettled || !startupFailed) return
    const timer = window.setTimeout(() => setStartupSettled(true), STARTUP_RETRY_MS)
    return () => window.clearTimeout(timer)
  }, [startupPhase, startupSettled, startupFailed])

  const starterRanRef = useRef(false)
  useEffect(() => {
    if (startupPhase !== 'ready' || (!starterDue && !favouritesSeeded) || starterRanRef.current) return
    // A fresh install's starter channels wait until the first picture is up (or the start has settled otherwise).
    if (starterDue && !startupSettled) return
    starterRanRef.current = true
    const installed = starterDue ? loadTestChannels(true).catch(() => undefined) : Promise.resolve()
    if (starterDue) void installed.then(() => afterPaint(() => void saveDeferredLibrary().catch(() => undefined).then(keepPools)))
    if (!favouritesSeeded) return
    void installed
      .then(async () => {
        const expected = starterFavouriteSources(recordsFromExport(await readStarterNetwork(), 0))
        const sources = migrateLegacyUserNumbers(await loadStoredSources()).sources
        setFavourites((current) => placeStarterFavourites(current, expected, sources))
      })
      .catch(() => undefined)
  }, [startupPhase, starterDue, favouritesSeeded, loadTestChannels, startupSettled])

  const removeStarterNetwork = useCallback(async () => {
    const ids = starterIds(await readStarterTemplate(), recordsFromExport(await readStarterNetwork(), 0))
    const existing = await loadStoredSources()
    const remaining = withoutStarter(existing, ids)
    setStarterState('removed')
    const removed = existing.length - remaining.length
    if (removed === 0) return 'NO STARTER CHANNELS TO REMOVE'
    await saveStoredSources(remaining)
    installSources(remaining)
    return `${removed} STARTER ${removed === 1 ? 'CHANNEL' : 'CHANNELS'} REMOVED`
  }, [installSources])

  const removeUserChannels = useCallback(
    async (numbers: 'all' | readonly number[]) => {
      const existing = await loadStoredSources()
      const remaining = withoutUserChannels(existing, numbers)
      await saveStoredSources(remaining)
      installSources(remaining)
      if (numbers === 'all') setStarterState('removed')
      const removed = existing.length - remaining.length
      return removed === 0 ? 'NO USER CHANNELS REMOVED' : `${removed} USER ${removed === 1 ? 'CHANNEL' : 'CHANNELS'} REMOVED`
    },
    [installSources],
  )

  /** A new, empty 1001+ channel for Edit Channel to fill: the lowest empty slot, or the next number. */
  const createEmptyChannel = useCallback(
    async () => {
      const existing = migrateLegacyUserNumbers(await loadStoredSources()).sources
      const slot = firstEmptySlot(existing)
      if (slot?.channelNumber) return slot.channelNumber
      const taken = existing.flatMap((source) => (source.channelNumber !== null && source.channelNumber >= USER_NUMBER_START ? [source.channelNumber] : []))
      const number = taken.length ? Math.max(...taken) + 1 : USER_NUMBER_START
      if (number >= USER_NUMBER_LIMIT) throw new Error('The User Network is full')
      const owner = usersRef.current.find((user) => userFilter(user.id) === guideFilter)?.id
      const next = [...existing, { ...emptySlotRecord(number, Date.now()), ...(owner ? { owner } : {}) }]
      await saveStoredSources(next)
      installSources(next)
      return number
    },
    [guideFilter, installSources],
  )

  const renameNetworkUser = useCallback(
    (id: string, name: string) => {
      const checked = checkUserName(name, usersRef.current.filter((user) => user.id !== id))
      if (!checked.ok) throw new Error(checked.error)
      commitUsers(usersRef.current.map((user) => (user.id === id ? { ...user, name: checked.name } : user)))
      return `RENAMED ${checked.name}`
    },
    [],
  )

  /** Remove a named user. Its channels either move to TVN (owner cleared) or are removed with it. */
  const deleteNetworkUser = useCallback(
    async (id: string, channels: 'move' | 'remove') => {
      const user = usersRef.current.find((item) => item.id === id)
      if (!user) return 'THAT USER IS ALREADY GONE'
      const existing = await loadStoredSources()
      const owned = existing.filter((source) => source.owner === id && !source.emptySlot)
      const remaining = releaseUserChannels(existing, id, channels, (source) =>
        source.channelNumber === null || source.emptySlot ? source : emptySlotRecord(source.channelNumber, Date.now()),
      )
      commitUsers(usersRef.current.filter((item) => item.id !== id))
      if (remaining.some((source, index) => source !== existing[index])) {
        await saveStoredSources(remaining)
        installSources(remaining)
      }
      if (guideFilter === userFilter(id)) setGuideFilter('user')
      const count = `${owned.length} ${owned.length === 1 ? 'CHANNEL' : 'CHANNELS'}`
      if (owned.length === 0) return `${user.name} DELETED`
      return channels === 'remove' ? `${user.name} DELETED WITH ${count}` : `${user.name} DELETED · ${count} MOVED TO TVN`
    },
    [guideFilter, installSources],
  )

  const exportUserNetwork = useCallback(async () => {
    const now = new Date()
    const document = buildUserNetworkExport(await loadStoredSources(), now, uploaderIdFor, usersRef.current)
    downloadText(exportFilename(now), serialiseUserNetworkExport(document))
    const count = document.channels.length
    const users = document.users?.length ?? 0
    return `EXPORTED ${count} USER ${count === 1 ? 'CHANNEL' : 'CHANNELS'}${users > 0 ? ` · ${users} ${users === 1 ? 'USER' : 'USERS'}` : ''}`
  }, [])

  const exportTvn = useCallback(async () => {
    const now = new Date()
    const register = await loadRegister()
    const document = buildTvnExport({
      stored: await loadStoredSources(),
      users: usersRef.current,
      favourites: favouritesRef.current,
      settings: {
        volume: volumeRef.current,
        muted: mutedRef.current,
        subtitles: subtitlesRef.current,
        sleepMinutes: sleepMinutesRef.current,
        guideSplit: guideSplitRef.current,
        infoShortcuts: infoShortcutsRef.current,
        surfRange: surfRangeRef.current,
        transition: transitionRef.current.id,
        transitionStyle: transitionRef.current,
        tvnChannel: tvnChannelSettings(),
      },
      now,
      uploaderOf: uploaderIdFor,
      curated: Object.values(loadCuratedEdits()),
      guides: guideLibraryRef.current,
      originalsOf: (number) => originalsOf(number, register),
      shippedOf: (number) => {
        const shipped = shippedChannel(number)
        return shipped ? shippedProgrammes(shipped.id) : []
      },
    })
    downloadText(tvnExportFilename(now), serialiseTvnExport(document))
    const count = document.userNetwork.channels.length
    const curated = document.central?.overrides.length ?? 0
    const guides = document.guides?.saved.length ?? 0
    return `TVN EXPORTED · ${count} USER ${count === 1 ? 'CHANNEL' : 'CHANNELS'} · ${curated} CURATED · ${guides} ${guides === 1 ? 'GUIDE' : 'GUIDES'} · ${document.favourites.length} FAVOURITES · SETTINGS`
  }, [])

  /** The editor's scope for this channel number, checked again on every action rather than trusted from the view. */
  const scopeOf = (number: number) => {
    const target = channelByNumber(number)
    const scope = target ? editorScope(target) : null
    if (!target || !scope) throw new Error('This channel cannot be edited')
    const shipped = scope === 'curated' ? shippedChannel(number) : undefined
    if (scope === 'curated' && !shipped) throw new Error('This channel cannot be edited')
    return { target, scope, shipped: shipped as NonNullable<typeof shipped> }
  }

  /** Replace the User Network with a validated export the viewer has confirmed; 001–999 and 000 are not touched. */
  const importUserNetwork = useCallback(
    async (document: UserNetworkExport) => {
      const now = Date.now()
      const resolved = await resolveRestored(recordsFromExport(document, now), restoreDeps, now)
      const next = restoreUserNetwork(await loadStoredSources(), resolved.records)
      await saveStoredSources(next)
      if (starterState() === 'pending') setStarterState('installed')
      setFavourites((current) => favouritesAfterRestore(current, resolved.records))
      const users = usersFromExport(document)
      commitUsers(users)
      setGuideFilter((current) => (current.startsWith('user:') && !users.some((user) => userFilter(user.id) === current) ? 'user' : current))
      installSources(next)
      const count = resolved.records.length
      const empty = resolved.records.filter((record) => record.emptySlot).length
      return `USER NETWORK IMPORTED · ${count} ${count === 1 ? 'CHANNEL' : 'CHANNELS'}${empty > 0 ? ` · ${empty} EMPTY` : ''}${
        users.length > 0 ? ` · ${users.length} ${users.length === 1 ? 'USER' : 'USERS'}` : ''
      }${
        resolved.failed > 0 ? ` · ${resolved.failed} ${resolved.failed === 1 ? 'SOURCE' : 'SOURCES'} COULD NOT BE READ` : ''
      }`
    },
    [installSources],
  )

  /**
   * Replace this browser's 001–999 overrides with an export's, already validated. Only the override layer
   * changes; each override is checked against the channel TVN ships now, and what no longer fits is reported.
   */
  const restoreCentralCuration = async (central: CentralCuration): Promise<string> => {
    const now = Date.now()
    const read = overridesFromExport(central)
    const resolved = await resolveRestored(read.map(overrideRecord), restoreDeps, now)
    const register = await loadRegister()
    const kept: CuratedEdit[] = []
    const conflicts: string[] = []
    read.forEach((edit, index) => {
      const shipped = shippedChannel(edit.channelNumber)
      const sources = resolved.records[index]?.channelSources ?? edit.sources
      const result = reconcileOverride({ ...edit, sources }, shipped, shipped ? shippedProgrammes(shipped.id).map((programme) => programme.id) : [], shipped ? originalsOf(shipped.number, register) : [])
      if (result.edit) kept.push(result.edit)
      conflicts.push(...result.conflicts)
    })
    replaceCuratedEdits(kept)
    installCurated()
    return ` · ${kept.length} CURATED${conflicts.length ? ` · ${conflicts.length} TO REVIEW` : ''}`
  }

  /**
   * Restore a complete TVN export the viewer has confirmed. The whole file is checked again first; the User
   * Network is restored next, and only once that has succeeded do Favourites and settings follow.
   */
  const importTvn = useCallback(
    async (document: TvnExport) => {
      const checked = validateTvnExport(document)
      if (!checked.ok) throw new Error(`Not a complete TVN export · ${checked.errors[0]}`)
      const restored = await importUserNetwork(checked.value.userNetwork)
      const central = checked.value.central ? await restoreCentralCuration(checked.value.central) : ''
      const guides = checked.value.guides
      if (guides) setGuideLibrary(libraryFrom(guides))
      const { favourites: favouriteNumbers, settings } = checked.value
      setFavourites([...favouriteNumbers])
      if (settings.volume !== undefined) {
        volumeRef.current = settings.volume
        setVolume(settings.volume)
      }
      if (settings.muted !== undefined) {
        mutedRef.current = settings.muted
        setMuted(settings.muted)
      }
      if (settings.subtitles !== undefined) {
        subtitlesRef.current = settings.subtitles
        setSubtitles(settings.subtitles)
      }
      if (settings.sleepMinutes !== undefined) {
        sleepMinutesRef.current = settings.sleepMinutes
        setSleepMinutes(settings.sleepMinutes)
      }
      if (settings.guideSplit !== undefined) setGuideSplit(clampGuideSplit(settings.guideSplit))
      if (settings.infoShortcuts !== undefined) setInfoShortcuts(asShortcuts(settings.infoShortcuts))
      if (settings.surfRange !== undefined) {
        const range = asSurfRange(settings.surfRange)
        saveSurfRange(range)
        setSurfRangeState(range)
      }
      // A file from before the transition's look was saved restores its defaults.
      transitionRef.current = asTransitionSettings({ ...settings.transitionStyle, id: settings.transition ?? settings.transitionStyle?.id })
      saveTransitionSettings(transitionRef.current)
      setTransitionState(transitionRef.current)
      if (settings.tvnChannel !== undefined) setTvnChannelSettings(settings.tvnChannel)
      playerRef.current?.setAudible(!tuningRef.current, volumeRef.current, mutedRef.current)
      return `${restored.replace('USER NETWORK IMPORTED', 'TVN RESTORED')}${central}${guides ? ` · ${guides.saved.length} ${guides.saved.length === 1 ? 'GUIDE' : 'GUIDES'}` : ''}`
    },
    [importUserNetwork],
  )

  const openChannelEdit = useCallback(async (number: number): Promise<ChannelEdit | null> => {
    const { scope, shipped } = scopeOf(number)
    if (scope === 'curated') {
      const saved = loadCuratedEdit(number)
      const edit = curatedEditOf(shipped, saved)
      const changed = saved && baselineChanged(saved, shippedBaseline(shipped, shippedIds(shipped))) ? ['TVN has changed this channel since you curated it'] : []
      const sources = reconcileOriginals(saved?.originals, originalsOf(number, await loadRegister()), String(number).padStart(3, '0')).conflicts
      const review = [...(saved?.conflicts ?? []), ...changed, ...sources.filter((line) => !saved?.conflicts?.includes(line))]
      return review.length ? { ...edit, review } : edit
    }
    const record = (await loadStoredSources()).find((item) => item.channelNumber === number)
    return record ? editOf(record) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveChannelEdit = useCallback(
    async (number: number, edit: ChannelEdit) => {
      const { scope, shipped } = scopeOf(number)
      if (scope === 'curated') {
        const saved = saveCuratedEdit(shipped, { ...edit, sources: widenSources(edit.sources, sourceArchive) }, Date.now(), undefined, shippedIds(shipped), poolIdsOf(number))
        installCurated()
        return saved ? 'SAVED · IN THIS BROWSER ONLY' : 'SAVED · AS TVN SHIPS IT'
      }
      const widened = { ...edit, sources: widenSources(edit.sources, sourceArchive) }
      const next = applyChannelEdit(migrateLegacyUserNumbers(await loadStoredSources()).sources, number, widened, Date.now())
      await saveStoredSources(next)
      installSources(next)
      return 'SAVED'
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [installSources],
  )

  const rescanChannelEdit = useCallback(
    async (number: number, edit: ChannelEdit) => {
      const { scope, shipped } = scopeOf(number)
      const deps = {
        resolveYouTube: (url: string, options?: { mode?: SourceMode }) => lookUpChannel(url, fetch, { fresh: true, ...options }),
        resolveFeed: (url: string, options?: { mode?: SourceMode }) => lookUpFeed(url, fetch, { fresh: true, ...options }),
        probeStream: (source: ChannelSource) => probeStream(source),
        uploaderOf: uploaderIdFor,
        archiveOf: sourceArchive,
      }
      const now = Date.now()
      if (scope === 'curated') {
        const sources = await rescanSources(edit.sources, deps, now)
        const next = { ...edit, sources }
        saveCuratedEdit(shipped, next, now, undefined, shippedIds(shipped), poolIdsOf(number))
        installCurated()
        return { edit: next, message: rescanSummary(sources) }
      }
      const result = await rescanChannel(migrateLegacyUserNumbers(await loadStoredSources()).sources, number, edit, deps, now)
      await saveStoredSources(result.all)
      installSources(result.all)
      return { edit: result.edit, message: result.message }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [installSources],
  )

  const exportChannelFile = useCallback(
    async (number: number, edit: ChannelEdit, as: ChannelExportKind) => {
      const { scope, shipped } = scopeOf(number)
      if (scope === 'curated') {
        if (as === 'json') throw new Error('Only your own channels can be exported as a channel file')
        const shown = canonicalEdit(shipped, { ...edit, sources: widenSources(edit.sources, sourceArchive) }, shippedIds(shipped), poolIdsOf(number))
        const manifest = curatedChannelManifest(number, shown, shippedProgrammes(shipped.id), originalsOf(number, await loadRegister()))
        const record = overrideRecord({ channelNumber: number, ...shown, savedAt: Date.now() })
        if (as === 'md') {
          downloadText(channelFilename(record, 'md'), manifestText(manifest, record), 'text/markdown')
          return 'READABLE MANIFEST EXPORTED'
        }
        downloadText(channelFilename(record, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
        return 'CHANNEL MANIFEST EXPORTED'
      }
      // What the editor shows, unsaved changes included, on a copy: exporting never saves.
      const shown = applyChannelEdit(migrateLegacyUserNumbers(await loadStoredSources()).sources, number, { ...edit, sources: widenSources(edit.sources, sourceArchive) }, Date.now())
      const record = shown.find((item) => item.channelNumber === number)
      if (!record) throw new Error('That channel is no longer in your User Network')
      if (as === 'md') {
        downloadText(channelFilename(record, 'md'), manifestText(userChannelManifest(record), record), 'text/markdown')
        return 'READABLE MANIFEST EXPORTED'
      }
      if (as === 'manifest') {
        downloadText(channelFilename(record, 'manifest.json'), `${JSON.stringify(userChannelManifest(record), null, 2)}\n`)
        return 'CHANNEL MANIFEST EXPORTED'
      }
      downloadText(channelFilename(record), serialiseChannelFile(buildChannelFile(record, new Date(), uploaderIdFor)))
      return 'CHANNEL EXPORTED'
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const importChannelFile = useCallback(
    async (text: string, owner: string) => {
      const read = readChannelFile(text)
      if (!read.ok) throw new Error(read.errors[0] ?? 'That channel file could not be read')
      const now = Date.now()
      const existing = migrateLegacyUserNumbers(await loadStoredSources()).sources
      const added = addChannelFromFile(existing, read.value, owner, now)
      const resolved = await resolveRestored([added.record], restoreDeps, now)
      const record = resolved.records[0]
      const next = added.sources.map((item) => (item === added.record ? record : item))
      await saveStoredSources(next)
      installSources(next)
      const failed = resolved.failed > 0 ? ` · ${resolved.failed} ${resolved.failed === 1 ? 'SOURCE' : 'SOURCES'} COULD NOT BE READ` : ''
      return { message: `CHANNEL IMPORTED AS ${added.number}${failed}`, number: added.number }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [installSources],
  )

  const restoreCuratedChannel = useCallback(
    async (number: number) => {
      if (scopeOf(number).scope !== 'curated') throw new Error('Only TVN channels can be restored')
      clearCuratedEdit(number)
      installCurated()
      closeGuideTool()
      closeScreenEdit()
      return `${String(number).padStart(3, '0')} RESTORED AS TVN SHIPS IT`
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const deleteUserChannel = useCallback(
    async (number: number) => {
      if (scopeOf(number).scope !== 'user') throw new Error('Only your own channels can be deleted')
      // The number stays as an empty slot, so the Guide cursor stays on it and nothing renumbers.
      const result = clearUserChannel(migrateLegacyUserNumbers(await loadStoredSources()).sources, number, Date.now())
      if (result.status === 'missing') throw new Error('That channel is no longer in your User Network')
      closeGuideTool()
      if (result.status === 'already-empty') return `${number} IS ALREADY EMPTY`
      await saveStoredSources(result.sources)
      installSources(result.sources)
      if (channelByNumber(number)) focusGuide(number, cursorRef.current.timeMs)
      return `${number} CLEARED · THE NUMBER IS KEPT AS AN EMPTY CHANNEL`
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusGuide, installSources],
  )

  /**
   * The information bar's Watch over the picture: back to the broadcast at NOW after a Prev, Next or
   * Guide pick, and otherwise simply clears the bar.
   */
  const screenAction = useCallback(() => {
    const here = channelByNumber(channelRef.current)
    if (!here) return
    const now = Date.now()
    if (here.origin === 'session') {
      sessionRef.current.play(onScreen(here, now).current.programme.id)
      return
    }
    if (clearManual()) {
      loadedKey.current = ''
      pausedRef.current = false
      setPaused(false)
      if (playerRef.current && playerReadyRef.current) void loadProgramme(here, now)
      showOverlay('info', INFO_MS)
      return
    }
    showOverlay('none', 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** The information bar's Prev (-1) and Next (1) over the picture: that programme, from its start. */
  const screenStep = useCallback((direction: -1 | 1) => {
    // While a Guide is followed, Prev and Next move along the Guide; ↑ and ↓ still go back through the channels watched.
    if (guideRunRef.current?.state === 'active') {
      guideEngine.current.step(direction)
      return
    }
    const here = channelByNumber(channelRef.current)
    // On 000, Next is another choice; it has no earlier programme of its own to go back to.
    if (here?.origin === 'tvn') {
      if (direction === 1) chooseAnotherOnTvn()
      return
    }
    if (!here || here.origin === 'session' || onScreen(here, Date.now()).current.programme.liveStream) return
    const target = stepFrom(here, Date.now(), direction)
    if (hasPicture(target.programme)) playFromGuide(here, target.programme, target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** CHOOSE ANOTHER on 000: a new choice now, played at once when 000 is on screen. */
  const chooseAnotherOnTvn = useCallback(() => {
    const now = Date.now()
    chooseAnotherTvn(now)
    const here = channelByNumber(channelRef.current)
    if (here?.origin !== 'tvn' || tuningRef.current || multiviewRef.current !== '1' || !playerRef.current || !playerReadyRef.current) return
    loadedKey.current = ''
    void loadProgramme(here, now)
    showOverlay('info', INFO_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** The pointer is on the information bar: it stays until the pointer leaves, then fades as usual. */
  const holdInfo = useCallback((held: boolean) => {
    window.clearTimeout(overlayTimer.current)
    if (!held) overlayTimer.current = window.setTimeout(() => setOverlay('none'), INFO_MS)
  }, [])

  const toggleSurf = useCallback(() => {
    activityRef.current = Date.now()
    const next = !surfingRef.current
    surfingRef.current = next
    setSurfing(next)
    saveSurfOn(next)
    flash(next ? 'TVN SURF ON' : 'TVN SURF OFF', 1400)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setSurfRange = useCallback((range: SurfRange, moved: 'min' | 'max' = 'min') => {
    const next = asSurfRange(range, moved)
    saveSurfRange(next)
    setSurfRangeState(next)
  }, [])

  const setTransition = useCallback((settings: TransitionSettings) => {
    const next = asTransitionSettings(settings)
    transitionRef.current = next
    saveTransitionSettings(next)
    setTransitionState(next)
  }, [])

  /** The picture (or a face) has the screen; a later presentation is left alone. */
  const endTransition = useCallback((session: number) => {
    if (presentationRef.current?.session !== session) return
    presentationRef.current = null
    setPresentation(null)
  }, [])

  const setInfoShortcut = useCallback((corner: Corner, id: ShortcutId) => {
    setInfoShortcuts((current) => assignShortcut(current, corner, id))
  }, [])

  const resetInfoShortcuts = useCallback(() => setInfoShortcuts({ ...DEFAULT_SHORTCUTS }), [])

  // Surfing hops without counting as the viewer's activity, so SLEEP still ends an unattended session.
  useEffect(() => {
    // A first visit stays on its first channel until the welcome notice is dismissed.
    if (!surfing || asleep || guideOpen || screenEdit !== null || startupPhase !== 'ready' || !noticeSeen) return
    const id = window.setTimeout(() => {
      if (multiviewRef.current === '1') {
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
    }, surfDelayMs(surfRange))
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfing, surfHops, surfRange, asleep, guideOpen, screenEdit, multiviewMode, startupPhase, noticeSeen])

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

  const guideApi = useRef({ add: addToGuideAction, edit: editGuideAction, play: playGuideAction, resume: resumeGuideAction, stop: stopGuideAction, step: guideStepAction, search: searchGuideAction })
  guideApi.current = { add: addToGuideAction, edit: editGuideAction, play: playGuideAction, resume: resumeGuideAction, stop: stopGuideAction, step: guideStepAction, search: searchGuideAction }
  const searchGuide = useCallback((query: string, rescan?: boolean) => guideApi.current.search(query, rescan), [])
  const addToGuide = useCallback((channelNumber: number, programme: Programme) => guideApi.current.add(channelNumber, programme), [])
  const editGuide = useCallback((action: GuideAction) => guideApi.current.edit(action), [])
  const playGuide = useCallback((fromIndex?: number) => guideApi.current.play(fromIndex), [])
  const resumeGuide = useCallback(() => guideApi.current.resume(), [])
  const stopGuide = useCallback(() => guideApi.current.stop(), [])
  const guideStep = useCallback((direction: -1 | 1) => guideApi.current.step(direction), [])

  const value = useMemo<TvContextValue>(
    () => ({
      channel,
      previousChannel,
      canGoBack: canGoBack(history),
      canGoForward: canGoForward(history),
      startHold,
      visibleChannels,
      guideVisiting,
      volume,
      muted,
      paused,
      subtitles,
      favourites,
      guideFilter,
      guideQuery,
      setGuideQuery,
      guideZoom,
      setGuideZoom,
      guideOpen,
      guideMode,
      guideSplit,
      multiviewMode,
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
      chooseAnotherTvn: chooseAnotherOnTvn,
      holdInfo,
      guideLibrary,
      guideRun,
      guideSearch,
      searchGuide,
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
      networkUsers,
      createNetworkUser,
      renameNetworkUser,
      deleteNetworkUser,
      loadTestChannels,
      removeStarterNetwork,
      removeUserChannels,
      createEmptyChannel,
      exportUserNetwork,
      importUserNetwork,
      exportTvn,
      importTvn,
      openChannelEdit,
      saveChannelEdit,
      rescanChannelEdit,
      exportChannelFile,
      importChannelFile,
      sourceArchive,
      deleteUserChannel,
      restoreCuratedChannel,
      setSourceOverride,
      playSession,
      importSession,
    }),
    [
      openChannelEdit,
      saveChannelEdit,
      rescanChannelEdit,
      exportChannelFile,
      importChannelFile,
      deleteUserChannel,
      restoreCuratedChannel,
      playSession,
      importSession,
      addChannel,
      networkUsers,
      createNetworkUser,
      renameNetworkUser,
      deleteNetworkUser,
      loadTestChannels,
      removeStarterNetwork,
      removeUserChannels,
      createEmptyChannel,
      exportUserNetwork,
      importUserNetwork,
      exportTvn,
      importTvn,
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
      startupPhase,
      startupProgress,
      sleepMinutes,
      asleep,
      wake,
      surfing,
      toggleSurf,
      surfRange,
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
      chooseAnotherOnTvn,
      holdInfo,
      guideLibrary,
      guideRun,
      guideSearch,
      searchGuide,
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
