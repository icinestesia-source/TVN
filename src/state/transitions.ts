/**
 * How a channel change is presented. A transition only shapes the moment between a press and the channel
 * committing: the provider is asked for the new channel at once either way, and no transition waits for it.
 * Until the new picture is really playing, the stage's own cover stands in for it (src/player/picture.ts).
 */
export type TransitionId = 'instant' | 'tv-tune'

export interface TuneTransition {
  id: TransitionId
  label: string
  note: string
  /** How long a press waits for another (a run of CH+, say) before the tune starts. */
  settleMs: number
  /** The shortest time the tune is presented for, counted from the first press. */
  minMs: number
  /** Analogue static with the channel's ident while the tune is presented. */
  showsStatic: boolean
}

export const TRANSITIONS: Record<TransitionId, TuneTransition> = {
  instant: {
    id: 'instant',
    label: 'Instant',
    note: 'The channel changes at once; the picture follows when it is ready.',
    settleMs: 0,
    minMs: 0,
    showsStatic: false,
  },
  'tv-tune': {
    id: 'tv-tune',
    label: 'TV tune',
    note: 'A moment of static with the channel’s number, as a television tunes.',
    settleMs: 220,
    minMs: 520,
    showsStatic: true,
  },
}

export const TRANSITION_IDS: readonly TransitionId[] = ['tv-tune', 'instant']
export const DEFAULT_TRANSITION: TransitionId = 'tv-tune'
export const TRANSITION_KEY = 'tvn.transition.v1'

type Store = Pick<Storage, 'getItem' | 'setItem'>

function browserStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function asTransition(value: unknown): TransitionId {
  return typeof value === 'string' && (TRANSITION_IDS as readonly string[]).includes(value) ? (value as TransitionId) : DEFAULT_TRANSITION
}

export function loadTransition(store: Store | null = browserStore()): TransitionId {
  try {
    return asTransition(store?.getItem(TRANSITION_KEY))
  } catch {
    return DEFAULT_TRANSITION
  }
}

export function saveTransition(id: TransitionId, store: Store | null = browserStore()): void {
  try {
    store?.setItem(TRANSITION_KEY, asTransition(id))
  } catch {
    // Blocked storage keeps the choice for this visit only.
  }
}
