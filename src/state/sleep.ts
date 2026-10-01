/** Minutes without a key, click or touch before RetroTV stops streaming. 0 is off. */
export const DEFAULT_SLEEP_MINUTES = 60
export const SLEEP_CHOICES: readonly number[] = [30, 60, 90, 120, 0]
export const SLEEP_WARNING_MS = 60_000

export type SleepPhase = 'off' | 'awake' | 'warning' | 'due'

export function asSleepMinutes(value: unknown): number {
  return typeof value === 'number' && SLEEP_CHOICES.includes(value) ? value : DEFAULT_SLEEP_MINUTES
}

/** Each press of SLEEP moves to the next setting: 30, 60, 90, 120, off, then round again. */
export function nextSleepMinutes(current: number): number {
  const index = SLEEP_CHOICES.indexOf(current)
  return SLEEP_CHOICES[(index + 1) % SLEEP_CHOICES.length]
}

export function sleepPhase(lastActivityMs: number, minutes: number, nowMs: number): SleepPhase {
  if (minutes <= 0) return 'off'
  const left = lastActivityMs + minutes * 60_000 - nowMs
  if (left <= 0) return 'due'
  return left <= SLEEP_WARNING_MS ? 'warning' : 'awake'
}

export function sleepLabel(minutes: number): string {
  return minutes > 0 ? `Sleep ${minutes}` : 'Sleep off'
}
