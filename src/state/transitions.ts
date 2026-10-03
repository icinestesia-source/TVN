/**
 * How a channel change is presented. A transition shapes only the moment between a press and the new picture:
 * the provider is asked for the channel once the press settles, whatever the transition, and none waits for
 * it. Tuning, schedules and the player are shared; a definition here controls presentation alone.
 *
 * Every transition runs in three phases: ENTER (its effect starts over the old picture), IDENTIFY (the new
 * channel's title card shows, from `cardAt` until the picture is ready) and REVEAL (the effect gives way to the
 * picture: a cut, or a short fade). The channel commits after `durationMs`; when its picture is not playing by
 * then, the effect and the card stay on until it is, so the card never leaves the viewer looking at nameless
 * static. A tune started while one is presenting takes it over, with the newest channel's identity.
 */
export type TransitionId = 'instant' | 'tv-tune' | 'analogue' | 'crt' | 'glitch' | 'fade' | 'flash'
export type TransitionEffect = 'none' | 'tune' | 'analogue' | 'crt' | 'glitch' | 'fade' | 'flash'
export type TransitionPhase = 'enter' | 'identify' | 'reveal'

export type TransitionColour = 'mono' | 'warm' | 'cool' | 'green' | 'amber' | 'accent'
export type TransitionGrain = 'coarse' | 'normal' | 'fine'
export type CardPosition = 'centre' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type CardSize = 'small' | 'medium' | 'large'
export type CardPanel = 'box' | 'band' | 'none'
export type CardType = 'tvn' | 'mono'
export type CardAccent = 'gold' | 'white' | 'green' | 'amber' | 'cool'

export interface TransitionDefinition {
  id: TransitionId
  label: string
  note: string
  effect: TransitionEffect
  /** Press to commit at Normal speed. */
  durationMs: number
  /** How long a press waits for another (a run of CH+, say) before the provider is asked. */
  settleMs: number
  /** When the title card appears, as a share of the duration; null for a transition without one. */
  cardAt: number | null
  /** The effect's fade into the playing picture; 0 is a clean cut. */
  revealMs: number
  /** Which of the viewer's controls mean anything for this effect. */
  speed: boolean
  colour: boolean
  grain: boolean
}

export const TRANSITIONS: Record<TransitionId, TransitionDefinition> = {
  'tv-tune': {
    id: 'tv-tune',
    label: 'TV tune',
    note: 'A moment of static with the channel’s number, as a television tunes.',
    effect: 'tune',
    durationMs: 520,
    settleMs: 220,
    cardAt: 0,
    revealMs: 0,
    speed: true,
    colour: true,
    grain: true,
  },
  instant: {
    id: 'instant',
    label: 'Instant',
    note: 'The channel changes at once; the picture follows when it is ready.',
    effect: 'none',
    durationMs: 0,
    settleMs: 0,
    cardAt: null,
    revealMs: 0,
    speed: false,
    colour: false,
    grain: false,
  },
  analogue: {
    id: 'analogue',
    label: 'Analogue static',
    note: 'Heavy snow with a rolling hold bar and scan lines.',
    effect: 'analogue',
    durationMs: 800,
    settleMs: 220,
    cardAt: 0.15,
    revealMs: 0,
    speed: true,
    colour: true,
    grain: true,
  },
  crt: {
    id: 'crt',
    label: 'CRT collapse',
    note: 'The old picture collapses to a line and a dot, then the channel’s card.',
    effect: 'crt',
    durationMs: 650,
    settleMs: 220,
    cardAt: 0.55,
    revealMs: 0,
    speed: true,
    colour: true,
    grain: false,
  },
  glitch: {
    id: 'glitch',
    label: 'Signal glitch',
    note: 'A brief interruption: torn lines and a dropped signal.',
    effect: 'glitch',
    durationMs: 560,
    settleMs: 220,
    cardAt: 0.2,
    revealMs: 0,
    speed: true,
    colour: true,
    grain: true,
  },
  fade: {
    id: 'fade',
    label: 'Fade',
    note: 'Down to black with the channel’s card, and up into the picture.',
    effect: 'fade',
    durationMs: 600,
    settleMs: 220,
    cardAt: 0.4,
    revealMs: 240,
    speed: true,
    colour: false,
    grain: false,
  },
  flash: {
    id: 'flash',
    label: 'Cut & flash',
    note: 'A broadcast cut behind a quick white flash; no card.',
    effect: 'flash',
    durationMs: 200,
    settleMs: 120,
    cardAt: null,
    revealMs: 0,
    speed: true,
    colour: true,
    grain: false,
  },
}

export const TRANSITION_IDS: readonly TransitionId[] = ['tv-tune', 'instant', 'analogue', 'crt', 'glitch', 'fade', 'flash']
export const DEFAULT_TRANSITION: TransitionId = 'tv-tune'

export const SPEEDS: readonly { value: number; label: string }[] = [
  { value: 0.5, label: 'Faster' },
  { value: 0.75, label: 'Fast' },
  { value: 1, label: 'Normal' },
  { value: 1.5, label: 'Slow' },
  { value: 2, label: 'Slower' },
]
export const COLOURS: readonly { value: TransitionColour; label: string }[] = [
  { value: 'mono', label: 'Mono' },
  { value: 'warm', label: 'Warm' },
  { value: 'cool', label: 'Cool' },
  { value: 'green', label: 'Green' },
  { value: 'amber', label: 'Amber' },
  { value: 'accent', label: 'TVN gold' },
]
export const GRAINS: readonly { value: TransitionGrain; label: string }[] = [
  { value: 'coarse', label: 'Coarse' },
  { value: 'normal', label: 'Normal' },
  { value: 'fine', label: 'Fine' },
]
export const CARD_POSITIONS: readonly { value: CardPosition; label: string }[] = [
  { value: 'centre', label: 'Centre' },
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
]
export const CARD_SIZES: readonly { value: CardSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
]
export const CARD_PANELS: readonly { value: CardPanel; label: string }[] = [
  { value: 'box', label: 'Box' },
  { value: 'band', label: 'Band' },
  { value: 'none', label: 'None' },
]
export const CARD_TYPES: readonly { value: CardType; label: string }[] = [
  { value: 'tvn', label: 'TVN' },
  { value: 'mono', label: 'Typewriter' },
]
export const CARD_ACCENTS: readonly { value: CardAccent; label: string }[] = [
  { value: 'gold', label: 'Gold' },
  { value: 'white', label: 'White' },
  { value: 'green', label: 'Green' },
  { value: 'amber', label: 'Amber' },
  { value: 'cool', label: 'Cool' },
]
export const CARD_OPACITY_MIN = 0.4

/** The title card: what it shows and how. Always the identity of the channel being tuned to. */
export interface TitleCard {
  show: boolean
  number: boolean
  name: boolean
  programme: boolean
  position: CardPosition
  size: CardSize
  /** 0.4–1. */
  opacity: number
  panel: CardPanel
  type: CardType
  accent: CardAccent
}

/** The viewer's choice: one transition and how it looks. Colour, grain and speed apply where the effect uses them. */
export interface TransitionSettings {
  id: TransitionId
  speed: number
  colour: TransitionColour
  grain: TransitionGrain
  card: TitleCard
}

export const DEFAULT_CARD: TitleCard = {
  show: true,
  number: true,
  name: true,
  programme: true,
  position: 'centre',
  size: 'medium',
  opacity: 1,
  panel: 'box',
  type: 'tvn',
  accent: 'gold',
}

export const DEFAULT_TRANSITION_SETTINGS: TransitionSettings = { id: DEFAULT_TRANSITION, speed: 1, colour: 'mono', grain: 'normal', card: DEFAULT_CARD }

export interface TransitionTiming {
  settleMs: number
  /** Press to commit. */
  durationMs: number
  /** Press to title card; null when no card shows. */
  cardAtMs: number | null
  revealMs: number
}

export function transitionTiming(settings: TransitionSettings): TransitionTiming {
  const definition = TRANSITIONS[settings.id]
  const durationMs = Math.round(definition.durationMs * (definition.speed ? settings.speed : 1))
  const card = definition.cardAt !== null && settings.card.show
  return {
    settleMs: definition.settleMs,
    durationMs,
    cardAtMs: card ? Math.round((definition.cardAt ?? 0) * durationMs) : null,
    revealMs: definition.revealMs,
  }
}

/**
 * Where a presentation stands `elapsedMs` after the press. REVEAL needs both the duration run and the picture
 * ready; until then the card holds (IDENTIFY) or the effect runs on (ENTER).
 */
export function transitionPhase(timing: TransitionTiming, elapsedMs: number, pictureReady: boolean): TransitionPhase {
  if (pictureReady && elapsedMs >= timing.durationMs) return 'reveal'
  return timing.cardAtMs !== null && elapsedMs >= timing.cardAtMs ? 'identify' : 'enter'
}

/** A channel change being presented: `number` is always the newest channel asked for. */
export interface Presentation {
  /** One per presentation; a tune during one keeps it, so the effect is not restarted. */
  session: number
  number: number
  settings: TransitionSettings
  /** The channel the title card names when it is not `number`: 000 surfing shows the channel it has just joined. */
  cardNumber?: number
}

/**
 * The channel whose transition is on screen, or null once the picture (or one of TVN's faces) has it. While the
 * tune is pending, the channel being tuned to; after it commits, that channel for as long as its picture is
 * still covered. Never a channel other than the one asked for last.
 */
export function presentedChannel(state: {
  presentation: Presentation | null
  tuningNumber: number | null
  channelNumber: number
  covered: boolean
  single: boolean
}): number | null {
  const { presentation } = state
  if (!presentation || !state.single || presentation.settings.id === 'instant') return null
  if (state.tuningNumber !== null) return state.tuningNumber === presentation.number ? presentation.number : null
  return state.covered && state.channelNumber === presentation.number ? presentation.number : null
}

// ——— Saved settings ———

export const TRANSITION_KEY = 'tvn.transition.v2'
/** 2.0's first release saved the transition's id alone. */
export const LEGACY_TRANSITION_KEY = 'tvn.transition.v1'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const oneOf = <T extends string>(choices: readonly { value: T }[], value: unknown): value is T => choices.some((choice) => choice.value === value)

export function asTransition(value: unknown): TransitionId {
  return typeof value === 'string' && (TRANSITION_IDS as readonly string[]).includes(value) ? (value as TransitionId) : DEFAULT_TRANSITION
}

/** Anything stored or restored, made whole: each missing or unknown field takes its default. */
export function asTransitionSettings(value: unknown): TransitionSettings {
  if (typeof value === 'string') return { ...DEFAULT_TRANSITION_SETTINGS, id: asTransition(value) }
  if (!isRecord(value)) return { ...DEFAULT_TRANSITION_SETTINGS }
  const card = isRecord(value.card) ? value.card : {}
  const flag = (name: keyof TitleCard) => (typeof card[name] === 'boolean' ? (card[name] as boolean) : (DEFAULT_CARD[name] as boolean))
  const opacity = typeof card.opacity === 'number' && Number.isFinite(card.opacity) ? Math.min(1, Math.max(CARD_OPACITY_MIN, card.opacity)) : DEFAULT_CARD.opacity
  return {
    id: asTransition(value.id),
    speed: SPEEDS.some((speed) => speed.value === value.speed) ? (value.speed as number) : DEFAULT_TRANSITION_SETTINGS.speed,
    colour: oneOf(COLOURS, value.colour) ? value.colour : DEFAULT_TRANSITION_SETTINGS.colour,
    grain: oneOf(GRAINS, value.grain) ? value.grain : DEFAULT_TRANSITION_SETTINGS.grain,
    card: {
      show: flag('show'),
      number: flag('number'),
      name: flag('name'),
      programme: flag('programme'),
      position: oneOf(CARD_POSITIONS, card.position) ? card.position : DEFAULT_CARD.position,
      size: oneOf(CARD_SIZES, card.size) ? card.size : DEFAULT_CARD.size,
      opacity: Math.round(opacity * 100) / 100,
      panel: oneOf(CARD_PANELS, card.panel) ? card.panel : DEFAULT_CARD.panel,
      type: oneOf(CARD_TYPES, card.type) ? card.type : DEFAULT_CARD.type,
      accent: oneOf(CARD_ACCENTS, card.accent) ? card.accent : DEFAULT_CARD.accent,
    },
  }
}

/** Every fault in a restored transition setting; a present field must already be valid. */
export function transitionSettingsErrors(value: unknown, at: string): string[] {
  if (!isRecord(value)) return [`${at} is not an object`]
  const errors: string[] = []
  if (value.id !== undefined && !(TRANSITION_IDS as readonly unknown[]).includes(value.id)) errors.push(`${at}.id is not a transition`)
  if (value.speed !== undefined && !SPEEDS.some((speed) => speed.value === value.speed)) errors.push(`${at}.speed is not one of ${SPEEDS.map((speed) => speed.value).join(', ')}`)
  if (value.colour !== undefined && !oneOf(COLOURS, value.colour)) errors.push(`${at}.colour is not a colour`)
  if (value.grain !== undefined && !oneOf(GRAINS, value.grain)) errors.push(`${at}.grain is not a grain`)
  if (value.card === undefined) return errors
  if (!isRecord(value.card)) return [...errors, `${at}.card is not an object`]
  const card = value.card
  for (const name of ['show', 'number', 'name', 'programme'] as const) {
    if (card[name] !== undefined && typeof card[name] !== 'boolean') errors.push(`${at}.card.${name} is not true or false`)
  }
  if (card.opacity !== undefined && !(typeof card.opacity === 'number' && card.opacity >= CARD_OPACITY_MIN && card.opacity <= 1)) errors.push(`${at}.card.opacity is not ${CARD_OPACITY_MIN}–1`)
  const lists = { position: CARD_POSITIONS, size: CARD_SIZES, panel: CARD_PANELS, type: CARD_TYPES, accent: CARD_ACCENTS } as const
  for (const [name, choices] of Object.entries(lists)) {
    if (card[name] !== undefined && !oneOf(choices as readonly { value: string }[], card[name])) errors.push(`${at}.card.${name} is not a choice`)
  }
  return errors
}

type Store = Pick<Storage, 'getItem' | 'setItem'>

function browserStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadTransitionSettings(store: Store | null = browserStore()): TransitionSettings {
  try {
    const saved = store?.getItem(TRANSITION_KEY)
    if (saved) return asTransitionSettings(JSON.parse(saved))
    const legacy = store?.getItem(LEGACY_TRANSITION_KEY)
    return asTransitionSettings(legacy ?? undefined)
  } catch {
    return { ...DEFAULT_TRANSITION_SETTINGS }
  }
}

export function saveTransitionSettings(settings: TransitionSettings, store: Store | null = browserStore()): void {
  try {
    store?.setItem(TRANSITION_KEY, JSON.stringify(asTransitionSettings(settings)))
  } catch {
    // Blocked storage keeps the choice for this visit only.
  }
}
