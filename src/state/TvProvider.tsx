import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { channelByNumber, channels, listChannels, randomChannel, shippedChannel } from '../data/catalogue.ts'
import { channelMatchesFilter, inFavouriteOrder } from '../data/network.ts'
import { installCuratedEdits, installUserCatalogue, subscribeCatalogue } from '../data/user-overlay.ts'
import {
  GUIDE_EXTEND_MS,
  GUIDE_MAX_WINDOW_MS,
  windowAround,
} from '../epg/geometry.ts'
import { guideFilterForChannel, searchGuideChannels, stepGuideChannel } from '../epg/navigation.ts'
import { clampZoom } from '../epg/zoom.ts'
import { commandFromGamepad } from '../input/gamepad.ts'
import { commandFromKeyEvent } from '../input/keyboard.ts'
import { tunerStep } from '../input/tuner.ts'
import { deliver, playbackCommand, type PlaybackCommand } from '../player/command.ts'
import { subtitlesNotice } from '../player/captions.ts'
import { notePlayback } from '../player/trace.ts'
import { notePhase, notePress } from '../player/tune-timing.ts'
import { commitTune, createPictureWait } from './tune-commit.ts'
import { liveAiring, pauseViewing } from '../player/viewing.ts'
import { clearManual, onScreen, pickTunes, selectProgramme, stepFrom } from '../player/manual.ts'
import type { PlayerHandle, PlayerStatus } from '../player/types.ts'
import { liveKey } from '../scheduler/calculate.ts'
import { adjacentSlotTime, slotContaining } from '../scheduler/window.ts'
import { beginScheduleBootstrap, endScheduleBootstrap, hydrateDirector } from '../director/cache.ts'
import { primeDirector } from '../director/director.ts'
import { markLiveUnavailable } from '../dynamic/runtime.ts'
import { loadUserLibraryMode, setUserLibraryMode, userLibraryMode } from '../library/mode.ts'
import { ensureDefaultNetwork, hydrateLibrary, ingestParsed, librarySnapshot, loadShippedIndependentCatalogue, recordPlaybackFailure, republishLibrary } from '../library/store.ts'
import { guideSlots } from '../services/broadcast.ts'
import { BUILT_IN_CATALOGUE_ID, bootstrapUserNetwork, readStarterTemplate } from '../data/user-network/bootstrap.ts'
import { claimStarterInstall, setStarterState, starterIds, starterState, withoutStarter } from '../data/user-network/starter.ts'
import {
  channelsFromSources,
  emptySlotRecord,
  migrateLegacyUserNumbers,
  planImport,
  type ParsedExport,
  type StoredSource,
} from '../services/channels-import.ts'
import { lookUpChannel } from '../services/add-channel.ts'
import { addChannelSource, clearUserChannel, planTestChannels, removeUserChannels as withoutUserChannels } from '../services/user-network.ts'
import { applyChannelEdit, editOf, rescanChannel, rescanSources, rescanSummary, widenSources, type ChannelEdit } from '../services/channel-editor.ts'
import { addChannelFromFile, buildChannelFile, channelFilename, readChannelFile, serialiseChannelFile } from '../services/channel-file.ts'
import { manifestText, userChannelManifest } from '../services/editorial-manifest.ts'
import type { SourceMode } from '../services/channel-curation.ts'
import type { ChannelSource } from '../services/channel-sources.ts'
import { buildCuratedEdit, clearCuratedEdit, curatedEditOf, loadCuratedEdit, loadCuratedEdits, saveCuratedEdit } from '../services/curated-edits.ts'
import { probeStream } from '../player/stream.ts'
import { isLiveStreamChannel } from '../dynamic/stream.ts'
import { editorScope } from '../view/channel-edit.ts'
import { loadOverrides, setVideoOverride, subscribeOverrides, videoOverride } from '../services/overrides.ts'
import { defaultFavouritesDue, loadPreferences, savePreferences } from '../services/preferences.ts'
import { placeStarterFavourites, starterFavouriteSources } from '../services/default-favourites.ts'
import {
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
import { currentEntryMode, surfsOnEntry } from './entry.ts'
import { createStartupRestore } from './startup-channel.ts'
import { commitTuned, emptyUniverseNote, randomTarget, stepTarget, type Tuned } from './tuning.ts'
import { browserCanPlay, buildSessionItems, commitImport, probeDuration } from '../session/import.ts'
import { SESSION_CHANNEL_NUMBER, hasPicture, rebaseSession, searchSession, sessionChoice, sessionRefresh, subscribeSession } from '../session/session-channel.ts'
import { independentNetworkLoaded, resolveStartupTuning, runStartup, startupAccepts, type StartupPhase } from './startup.ts'

/** RESTORE and channel-file IMPORT read YouTube sources at their own modes and add TVN's shipped back catalogue to ARCHIVE and ALL. */
const restoreDeps = {
  resolveYouTube: (url: string, options?: { mode?: SourceMode }) => lookUpChannel(url, fetch, { ...options }),
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
  type GuideToolState,
  type OverlayMode,
  type TvContextValue,
} from './tv-context.ts'

const INFO_MS = 6000
const VOLUME_MS = 1200
const NUMERIC_MS = 1600
const MIN_STATIC_MS = 520
const SETTLE_MS = 220
/** Loading shown after director cache, library, shipped network and user network; 100 once tuned. */
const STARTUP_STEPS = [10, 30, 75, 90] as const

/** Lay the viewer's saved changes to curated channels over the shipped ones, in this browser only. */
function installCurated() {
  const built: Channel[] = []
  const programmes = new Map<string, Programme[]>()
  for (const edit of Object.values(loadCuratedEdits())) {
    const shipped = shippedChannel(edit.channelNumber)
    if (!shipped) continue
    const made = buildCuratedEdit(shipped, edit, refusedVideos())
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

export function TvProvider({ children }: { children: ReactNode }) {
  setUserLibraryMode(loadUserLibraryMode())
  ensureDefaultNetwork()
  beginScheduleBootstrap()
  const [starterDue] = useState(() => claimStarterInstall())
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
  const [pictureWaiting, setPictureWaiting] = useState(false)
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
  const [pictureWait] = useState(() => createPictureWait(setPictureWaiting))
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
  const guideChannels = useMemo(() => {
    const listed = listChannels().filter((item) => channelMatchesFilter(item, guideFilter, favourites))
    return guideFilter === 'favourites' ? inFavouriteOrder(listed, favourites) : listed
  }, [catalogueVersion, favourites, guideFilter])
  const visibleChannels = useMemo(
    () => searchGuideChannels(guideChannels, guideQuery, (item, needle) => item.origin === 'session' && searchSession(needle).length > 0),
    [guideChannels, guideQuery],
  )
  const guideQueryRef = useRef(guideQuery)
  guideQueryRef.current = guideQuery

  volumeRef.current = volume
  mutedRef.current = muted
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
    if (!command.videoId || !refusedVideos().has(command.videoId)) return deliver(player, command)
    await deliver(player, { ...command, videoId: null, kind: 'holding' })
    setPlayerStatus('error')
    setPlayerDetail('150')
    return 'error' as const
  }

  const loadProgramme = async (target: Channel, nowMs: number) => {
    const load = ++loadToken.current
    const scheduleStart = performance.now()
    const airing = liveAiring(target, nowMs, videoOverride(target.number))
    notePhase(target.number, 'programmeAt', { scheduleMs: performance.now() - scheduleStart })
    loadedKey.current = airing.key
    const player = playerRef.current
    if (!player) return 'slate' as const
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

    if (target.number === origin) {
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
        const remain = MIN_STATIC_MS - (performance.now() - staticSince.current)
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
      },
      awaitPicture: pictureWait.wait,
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
      const watching = channelByNumber(channelRef.current)
      if (watching) {
        const nextFilter = guideFilterForChannel(watching, guideFilter, favourites)
        if (nextFilter !== guideFilter) setGuideFilter(nextFilter)
      }
      const now = Date.now()
      const nextWindow = windowAround(now)
      const nextCursor = { channelNumber: channelRef.current, timeMs: now }
      windowRef.current = nextWindow
      cursorRef.current = nextCursor
      setGuideWindow(nextWindow)
      setGuideCursor(nextCursor)
      setGuideNote(null)
    }
    guideModeRef.current = mode
    guideOpenRef.current = mode !== 'closed'
    setGuideMode(mode)
  }

  /**
   * MEDIA, IMPORT and ADD open the Guide where they happen: channel 000 for MEDIA, the foot of the User
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
    notePress(target.number)
    pictureWait.stop()
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
    if (!tuningRef.current) staticSince.current = performance.now()
    tuningRef.current = true
    setTuningNumber(number)
    playerRef.current?.setAudible(false, 0, true)
    window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(() => {
      void commitTuneRef.current(generation, number, origin)
    }, SETTLE_MS)
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
    const snap = onScreen(current, nowMs)
    const key = liveKey(current.id, snap.current.programme.id, snap.current.startMs)
    if (key === loadedKey.current) return
    loadedKey.current = key
    const player = playerRef.current
    if (!player) return
    const command = playbackCommand(snap.current.programme, snap.current.seekSeconds, videoOverride(current.number))
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
    // A publisher refusal is permanent: schedule without that video and retune in place.
    if (!videoId || !isRefusalCode(detail) || !learnRefusal(videoId)) return
    failureScopes.current.add(channel.origin === 'user-import' ? 'user' : 'library')
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
    pictureWait.stop()
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
        }
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
        await hydrateDirector().catch(() => undefined)
        reached(0)
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
    const built = channelsFromSources(sources, { refused: refusedVideos(), archive: uploaderArchive, users: userIds() })
    installUserCatalogue(built.channels, built.programmes)
    if (!channelByNumber(channelRef.current)) requestTune(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addChannel = useCallback(
    async (link: string, owner?: string) => {
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

  /** Add the starter network after the viewer's own channels; anything already present is left as it is. */
  const loadTestChannels = useCallback(
    async (automatic = false) => {
      if (automatic && starterState() !== 'pending') return ''
      const parsed = await readStarterTemplate()
      const existing = migrateLegacyUserNumbers(await loadStoredSources()).sources
      await ingestParsed(parsed, { filename: BUILT_IN_CATALOGUE_ID })
      const plan = planTestChannels(existing, parsed, Date.now(), uploaderIdFor)
      if (plan.added.length > 0) await saveStoredSources(plan.sources)
      setStarterState('installed')
      if (plan.added.length === 0) return 'THE STARTER NETWORK IS ALREADY INSTALLED'
      installSources(plan.sources)
      const range = plan.added.length === 1 ? `${plan.added[0]}` : `${plan.added[0]}–${plan.added[plan.added.length - 1]}`
      return `${plan.added.length} STARTER CHANNELS ADDED ON ${range}${plan.skipped > 0 ? ` · ${plan.skipped} ALREADY PRESENT` : ''}`
    },
    [installSources],
  )

  const starterRanRef = useRef(false)
  useEffect(() => {
    if (startupPhase !== 'ready' || (!starterDue && !favouritesSeeded) || starterRanRef.current) return
    starterRanRef.current = true
    const installed = starterDue ? loadTestChannels(true).catch(() => undefined) : Promise.resolve()
    if (!favouritesSeeded) return
    void installed
      .then(async () => {
        const expected = starterFavouriteSources(await readStarterTemplate(), uploaderIdFor)
        const sources = migrateLegacyUserNumbers(await loadStoredSources()).sources
        setFavourites((current) => placeStarterFavourites(current, expected, sources))
      })
      .catch(() => undefined)
  }, [startupPhase, starterDue, favouritesSeeded, loadTestChannels])

  const removeStarterNetwork = useCallback(async () => {
    const ids = starterIds(await readStarterTemplate())
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

  const openChannelEdit = useCallback(async (number: number): Promise<ChannelEdit | null> => {
    const { scope, shipped } = scopeOf(number)
    if (scope === 'curated') return curatedEditOf(shipped, loadCuratedEdit(number))
    const record = (await loadStoredSources()).find((item) => item.channelNumber === number)
    return record ? editOf(record) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveChannelEdit = useCallback(
    async (number: number, edit: ChannelEdit) => {
      const { scope, shipped } = scopeOf(number)
      if (scope === 'curated') {
        const saved = saveCuratedEdit(shipped, edit, Date.now())
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
        probeStream: (source: ChannelSource) => probeStream(source),
        uploaderOf: uploaderIdFor,
        archiveOf: sourceArchive,
      }
      const now = Date.now()
      if (scope === 'curated') {
        const sources = await rescanSources(edit.sources, deps, now)
        const next = { ...edit, sources }
        saveCuratedEdit(shipped, next, now)
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
    async (number: number, edit: ChannelEdit, as: 'json' | 'md') => {
      if (scopeOf(number).scope !== 'user') throw new Error('Only your own channels can be exported')
      // What the editor shows, unsaved changes included, on a copy: exporting never saves.
      const shown = applyChannelEdit(migrateLegacyUserNumbers(await loadStoredSources()).sources, number, { ...edit, sources: widenSources(edit.sources, sourceArchive) }, Date.now())
      const record = shown.find((item) => item.channelNumber === number)
      if (!record) throw new Error('That channel is no longer in your User Network')
      if (as === 'md') {
        downloadText(channelFilename(record, 'md'), manifestText(userChannelManifest(record), record), 'text/markdown')
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
    const here = channelByNumber(channelRef.current)
    if (!here || here.origin === 'session' || onScreen(here, Date.now()).current.programme.liveStream) return
    const target = stepFrom(here, Date.now(), direction)
    if (hasPicture(target.programme)) playFromGuide(here, target.programme, target)
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

  const value = useMemo<TvContextValue>(
    () => ({
      channel,
      previousChannel,
      canGoBack: canGoBack(history),
      canGoForward: canGoForward(history),
      startHold,
      visibleChannels,
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
      pictureWaiting,
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
      infoShortcuts,
      setInfoShortcut,
      resetInfoShortcuts,
      screenEdit,
      screenAction,
      screenStep,
      holdInfo,
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
      exportUserNetwork,
      importUserNetwork,
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
      exportUserNetwork,
      importUserNetwork,
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
      infoShortcuts,
      setInfoShortcut,
      resetInfoShortcuts,
      screenEdit,
      screenAction,
      screenStep,
      holdInfo,
      subtitles,
      syncLive,
      tuningNumber,
      pictureWaiting,
      visibleChannels,
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
