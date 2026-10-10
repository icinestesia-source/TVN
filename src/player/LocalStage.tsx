import { useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react'
import { noteLocalSource } from '../session/session-channel.ts'
import { fileScale } from './file-scale.ts'
import { attachFlv, type Remuxer } from './flv.ts'
import { steadiedUrl, steadyLocalUrl } from './mp4-steady.ts'
import { nativeHls } from './stream.ts'
import { notePlayback } from './trace.ts'
import type { LocalPlayerHandle } from './routed.ts'
import type { LoadResult, PlayerStatus } from './types.ts'
import { boostableUrl, boostGain, elementVolume, VOLUME_FULL } from './volume.ts'
import { leavesEdges, useFillEdges } from '../view/fill-edges.ts'

const LOAD_TIMEOUT_MS = 10_000
/** A publisher's file on the web may go this long without sending anything before it counts as failed. */
const WEB_FILE_TIMEOUT_MS = 30_000
/** A slow host still sending a large file's index gets this long in all before TVN moves on. */
const WEB_FILE_LIMIT_MS = 120_000
const STREAM_TIMEOUT_MS = 15_000
/** FILL EDGES redraws the blurred surround a few times a second: enough to follow the picture, too few to cost anything. */
const FILL_FRAME_MS = 200
const FILL_WIDTH = 64

interface Pending {
  id: number
  startSeconds: number
  /** The file's length on the schedule, when known. */
  scheduledSeconds?: number
  live: boolean
  /** When a web file still loading must give up, however steadily it is arriving. */
  giveUpAt?: number
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
  /** Files from this device play on their own element, the only one ever routed through the boost: once routed, an element stays routed, and a web file without the host's leave would play silent on it. */
  const ownRef = useRef<HTMLVideoElement>(null)
  const onOwnRef = useRef(false)
  const [onOwn, setOnOwn] = useState(false)
  const boostRef = useRef<{ context: AudioContext; gain: GainNode } | null>(null)
  const element = () => (onOwnRef.current ? ownRef.current : videoRef.current)
  const pendingRef = useRef<Pending | null>(null)
  const requestId = useRef(0)
  const liveRef = useRef(false)
  const timerRef = useRef(0)
  const scaleRef = useRef(1)
  const remuxRef = useRef<Remuxer | null>(null)
  const onStatusRef = useRef(onStatus)
  const fillRef = useRef<HTMLCanvasElement>(null)
  const fill = useFillEdges()

  useEffect(() => {
    onStatusRef.current = onStatus
  })

  // FILL EDGES: where the picture does not cover the screen, the same picture, enlarged and blurred, behind it.
  useEffect(() => {
    const canvas = fillRef.current
    if (!fill || !shown || !canvas) return
    const videos = [videoRef.current, ownRef.current]
    const draw = () => {
      const video = element()
      const slot = canvas.parentElement
      const filled = Boolean(video && slot && video.videoWidth > 0 && leavesEdges({ width: slot.clientWidth, height: slot.clientHeight }, video.videoWidth / video.videoHeight))
      canvas.hidden = !filled
      for (const each of videos) each?.classList.toggle('is-filled', filled)
      if (!filled || !video || !slot) return
      const height = Math.max(1, Math.round((FILL_WIDTH * slot.clientHeight) / Math.max(1, slot.clientWidth)))
      if (canvas.width !== FILL_WIDTH || canvas.height !== height) {
        canvas.width = FILL_WIDTH
        canvas.height = height
      }
      const scale = Math.max(FILL_WIDTH / video.videoWidth, height / video.videoHeight)
      const width = video.videoWidth * scale
      const tall = video.videoHeight * scale
      try {
        canvas.getContext('2d')?.drawImage(video, (FILL_WIDTH - width) / 2, (height - tall) / 2, width, tall)
      } catch {
        // A frame not ready yet is drawn next time.
      }
    }
    draw()
    const timer = window.setInterval(draw, FILL_FRAME_MS)
    return () => {
      window.clearInterval(timer)
      canvas.hidden = true
      for (const each of videos) each?.classList.remove('is-filled')
    }
    // element() reads refs; the loop follows whichever element is showing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fill, shown])

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
    const video = element()
    const pending = pendingRef.current
    if (!video || !pending || pending.id !== id) return
    // A live stream is joined where it is; only a file is seeked to the broadcast position.
    scaleRef.current = pending.live ? 1 : fileScale(video.duration, pending.scheduledSeconds)
    const target = pending.live ? 0 : Math.min(pending.startSeconds * scaleRef.current, Number.isFinite(video.duration) ? Math.max(0, video.duration - 1) : Infinity)
    if (!pending.live && Math.abs(video.currentTime - target) > 0.5) video.currentTime = target
    video.play().then(
      () => {
        if (id !== requestId.current) return
        notePlayback({ playerState: 'playing', lastError: null })
        onStatusRef.current('playing')
        settle(id, 'playing')
      },
      (error: unknown) => {
        // The browser refusing to start before the viewer has interacted is not a broken stream: the source
        // is loaded and waiting, and TVN's start check takes it from here.
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          if (id !== requestId.current) return
          notePlayback({ playerState: 'paused', lastError: 'waiting for the viewer' })
          onStatusRef.current('paused')
          settle(id, 'playing')
          return
        }
        fail(id)
      },
    )
  }

  const dropRemux = () => {
    const remuxer = remuxRef.current
    remuxRef.current = null
    try {
      remuxer?.destroy()
    } catch {
      // A converter that fails to let go still leaves the element to be cleared below.
    }
  }

  const release = () => {
    dropRemux()
    const video = element()
    if (!video) return
    video.pause()
    if (video.hasAttribute('src')) {
      video.removeAttribute('src')
      video.load()
    }
    liveRef.current = false
    scaleRef.current = 1
    noteLocalSource(null)
  }

  /** Routes the own element through a gain stage, the first time boost is asked for; it stays routed. */
  const connectBoost = () => {
    const own = ownRef.current
    if (boostRef.current || !own || typeof AudioContext === 'undefined') return
    try {
      const context = new AudioContext()
      const gain = context.createGain()
      context.createMediaElementSource(own).connect(gain).connect(context.destination)
      boostRef.current = { context, gain }
    } catch {
      // Without a gain stage the file still plays, at full volume.
    }
  }

  useImperativeHandle(
    handleRef,
    (): LocalPlayerHandle => ({
      load(request) {
        return new Promise<LoadResult>((resolve) => {
          pendingRef.current?.resolve('slate')
          const id = ++requestId.current
          const url = request.localUrl ?? request.streamUrl
          const own = boostableUrl(request.localUrl)
          if (own !== onOwnRef.current) {
            release()
            onOwnRef.current = own
            setOnOwn(own)
          }
          const video = element()
          if (!video || !url) {
            pendingRef.current = null
            resolve('slate')
            return
          }
          const live = !request.localUrl
          const startSeconds = !live && Number.isFinite(request.startSeconds) ? Math.max(0, request.startSeconds) : 0
          const web = !live && /^https?:/i.test(url)
          pendingRef.current = {
            id,
            startSeconds,
            live,
            resolve,
            ...(live ? {} : { scheduledSeconds: request.localSeconds }),
            ...(web ? { giveUpAt: Date.now() + WEB_FILE_LIMIT_MS } : {}),
          }
          window.clearTimeout(timerRef.current)
          if (request.hls && !nativeHls((mime) => video.canPlayType(mime))) {
            release()
            liveRef.current = live
            fail(id, 'stream format unsupported')
            return
          }
          timerRef.current = window.setTimeout(() => fail(id), live ? STREAM_TIMEOUT_MS : web ? WEB_FILE_TIMEOUT_MS : LOAD_TIMEOUT_MS)
          onStatusRef.current('buffering')
          notePlayback({ playerState: 'buffering', expectedSeek: startSeconds })
          const showing = remuxRef.current ? remuxRef.current.url : video.getAttribute('src')
          if (!live && showing !== null && (showing === url || showing === steadiedUrl(url)) && video.readyState >= 1) {
            begin(id)
            return
          }
          if (!live && request.remux) {
            release()
            noteLocalSource(url)
            attachFlv(video, url, (reason) => fail(id, reason)).then(
              (remuxer) => {
                if (id === requestId.current) remuxRef.current = remuxer
                else remuxer.destroy()
              },
              () => fail(id, 'flv unsupported'),
            )
            return
          }
          dropRemux()
          liveRef.current = live
          if (!live && url.startsWith('blob:')) {
            noteLocalSource(url)
            // A file from this device with bunched frame times plays from a steadied copy of its index.
            void steadyLocalUrl(url).then((playable) => {
              if (id === requestId.current) video.src = playable
            })
            return
          }
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
        if (onOwnRef.current) void boostRef.current?.context.resume().catch(() => undefined)
        void element()?.play().catch(() => undefined)
      },
      pause() {
        element()?.pause()
      },
      seek(seconds) {
        const video = element()
        if (video && !liveRef.current && Number.isFinite(seconds)) video.currentTime = Math.max(0, seconds * scaleRef.current)
      },
      setAudible(audible, volume, muted) {
        const video = element()
        if (!video) return
        video.volume = elementVolume(volume)
        video.muted = !audible || muted || volume <= 0
        const boost = onOwnRef.current && volume > VOLUME_FULL
        if (boost) connectBoost()
        const routed = boostRef.current
        if (!routed) return
        routed.gain.gain.value = boost ? boostGain(volume) : 1
        if (onOwnRef.current) void routed.context.resume().catch(() => undefined)
      },
      currentTime() {
        const value = element()?.currentTime
        return typeof value === 'number' && Number.isFinite(value) ? value / scaleRef.current : 0
      },
      actualVideoId() {
        return null
      },
    }),
    [],
  )

  useEffect(() => {
    const elements = [videoRef.current, ownRef.current].filter((item): item is HTMLVideoElement => item !== null)
    // Both elements are listened to; only the one in use speaks.
    const mine = (event: Event) => event.currentTarget === element()
    const onMeta = (event: Event) => {
      const pending = pendingRef.current
      if (pending && mine(event)) begin(pending.id)
    }
    const onError = (event: Event) => {
      if (!mine(event) || !(event.currentTarget as HTMLVideoElement).hasAttribute('src')) return
      fail(requestId.current)
    }
    const onWaiting = (event: Event) => {
      if (mine(event)) onStatusRef.current('buffering')
    }
    const onProgress = (event: Event) => {
      if (!mine(event)) return
      const pending = pendingRef.current
      if (!pending?.giveUpAt) return
      const id = pending.id
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => fail(id), Math.max(0, Math.min(WEB_FILE_TIMEOUT_MS, pending.giveUpAt - Date.now())))
    }
    const onPlaying = (event: Event) => {
      if (mine(event)) onStatusRef.current('playing')
    }
    // A live stream has no end; one that ends has dropped.
    const onEnded = (event: Event) => {
      if (!mine(event)) return
      if (liveRef.current) fail(requestId.current, 'stream ended')
      else onStatusRef.current('ended')
    }
    const listeners = { loadedmetadata: onMeta, error: onError, waiting: onWaiting, progress: onProgress, playing: onPlaying, ended: onEnded }
    for (const video of elements) for (const [type, listener] of Object.entries(listeners)) video.addEventListener(type, listener)
    return () => {
      for (const video of elements) for (const [type, listener] of Object.entries(listeners)) video.removeEventListener(type, listener)
      window.clearTimeout(timerRef.current)
      release()
      void boostRef.current?.context.close().catch(() => undefined)
      boostRef.current = null
    }
    // Listeners are bound once to the one element; they read the current request through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <canvas ref={fillRef} className="fill-backdrop is-local" aria-hidden="true" hidden />
      <video ref={videoRef} className="local-host" hidden={!shown || onOwn} playsInline preload="auto" />
      <video ref={ownRef} className="local-host" hidden={!shown || !onOwn} playsInline preload="auto" />
    </>
  )
}
