import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  CARD_ACCENTS,
  CARD_OPACITY_MIN,
  CARD_PANELS,
  CARD_POSITIONS,
  CARD_SIZES,
  CARD_TYPES,
  COLOUR_SETS,
  COLOURS,
  DEFAULT_TRANSITION_SETTINGS,
  GRAINS,
  MAX_TRANSITION_COLOURS,
  SPEEDS,
  TRANSITION_IDS,
  TRANSITIONS,
  toggledColour,
  transitionTiming,
  withColours,
  type TitleCard,
  type TransitionSettings,
} from '../state/transitions.ts'
import { TINTS, TransitionOverlay, type CardIdentity } from './TransitionOverlay.tsx'

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

/** One colour or up to five, picked in order; Mono clears them. A combination replaces the colours picked. */
function ColourPicker({ settings, onChange }: { settings: TransitionSettings; onChange: (next: TransitionSettings) => void }) {
  const { colours } = settings
  const full = colours.length >= MAX_TRANSITION_COLOURS
  const matching = COLOUR_SETS.findIndex((set) => set.colours.length === colours.length && set.colours.every((colour, index) => colours[index] === colour))
  return (
    <>
      <Row label="Colour">
        <span className="options-choices fx-colours" role="group" aria-label="Colour">
          {COLOURS.map(({ value, label }) => {
            const order = colours.indexOf(value)
            const on = value === 'mono' ? colours.length === 0 : order >= 0
            return (
              <button
                key={value}
                type="button"
                className={on ? 'tab is-on' : 'tab'}
                aria-pressed={on}
                disabled={!on && full && value !== 'mono'}
                title={!on && full && value !== 'mono' ? `Up to ${MAX_TRANSITION_COLOURS} colours: take one out first` : undefined}
                onClick={() => onChange(withColours(settings, toggledColour(colours, value)))}
              >
                {TINTS[value] ? <i className="fx-swatch" style={{ background: TINTS[value] }} aria-hidden="true" /> : null}
                {label}
                {order >= 0 && colours.length > 1 ? <b className="fx-colour-order">{order + 1}</b> : null}
              </button>
            )
          })}
        </span>
      </Row>
      <Row label="Combinations">
        <select
          aria-label="Colour combinations"
          value={matching >= 0 ? String(matching) : ''}
          onChange={(event) => {
            const set = COLOUR_SETS[Number(event.target.value)]
            if (set) onChange(withColours(settings, set.colours))
          }}
        >
          <option value="" disabled>
            {colours.length > 1 ? 'Your own' : 'Choose…'}
          </option>
          {COLOUR_SETS.map((set, index) => (
            <option key={set.label} value={index}>
              {set.label}
            </option>
          ))}
        </select>
      </Row>
      <p className="options-note">
        {colours.length > 1
          ? `${colours.length} of ${MAX_TRANSITION_COLOURS} colours, swept through in the order picked.`
          : `Pick up to ${MAX_TRANSITION_COLOURS} colours to sweep through them; Mono for none.`}
      </p>
    </>
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
      {definition.colour ? <ColourPicker settings={settings} onChange={onChange} /> : null}
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
