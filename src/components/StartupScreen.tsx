import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { SESSION_LOGO } from './logos.ts'
import { pointerAngle, releaseSpin, slowedSpin, turnBetween, useLoadingLogo, wheelSpin } from '../view/loading-logo.ts'
import type { StartupPhase } from '../state/startup.ts'
import { RING_COLOURS, ringColour } from './ring-colour.ts'
import { parseHex, shadeTowards } from './StaticOverlay.tsx'
import { snowColours } from './TransitionOverlay.tsx'
import { DEFAULT_TRANSITION_SETTINGS, loadTransitionSettings, TRANSITIONS } from '../state/transitions.ts'

export const BRAND = 'TVN'

export const STARTUP_COPY = {
  loading: 'LOADING TVN...',
  failed: 'TVN IS OFF THE AIR',
  failedNote: 'SORRY FOR THE BREAK IN TRANSMISSION · PLEASE TRY AGAIN SHORTLY',
  retry: 'Try again',
} as const

/** Presentation status lines — not a claim that remote services have connected. */
export const STARTUP_STATUS_LINES = [
  'INITIALISING TVN',
  'ESTABLISHING SIGNAL',
  'SYNCHRONISING CHANNELS',
  'PREPARING PROGRAMME GUIDE',
  'CONNECTING TO THE NETWORK',
  'BROADCAST SYSTEM READY',
  'WELCOME TO TVN',
] as const

export const OUTER_RING_COPY =
  'TVN · INDEPENDENT TELEVISION NETWORK · BROADCASTING CONTINUOUSLY · TELEVISION WITHOUT BOUNDARIES · CHANNELS · CULTURE · MUSIC · CINEMA · ENTERTAINMENT · '

export const INNER_RING_COPY = 'SIGNAL ACTIVE · SYSTEM READY · CHANNEL SYNC · TVN 2.0 · '

const NOISE_FRAMES = 4

/**
 * Static for the startup screen: a few frames drawn once and stepped through by a CSS transform, which keeps
 * running while the network is still being worked out on the main thread.
 */
function StartupNoise({ colours }: { colours: readonly string[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const paletteKey = colours.join('|')
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
    const palette = (paletteKey ? paletteKey.split('|') : []).map(parseHex).filter((rgb) => rgb !== null)
    for (let frame = 0; frame < NOISE_FRAMES; frame += 1) {
      const level = 150 + Math.random() * 40
      const band = frame * height + Math.floor(Math.random() * (height - 2))
      for (let row = frame * height; row < (frame + 1) * height; row += 1) {
        for (let x = 0; x < width; x += 1) {
          const pixel = (row * width + x) * 4
          const grey = row === band ? 190 + Math.random() * 50 : Math.random() * level
          const [red, green, blue] = palette.length ? shadeTowards(palette[Math.floor(Math.random() * palette.length)]!, grey) : [grey, grey, grey]
          data[pixel] = red
          data[pixel + 1] = green
          data[pixel + 2] = blue
          data[pixel + 3] = 255
        }
      }
    }
    context.putImageData(image, 0, 0)
  }, [paletteKey])
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

function circlePath(radius: number): string {
  return `M 50,${50 - radius} a ${radius},${radius} 0 1,1 0,${radius * 2} a ${radius},${radius} 0 1,1 0,-${radius * 2}`
}

const OUTER_RADIUS = 46
const INNER_RADIUS = 37.5
const OUTER_PATH = circlePath(OUTER_RADIUS)
const INNER_PATH = circlePath(INNER_RADIUS)
const OUTER_LENGTH = 2 * Math.PI * OUTER_RADIUS
const INNER_LENGTH = 2 * Math.PI * INNER_RADIUS

function RingText({
  id,
  path,
  length,
  phrase,
  className,
}: {
  id: string
  path: string
  length: number
  phrase: string
  className: string
}) {
  const measure = useRef<SVGTextElement>(null)
  const [size, setSize] = useState<number | null>(null)
  useLayoutEffect(() => {
    const node = measure.current
    const natural = node?.getComputedTextLength?.() ?? 0
    if (!node || natural <= 0) return
    const current = Number.parseFloat(window.getComputedStyle(node).fontSize) || 3.55
    // One copy of the phrase around the circle. Growing and shrinking both stay on a single lap.
    setSize(Math.max(1.7, Math.min(5.2, current * ((length - 1) / natural))))
  }, [phrase, length])

  return (
    <>
      <defs>
        <path id={id} d={path} />
      </defs>
      <text ref={measure} className={className} visibility="hidden" xmlSpace="preserve">
        {phrase}
      </text>
      <text className={className} style={size ? { fontSize: `${size}px` } : undefined}>
        <textPath href={`#${id}`}>{phrase}</textPath>
      </text>
    </>
  )
}

function CalibrationLayer() {
  const ticks = Array.from({ length: 24 }, (_, index) => {
    const angle = (index / 24) * Math.PI * 2 - Math.PI / 2
    const outer = 48.6
    const inner = index % 3 === 0 ? 45.2 : 46.4
    return {
      key: index,
      x1: 50 + Math.cos(angle) * inner,
      y1: 50 + Math.sin(angle) * inner,
      x2: 50 + Math.cos(angle) * outer,
      y2: 50 + Math.sin(angle) * outer,
      major: index % 3 === 0,
    }
  })
  const markers = [
    { cx: 50, cy: 2.8, delay: '0s' },
    { cx: 97.2, cy: 50, delay: '1.1s' },
    { cx: 50, cy: 97.2, delay: '2.2s' },
    { cx: 2.8, cy: 50, delay: '3.3s' },
  ]
  return (
    <svg className="startup-calibration" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle className="startup-cal-ring" cx="50" cy="50" r="41.5" />
      <circle className="startup-cal-ring is-fine" cx="50" cy="50" r="44" />
      <circle className="startup-cal-ring is-fine" cx="50" cy="50" r="48.8" />
      {ticks.map((tick) => (
        <line
          key={tick.key}
          className={tick.major ? 'startup-cal-tick is-major' : 'startup-cal-tick'}
          x1={tick.x1}
          y1={tick.y1}
          x2={tick.x2}
          y2={tick.y2}
        />
      ))}
      {markers.map((marker) => (
        <circle
          key={`${marker.cx}-${marker.cy}`}
          className="startup-cal-beacon"
          cx={marker.cx}
          cy={marker.cy}
          r="0.9"
          style={{ animationDelay: marker.delay }}
        />
      ))}
      <text className="startup-cal-label" x="50" y="8.2" textAnchor="middle">
        001
      </text>
      <text className="startup-cal-label" x="92.5" y="51.2" textAnchor="middle">
        CH
      </text>
      <text className="startup-cal-label" x="50" y="95.4" textAnchor="middle">
        1001
      </text>
      <text className="startup-cal-label" x="7.5" y="51.2" textAnchor="middle">
        Hz
      </text>
    </svg>
  )
}

/**
 * Dual typographic rings around the logo — broadcast outer copy, technical inner copy.
 * Percent is not drawn on the rings (real progress stays in the accessible status text).
 */
export function LoadingRing({ percent: _percent, colours = [] }: { percent?: number; colours?: readonly string[] }) {
  const [fallback] = useState(() => ringColour())
  const outer = colours[0] ?? fallback
  const inner = colours[1] ?? colours[0] ?? '#5ce1ff'
  return (
    <div
      className="startup-rings"
      aria-hidden="true"
      style={{ ['--ring-colour' as string]: outer, ['--ring-colour-inner' as string]: inner } as CSSProperties}
    >
      <CalibrationLayer />
      <svg className="startup-ring startup-ring-outer" viewBox="0 0 100 100" focusable="false">
        <RingText id="startup-ring-outer-path" path={OUTER_PATH} length={OUTER_LENGTH} phrase={OUTER_RING_COPY} className="startup-ring-text startup-ring-text-outer" />
      </svg>
      <svg className="startup-ring startup-ring-inner" viewBox="0 0 100 100" focusable="false">
        <RingText id="startup-ring-inner-path" path={INNER_PATH} length={INNER_LENGTH} phrase={INNER_RING_COPY} className="startup-ring-text startup-ring-text-inner" />
      </svg>
    </div>
  )
}

function StartupStatus() {
  return (
    <div className="startup-status" aria-hidden="true">
      {STARTUP_STATUS_LINES.map((line, index) => (
        <span key={line} className="startup-status-line" style={{ animationDelay: `${index * 2.8}s` }}>
          {line}
        </span>
      ))}
    </div>
  )
}

/**
 * LOADING LOGO set to Spin. A finger, pen or mouse dragged anywhere on the loading screen turns the logo round
 * its centre and flicks it on when let go; a two-finger trackpad swipe or a mouse wheel pushes it round. It
 * slows to a stop. Drawn by setting its transform directly, so React does not render on every frame while the
 * network is still loading.
 */
function SpinLogo() {
  const ref = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const logo = ref.current
    const screen = logo?.closest<HTMLElement>('.startup')
    if (!logo || !screen) return
    const spin = { angle: 0, speed: 0, held: -1, last: 0, tick: 0, frame: 0, samples: [] as { angle: number; at: number }[] }
    const paint = () => {
      logo.style.transform = `rotate(${spin.angle.toFixed(2)}deg)`
    }
    const angleOf = (event: { clientX: number; clientY: number }) => {
      const box = logo.getBoundingClientRect()
      return pointerAngle({ x: box.left + box.width / 2, y: box.top + box.height / 2 }, { x: event.clientX, y: event.clientY })
    }
    const step = (time: number) => {
      const seconds = Math.min(0.1, (time - spin.tick) / 1000)
      spin.tick = time
      spin.angle = (spin.angle + spin.speed * seconds) % 360
      spin.speed = slowedSpin(spin.speed, seconds)
      paint()
      spin.frame = spin.speed !== 0 && spin.held < 0 ? requestAnimationFrame(step) : 0
    }
    const run = () => {
      if (spin.frame || spin.speed === 0 || spin.held >= 0) return
      spin.tick = performance.now()
      spin.frame = requestAnimationFrame(step)
    }
    const stop = () => {
      cancelAnimationFrame(spin.frame)
      spin.frame = 0
    }
    const down = (event: globalThis.PointerEvent) => {
      if (spin.held >= 0 || (event.pointerType === 'mouse' && event.button !== 0)) return
      if (event.target instanceof Element && event.target.closest('button, a')) return
      event.preventDefault()
      stop()
      spin.held = event.pointerId
      spin.speed = 0
      spin.last = angleOf(event)
      spin.samples = [{ angle: spin.last, at: performance.now() }]
      screen.setPointerCapture?.(event.pointerId)
    }
    const move = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== spin.held) return
      const angle = angleOf(event)
      spin.angle += turnBetween(spin.last, angle)
      spin.last = angle
      spin.samples = [...spin.samples.slice(-11), { angle, at: performance.now() }]
      paint()
    }
    const up = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== spin.held) return
      spin.held = -1
      if (screen.hasPointerCapture?.(event.pointerId)) screen.releasePointerCapture(event.pointerId)
      spin.speed = event.type === 'pointercancel' ? 0 : releaseSpin(spin.samples, performance.now())
      run()
    }
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey) return
      event.preventDefault()
      spin.speed = wheelSpin(spin.speed, event)
      run()
    }
    screen.addEventListener('pointerdown', down)
    screen.addEventListener('pointermove', move)
    screen.addEventListener('pointerup', up)
    screen.addEventListener('pointercancel', up)
    screen.addEventListener('wheel', wheel, { passive: false })
    screen.classList.add('has-spinner')
    return () => {
      stop()
      screen.removeEventListener('pointerdown', down)
      screen.removeEventListener('pointermove', move)
      screen.removeEventListener('pointerup', up)
      screen.removeEventListener('pointercancel', up)
      screen.removeEventListener('wheel', wheel)
      screen.classList.remove('has-spinner')
    }
  }, [])
  return <img ref={ref} className="startup-logo is-spinner" src={SESSION_LOGO} alt={BRAND} width={640} height={640} draggable={false} title="Flick or swipe to spin" />
}

/**
 * The logo over static, from the first frame until the first channel is on screen; then it fades off over the
 * picture. While the network is loading it shows the share loaded.
 */
export function StartupScreen({ phase, progress = 0, onLeft }: { phase: StartupPhase; progress?: number; onLeft?: () => void }) {
  const failed = phase === 'failed'
  const loading = phase === 'loading'
  const logo = useLoadingLogo()
  const percent = useCountUp(Math.round(Math.min(100, Math.max(0, progress))))
  const look = useState(() => {
    const saved = loadTransitionSettings()
    const visual = saved.id === 'instant' || !TRANSITIONS[saved.id] ? DEFAULT_TRANSITION_SETTINGS : saved
    return snowColours(visual.colours, visual.custom, visual)
  })[0]
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
      <StartupNoise colours={look} />
      <div className="startup-ident">
        <div className="startup-emblem">
          {logo === 'spin' && !failed ? <SpinLogo /> : <img className="startup-logo" src={SESSION_LOGO} alt={BRAND} width={640} height={640} />}
          {failed ? null : <LoadingRing percent={percent} colours={look.length ? look : RING_COLOURS} />}
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
          <>
            <StartupStatus />
            <p className="startup-message startup-progress">
              {STARTUP_COPY.loading}
              <span className="startup-percent" aria-label={`${percent} percent loaded`}>
                {percent}%
              </span>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
