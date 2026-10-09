import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { CaptionController } from './captions.ts'
import { loadYouTubeApi } from './load-api.ts'
import { PLAYER_LOAD_TIMEOUT_MS, playingRequested } from './picture.ts'
import { shieldProviderFrame } from './picture-shield.ts'
import { notePlayback } from './trace.ts'
import type { LoadResult, PlayerHandle, PlayerLoadRequest, PlayerStatus } from './types.ts'
import type { YouTubePlayer } from '../types/youtube.ts'
import { qualityFrame, useDisplayQuality } from '../view/display-quality.ts'
import { containedBox, leavesEdges, shapedThumbnail, useFillEdges, youtubeAspect } from '../view/fill-edges.ts'
import { VOLUME_FULL } from './volume.ts'

interface YoutubeStageProps {
  playerRef: RefObject<PlayerHandle | null>
  onReady: () => void
  onStatus: (status: PlayerStatus, detail?: string) => void
  /** Non-focused multiview tiles ask YouTube for a smaller picture. */
  preview?: boolean
  /** The viewer's subtitle preference, applied to every video this player loads. */
  captions?: boolean
}

const RESUME_DELAYS_MS = [300, 1200, 4000]

interface QueuedLoad {
  id: number
  request: PlayerLoadRequest
  resolve: (result: LoadResult) => void
}

export function YoutubeStage({ playerRef, onReady, onStatus, preview = false, captions = false }: YoutubeStageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const quality = useDisplayQuality()
  const fill = useFillEdges() && !preview
  const [slotSize, setSlotSize] = useState({ width: 0, height: 0 })
  const [shownId, setShownId] = useState<string | null>(null)
  const [shape, setShape] = useState<{ videoId: string; aspect: number | null } | null>(null)
  useEffect(() => {
    const slot = frameRef.current?.parentElement
    if (!slot || (quality === 'auto' && !fill) || preview || typeof ResizeObserver === 'undefined') return
    const measure = () => setSlotSize({ width: slot.clientWidth, height: slot.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(slot)
    return () => observer.disconnect()
  }, [quality, preview, fill])
  useEffect(() => {
    if (!fill || !shownId) return
    let live = true
    void youtubeAspect(shownId).then((aspect) => {
      if (live) setShape({ videoId: shownId, aspect })
    })
    return () => {
      live = false
    }
  }, [fill, shownId])
  // FILL EDGES: a video that is not the screen's shape plays in a box of its own shape, the blurred picture around it.
  const aspect = fill && shownId && shape?.videoId === shownId ? shape.aspect : null
  const box = aspect && leavesEdges(slotSize, aspect) ? containedBox(slotSize, aspect) : null
  const frame = preview ? null : qualityFrame(quality, box ?? slotSize, typeof window === 'undefined' ? 1 : window.devicePixelRatio)
  const place: CSSProperties = box ? { left: `${box.left}px`, top: `${box.top}px`, right: 'auto', bottom: 'auto', width: `${box.width}px`, height: `${box.height}px` } : {}
  const frameStyle: CSSProperties | undefined = frame
    ? { ...place, right: 'auto', bottom: 'auto', width: `${frame.width}px`, height: `${frame.height}px`, transform: `scale(${frame.scale})`, transformOrigin: '0 0' }
    : box
      ? place
      : undefined
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
  const resumeRef = useRef(0)
  const unpausedRef = useRef(0)
  const resumeIfStrayRef = useRef<() => void>(() => {})
  const resumeSoonRef = useRef<() => void>(() => {})

  // The picture shown again (the Guide closing, a resize, the tab coming back) picks up a stray pause at once.
  useEffect(() => {
    // The YouTube API replaces the host with its iframe, so the frame around it is what is watched.
    const host = frameRef.current
    const resume = () => {
      unpausedRef.current = 0
      resumeIfStrayRef.current()
    }
    const observer = host && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resume) : null
    if (host) observer?.observe(host)
    const visible = () => {
      if (document.visibilityState === 'visible') resume()
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      observer?.disconnect()
      document.removeEventListener('visibilitychange', visible)
      window.clearTimeout(resumeRef.current)
    }
  }, [])

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

  /**
   * A pause TVN did not ask for (Safari pauses a video while the Guide covers it) would leave YouTube's own
   * play button over the picture for good: the programme carries on instead, retried a few times and again
   * whenever the picture is laid out anew.
   */
  const resumeSoon = () => {
    window.clearTimeout(resumeRef.current)
    if (unpausedRef.current >= RESUME_DELAYS_MS.length) return
    resumeRef.current = window.setTimeout(() => {
      unpausedRef.current += 1
      resumeIfStray()
      if (ytRef.current?.getPlayerState?.() === 2 && !holdRef.current) resumeSoon()
    }, RESUME_DELAYS_MS[unpausedRef.current])
  }
  const resumeIfStray = () => {
    const player = ytRef.current
    if (!player || holdRef.current || !requestedRef.current || player.getPlayerState?.() !== 2) return
    player.playVideo()
  }
  useEffect(() => {
    resumeIfStrayRef.current = resumeIfStray
    resumeSoonRef.current = resumeSoon
  })

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
    setShownId(request.videoId || null)
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
        player.setVolume(Math.min(VOLUME_FULL, volume))
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
        const slot = hostRef.current.parentElement
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
              shieldProviderFrame(event.target.getIframe?.())
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
              if (event.data === 2) {
                onStatusRef.current('paused')
                if (!holdRef.current) resumeSoonRef.current()
              }
              if (event.data === 1) unpausedRef.current = 0
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
        shieldProviderFrame(slot?.querySelector('iframe'))
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

  return (
    <>
      {box && shownId ? <div className="fill-backdrop" aria-hidden="true" style={{ backgroundImage: `url(${shapedThumbnail(shownId)})` }} /> : null}
      <div className="yt-frame" ref={frameRef} style={frameStyle}>
        <div className="yt-host" ref={hostRef} />
      </div>
    </>
  )
}
