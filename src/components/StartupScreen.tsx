import { useEffect, useState } from 'react'
import logo from '../assets/TVNolo.png'
import type { StartupPhase } from '../state/startup.ts'
import { Noise } from './StaticOverlay.tsx'

export const BRAND = 'TVN'

export const STARTUP_COPY = {
  loading: 'LOADING TVN...',
  failed: 'TVN IS OFF THE AIR',
  failedNote: 'SORRY FOR THE BREAK IN TRANSMISSION · PLEASE TRY AGAIN SHORTLY',
  retry: 'Try again',
} as const

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
  const phrase = `${STARTUP_COPY.loading.replace(/\.+$/, '')} · ${percent}% · `
  const letters = [...phrase.repeat(2)]
  const gold = new Set<number>()
  letters.forEach((_, index) => {
    const at = index % phrase.length
    const start = phrase.indexOf(`${percent}%`)
    if (at >= start && at < start + `${percent}%`.length) gold.add(index)
  })
  return (
    <svg className="startup-ring" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <path id="startup-ring-path" d={RING_PATH} />
      </defs>
      <text className="startup-ring-text">
        <textPath href="#startup-ring-path" textLength={RING_LENGTH - 0.5} lengthAdjust="spacing">
          {letters.map((letter, index) => (
            <tspan
              key={index}
              className={gold.has(index) ? 'is-gold' : undefined}
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

/** Shown until the network and the first channel are settled; after that it fades off over the picture. */
export function StartupScreen({ phase, progress = 0, onLeft }: { phase: StartupPhase; progress?: number; onLeft?: () => void }) {
  const failed = phase === 'failed'
  const loading = phase === 'loading'
  const percent = useCountUp(Math.round(Math.min(100, Math.max(0, progress))))
  return (
    <div
      className={phase === 'ready' ? 'startup is-leaving' : 'startup'}
      role={failed ? 'alert' : 'status'}
      aria-live="polite"
      aria-busy={loading}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) onLeft?.()
      }}
    >
      <Noise />
      <div className="startup-ident">
        <div className="startup-emblem">
          <img className="startup-logo" src={logo} alt={BRAND} width={640} height={640} />
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
