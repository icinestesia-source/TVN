import { useEffect, useImperativeHandle, useRef, type RefObject } from 'react'
import { notePlayback } from './trace.ts'
import type { LocalPlayerHandle } from './routed.ts'
import type { LoadResult, PlayerStatus } from './types.ts'
import { endWebSlot, setWebShown, showableWebUrl, useWebInteraction } from './web-interaction.ts'

/** A slow site still counts as on screen after this long; TVN never holds the schedule for a page. */
const SETTLE_MS = 4_000

/**
 * A website or public post as the picture: the page in a sandboxed frame, under TVN's glass until the viewer
 * chooses INTERACT. Nothing is injected into it and it cannot navigate or script TVN. It has no length,
 * position or sound TVN controls, so the clock here is only the schedule's own.
 */
export function WebStage({
  handleRef,
  onStatus,
  shown,
  primary,
}: {
  handleRef: RefObject<LocalPlayerHandle | null>
  onStatus: (status: PlayerStatus, detail?: string) => void
  shown: boolean
  /** This slot's picture is the one on screen (not INSTANT's hidden standby). */
  primary: boolean
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const requestId = useRef(0)
  const timerRef = useRef(0)
  const pendingRef = useRef<{ id: number; resolve: (result: LoadResult) => void } | null>(null)
  const clockRef = useRef<{ seconds: number; at: number; playing: boolean }>({ seconds: 0, at: 0, playing: false })
  const onStatusRef = useRef(onStatus)
  const primaryRef = useRef(primary)
  const { interacting } = useWebInteraction()
  const live = shown && primary

  useEffect(() => {
    onStatusRef.current = onStatus
    primaryRef.current = primary
  })

  useEffect(() => {
    setWebShown(live)
  }, [live])

  useEffect(() => () => setWebShown(false), [])

  const settle = (id: number, result: LoadResult) => {
    const pending = pendingRef.current
    if (!pending || pending.id !== id) return
    pendingRef.current = null
    window.clearTimeout(timerRef.current)
    pending.resolve(result)
  }

  useImperativeHandle(
    handleRef,
    (): LocalPlayerHandle => ({
      load(request) {
        return new Promise<LoadResult>((resolve) => {
          pendingRef.current?.resolve('slate')
          const id = ++requestId.current
          pendingRef.current = { id, resolve }
          const frame = frameRef.current
          const url = showableWebUrl(request.webUrl)
          if (!frame || !url) {
            notePlayback({ playerState: 'error', lastError: 'website address refused' })
            onStatusRef.current('error', 'SITE CANNOT BE EMBEDDED')
            settle(id, 'error')
            return
          }
          if (frame.getAttribute('src') !== url) {
            if (primaryRef.current) endWebSlot()
            frame.setAttribute('src', url)
          }
          clockRef.current = { seconds: Math.max(0, request.startSeconds), at: Date.now(), playing: true }
          const done = () => {
            notePlayback({ playerState: 'playing', lastError: null })
            onStatusRef.current('playing')
            settle(id, 'playing')
          }
          frame.onload = () => {
            if (id === requestId.current) done()
          }
          window.clearTimeout(timerRef.current)
          timerRef.current = window.setTimeout(() => {
            if (id === requestId.current) done()
          }, SETTLE_MS)
        })
      },
      play() {
        const clock = clockRef.current
        if (!clock.playing) clockRef.current = { ...clock, at: Date.now(), playing: true }
      },
      pause() {
        const clock = clockRef.current
        if (clock.playing) clockRef.current = { seconds: clock.seconds + (Date.now() - clock.at) / 1000, at: Date.now(), playing: false }
      },
      seek(seconds) {
        clockRef.current = { ...clockRef.current, seconds: Math.max(0, seconds), at: Date.now() }
      },
      setAudible() {
        // A page's own sound is its own: TVN has no control over it.
      },
      currentTime() {
        const clock = clockRef.current
        return clock.playing ? clock.seconds + (Date.now() - clock.at) / 1000 : clock.seconds
      },
      actualVideoId() {
        return null
      },
      stop() {
        requestId.current += 1
        pendingRef.current?.resolve('slate')
        pendingRef.current = null
        window.clearTimeout(timerRef.current)
        const frame = frameRef.current
        if (frame?.hasAttribute('src')) {
          if (primaryRef.current) endWebSlot()
          frame.removeAttribute('src')
        }
        clockRef.current = { seconds: 0, at: 0, playing: false }
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  return (
    <iframe
      ref={frameRef}
      className={live && interacting ? 'web-host is-interacting' : 'web-host'}
      hidden={!shown}
      title="Website programme"
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      referrerPolicy="strict-origin-when-cross-origin"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-pointer-lock allow-presentation"
      tabIndex={live && interacting ? 0 : -1}
    />
  )
}
