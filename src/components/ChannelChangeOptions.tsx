import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  CARD_ACCENTS,
  CARD_OPACITY_MIN,
  CARD_PANELS,
  CARD_POSITIONS,
  CARD_SIZES,
  CARD_TYPES,
  COLOURS,
  DEFAULT_TRANSITION_SETTINGS,
  GRAINS,
  SPEEDS,
  TRANSITION_IDS,
  TRANSITIONS,
  transitionTiming,
  type TitleCard,
  type TransitionSettings,
} from '../state/transitions.ts'
import { TransitionOverlay, type CardIdentity } from './TransitionOverlay.tsx'

/** A clearly made-up channel: the preview never tunes the television. */
const SAMPLE: CardIdentity = { number: '225', name: 'TVN Preview', programme: 'Sample programme' }

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="options-row">
      <span className="options-label">{label}</span>
      <span className="options-control">{children}</span>
    </div>
  )
}

function Choices<T extends string | number>({
  label,
  value,
  choices,
  onChange,
}: {
  label: string
  value: T
  choices: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <span className="options-choices" role="radiogroup" aria-label={label}>
      {choices.map((choice) => (
        <button
          key={String(choice.value)}
          type="button"
          role="radio"
          aria-checked={value === choice.value}
          className={value === choice.value ? 'tab is-on' : 'tab'}
          onClick={() => onChange(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </span>
  )
}

function Select<T extends string>({ label, value, choices, onChange }: { label: string; value: T; choices: readonly { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as T)}>
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  )
}

type PreviewState = 'idle' | 'playing' | 'revealing' | 'done'

/**
 * A small screen that plays the chosen transition once, from a sample picture to another, on request. It runs
 * the effect for its duration and reveals as soon as that ends, as with a picture that is already playing.
 */
function TransitionPreview({ settings }: { settings: TransitionSettings }) {
  const [state, setState] = useState<PreviewState>('idle')
  const [run, setRun] = useState(0)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), [])

  const play = () => {
    timers.current.forEach((id) => window.clearTimeout(id))
    timers.current = []
    setRun((value) => value + 1)
    const timing = transitionTiming(settings)
    if (settings.id === 'instant') {
      setState('done')
      return
    }
    setState('playing')
    const reveal = () => {
      if (timing.revealMs <= 0) return setState('done')
      setState('revealing')
      timers.current.push(window.setTimeout(() => setState('done'), timing.revealMs))
    }
    timers.current.push(window.setTimeout(reveal, Math.max(timing.durationMs, 1) + 260))
  }

  return (
    <div className="fx-preview-wrap">
      <div className="fx-preview" aria-label="Transition preview">
        <div className={state === 'idle' ? 'fx-preview-picture' : 'fx-preview-picture is-next'} aria-hidden="true">
          <span>{state === 'idle' ? 'Now watching' : SAMPLE.name}</span>
        </div>
        {state === 'playing' || state === 'revealing' ? (
          <TransitionOverlay key={run} settings={settings} identity={SAMPLE} revealing={state === 'revealing'} contained />
        ) : null}
      </div>
      <button type="button" className="tab" onClick={play}>
        {state === 'idle' ? 'Preview' : 'Replay'}
      </button>
    </div>
  )
}

/** OPTIONS → Channel change: the transition, its look and its title card, with only the controls it uses. */
export function ChannelChangeOptions({ settings, onChange }: { settings: TransitionSettings; onChange: (next: TransitionSettings) => void }) {
  const definition = TRANSITIONS[settings.id]
  const set = (patch: Partial<TransitionSettings>) => onChange({ ...settings, ...patch })
  const card = (patch: Partial<TitleCard>) => onChange({ ...settings, card: { ...settings.card, ...patch } })
  const toggle = (on: boolean, label: string, action: () => void) => (
    <button type="button" className={on ? 'tab is-on' : 'tab'} aria-pressed={on} onClick={action}>
      {label}
    </button>
  )

  return (
    <div className="channel-change">
      <Row label="Transition">
        <Select label="Transition" value={settings.id} choices={TRANSITION_IDS.map((id) => ({ value: id, label: TRANSITIONS[id].label }))} onChange={(id) => set({ id })} />
      </Row>
      <p className="options-note">{definition.note}</p>
      <TransitionPreview settings={settings} />
      {definition.speed ? (
        <Row label="Speed">
          <Choices label="Speed" value={settings.speed} choices={SPEEDS} onChange={(speed) => set({ speed })} />
        </Row>
      ) : null}
      {definition.colour ? (
        <Row label="Colour">
          <Select label="Colour" value={settings.colour} choices={COLOURS} onChange={(colour) => set({ colour })} />
        </Row>
      ) : null}
      {definition.grain ? (
        <Row label="Grain">
          <Choices label="Grain" value={settings.grain} choices={GRAINS} onChange={(grain) => set({ grain })} />
        </Row>
      ) : null}
      {definition.cardAt !== null ? (
        <>
          <Row label="Title card">{toggle(settings.card.show, settings.card.show ? 'On' : 'Off', () => card({ show: !settings.card.show }))}</Row>
          {settings.card.show ? (
            <>
              <Row label="Shows">
                <span className="options-choices">
                  {toggle(settings.card.number, 'Number', () => card({ number: !settings.card.number }))}
                  {toggle(settings.card.name, 'Name', () => card({ name: !settings.card.name }))}
                  {toggle(settings.card.programme, 'Programme', () => card({ programme: !settings.card.programme }))}
                </span>
              </Row>
              <Row label="Position">
                <Select label="Title card position" value={settings.card.position} choices={CARD_POSITIONS} onChange={(position) => card({ position })} />
              </Row>
              <Row label="Size">
                <Choices label="Title card size" value={settings.card.size} choices={CARD_SIZES} onChange={(size) => card({ size })} />
              </Row>
              <label className="options-row">
                <span className="options-label">Opacity</span>
                <span className="options-control">
                  <input
                    type="range"
                    min={CARD_OPACITY_MIN}
                    max={1}
                    step={0.05}
                    value={settings.card.opacity}
                    onChange={(event) => card({ opacity: Number(event.target.value) })}
                  />
                  <output className="options-value">{Math.round(settings.card.opacity * 100)}%</output>
                </span>
              </label>
              <Row label="Panel">
                <Select label="Title card panel" value={settings.card.panel} choices={CARD_PANELS} onChange={(panel) => card({ panel })} />
              </Row>
              <Row label="Lettering">
                <Select label="Title card lettering" value={settings.card.type} choices={CARD_TYPES} onChange={(type) => card({ type })} />
                <Select label="Title card accent" value={settings.card.accent} choices={CARD_ACCENTS} onChange={(accent) => card({ accent })} />
              </Row>
            </>
          ) : null}
        </>
      ) : null}
      <div className="options-foot">
        <button type="button" className="tab" onClick={() => onChange({ ...DEFAULT_TRANSITION_SETTINGS })}>
          Reset to default
        </button>
      </div>
    </div>
  )
}
