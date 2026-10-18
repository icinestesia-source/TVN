import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SESSION_LOGO } from './logos.ts'
import { pointerAngle, releaseSpin, slowedSpin, turnBetween, useLoadingLogo, wheelSpin } from '../view/loading-logo.ts'
import type { StartupPhase } from '../state/startup.ts'
import { RING_COLOURS } from './ring-colour.ts'
import { GRAIN_SIZE, parseHex, shadeTowards } from './StaticOverlay.tsx'
import { snowColours } from './TransitionOverlay.tsx'
import { DEFAULT_TRANSITION_SETTINGS, loadTransitionSettings, TRANSITIONS, type TransitionGrain } from '../state/transitions.ts'

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

export const INNER_RING_COPY =
  'SIGNAL ACTIVE · SYSTEM READY · CHANNEL SYNC · TVN 2.0 · PICTURE LOCKED · AUDIO IN SYNC · GUIDE PREPARED · NETWORK STABLE · BROADCAST CONTINUING · '

const NOISE_FRAMES = 4

/**
 * Static for the startup screen: a few frames drawn once and stepped through by a CSS transform, which keeps
 * running while the network is still being worked out on the main thread.
 */
function StartupNoise({ colours, grain }: { colours: readonly string[]; grain: TransitionGrain }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const paletteKey = colours.join('|')
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !context) return
    const [width, height] = GRAIN_SIZE[grain]
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
  }, [paletteKey, grain])
  return (
    <div className="startup-noise" data-grain={grain} aria-hidden="true">
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

const RING_CENTRE = 50
const OUTER_RADIUS = 46
const INNER_RADIUS = 37.5
/** How far past each side the lane change sits, so the two paths cross instead of meeting on a radius. */
const LANE_CROSS = 0.42

function lanePoint(radius: number, angle: number): [number, number] {
  return [RING_CENTRE + radius * Math.cos(angle), RING_CENTRE - radius * Math.sin(angle)]
}

function laneTangent(radius: number, angle: number): [number, number] {
  return [-radius * Math.sin(angle), -radius * Math.cos(angle)]
}

function crossCurve(from: [number, number], fromTangent: [number, number], to: [number, number], toTangent: [number, number]): string {
  const scale = (tangent: [number, number]) => {
    const length = Math.hypot(tangent[0], tangent[1]) || 1
    return [tangent[0] / length, tangent[1] / length] as [number, number]
  }
  const [sx, sy] = scale(fromTangent)
  const [ex, ey] = scale(toTangent)
  const handle = 11
  const n = (value: number) => value.toFixed(2)
  return `C ${n(from[0] + sx * handle)},${n(from[1] + sy * handle)} ${n(to[0] - ex * handle)},${n(to[1] - ey * handle)} ${n(to[0])},${n(to[1])}`
}

function curveLength(start: [number, number], command: string): number {
  const values = command
    .slice(1)
    .trim()
    .split(/[,\s]+/)
    .map(Number)
  const controls: [number, number][] = [start, [values[0], values[1]], [values[2], values[3]], [values[4], values[5]]]
  let length = 0
  let [x, y] = start
  for (let step = 1; step <= 16; step += 1) {
    const t = step / 16
    const u = 1 - t
    const nx = u ** 3 * controls[0][0] + 3 * u ** 2 * t * controls[1][0] + 3 * u * t ** 2 * controls[2][0] + t ** 3 * controls[3][0]
    const ny = u ** 3 * controls[0][1] + 3 * u ** 2 * t * controls[1][1] + 3 * u * t ** 2 * controls[2][1] + t ** 3 * controls[3][1]
    length += Math.hypot(nx - x, ny - y)
    x = nx
    y = ny
  }
  return length
}

/**
 * One closed lap that spends half its length on the outer lane and half on the inner.
 * `outerFirst` takes the outer lane across the top; the other path takes it across the bottom, so they cross at each side.
 */
function weavePath(outerFirst: boolean): { d: string; length: number } {
  const top = outerFirst ? OUTER_RADIUS : INNER_RADIUS
  const bottom = outerFirst ? INNER_RADIUS : OUTER_RADIUS
  const span = Math.PI - 2 * LANE_CROSS
  const start = lanePoint(top, LANE_CROSS)
  const topEnd = lanePoint(top, Math.PI - LANE_CROSS)
  const bottomStart = lanePoint(bottom, Math.PI + LANE_CROSS)
  const bottomEnd = lanePoint(bottom, -LANE_CROSS)
  const n = (value: number) => value.toFixed(2)
  const toTop = crossCurve(bottomEnd, laneTangent(bottom, -LANE_CROSS), start, laneTangent(top, LANE_CROSS))
  const toBottom = crossCurve(topEnd, laneTangent(top, Math.PI - LANE_CROSS), bottomStart, laneTangent(bottom, Math.PI + LANE_CROSS))
  const d = `M ${n(start[0])},${n(start[1])} A ${top},${top} 0 0 0 ${n(topEnd[0])},${n(topEnd[1])} ${toBottom} A ${bottom},${bottom} 0 0 0 ${n(bottomEnd[0])},${n(bottomEnd[1])} ${toTop}`
  return { d, length: top * span + bottom * span + curveLength(topEnd, toBottom) + curveLength(bottomEnd, toTop) }
}

const OUTER_WEAVE = weavePath(true)
const INNER_WEAVE = weavePath(false)

/** Lift a chosen colour toward white so the ring reads as light rather than a solid band. */
function liftColour(hex: string, toward = 0.42): string {
  const rgb = parseHex(hex)
  if (!rgb) return '#d5ecff'
  const channel = (value: number) => Math.round(value + (255 - value) * toward).toString(16).padStart(2, '0')
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`
}

/** Three soft stops. The viewer's colours travel around the ring; a mono transition gets a pale set. */
function washStops(colours: readonly string[]): [string, string, string] {
  const lifted = (colours.length ? colours : RING_COLOURS).map((hex) => liftColour(hex))
  return [lifted[0] ?? '#f4e4b0', lifted[1] ?? liftColour(lifted[0] ?? '#9fdfff', 0.35), lifted[2] ?? lifted[0] ?? '#e4c6ff']
}

function RingWash({ id, phraseColours, duration, reverse }: { id: string; phraseColours: readonly string[]; duration: string; reverse: boolean }) {
  const [a, b, c] = washStops(phraseColours)
  const reduce = typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false)
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="8" y1="50" x2="92" y2="50">
      <stop offset="0%" stopColor={a} stopOpacity="0.42" />
      <stop offset="46%" stopColor={b} stopOpacity="0.92" />
      <stop offset="100%" stopColor={c} stopOpacity="0.48" />
      {reduce ? null : (
        <animateTransform
          attributeName="gradientTransform"
          type="rotate"
          from={reverse ? '360 50 50' : '0 50 50'}
          to={reverse ? '0 50 50' : '360 50 50'}
          dur={duration}
          repeatCount="indefinite"
        />
      )}
    </linearGradient>
  )
}

function RingText({
  id,
  path,
  length,
  phrase,
  className,
  fontSize,
  fill,
}: {
  id: string
  path: string
  length: number
  phrase: string
  className: string
  fontSize: number
  fill: string
}) {
  const textRef = useRef<SVGTextElement>(null)
  const [gap, setGap] = useState<number | null>(null)
  useLayoutEffect(() => {
    const rendered = textRef.current?.getComputedTextLength?.() ?? 0
    // textLength already spans the circle in browsers that honour it. Firefox does not, so the spare
    // length is shared once, as dx, and textLength is dropped on the next paint so the two never stack.
    if (rendered <= 0 || Math.abs(rendered - length) < 2) return
    setGap((length - rendered) / Math.max(1, [...phrase].length))
  }, [phrase, length])

  const spare = gap
  const letters = spare == null ? null : [...phrase]
  return (
    <>
      <path id={id} d={path} fill="none" />
      <text ref={textRef} className={className} fontSize={fontSize} fill={fill}>
        <textPath
          href={`#${id}`}
          textLength={gap == null ? length : undefined}
          lengthAdjust={gap == null ? 'spacing' : undefined}
          startOffset="0"
        >
          {letters
            ? letters.map((letter, index) => (
                <tspan key={index} dx={index > 0 && spare != null ? spare.toFixed(3) : undefined}>
                  {letter}
                </tspan>
              ))
            : phrase}
        </textPath>
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
  return (
    <div className="startup-rings" aria-hidden="true">
      <CalibrationLayer />
      <svg className="startup-ring startup-ring-outer" viewBox="0 0 100 100" focusable="false">
        <defs>
          <RingWash id="startup-wash-outer" phraseColours={colours} duration="28s" reverse={false} />
        </defs>
        <RingText
          id="startup-ring-outer-path"
          path={OUTER_WEAVE.d}
          length={OUTER_WEAVE.length}
          phrase={OUTER_RING_COPY}
          className="startup-ring-text startup-ring-text-outer"
          fontSize={2.2}
          fill="url(#startup-wash-outer)"
        />
      </svg>
      <svg className="startup-ring startup-ring-inner" viewBox="0 0 100 100" focusable="false">
        <defs>
          <RingWash id="startup-wash-inner" phraseColours={colours.length > 1 ? [...colours].reverse() : colours} duration="19s" reverse />
        </defs>
        <RingText
          id="startup-ring-inner-path"
          path={INNER_WEAVE.d}
          length={INNER_WEAVE.length}
          phrase={INNER_RING_COPY}
          className="startup-ring-text startup-ring-text-inner"
          fontSize={2.2}
          fill="url(#startup-wash-inner)"
        />
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
    return { colours: snowColours(visual.colours, visual.custom, visual), grain: saved.grain }
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
      <StartupNoise colours={look.colours} grain={look.grain} />
      <div className="startup-ident">
        <div className="startup-emblem">
          {logo === 'spin' && !failed ? <SpinLogo /> : <img className="startup-logo" src={SESSION_LOGO} alt={BRAND} width={640} height={640} />}
          {failed ? null : <LoadingRing percent={percent} colours={look.colours} />}
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
