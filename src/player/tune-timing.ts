/**
 * Phase timings for channel tuning, kept apart so a slow provider is never mistaken for a slow tune:
 * A press → channel committed, B committed → programme selected, C programme → provider request,
 * D request → player answered, E answered → playing. Bounded to the last few tunes; read in
 * development as `window.__tvnTunes`.
 */
export interface TuneTiming {
  id: number
  channelNumber: number
  pressedAt: number
  committedAt: number | null
  programmeAt: number | null
  /** Time spent working out what airs (schedule lookup), inside B. */
  scheduleMs: number | null
  requestAt: number | null
  answeredAt: number | null
  playingAt: number | null
  result: string | null
  superseded: boolean
}

const LIMIT = 40
const tunes: TuneTiming[] = []
let nextId = 0
const clock = () => performance.now()

export function tuneTimings(): readonly TuneTiming[] {
  return tunes
}

export function resetTuneTimings(): void {
  tunes.length = 0
}

const latest = (channelNumber: number) => {
  for (let index = tunes.length - 1; index >= 0; index -= 1) {
    if (tunes[index].channelNumber === channelNumber) return tunes[index]
  }
  return null
}

export function notePress(channelNumber: number): void {
  const last = tunes.at(-1)
  if (last && last.playingAt === null && last.result === null) last.superseded = true
  tunes.push({
    id: ++nextId,
    channelNumber,
    pressedAt: clock(),
    committedAt: null,
    programmeAt: null,
    scheduleMs: null,
    requestAt: null,
    answeredAt: null,
    playingAt: null,
    result: null,
    superseded: false,
  })
  if (tunes.length > LIMIT) tunes.splice(0, tunes.length - LIMIT)
}

type Phase = 'committedAt' | 'programmeAt' | 'requestAt' | 'answeredAt' | 'playingAt'

export function notePhase(channelNumber: number, phase: Phase, extra: Partial<Pick<TuneTiming, 'scheduleMs' | 'result'>> = {}): void {
  const tune = latest(channelNumber)
  if (!tune || tune[phase] !== null) return
  tune[phase] = clock()
  Object.assign(tune, extra)
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __tvnTunes: () => readonly TuneTiming[] }).__tvnTunes = tuneTimings
}
