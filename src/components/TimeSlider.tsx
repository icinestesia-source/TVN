import { useEffect, useRef, useState } from 'react'
import { formatElapsed } from '../utils/time.ts'

export const SLIDER_IDLE_MS = 2500
export const SLIDER_FADE_MS = 600
export const SLIDER_SETTLE_MS = 300

/**
 * The information bar's time slider, under the time: drag (or use the arrow keys) to move through the
 * programme on screen. The jump happens once the slider settles, and the slider fades away when left alone.
 */
export function TimeSlider({
  elapsedSeconds,
  durationSeconds,
  onSeek,
  onDone,
}: {
  elapsedSeconds: number
  durationSeconds: number
  onSeek: (seconds: number) => void
  onDone: () => void
}) {
  const [draft, setDraft] = useState<number | null>(null)
  const [fading, setFading] = useState(false)
  const [held, setHeld] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const settle = useRef(0)
  const seekRef = useRef(onSeek)
  const doneRef = useRef(onDone)
  const [activity, setActivity] = useState(0)

  useEffect(() => {
    seekRef.current = onSeek
    doneRef.current = onDone
  })

  useEffect(() => {
    input.current?.focus({ preventScroll: true })
    return () => window.clearTimeout(settle.current)
  }, [])

  useEffect(() => {
    if (held) return
    const fade = window.setTimeout(() => setFading(true), SLIDER_IDLE_MS)
    const done = window.setTimeout(() => doneRef.current(), SLIDER_IDLE_MS + SLIDER_FADE_MS)
    return () => {
      window.clearTimeout(fade)
      window.clearTimeout(done)
    }
  }, [activity, held])

  const touch = () => {
    setFading(false)
    setActivity((count) => count + 1)
  }

  const move = (seconds: number) => {
    setDraft(seconds)
    touch()
    window.clearTimeout(settle.current)
    settle.current = window.setTimeout(() => {
      seekRef.current(seconds)
      setDraft(null)
    }, SLIDER_SETTLE_MS)
  }

  const max = Math.max(1, Math.floor(durationSeconds))
  const value = Math.min(max, Math.max(0, Math.floor(draft ?? elapsedSeconds)))

  return (
    <div
      className={fading ? 'time-slider is-fading' : 'time-slider'}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerEnter={() => {
        setFading(false)
        setHeld(true)
      }}
      onPointerLeave={() => setHeld(false)}
    >
      <input
        ref={input}
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        aria-label="Move through the programme"
        aria-valuetext={`${formatElapsed(value)} of ${formatElapsed(max)}`}
        onChange={(event) => move(Number(event.currentTarget.value))}
        onFocus={touch}
        onBlur={() => setHeld(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            doneRef.current()
          }
          touch()
        }}
      />
      <span className="time-slider-value">
        {formatElapsed(value)} / {formatElapsed(max)}
      </span>
    </div>
  )
}
