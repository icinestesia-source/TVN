import { useEffect, useImperativeHandle, useRef, type RefObject } from 'react'
import { CaptionController } from './captions.ts'
import { loadYouTubeApi } from './load-api.ts'
import { PLAYER_LOAD_TIMEOUT_MS, playingRequested } from './picture.ts'
import { notePlayback } from './trace.ts'
import type { LoadResult, PlayerHandle, PlayerLoadRequest, PlayerStatus } from './types.ts'
import type { YouTubePlayer } from '../types/youtube.ts'

interface YoutubeStageProps {
  playerRef: RefObject<PlayerHandle | null>
  onReady: () => void
  onStatus: (status: PlayerStatus, detail?: string) => void
  /** Non-focused multiview tiles ask YouTube for a smaller picture. */
  preview?: boolean
  /** The viewer's subtitle preference, applied to every video this player loads. */
  captions?: boolean
}

interface QueuedLoad {
  id: number
  request: PlayerLoadRequest
  resolve: (result: LoadResult) => void
}

export function YoutubeStage({ playerRef, onReady, onStatus, preview = false, captions = false }: YoutubeStageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const ytRef = useRef<YouTubePlayer | null>(null)
  const requestId = useRef(0)
  const loopRef = useRef(false)
  const holdRef = useRef(false)
  const resolveRef = useRef<((result: LoadResult) => void) | null>(null)
  const timeoutRef = useRef(0)
  const queuedRef = useRef<QueuedLoad | null>(null)
  const requestedRef = useRef<string | null>(null)
  const liveRequestRef = useRef(false)
  const watchRef = useRef(0)
  const onReadyRef = useRef(onReady)
  const onStatusRef = useRef(onStatus)
  const previewRef = useRef(preview)
  const executeRef = useRef<(id: number, request: PlayerLoadRequest) => void>(() => {})
  const captionsRef = useRef<CaptionController | null>(null)
  captionsRef.current ??= new CaptionController(captions)

  useEffect(() => {
    onReadyRef.current = onReady
    onStatusRef.current = onStatus
    previewRef.current = preview
  })

  useEffect(() => {
    const controller = captionsRef.current!
    if (controller.enabled !== captions) controller.setPreference(captions, ytRef.current)
  }, [captions])

  const finish = (id: number, result: LoadResult) => {
    if (id !== requestId.current) return
    window.clearTimeout(timeoutRef.current)
    const resolve = resolveRef.current
    resolveRef.current = null
    resolve?.(result)
  }

  const actualId = (player: YouTubePlayer | null): string | null => {
    const id = player?.getVideoData?.()?.video_id
    return id || null
  }

  const confirmLoaded = (id: number, player: YouTubePlayer) => {
    if (id !== requestId.current) return
    const requested = requestedRef.current
    const actual = actualId(player)
    notePlayback({ actualVideoId: actual, playerTime: player.getCurrentTime?.() ?? 0 })
    if (!requested) {
      window.clearInterval(watchRef.current)
      notePlayback({ playerState: 'slate', fallbackActive: true, fallbackReason: 'no playable source on this child' })
      onStatusRef.current('slate', 'no picture')
      finish(id, 'slate')
      return
    }
    if (actual !== requested) return
    if (liveRequestRef.current && (player.getVideoData?.() as { isLive?: boolean } | undefined)?.isLive === false) {
      window.clearInterval(watchRef.current)
      window.clearTimeout(timeoutRef.current)
      notePlayback({ playerState: 'error', actualVideoId: actual, lastError: 'stream is no longer live' })
      player.stopVideo()
      onStatusRef.current('error', 'stream is no longer live')
      finish(id, 'error')
      return
    }
    window.clearInterval(watchRef.current)
    window.clearTimeout(timeoutRef.current)
    // Loaded is not playing: YouTube shows its own still and play button until PLAYING, which onStateChange reports.
    notePlayback({ actualVideoId: actual, lastError: null })
    finish(id, 'playing')
  }

  const reportPlaying = (player: YouTubePlayer) => {
    const data = player.getVideoData?.() as { video_id?: string; isLive?: boolean } | undefined
    if (!playingRequested(requestedRef.current, data?.video_id || null, liveRequestRef.current, data?.isLive)) return
    notePlayback({ playerState: 'playing', actualVideoId: data?.video_id ?? null, lastError: null })
    onStatusRef.current('playing')
  }

  executeRef.current = (id: number, request: PlayerLoadRequest) => {
    const player = ytRef.current
    if (id !== requestId.current) return
    loopRef.current = request.loop
    holdRef.current = false
    window.clearInterval(watchRef.current)
    requestedRef.current = request.videoId
    liveRequestRef.current = Boolean(request.live)
    if (!player) {
      onStatusRef.current('slate', 'player missing')
      finish(id, 'slate')
      return
    }
    if (!request.videoId) {
      player.stopVideo()
      notePlayback({
        requestedVideoId: null,
        actualVideoId: null,
        playerState: 'slate',
        lastLoad: null,
        fallbackActive: true,
        fallbackReason: 'no playable source on this child',
      })
      onStatusRef.current('slate', 'no picture')
      finish(id, 'slate')
      return
    }

    window.clearTimeout(timeoutRef.current)
    timeoutRef.current = window.setTimeout(() => {
      if (id !== requestId.current) return
      const actual = actualId(player)
      notePlayback({
        playerState: 'error',
        actualVideoId: actual,
        lastError: actual === request.videoId ? 'timeout' : `player stayed on ${actual ?? 'nothing'}`,
      })
      player.stopVideo()
      onStatusRef.current('error', 'timeout')
      finish(id, 'error')
    }, PLAYER_LOAD_TIMEOUT_MS)

    const startSeconds = Number.isFinite(request.startSeconds)
      ? Math.max(0, Math.floor(request.startSeconds))
      : 0
    onStatusRef.current('buffering')
    notePlayback({
      requestedVideoId: request.videoId,
      expectedSeek: startSeconds,
      lastLoad: request.videoId,
      lastPlay: request.videoId,
      playerState: 'buffering',
    })
    captionsRef.current!.loadRequested()
    player.loadVideoById(request.live ? { videoId: request.videoId } : { videoId: request.videoId, startSeconds })
    watchRef.current = window.setInterval(() => confirmLoaded(id, player), 250)
  }

  useImperativeHandle(
    playerRef,
    (): PlayerHandle => ({
      load(request) {
        return new Promise<LoadResult>((resolve) => {
          resolveRef.current?.('slate')
          resolveRef.current = resolve
          const id = ++requestId.current
          if (!ytRef.current) {
            queuedRef.current = { id, request, resolve }
            return
          }
          executeRef.current(id, request)
        })
      },
      play() {
        holdRef.current = false
        ytRef.current?.playVideo()
      },
      pause() {
        holdRef.current = true
        ytRef.current?.pauseVideo()
      },
      seek(seconds: number) {
        const start = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
        ytRef.current?.seekTo(start, true)
      },
      setAudible(audible, volume, muted) {
        const player = ytRef.current
        if (!player) return
        if (!audible || muted || volume <= 0) {
          player.setVolume(0)
          player.mute()
          return
        }
        player.setVolume(volume)
        player.unMute()
      },
      currentTime() {
        const value = ytRef.current?.getCurrentTime()
        return typeof value === 'number' && Number.isFinite(value) ? value : 0
      },
      actualVideoId() {
        return actualId(ytRef.current)
      },
    }),
    [],
  )

  useEffect(() => {
    let destroyed = false
    let created: YouTubePlayer | null = null

    loadYouTubeApi()
      .then(() => {
        if (destroyed || !hostRef.current || !window.YT) return
        created = new window.YT.Player(hostRef.current, {
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            iv_load_policy: 3,
            playsinline: 1,
            cc_load_policy: captionsRef.current!.enabled ? 1 : 0,
            origin: window.location.origin,
          },
          events: {
            onReady: (event) => {
              if (destroyed) {
                event.target.destroy()
                return
              }
              ytRef.current = event.target
              const queued = queuedRef.current
              queuedRef.current = null
              if (queued && queued.id === requestId.current) {
                executeRef.current(queued.id, queued.request)
              }
              onReadyRef.current()
            },
            onStateChange: (event) => {
              if (event.data === 3) {
                notePlayback({ playerState: 'buffering' })
                onStatusRef.current('buffering')
              }
              if (event.data === 2) onStatusRef.current('paused')
              if (event.data === 5) notePlayback({ playerState: 'cued', lastCue: requestedRef.current })
              if (event.data === 1) captionsRef.current!.videoPlaying(event.target)
              if (event.data === 1 || event.data === 5) {
                if (previewRef.current && event.data === 1) event.target.setPlaybackQuality?.('small')
                confirmLoaded(requestId.current, event.target)
              }
              if (event.data === 1) reportPlaying(event.target)
              if (event.data === 0 && loopRef.current && !holdRef.current) {
                event.target.seekTo(0, true)
                event.target.playVideo()
              } else if (event.data === 0 && (actualId(event.target) ?? requestedRef.current) === requestedRef.current) {
                // An ENDED from a video the player has since been asked to leave is stale.
                onStatusRef.current('ended')
              }
            },
            onApiChange: (event) => captionsRef.current!.modulesChanged(event.target),
            onError: (event) => {
              // An error while the player is still on another video than the one last asked for is that video's.
              const actual = actualId(event.target)
              if (actual && requestedRef.current && actual !== requestedRef.current) return
              window.clearInterval(watchRef.current)
              notePlayback({ playerState: 'error', lastError: String(event.data) })
              event.target.stopVideo()
              onStatusRef.current('error', String(event.data))
              finish(requestId.current, 'error')
            },
          },
        })
      })
      .catch(() => {
        if (destroyed) return
        onStatusRef.current('error', 'api unavailable')
        queuedRef.current?.resolve('error')
        queuedRef.current = null
        onReadyRef.current()
      })

    return () => {
      destroyed = true
      window.clearTimeout(timeoutRef.current)
      window.clearInterval(watchRef.current)
      created?.destroy()
      ytRef.current = null
    }
  }, [])

  return <div className="yt-host" ref={hostRef} />
}
