import type { Dispatch, RefObject, SetStateAction } from 'react'
import { startupAccepts, type StartupPhase } from '../startup.ts'
import { GUIDE_KEY_ZOOM, INFO_MS, NUMERIC_MS, SCHEDULE_WORKING, SCREEN_EDIT_COMMANDS, SOUND_RELEASE_MS, VOLUME_MS } from './shared.ts'
import { channelByNumber, listChannels } from '../../data/catalogue.ts'
import { isOffAir } from '../../data/off-air.ts'
import { tunerStep } from '../../input/tuner.ts'
import { emptyUniverseNote, randomTarget, stepTarget, type Tuned } from '../tuning.ts'
import { isLiveStreamChannel } from '../../dynamic/stream.ts'
import { historyStep, type ViewingHistory } from '../history.ts'
import { clampGuideSplit, type GuideMode } from '../../view/guide-mode.ts'
import { PIP_SIZE_STEP, cycleMultiview, focusStep, gridDelta, loadPipChannel, multiviewLayout, planMultiview } from '../../view/multiview.ts'
import { clearManual, manualAiring, onScreen, seekable } from '../../player/manual.ts'
import { holdPausedClip, resumeFromPause } from '../../view/resume-from-pause.ts'
import { clipFlags } from '../../view/clip-flags.ts'
import { guideTabLabel, nextGuideTab } from '../guide-tabs.ts'
import { SLEEP_CHOICES, nextSleepMinutes } from '../sleep.ts'
import { pauseViewing } from '../../player/viewing.ts'
import { subtitlesNotice } from '../../player/captions.ts'
import { volumeLimit } from '../../player/volume.ts'
import { hasPicture, isLocalMediaNumber } from '../../session/session-channel.ts'
import { clamp, padChannel } from '../../utils/time.ts'
import { fullscreenAvailable } from '../../view/info-shortcuts.ts'
import { bookmarkFor, toggleBookmark } from '../../view/bookmarks-store.ts'
import { editorScope } from '../../view/channel-edit.ts'
import { clampZoom } from '../../epg/zoom.ts'
import { GUIDE_EXTEND_MS, GUIDE_MAX_WINDOW_MS, windowAround } from '../../epg/geometry.ts'
import { stepGuideChannel } from '../../epg/navigation.ts'
import { guideSlots } from '../../services/broadcast.ts'
import { adjacentSlotTime } from '../../scheduler/window.ts'
import type { GuideTool, TvCommand } from '../../types/input.ts'
import type { LoadResult, PlayerHandle } from '../../player/types.ts'
import type { GuideFilter, MultiviewMode } from '../../types/preferences.ts'
import type { GuideCursor, GuideNote, GuideToolState, OverlayMode } from '../tv-context.ts'
import type { GuideRun } from '../../services/viewing-guides.ts'
import type { StartupRestore } from '../startup-channel.ts'
import type { NetworkUser } from '../../data/user-network/users.ts'
import type { Programme } from '../../types/programme.ts'
import type { Channel } from '../../types/channel.ts'

export interface TvCommandDeps {
  dispatchRef: RefObject<(command: TvCommand) => void>
  phaseRef: RefObject<StartupPhase>
  activityRef: RefObject<number>
  asleepRef: RefObject<boolean>
  wake: () => void
  sleepWarnedRef: RefObject<boolean>
  setNotice: Dispatch<SetStateAction<string | null>>
  screenEditRef: RefObject<number | null>
  closeScreenEdit: (quiet?: boolean) => void
  tokenRef: RefObject<number>
  settleTimer: RefObject<number>
  tuningRef: RefObject<boolean>
  pendingOrigin: RefObject<number | null>
  pendingNumberRef: RefObject<number | null>
  staticSince: RefObject<number>
  setTuningNumber: Dispatch<SetStateAction<number | null>>
  playerRef: RefObject<PlayerHandle | null>
  volumeRef: RefObject<number>
  mutedRef: RefObject<boolean>
  bufferRef: RefObject<string>
  setNumeric: Dispatch<SetStateAction<string>>
  numericTimer: RefObject<number>
  commitNumericRef: RefObject<() => void>
  tuned: () => Tuned
  guideFilter: GuideFilter
  favourites: number[]
  tilesRef: RefObject<number[]>
  audioFocusRef: RefObject<number>
  multiviewRef: RefObject<MultiviewMode>
  flash: (message: string, ms?: number) => void
  requestTune: (number: number, keepPick?: boolean) => void
  toggleSurf: () => void
  guideOpenRef: RefObject<boolean>
  screenStep: (direction: 1 | -1) => void
  channelRef: RefObject<number>
  previousRef: RefObject<number | null>
  historyAimRef: RefObject<number | null>
  historyRef: RefObject<ViewingHistory>
  historyNavRef: RefObject<number | null>
  editingRef: RefObject<() => boolean>
  activateGuide: (options?: { fromStart?: boolean | undefined } | undefined) => void
  setMultiviewMode: Dispatch<SetStateAction<MultiviewMode>>
  setMultiviewPage: Dispatch<SetStateAction<number>>
  loadedKey: RefObject<string>
  showOverlay: (mode: OverlayMode, ms: number) => void
  debugOpen: boolean
  setDebugOpen: Dispatch<SetStateAction<boolean>>
  remoteOpen: boolean
  setRemoteOpen: Dispatch<SetStateAction<boolean>>
  setSmart: (on: boolean) => void
  panelOpenRef: RefObject<() => GuideTool | null>
  closeGuideTool: () => void
  closeGuide: () => void
  creditsRef: RefObject<boolean>
  setCreditsOn: (on: boolean) => void
  setOverlay: Dispatch<SetStateAction<OverlayMode>>
  guideModeRef: RefObject<GuideMode>
  openGuide: (mode: GuideMode) => void
  guideToolRef: RefObject<GuideToolState | null>
  guideRunRef: RefObject<GuideRun | null>
  openGuideTool: (kind: GuideTool, channelNumber?: number | undefined) => void
  setGuideSplit: Dispatch<SetStateAction<number>>
  guideEngine: RefObject<{ advance: (_finished: boolean) => void; skipFailed: (_channelNumber: number) => boolean; suspend: () => void; step: (_direction: 1 | -1) => void }>
  setTiles: Dispatch<SetStateAction<number[]>>
  setAudioFocus: Dispatch<SetStateAction<number>>
  startup: StartupRestore
  commitChannel: (next: Tuned, record?: boolean) => void
  selectTile: (index: number) => number | undefined
  setGuideFilter: Dispatch<SetStateAction<GuideFilter>>
  usersRef: RefObject<NetworkUser[]>
  smartRef: RefObject<boolean>
  sleepMinutesRef: RefObject<number>
  setSleepMinutes: Dispatch<SetStateAction<number>>
  setPipSize: (size: number) => number
  pipSizeRef: RefObject<number>
  overlay: OverlayMode
  pausedRef: RefObject<boolean>
  resumeViewing: () => void
  pausedWebRef: RefObject<{ channelNumber: number; programme: Programme; elapsedSeconds: number; slot: { startMs: number; endMs: number } } | null>
  setPaused: Dispatch<SetStateAction<boolean>>
  soundReleasedAt: RefObject<number>
  setMuted: Dispatch<SetStateAction<boolean>>
  subtitlesRef: RefObject<boolean>
  setSubtitles: Dispatch<SetStateAction<boolean>>
  setVolume: Dispatch<SetStateAction<number>>
  cursorRef: RefObject<GuideCursor>
  favouritesRef: RefObject<number[]>
  setFavourites: Dispatch<SetStateAction<number[]>>
  scheduleBusyRef: RefObject<boolean>
  reloadChannel: (number: number) => Promise<string>
  arrangeChannel: (number: number, asked: "latest" | "latest-now" | "az" | "random" | "reset") => Promise<string>
  exportTvn: () => Promise<string>
  setGuideZoomState: Dispatch<SetStateAction<number>>
  nowCursorRef: RefObject<GuideCursor | null>
  playerReadyRef: RefObject<boolean>
  loadProgramme: (target: Channel, nowMs: number) => Promise<LoadResult>
  setGuideCursor: Dispatch<SetStateAction<GuideCursor>>
  setGuideNowAsk: Dispatch<SetStateAction<number>>
  windowRef: RefObject<{ startMs: number; endMs: number }>
  setGuideWindow: Dispatch<SetStateAction<{ startMs: number; endMs: number }>>
  setGuideNote: Dispatch<SetStateAction<GuideNote>>
  setHintsOn: Dispatch<SetStateAction<boolean>>
  visibleRef: RefObject<Channel[]>
}

/** What every command does: each key, remote button, gesture and on-screen control arrives here as a TvCommand. */
export function useTvCommands({
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
}: TvCommandDeps) {
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
        let target = stepTarget(tuned(), pending, command.type === 'channel-up' ? 1 : -1, { filter: guideFilter, favourites })
        // In Multi View the selected picture steps past the other pictures' channels, and past local media and live
        // streams, which play in single view only.
        const others = tilesRef.current.filter((_, index) => index !== audioFocusRef.current)
        for (let hops = 0; multiviewRef.current !== '1' && target !== null && hops < 2000; hops += 1) {
          const next = channelByNumber(target)
          if (!next || (next.origin !== 'session' && !isLiveStreamChannel(next) && !others.includes(target))) break
          target = stepTarget({ channelNumber: target, previousNumber: null }, null, command.type === 'channel-up' ? 1 : -1, { filter: guideFilter, favourites })
        }
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
        const delta = command.type === 'history-back' ? -1 : 1
        const step = historyStep(from, delta)
        if (step && channelByNumber(step.channelNumber)) {
          historyNavRef.current = step.index
          requestTune(step.channelNumber)
          break
        }
        // Nothing remembered that way: N goes up a channel, and B down one, as the channel keys do.
        const pending = tuningRef.current ? pendingNumberRef.current : null
        const target = stepTarget(tuned(), pending, delta, { filter: guideFilter, favourites })
        if (target === null) flash(emptyUniverseNote(guideFilter))
        else requestTune(target)
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
        else if (remoteOpen) {
          setRemoteOpen(false)
          setSmart(false)
        }
        else if (screenEditRef.current !== null) closeScreenEdit()
        else if (guideOpenRef.current && (editingRef.current() || panelOpenRef.current())) closeGuideTool()
        else if (guideOpenRef.current) {
          closeGuide()
          showOverlay('info', INFO_MS)
        } else if (creditsRef.current) setCreditsOn(false)
        else setOverlay('none')
        break
      case 'guide':
        if (command.listings) {
          // The broadcast listings at NOW; a Map being played goes on playing.
          if (guideModeRef.current === 'closed') openGuide('expanded')
          else if (guideToolRef.current) closeGuideTool()
          break
        }
        if (guideModeRef.current === 'closed') openGuide('expanded')
        else {
          closeGuide()
          showOverlay('info', INFO_MS)
          break
        }
        // A Map being played opens with its schedule in view, not behind a menu.
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
        if (command.mode === '1' && multiviewRef.current === '1') break
        guideEngine.current.suspend()
        const nextMode = command.mode ?? cycleMultiview(multiviewRef.current)
        const ordered = listChannels()
          .filter((item) => item.enabled && item.origin !== 'session' && !isLiveStreamChannel(item) && !isOffAir(item.number))
          .map((item) => item.number)
        const from = multiviewRef.current
        const plan = planMultiview(from, nextMode, channelRef.current, tilesRef.current, audioFocusRef.current, ordered, from === '1' ? loadPipChannel() : null)
        if (nextMode === '1') {
          multiviewRef.current = '1'
          setMultiviewMode('1')
          setMultiviewPage(0)
          if (plan.focus !== channelRef.current) requestTune(plan.focus)
          else loadedKey.current = ''
          break
        }
        clearManual()
        tilesRef.current = plan.tiles
        setTiles(plan.tiles)
        audioFocusRef.current = plan.audioFocus
        setAudioFocus(plan.audioFocus)
        const heard = plan.tiles[plan.audioFocus] ?? plan.focus
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
      case 'guide-cycle': {
        // ♡ is the tab after FAV while the Guide is up, then ⚑ while there are flags; from there the round starts again at ALL.
        if (guideOpenRef.current && panelOpenRef.current() === 'bookmarks' && clipFlags().length > 0) {
          openGuideTool('flags')
          break
        }
        if (guideOpenRef.current && (panelOpenRef.current() === 'bookmarks' || panelOpenRef.current() === 'flags')) {
          closeGuideTool()
          setGuideFilter('all')
          break
        }
        const next = nextGuideTab(guideFilter, usersRef.current.map((user) => user.id))
        if (guideOpenRef.current && guideFilter === 'favourites' && next === 'all') {
          openGuideTool('bookmarks')
          break
        }
        setGuideFilter(next)
        if (!guideOpenRef.current) flash(`GUIDE · ${guideTabLabel(next, usersRef.current)}`)
        break
      }
      case 'user-channels':
        setGuideFilter('user')
        if (guideModeRef.current === 'closed') openGuide('expanded')
        break
      case 'tune':
        requestTune(command.channelNumber)
        break
      case 'remote':
        setRemoteOpen((open) => !open)
        setSmart(false)
        break
      case 'smart':
        if (!smartRef.current) setRemoteOpen(true)
        setSmart(!smartRef.current)
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
      case 'pip-size': {
        if (multiviewRef.current !== 'pip') break
        const size = setPipSize(pipSizeRef.current + command.step * PIP_SIZE_STEP)
        flash(`PICTURE IN PICTURE · ${size}%`, 1200)
        break
      }
      case 'info':
        // V (or a tap on the picture) shows the information bar, and closes it again while it is up.
        if (overlay === 'info') showOverlay('none', 0)
        else showOverlay('info', INFO_MS)
        break
      case 'play-pause':
        if (pausedRef.current) resumeViewing()
        else {
          const here = channelByNumber(channelRef.current)
          const airing = here ? onScreen(here, Date.now()).current : null
          pausedWebRef.current =
            here && airing && (airing.programme.programmeType === 'website' || airing.programme.programmeType === 'social-post')
              ? { channelNumber: here.number, programme: airing.programme, elapsedSeconds: airing.elapsedSeconds, slot: { startMs: airing.startMs, endMs: airing.endMs } }
              : null
          // Playback on: remember where this clip actually is, so unpausing does not jump to the Guide.
          const at = playerRef.current?.currentTime()
          const seconds = typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : airing?.seekSeconds
          holdPausedClip(
            resumeFromPause() && here && airing && seekable(here, airing.programme) && seconds !== undefined
              ? { channelNumber: here.number, programme: airing.programme, seconds, slot: { startMs: airing.startMs, endMs: airing.endMs } }
              : null,
          )
          pausedRef.current = true
          setPaused(true)
          pauseViewing(playerRef.current)
        }
        break
      case 'mute': {
        // The press that released the browser's sound hold was the viewer asking for sound, which reads as Muted.
        if (!mutedRef.current && Date.now() - soundReleasedAt.current < SOUND_RELEASE_MS) {
          soundReleasedAt.current = 0
          playerRef.current?.setAudible(!tuningRef.current, volumeRef.current, false)
          showOverlay('volume', VOLUME_MS)
          break
        }
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
        const limit = volumeLimit(isLocalMediaNumber(channelRef.current) && multiviewRef.current === '1')
        const nextVolume = clamp(volumeRef.current + delta, 0, limit)
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
        const adding = !favouritesRef.current.includes(number)
        favouritesRef.current = adding ? [...favouritesRef.current, number] : favouritesRef.current.filter((item) => item !== number)
        setFavourites((current) =>
          current.includes(number) ? current.filter((item) => item !== number) : [...current, number],
        )
        // A (or the remote) says what it did; a star pressed in the Guide shows it in place.
        if (command.channelNumber === undefined) flash(adding ? `★ FAVOURITE · ${padChannel(number)}` : `☆ FAVOURITE REMOVED · ${padChannel(number)}`, 1400)
        break
      }
      case 'bookmark': {
        // The clip selected in the Guide, or the one on screen.
        const number = guideOpenRef.current ? cursorRef.current.channelNumber : channelRef.current
        const target = channelByNumber(number)
        if (!target) break
        const { programme } = onScreen(target, guideOpenRef.current ? cursorRef.current.timeMs : Date.now()).current
        if (programme.liveStream !== undefined || !hasPicture(programme)) {
          flash('NOTHING TO BOOKMARK HERE', 1400)
          break
        }
        const on = toggleBookmark(bookmarkFor(target, programme))
        flash(on ? `♥\uFE0E BOOKMARKED · ${programme.title}` : `BOOKMARK REMOVED · ${programme.title}`, 1600)
        break
      }
      case 'debug':
        setDebugOpen((open) => !open)
        break
      case 'guide-filter': {
        const nextFilter = command.filter ?? (guideFilter === 'favourites' ? 'all' : 'favourites')
        if (panelOpenRef.current() === 'bookmarks' || panelOpenRef.current() === 'flags' || (guideOpenRef.current && editingRef.current())) closeGuideTool()
        setGuideFilter(nextFilter)
        break
      }
      case 'schedule': {
        if (scheduleBusyRef.current) break
        const number = command.channelNumber ?? (guideOpenRef.current ? cursorRef.current.channelNumber : channelRef.current)
        const target = channelByNumber(number)
        if (!target || !editorScope(target) || target.origin === 'session') {
          flash(`${padChannel(number)} · THIS CHANNEL'S SCHEDULE CANNOT BE CHANGED HERE`, 2200)
          break
        }
        const work = command.action === 'reload' ? reloadChannel(number) : arrangeChannel(number, command.action)
        scheduleBusyRef.current = true
        flash(`${padChannel(number)} · ${SCHEDULE_WORKING[command.action]}`, 60_000)
        work
          .then(
            (message) => flash(`${padChannel(number)} · ${message}`, 2600),
            (caught: unknown) => flash(`${padChannel(number)} · ${caught instanceof Error && caught.message ? caught.message.toUpperCase().slice(0, 110) : 'THAT DID NOT WORK'}`, 2600),
          )
          .finally(() => {
            scheduleBusyRef.current = false
          })
        break
      }
      case 'export-all':
        void exportTvn().then(
          (message) => flash(message, 2600),
          () => flash('EXPORT ALL DID NOT WORK', 2600),
        )
        break
      case 'guide-zoom':
        // From here the viewer's zoom stands until the Guide is opened afresh.
        if (guideOpenRef.current) setGuideZoomState((zoom) => clampZoom(zoom * (command.direction > 0 ? GUIDE_KEY_ZOOM : 1 / GUIDE_KEY_ZOOM)))
        break
      case 'guide-now': {
        // A second NOW, the cursor still where the first left it, goes back to the playing picture.
        if (guideOpenRef.current && nowCursorRef.current !== null && cursorRef.current === nowCursorRef.current && manualAiring(channelRef.current, Date.now()) === null) {
          nowCursorRef.current = null
          closeGuide()
          showOverlay('info', INFO_MS)
          break
        }
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
        // NOW is the channel playing, at the current time, centred in the listings.
        const nextCursor = { channelNumber: channelRef.current, timeMs: now }
        cursorRef.current = nextCursor
        nowCursorRef.current = nextCursor
        setGuideCursor(nextCursor)
        setGuideNowAsk((asked) => asked + 1)
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
}
