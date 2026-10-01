import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { listChannels } from '../data/catalogue.ts'
import { mediaLibrary } from '../director/library.ts'
import { openAbout } from '../legal/about-store.ts'
import { getChannelMedia } from '../library/query.ts'
import { onScreen } from '../player/manual.ts'
import { useTv } from '../state/tv-context.ts'
import { useClock } from '../utils/use-clock.ts'
import { downloadJson, provenanceExport } from './export.ts'
import { loadRegister, loadViewerRecords, type ViewerRecords } from './load.ts'
import { channelLabel, creditFor, EMPTY_REGISTER, type Credit, type SourceRegister } from './provenance.ts'
import { buildRoll, LINE_HEIGHT, visibleRange, type Roll, type RollLine } from './roll.ts'

/** Pixels per second: about a line every two seconds, like a film's end credits. */
const SPEED = 32
/** Now Playing holds still this long before the roll starts. */
const HOLD_MS = 4000
const STEP = LINE_HEIGHT.source * 2

const poolOf = (channelNumber: number) => getChannelMedia(mediaLibrary(), channelNumber)

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

function External({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

/** OPEN ORIGINAL names the real service; a stream or local file is never dressed up as YouTube. */
export function originalLabel(credit: Pick<Credit, 'kind' | 'provider'>): string {
  if (credit.provider === 'YouTube') return 'Open original on YouTube'
  if (credit.kind === 'stream') return 'Open original stream'
  return 'Open original'
}

export function NowPlaying({ credit, channel }: { credit: Credit; channel: string }) {
  return (
    <section className="credits-now" aria-label="Now playing">
      <p className="credits-kicker">Now Playing</p>
      <h2 className="credits-now-title">{credit.title}</h2>
      <p className="credits-now-by">{credit.creator ? credit.creator : 'Creator not recorded'}</p>
      <dl className="credits-now-facts">
        <div>
          <dt>TVN channel</dt>
          <dd>{channel}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{credit.provider}</dd>
        </div>
        {credit.licence ? (
          <div>
            <dt>Licence</dt>
            <dd>{credit.licence}</dd>
          </div>
        ) : null}
      </dl>
      {credit.note ? <p className="credits-now-note">{credit.note}</p> : null}
      <p className="credits-links">
        {credit.originalUrl ? <External href={credit.originalUrl} className="credits-original">{originalLabel(credit)}</External> : null}
        {credit.sourceUrl ? <External href={credit.sourceUrl}>Creator’s page</External> : null}
        {credit.website ? <External href={credit.website}>Website</External> : null}
      </p>
    </section>
  )
}

function Line({ line, now }: { line: RollLine; now: ReactNode }) {
  switch (line.kind) {
    case 'now':
      return <>{now}</>
    case 'title':
      return <h3 className="credits-title">{line.text}</h3>
    case 'subtitle':
      return <p className="credits-subtitle">{line.text}</p>
    case 'channel':
      return (
        <p className="credits-channel">
          <span>{line.number}</span>
          {line.name ? <strong>{line.name}</strong> : null}
        </p>
      )
    case 'source':
      return (
        <p className="credits-source">
          <span className="credits-source-name">{line.name}</span>
          <span className="credits-source-detail">{line.detail}</span>
          {line.links.map((link) => (
            <External key={link.url} href={link.url}>
              {link.label}
            </External>
          ))}
        </p>
      )
    case 'note':
      return <p className="credits-note">{line.text}</p>
    case 'space':
      return null
  }
}

/**
 * CREDITS: the picture's place taken by a rolling register of who made what TVN shows, generated from
 * TVN's records when it opens. Only the lines on screen exist, so the roll can run as long as it likes.
 */
export function CreditsRoll() {
  const tv = useTv()
  const now = useClock(5000)
  const rootRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const [data, setData] = useState<{ register: SourceRegister; records: ViewerRecords } | null>(null)
  const [roll, setRoll] = useState<Roll | null>(null)
  const [running, setRunning] = useState(() => !prefersReducedMotion())
  const [top, setTop] = useState(0)
  const [height, setHeight] = useState(720)
  const topRef = useRef(0)
  const holdRef = useRef(false)

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    let live = true
    void Promise.all([loadRegister(), loadViewerRecords()]).then(([register, records]) => {
      if (live) setData({ register, records })
    })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!data) return
    // Built after the first paint, so the roll opens on Now Playing at once.
    const id = window.setTimeout(() => {
      setRoll(buildRoll({ channels: listChannels(), poolOf, register: data.register, stored: data.records.stored, curated: data.records.curated }))
    }, 0)
    return () => window.clearTimeout(id)
  }, [data])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const apply = () => setHeight(view.clientHeight || 720)
    apply()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply)
    observer?.observe(view)
    return () => observer?.disconnect()
  }, [])

  const total = roll ? roll.offsets[roll.offsets.length - 1] : 0
  const moveTo = (next: number) => {
    if (!total) return
    const wrapped = ((next % total) + total) % total
    topRef.current = wrapped
    setTop(wrapped)
  }
  const moveRef = useRef(moveTo)
  moveRef.current = moveTo

  useEffect(() => {
    if (!running || !roll) return
    let last = performance.now()
    const startAt = last + (topRef.current === 0 ? HOLD_MS : 0)
    let frame = requestAnimationFrame(function step(at) {
      if (at > startAt && !holdRef.current) moveRef.current(topRef.current + ((at - last) * SPEED) / 1000)
      last = at
      frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [running, roll])

  const channel = tv.channel
  const nowBlock = useMemo(() => {
    const programme = onScreen(channel, now).current.programme
    const credit = creditFor(channel, programme, {
      library: mediaLibrary(),
      register: data?.register ?? EMPTY_REGISTER,
      stored: data?.records.stored,
      curated: data?.records.curated,
    })
    return <NowPlaying credit={credit} channel={channelLabel(channel)} />
  }, [channel, now, data])

  const placed: { key: string; line: RollLine; y: number }[] = []
  if (roll) {
    const [from, to] = visibleRange(roll.offsets, top, height)
    for (let index = from; index < to; index += 1) placed.push({ key: `a${index}`, line: roll.lines[index], y: roll.offsets[index] - top })
    if (top + height > total) {
      const [wrapFrom, wrapTo] = visibleRange(roll.offsets, 0, top + height - total)
      for (let index = wrapFrom; index < wrapTo; index += 1) placed.push({ key: `b${index}`, line: roll.lines[index], y: total - top + roll.offsets[index] })
    }
  }

  const close = () => tv.dispatch({ type: 'credits' })
  const download = () => {
    if (!data) return
    downloadJson('tvn-source-register.json', provenanceExport(listChannels(), poolOf, data.register, new Date().toISOString()))
  }

  return (
    <div
      className="credits"
      ref={rootRef}
      tabIndex={-1}
      role="region"
      aria-label="Credits"
      onKeyDown={(event) => {
        const keys: Record<string, () => void> = {
          Escape: close,
          ' ': () => setRunning((on) => !on),
          k: () => setRunning((on) => !on),
          K: () => setRunning((on) => !on),
          ArrowDown: () => moveTo(topRef.current + STEP),
          ArrowUp: () => moveTo(topRef.current - STEP),
          PageDown: () => moveTo(topRef.current + height * 0.8),
          PageUp: () => moveTo(topRef.current - height * 0.8),
          Home: () => moveTo(0),
        }
        const action = keys[event.key]
        if (!action) return
        // Inside the roll these keys move the credits, never the channel underneath.
        event.preventDefault()
        event.stopPropagation()
        action()
      }}
    >
      <div
        className="credits-view"
        ref={viewRef}
        onWheel={(event) => moveTo(topRef.current + event.deltaY)}
        onFocus={(event) => {
          holdRef.current = (event.target as HTMLElement).closest('a') !== null
        }}
        onBlur={() => {
          holdRef.current = false
        }}
        aria-live="off"
      >
        {roll ? (
          placed.map(({ key, line, y }) => (
            <div key={key} className={`credits-line is-${line.kind}`} style={{ transform: `translateY(${y}px)`, height: LINE_HEIGHT[line.kind] } as CSSProperties}>
              <Line line={line} now={nowBlock} />
            </div>
          ))
        ) : (
          <div className="credits-line is-now">
            {nowBlock}
            <p className="credits-note">Preparing credits…</p>
          </div>
        )}
      </div>
      <div className="credits-controls" role="toolbar" aria-label="Credits controls">
        <button type="button" aria-pressed={!running} onClick={() => setRunning((on) => !on)}>
          {running ? 'Pause roll' : 'Play roll'}
        </button>
        <button type="button" aria-label="Scroll back" onClick={() => moveTo(topRef.current - STEP)}>
          ▲
        </button>
        <button type="button" aria-label="Scroll on" onClick={() => moveTo(topRef.current + STEP)}>
          ▼
        </button>
        <button type="button" onClick={() => moveTo(0)}>
          Now playing
        </button>
        <button type="button" disabled={!data} onClick={download}>
          Download register
        </button>
        <button type="button" onClick={openAbout}>
          About &amp; legal
        </button>
        <button type="button" className="credits-close" onClick={close}>
          Close credits
        </button>
      </div>
    </div>
  )
}
