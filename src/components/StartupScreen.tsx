import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SESSION_LOGO } from './logos.ts'
import type { StartupPhase } from '../state/startup.ts'
import { ringColour } from './ring-colour.ts'

export const BRAND = 'TVN'

export const STARTUP_COPY = {
  loading: 'LOADING TVN...',
  failed: 'TVN IS OFF THE AIR',
  failedNote: 'SORRY FOR THE BREAK IN TRANSMISSION · PLEASE TRY AGAIN SHORTLY',
  retry: 'Try again',
} as const

const NOISE_FRAMES = 4

/**
 * Static for the startup screen: a few frames drawn once and stepped through by a CSS transform, which keeps
 * running while the network is still being worked out on the main thread.
 */
function StartupNoise() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !context) return
    const width = 180
    const height = 102
    canvas.width = width
    canvas.height = height * NOISE_FRAMES
    const image = context.createImageData(width, height * NOISE_FRAMES)
    const data = image.data
    for (let frame = 0; frame < NOISE_FRAMES; frame += 1) {
      const level = 150 + Math.random() * 40
      const band = frame * height + Math.floor(Math.random() * (height - 2))
      for (let row = frame * height; row < (frame + 1) * height; row += 1) {
        for (let x = 0; x < width; x += 1) {
          const pixel = (row * width + x) * 4
          const value = row === band ? 190 + Math.random() * 50 : Math.random() * level
          data[pixel] = value
          data[pixel + 1] = value
          data[pixel + 2] = value
          data[pixel + 3] = 255
        }
      }
    }
    context.putImageData(image, 0, 0)
  }, [])
  return (
    <div className="startup-noise" aria-hidden="true">
      <canvas ref={canvasRef} className="startup-noise-frames" />
    </div>
  )
}

/** Counts up to the loaded share a step at a time; it never runs ahead of what has actually loaded. */
function useCountUp(target: number): number {
  const [shown, setShown] = useState(target)
  useEffect(() => {
    if (shown >= target) return
    const id = window.setTimeout(() => setShown((value) => Math.min(target, value + Math.max(1, Math.ceil((target - value) / 4)))), 16)
    return () => window.clearTimeout(id)
  }, [shown, target])
  return Math.min(shown, target)
}

const RING_RADIUS = 46
const RING_LENGTH = 2 * Math.PI * RING_RADIUS
/** From the top, clockwise, all the way round: letters stand on it with their feet towards the centre. */
const RING_PATH = `M 50,${50 - RING_RADIUS} a ${RING_RADIUS},${RING_RADIUS} 0 1,1 0,${RING_RADIUS * 2} a ${RING_RADIUS},${RING_RADIUS} 0 1,1 0,-${RING_RADIUS * 2}`

/**
 * LOADING TVN and the percentage, twice round the logo's rim, spaced evenly over the whole circle. The
 * ring turns clockwise and a brighter letter chases round it; the readable copy is the status text.
 */
export function LoadingRing({ percent }: { percent: number }) {
  const [colour] = useState(() => ringColour())
  const phrase = `${STARTUP_COPY.loading.replace(/\.+$/, '')} · ${percent}% · `
  const letters = [...phrase.repeat(2)]
  // Firefox ignores textLength on a textPath, so the spare length is shared between the letters as dx.
  const measure = useRef<SVGTextElement>(null)
  const [gap, setGap] = useState(0)
  useLayoutEffect(() => {
    const natural = measure.current?.getComputedTextLength?.() ?? 0
    setGap(natural > 0 ? (RING_LENGTH - 0.5 - natural) / letters.length : 0)
  }, [phrase, letters.length])
  const gold = new Set<number>()
  letters.forEach((_, index) => {
    const at = index % phrase.length
    const start = phrase.indexOf(`${percent}%`)
    if (at >= start && at < start + `${percent}%`.length) gold.add(index)
  })
  return (
    <svg className="startup-ring" viewBox="0 0 100 100" aria-hidden="true" focusable="false" style={{ ['--ring-colour' as string]: colour }}>
      <defs>
        <path id="startup-ring-path" d={RING_PATH} />
      </defs>
      <text ref={measure} className="startup-ring-text" visibility="hidden" xmlSpace="preserve">
        {letters.join('')}
      </text>
      <text className="startup-ring-text">
        <textPath href="#startup-ring-path" textLength={RING_LENGTH - 0.5} lengthAdjust="spacing">
          {letters.map((letter, index) => (
            <tspan
              key={index}
              className={gold.has(index) ? 'is-gold' : undefined}
              dx={gap && index > 0 ? gap.toFixed(3) : undefined}
              style={{ animationDelay: `${(((index - letters.length) / letters.length) * 2.4).toFixed(3)}s` }}
            >
              {letter}
            </tspan>
          ))}
        </textPath>
      </text>
    </svg>
  )
}

/**
 * The logo over static, from the first frame until the first channel is on screen; then it fades off over the
 * picture. While the network is loading it shows the share loaded.
 */
export function StartupScreen({ phase, progress = 0, onLeft }: { phase: StartupPhase; progress?: number; onLeft?: () => void }) {
  const failed = phase === 'failed'
  const loading = phase === 'loading'
  const percent = useCountUp(Math.round(Math.min(100, Math.max(0, progress))))
  const leftRef = useRef(false)
  const leave = () => {
    if (leftRef.current) return
    leftRef.current = true
    onLeft?.()
  }
  const onLeftRef = useRef(onLeft)
  useEffect(() => {
    onLeftRef.current = onLeft
  }, [onLeft])
  // Firefox can fire animationend seconds late while the main thread is busy; the fade is over by then.
  useEffect(() => {
    if (phase !== 'ready') return
    const id = window.setTimeout(() => {
      if (leftRef.current) return
      leftRef.current = true
      onLeftRef.current?.()
    }, 600)
    return () => window.clearTimeout(id)
  }, [phase])
  return (
    <div
      className={phase === 'ready' ? 'startup is-leaving' : 'startup'}
      role={failed ? 'alert' : 'status'}
      aria-live="polite"
      aria-busy={loading}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && phase === 'ready') leave()
      }}
    >
      <StartupNoise />
      <div className="startup-ident">
        <div className="startup-emblem">
          <img className="startup-logo" src={SESSION_LOGO} alt={BRAND} width={640} height={640} />
          {failed ? null : <LoadingRing percent={percent} />}
        </div>
        {failed ? (
          <>
            <p className="startup-message">{STARTUP_COPY.failed}</p>
            <p className="startup-note">{STARTUP_COPY.failedNote}</p>
            <button type="button" className="startup-retry" onClick={() => window.location.reload()}>
              {STARTUP_COPY.retry}
            </button>
          </>
        ) : (
          <p className="startup-message sr">
            {STARTUP_COPY.loading}
            <span className="startup-percent" aria-label={`${percent} percent loaded`}>
              {percent}%
            </span>
          </p>
        )}
      </div>
    </div>
  )
}
