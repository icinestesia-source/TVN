import type { ChannelEdit } from '../services/channel-editor.ts'
import type { MultiviewMode } from '../types/preferences.ts'

export type Arrangement = 'latest' | 'az' | 'random'
/** A Guide arrangement button: LATEST, A–Z, RANDOM, RESET, or LATEST right-clicked ('latest-now'). */
export type ArrangeAsk = Arrangement | 'latest-now' | 'reset'

const NAMES: Record<Arrangement | 'reset', string> = { latest: 'LATEST', az: 'A–Z', random: 'RANDOM', reset: 'RESET' }

/** Which of the three is on: LATEST only while it airs from a moment (`liveFromMs`), A–Z and RANDOM while their order stands. */
export function arrangementOn(edit: Pick<ChannelEdit, 'order' | 'orderKind' | 'liveFromMs'>): Arrangement | null {
  if (!edit.order?.length) return null
  if (edit.orderKind === 'latest') return edit.liveFromMs !== undefined ? 'latest' : null
  return edit.orderKind === 'az' || edit.orderKind === 'random' ? edit.orderKind : null
}

/**
 * What a press does. RESET, or LATEST and A–Z pressed while on, restore the schedule from before ('restore');
 * RESET with nothing on has nothing to do ('already-default'). RANDOM always deals again, and LATEST right-clicked
 * never switches off: it arranges newest first from now, whatever was on.
 */
export type ArrangePlan =
  | { step: 'arrange'; how: Arrangement; again: boolean; name: string }
  | { step: 'restore'; how: Arrangement | 'reset'; again: boolean; name: string }
  | { step: 'already-default'; how: 'reset'; again: boolean; name: string }

export function arrangePlan(asked: ArrangeAsk, on: Arrangement | null): ArrangePlan {
  const again = asked === 'latest-now'
  const how = again ? 'latest' : (asked as Arrangement | 'reset')
  const name = NAMES[how]
  if (how === 'reset' && on === null) return { how: 'reset', again, name, step: 'already-default' }
  if (how === 'reset' || (on === how && how !== 'random' && !again)) return { how, again, name, step: 'restore' }
  return { how: how as Arrangement, again, name, step: 'arrange' }
}

/** A schedule changed from the Guide replays at once only on the channel being watched, in single view; others wait to be chosen. */
export function replaysHere(number: number, watched: number, mode: MultiviewMode): boolean {
  return number === watched && mode === '1'
}
