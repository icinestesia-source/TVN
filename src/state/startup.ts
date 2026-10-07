import { channelByNumber, listChannels } from '../data/catalogue.ts'
import { isLocalMediaNumber } from '../session/session-channel.ts'
import type { TvCommand } from '../types/input.ts'
import { TVN_CHANNEL_NUMBER } from '../tvn/tvn-channel.ts'
import type { StartupRestore } from './startup-channel.ts'

export type StartupPhase = 'loading' | 'ready' | 'failed'

/**
 * Failure detection only: readiness is reached when loading finishes and never waits on this. A start
 * still loading after a minute has stalled (an unanswered request or a storage call that never returns).
 */
export const STARTUP_STALL_MS = 60_000

/** Until the network and the first channel are settled, nothing may act on the half-built tuning state. */
export function startupAccepts(phase: StartupPhase, command: TvCommand): boolean {
  return phase === 'ready' || command.type === 'fullscreen'
}

/** The 000–999 network can air once the shipped independent catalogue is in the library, fresh or restored. */
export function independentNetworkLoaded(items: readonly { ingestedFrom?: string }[]): boolean {
  return items.some((item) => item.ingestedFrom === 'youtube-discovery')
}

export interface StartupTuning {
  channelNumber: number
  previousNumber: number | null
}

/**
 * The first tuned channel and the previous-channel memory, resolved once against the loaded network and
 * user channels. The stored channel is restored when it is on air; the stored previous channel is kept
 * only when it still exists and differs, so the start itself never becomes a history entry.
 */
export function resolveStartupTuning(
  restore: StartupRestore,
  stored: { lastChannelNumber: number; previousChannelNumber: number | null },
  entry: 'television' | 'tvn' = 'television',
): StartupTuning | null {
  // The /tvn entry asks for surfing from the first moment, which is what 000 is.
  if (entry === 'tvn') stored = { lastChannelNumber: TVN_CHANNEL_NUMBER, previousChannelNumber: null }
  // A new session starts with an empty session channel, so it is never the place to resume: a viewer
  // who left on 000 comes back to the channel they watched before it.
  const leftOnSession = stored.lastChannelNumber !== null && isLocalMediaNumber(stored.lastChannelNumber)
  const resume = leftOnSession ? stored.previousChannelNumber : stored.lastChannelNumber
  const saved = resume === null || isLocalMediaNumber(resume) ? undefined : channelByNumber(resume)
  const start = restore.target(saved, listChannels())
  if (!start) return null
  const previous = leftOnSession ? null : stored.previousChannelNumber
  return {
    channelNumber: start.number,
    previousNumber:
      previous !== null && previous !== start.number && !isLocalMediaNumber(previous) && channelByNumber(previous)
        ? previous
        : null,
  }
}

/** One line naming what stopped the start, for the console: the viewer only ever sees the off-air card. */
export function startupReason(error: unknown): string {
  if (error instanceof Error || (typeof DOMException !== 'undefined' && error instanceof DOMException)) {
    const { name, message } = error as Error
    return `${name}: ${message}`.slice(0, 300)
  }
  return String(error).slice(0, 300)
}

/**
 * Runs the startup load. `load` resolves true when the network is usable; false or a rejection is a
 * failure. The phase leaves 'loading' only when the load settles, or when it stalls past `stallMs`;
 * a stalled start that later completes still becomes ready.
 */
export function runStartup(
  load: () => Promise<boolean>,
  onPhase: (phase: Exclude<StartupPhase, 'loading'>) => void,
  stallMs = STARTUP_STALL_MS,
  report: (reason: string) => void = () => undefined,
): () => void {
  let settled = false
  let cancelled = false
  const stall = setTimeout(() => {
    if (settled || cancelled) return
    report(`still loading after ${Math.round(stallMs / 1000)} s`)
    onPhase('failed')
  }, stallMs)
  const settle = (phase: Exclude<StartupPhase, 'loading'>) => {
    if (cancelled || settled) return
    settled = true
    clearTimeout(stall)
    onPhase(phase)
  }
  load().then(
    (usable) => {
      if (!usable && !cancelled && !settled) report('the shipped network did not load')
      settle(usable ? 'ready' : 'failed')
    },
    (error: unknown) => {
      if (!cancelled && !settled) report(startupReason(error))
      settle('failed')
    },
  )
  return () => {
    cancelled = true
    clearTimeout(stall)
  }
}
