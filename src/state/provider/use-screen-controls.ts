import { useCallback, useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { channelByNumber } from '../../data/catalogue.ts'
import { clearManual, manualAiring, onScreen, seekable, selectProgramme, stepFrom } from '../../player/manual.ts'
import { INFO_MS, type SessionControls } from './shared.ts'
import { hasPicture, rebaseSession, sessionNeighbour } from '../../session/session-channel.ts'
import {
  DEFAULT_SHORTCUTS,
  assignShortcut,
  networkFilterOf,
  randomScoped,
  type Corner,
  type ShortcutAssignment,
  type ShortcutId,
} from '../../view/info-shortcuts.ts'
import { filterUserId, userNetworkName, type NetworkUser } from '../../data/user-network/users.ts'
import { asSurfRange, saveSurfOn, saveSurfRange, saveSurfUntilEnd, type SurfRange } from '../surf.ts'
import { asTransitionSettings, saveTransitionSettings, type Presentation, type TransitionSettings } from '../transitions.ts'
import type { GuideFilter, MultiviewMode } from '../../types/preferences.ts'
import type { LoadResult, PlayerHandle } from '../../player/types.ts'
import type { Channel } from '../../types/channel.ts'
import type { OverlayMode } from '../tv-context.ts'
import type { GuideRun } from '../../services/viewing-guides.ts'
import type { Programme } from '../../types/programme.ts'

export interface ScreenControlDeps {
  channelRef: RefObject<number>
  sessionRef: RefObject<SessionControls>
  loadedKey: RefObject<string>
  pausedRef: RefObject<boolean>
  setPaused: Dispatch<SetStateAction<boolean>>
  playerRef: RefObject<PlayerHandle | null>
  playerReadyRef: RefObject<boolean>
  loadProgramme: (target: Channel, nowMs: number) => Promise<LoadResult>
  showOverlay: (mode: OverlayMode, ms: number) => void
  multiviewRef: RefObject<MultiviewMode>
  showSession: (number: number, keepGuide?: boolean) => void
  guideDrivingRef: RefObject<boolean>
  guideRunRef: RefObject<GuideRun | null>
  guideEngine: RefObject<{ advance: (_finished: boolean) => void; skipFailed: (_channelNumber: number) => boolean; suspend: () => void; step: (_direction: 1 | -1) => void }>
  chooseAnotherOnTvn: () => void
  playFromGuide: (target: Channel, programme: Programme, slot?: { startMs: number; endMs: number } | undefined, fromSeconds?: number) => void
  guideFilter: GuideFilter
  channelNumber: number
  networkUsers: NetworkUser[]
  setGuideFilter: Dispatch<SetStateAction<GuideFilter>>
  flash: (message: string, ms?: number) => void
  toggleSurfScopeRef: RefObject<() => void>
  overlayTimer: RefObject<number>
  setOverlay: Dispatch<SetStateAction<OverlayMode>>
  activityRef: RefObject<number>
  surfingRef: RefObject<boolean>
  setSurfing: Dispatch<SetStateAction<boolean>>
  setSurfUntilEndState: Dispatch<SetStateAction<boolean>>
  setSurfRangeState: Dispatch<SetStateAction<SurfRange>>
  transitionRef: RefObject<TransitionSettings>
  setTransitionState: Dispatch<SetStateAction<TransitionSettings>>
  presentationRef: RefObject<Presentation | null>
  setPresentation: Dispatch<SetStateAction<Presentation | null>>
  setInfoShortcuts: Dispatch<SetStateAction<ShortcutAssignment>>
}

/** The picture's own controls and TV Surf: Watch, seek and step over the picture, surf scope and range, the transition and the information bar's corners. */
export function useScreenControls({
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
}: ScreenControlDeps) {
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
  /**
   * The information bar's time slider: the programme on screen from this many seconds in. Local Media moves
   * its running order; anything else plays on as a Guide pick that started earlier, continuing as one does.
   */
  const screenSeek = useCallback((seconds: number) => {
    const here = channelByNumber(channelRef.current)
    if (!here || multiviewRef.current !== '1') return
    const now = Date.now()
    const shown = onScreen(here, now).current
    if (!seekable(here, shown.programme)) return
    const target = Math.max(0, Math.min(seconds, shown.programme.durationSeconds - 1))
    if (here.origin === 'session') {
      if (rebaseSession(shown.programme.id, now - target * 1000)) showSession(here.number, true)
      return
    }
    const manual = manualAiring(here.number, now)
    const slot = manual ? manual.slot : { startMs: shown.startMs, endMs: shown.endMs }
    const continues = slot && !guideDrivingRef.current ? here : undefined
    selectProgramme(here.number, shown.programme, now, slot, continues, target)
    loadedKey.current = ''
    pausedRef.current = false
    setPaused(false)
    if (playerRef.current && playerReadyRef.current) void loadProgramme(here, now)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    if (here?.origin === 'session') {
      const target = sessionNeighbour(Date.now(), direction, here.number)
      if (target) sessionRef.current.play(target.id)
      return
    }
    if (!here || onScreen(here, Date.now()).current.programme.liveStream) return
    const target = stepFrom(here, Date.now(), direction)
    if (hasPicture(target.programme)) playFromGuide(here, target.programme, target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // TV Surf covers ALL, or one User Network: the one chosen, else the one it was last narrowed to, else the channel's own.
  const [surfNetwork, setSurfNetwork] = useState<GuideFilter | null>(null)
  const surfTarget: GuideFilter = randomScoped(guideFilter) ? guideFilter : (surfNetwork ?? networkFilterOf(channelByNumber(channelNumber)))
  const surfScopeName = userNetworkName(filterUserId(surfTarget) ?? undefined, networkUsers)
  /** TV Surf's right-click or hold: surf ALL, or only the selected network. The Guide's tab follows, as Random from does. */
  const toggleSurfScope = useCallback(() => {
    if (randomScoped(guideFilter)) {
      setSurfNetwork(guideFilter)
      setGuideFilter('all')
      flash('SURF · ALL')
    } else {
      setGuideFilter(surfTarget)
      flash(`SURF · ${surfScopeName.toUpperCase()} ONLY`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideFilter, surfTarget, surfScopeName])
  useEffect(() => {
    toggleSurfScopeRef.current = toggleSurfScope
  }, [toggleSurfScope])

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

  const setSurfUntilEnd = useCallback((untilEnd: boolean) => {
    saveSurfUntilEnd(untilEnd)
    setSurfUntilEndState(untilEnd)
    flash(untilEnd ? 'TVN SURF · WAITS FOR EACH PROGRAMME TO END' : 'TVN SURF · HOPS AFTER THE RANDOM WAIT', 1600)
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
  return {
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
  }
}
