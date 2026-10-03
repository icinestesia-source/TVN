import { useEffect, useImperativeHandle, useRef, type RefObject } from 'react'
import { notePlayback } from './trace.ts'
import type { LocalPlayerHandle } from './routed.ts'
import type { LoadResult, PlayerStatus } from './types.ts'
import { readVimeoMessage, VIMEO_ORIGIN, vimeoEmbedSrc, vimeoIdOf } from './vimeo.ts'

const READY_TIMEOUT_MS = 15_000
/** After the player is ready, how long a start may take before TVN treats it as waiting for the viewer. */
const START_GRACE_MS = 4_000

interface Pending {
  id: number
  resolve: (result: LoadResult) => void
}

/**
 * A provider's own player for a public video TVN may only embed: Vimeo, driven through its documented
 * postMessage API. It sits under TVN's glass like YouTube's (pointer events off), with Vimeo's controls hidden.
 */
export function EmbedStage({
  handleRef,
  onStatus,
  shown,
}: {
  handleRef: RefObject<LocalPlayerHandle | null>
  onStatus: (status: PlayerStatus, detail?: string) => void
  shown: boolean
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const pendingRef = useRef<Pending | null>(null)
  const requestId = useRef(0)
  const timerRef = useRef(0)
  const soundRef = useRef<[audible: boolean, volume: number, muted: boolean]>([true, 100, false])
  const clockRef = useRef<{ seconds: number; at: number; playing: boolean }>({ seconds: 0, at: 0, playing: false })
  const onStatusRef = useRef(onStatus)

  useEffect(() => {
    onStatusRef.current = onStatus
  })

  const post = (method: string, value?: unknown) => {
    frameRef.current?.contentWindow?.postMessage(JSON.stringify(value === undefined ? { method } : { method, value }), VIMEO_ORIGIN)
  }

  const applySound = () => {
    const [audible, volume, muted] = soundRef.current
    post('setVolume', Math.min(1, Math.max(0, volume / 100)))
    post('setMuted', !audible || muted || volume <= 0)
  }

  const settle = (id: number, result: LoadResult) => {
    const pending = pendingRef.current
    if (!pending || pending.id !== id) return
    pendingRef.current = null
    window.clearTimeout(timerRef.current)
    pending.resolve(result)
  }

  const fail = (id: number, reason: string) => {
    if (id !== requestId.current) return
    notePlayback({ playerState: 'error', lastError: reason })
    onStatusRef.current('error', reason)
    settle(id, 'error')
  }

  const release = () => {
    const frame = frameRef.current
    if (frame?.hasAttribute('src')) frame.removeAttribute('src')
    clockRef.current = { seconds: 0, at: 0, playing: false }
  }

  useImperativeHandle(
    handleRef,
    (): LocalPlayerHandle => ({
      load(request) {
        return new Promise<LoadResult>((resolve) => {
          pendingRef.current?.resolve('slate')
          const id = ++requestId.current
          const frame = frameRef.current
          const video = vimeoIdOf(request.localUrl)
          if (!frame || !video) {
            pendingRef.current = null
            resolve('slate')
            return
          }
          pendingRef.current = { id, resolve }
          window.clearTimeout(timerRef.current)
          const start = Number.isFinite(request.startSeconds) ? Math.max(0, request.startSeconds) : 0
          clockRef.current = { seconds: start, at: Date.now(), playing: false }
          timerRef.current = window.setTimeout(() => fail(id, 'embed unavailable'), READY_TIMEOUT_MS)
          onStatusRef.current('buffering')
          notePlayback({ playerState: 'buffering', expectedSeek: start })
          const [audible, volume, muted] = soundRef.current
          frame.src = vimeoEmbedSrc(video, start, !audible || muted || volume <= 0)
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
        post('play')
      },
      pause() {
        post('pause')
      },
      seek(seconds) {
        if (!Number.isFinite(seconds)) return
        clockRef.current = { ...clockRef.current, seconds: Math.max(0, seconds), at: Date.now() }
        post('setCurrentTime', Math.max(0, seconds))
      },
      setAudible(audible, volume, muted) {
        soundRef.current = [audible, volume, muted]
        applySound()
      },
      currentTime() {
        const clock = clockRef.current
        return clock.playing ? clock.seconds + (Date.now() - clock.at) / 1000 : clock.seconds
      },
      actualVideoId() {
        return null
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current
      if (event.origin !== VIMEO_ORIGIN || !frame || event.source !== frame.contentWindow) return
      const message = readVimeoMessage(event.data)
      if (!message?.event) return
      const id = requestId.current
      const seconds = typeof message.data?.seconds === 'number' ? message.data.seconds : null
      if (seconds !== null) clockRef.current = { ...clockRef.current, seconds, at: Date.now() }
      switch (message.event) {
        case 'ready': {
          for (const name of ['play', 'playing', 'pause', 'ended', 'timeupdate', 'error', 'bufferstart', 'bufferend']) post('addEventListener', name)
          applySound()
          post('play')
          window.clearTimeout(timerRef.current)
          // Autoplay the browser holds back is not a broken video: it is loaded and waiting for the viewer.
          timerRef.current = window.setTimeout(() => {
            if (!pendingRef.current || pendingRef.current.id !== id) return
            notePlayback({ playerState: 'paused', lastError: 'waiting for the viewer' })
            onStatusRef.current('paused')
            settle(id, 'playing')
          }, START_GRACE_MS)
          break
        }
        case 'play':
        case 'playing':
        case 'bufferend':
          clockRef.current = { ...clockRef.current, at: Date.now(), playing: true }
          notePlayback({ playerState: 'playing', lastError: null })
          onStatusRef.current('playing')
          settle(id, 'playing')
          break
        case 'pause':
          clockRef.current = { ...clockRef.current, at: Date.now(), playing: false }
          onStatusRef.current('paused')
          break
        case 'bufferstart':
          onStatusRef.current('buffering')
          break
        case 'ended':
          clockRef.current = { ...clockRef.current, playing: false }
          onStatusRef.current('ended')
          break
        case 'error':
          fail(id, 'embed refused')
          break
        default:
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timerRef.current)
      release()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <iframe
      ref={frameRef}
      className="embed-host"
      hidden={!shown}
      title="Vimeo player"
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      referrerPolicy="strict-origin-when-cross-origin"
      sandbox="allow-scripts allow-same-origin allow-presentation"
      tabIndex={-1}
    />
  )
}
