import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { channelByNumber } from '../../data/catalogue.ts'
import { manualAiring, onScreen } from '../../player/manual.ts'
import { TVN_CHANNEL_NUMBER, driveTvn, endedTvn, tvnChoice } from '../../tvn/tvn-channel.ts'
import { liveKey } from '../../scheduler/calculate.ts'
import { playbackCommand, type PlaybackCommand } from '../../player/command.ts'
import { videoOverride } from '../../services/overrides.ts'
import { notePlayback } from '../../player/trace.ts'
import { recordPlaybackFailure, republishLibrary } from '../../library/store.ts'
import { loadStoredSources } from '../../services/user-db.ts'
import { channelsFromSources, migrateLegacyUserNumbers } from '../../services/channels-import.ts'
import { isRefusalCode, learnRefusal, refusedVideos } from '../../services/embed-refusals.ts'
import { uploaderArchive } from '../../services/user-archive.ts'
import { installUserCatalogue } from '../../data/user-overlay.ts'
import { notePhase } from '../../player/tune-timing.ts'
import { guideEndAdvances } from '../../view/guide-following.ts'
import { markLiveUnavailable } from '../../dynamic/runtime.ts'
import { liveAiring } from '../../player/viewing.ts'
import type { LoadResult, PlayerHandle, PlayerStatus } from '../../player/types.ts'
import type { MultiviewMode } from '../../types/preferences.ts'
import type { GuideRun } from '../../services/viewing-guides.ts'
import type { Channel } from '../../types/channel.ts'
import type { Recovery } from '../../player/refusal-fallback.ts'

export interface PlayerEventDeps {
  multiviewRef: RefObject<MultiviewMode>
  tuningRef: RefObject<boolean>
  pausedRef: RefObject<boolean>
  playerReadyRef: RefObject<boolean>
  bootedRef: RefObject<boolean>
  channelRef: RefObject<number>
  guideRunRef: RefObject<GuideRun | null>
  guideEngine: RefObject<{ advance: (_finished: boolean) => void; skipFailed: (_channelNumber: number) => boolean; suspend: () => void; step: (_direction: 1 | -1) => void }>
  passRefused: (target: Channel, nowMs: number) => boolean
  loadedKey: RefObject<string>
  presentTvnSurf: () => void
  playerRef: RefObject<PlayerHandle | null>
  askedRef: RefObject<{ channelNumber: number; videoId: string | null } | null>
  pictureLiveRef: RefObject<boolean>
  loadToken: RefObject<number>
  deliverLive: (player: PlayerHandle, command: PlaybackCommand, channelNumber: number) => Promise<LoadResult>
  catalogueReadyRef: RefObject<boolean>
  bootRef: RefObject<() => void>
  loadProgramme: (target: Channel, nowMs: number) => Promise<LoadResult>
  failureTimer: RefObject<number>
  failuresRef: RefObject<{ videoId: string; reason: string }[]>
  failureScopes: RefObject<Set<"library" | "user">>
  userIds: () => Set<string>
  setPlayerStatus: Dispatch<SetStateAction<PlayerStatus>>
  setPlayerDetail: Dispatch<SetStateAction<string>>
  setPictureLive: Dispatch<SetStateAction<boolean>>
  setStartupSettled: Dispatch<SetStateAction<boolean>>
  setPictureChannel: Dispatch<SetStateAction<number | null>>
  watchingNumber: () => number
  recoveryRef: RefObject<Recovery | null>
  recoverRef: RefObject<(channelNumber: number, cause: "refused" | "unplayable") => void>
  volumeRef: RefObject<number>
  mutedRef: RefObject<boolean>
}

/** What the player reports back: ready, playing, refused or failed, and the live position kept in step with the schedule. */
export function usePlayerEvents({
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
  volumeRef,
  mutedRef,
}: PlayerEventDeps) {

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
    const sampled = current.origin === 'tvn' ? tvnChoice() : null
    if (current.origin === 'tvn') driveTvn(nowMs)
    passRefused(current, nowMs)
    const snap = onScreen(current, nowMs)
    const key = liveKey(current.id, snap.current.programme.id, snap.current.startMs)
    if (key === loadedKey.current) return
    loadedKey.current = key
    if (sampled && tvnChoice() !== sampled) presentTvnSurf()
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
    // A player built again (leaving MULTI) starts at the provider's own volume, not the viewer's.
    playerRef.current?.setAudible(!tuningRef.current, volumeRef.current, mutedRef.current)
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
          installUserCatalogue(built.channels, built.programmes, built.subChannels)
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
      // 000's sampled programme ending for real surfs on at once; an ENDED from a video it has left is ignored.
      if (asked?.channelNumber === TVN_CHANNEL_NUMBER && watching === TVN_CHANNEL_NUMBER && multiviewRef.current === '1' && !tuningRef.current && endedTvn(Date.now(), asked.videoId)) {
        loadedKey.current = ''
        syncLive(Date.now())
      }
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
  return { syncLive, onPlayerReady, onPlayerStatus }
}
