import { useEffect, useImperativeHandle, useRef, type RefObject } from 'react'
import { noteLocalSource } from '../session/session-channel.ts'
import { nativeHls } from './stream.ts'
import { notePlayback } from './trace.ts'
import type { LocalPlayerHandle } from './routed.ts'
import type { LoadResult, PlayerStatus } from './types.ts'

const LOAD_TIMEOUT_MS = 10_000
const STREAM_TIMEOUT_MS = 15_000

interface Pending {
  id: number
  startSeconds: number
  live: boolean
  resolve: (result: LoadResult) => void
}

/**
 * Plays session-channel files from their object URLs, and live audio or video streams, with one media
 * element reused for every load. Letting go of a stream removes its address, which closes the connection.
 */
export function LocalStage({
  handleRef,
  onStatus,
  shown,
}: {
  handleRef: RefObject<LocalPlayerHandle | null>
  onStatus: (status: PlayerStatus, detail?: string) => void
  shown: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const pendingRef = useRef<Pending | null>(null)
  const requestId = useRef(0)
  const liveRef = useRef(false)
  const timerRef = useRef(0)
  const onStatusRef = useRef(onStatus)

  useEffect(() => {
    onStatusRef.current = onStatus
  })

  const settle = (id: number, result: LoadResult) => {
    const pending = pendingRef.current
    if (!pending || pending.id !== id) return
    pendingRef.current = null
    window.clearTimeout(timerRef.current)
    pending.resolve(result)
  }

  const fail = (id: number, reason = liveRef.current ? 'stream unavailable' : 'local file unavailable') => {
    if (id !== requestId.current) return
    notePlayback({ playerState: 'error', lastError: reason })
    onStatusRef.current('error', reason)
    settle(id, 'error')
  }

  const begin = (id: number) => {
    const video = videoRef.current
    const pending = pendingRef.current
    if (!video || !pending || pending.id !== id) return
    // A live stream is joined where it is; only a file is seeked to the broadcast position.
    if (!pending.live && Math.abs(video.currentTime - pending.startSeconds) > 0.5) video.currentTime = pending.startSeconds
    video.play().then(
      () => {
        if (id !== requestId.current) return
        notePlayback({ playerState: 'playing', lastError: null })
        onStatusRef.current('playing')
        settle(id, 'playing')
      },
      () => fail(id),
    )
  }

  const release = () => {
    const video = videoRef.current
    if (!video) return
    video.pause()
    if (video.hasAttribute('src')) {
      video.removeAttribute('src')
      video.load()
    }
    liveRef.current = false
    noteLocalSource(null)
  }

  useImperativeHandle(
    handleRef,
    (): LocalPlayerHandle => ({
      load(request) {
        return new Promise<LoadResult>((resolve) => {
          pendingRef.current?.resolve('slate')
          const id = ++requestId.current
          const video = videoRef.current
          const url = request.localUrl ?? request.streamUrl
          if (!video || !url) {
            pendingRef.current = null
            resolve('slate')
            return
          }
          const live = !request.localUrl
          const startSeconds = !live && Number.isFinite(request.startSeconds) ? Math.max(0, request.startSeconds) : 0
          pendingRef.current = { id, startSeconds, live, resolve }
          window.clearTimeout(timerRef.current)
          if (live && request.hls && !nativeHls((mime) => video.canPlayType(mime))) {
            release()
            liveRef.current = true
            fail(id, 'stream format unsupported')
            return
          }
          timerRef.current = window.setTimeout(() => fail(id), live ? STREAM_TIMEOUT_MS : LOAD_TIMEOUT_MS)
          onStatusRef.current('buffering')
          notePlayback({ playerState: 'buffering', expectedSeek: startSeconds })
          if (!live && video.getAttribute('src') === url && video.readyState >= 1) {
            begin(id)
            return
          }
          liveRef.current = live
          video.src = url
          noteLocalSource(live ? null : url)
        })
      },
      stop() {
        requestId.current += 1
        pendingRef.current?.resolve('slate')
        pendingRef.current = null
        window.clearTimeout(timerRef.current)
        release()
      },
      play() {
        void videoRef.current?.play().catch(() => undefined)
      },
      pause() {
        videoRef.current?.pause()
      },
      seek(seconds) {
        const video = videoRef.current
        if (video && !liveRef.current && Number.isFinite(seconds)) video.currentTime = Math.max(0, seconds)
      },
      setAudible(audible, volume, muted) {
        const video = videoRef.current
        if (!video) return
        video.volume = Math.min(1, Math.max(0, volume / 100))
        video.muted = !audible || muted || volume <= 0
      },
      currentTime() {
        const value = videoRef.current?.currentTime
        return typeof value === 'number' && Number.isFinite(value) ? value : 0
      },
      actualVideoId() {
        return null
      },
    }),
    [],
  )

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onMeta = () => {
      const pending = pendingRef.current
      if (pending) begin(pending.id)
    }
    const onError = () => {
      if (!video.hasAttribute('src')) return
      fail(requestId.current)
    }
    const onWaiting = () => onStatusRef.current('buffering')
    const onPlaying = () => onStatusRef.current('playing')
    // A live stream has no end; one that ends has dropped.
    const onEnded = () => (liveRef.current ? fail(requestId.current, 'stream ended') : onStatusRef.current('ended'))
    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('error', onError)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('ended', onEnded)
    return () => {
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('error', onError)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('ended', onEnded)
      window.clearTimeout(timerRef.current)
      release()
    }
    // Listeners are bound once to the one element; they read the current request through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <video ref={videoRef} className="local-host" hidden={!shown} playsInline preload="auto" />
}
