import { channelByNumber, listChannels } from '../data/catalogue.ts'
import { SESSION_CHANNEL_NUMBER } from '../session/session-channel.ts'
import type { TvCommand } from '../types/input.ts'
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
): StartupTuning | null {
  // A new session starts with an empty session channel, so it is never the place to resume: a viewer
  // who left on 000 comes back to the channel they watched before it.
  const leftOnSession = stored.lastChannelNumber === SESSION_CHANNEL_NUMBER
  const resume = leftOnSession ? stored.previousChannelNumber : stored.lastChannelNumber
  const saved = resume === null || resume === SESSION_CHANNEL_NUMBER ? undefined : channelByNumber(resume)
  const start = restore.target(saved, listChannels())
  if (!start) return null
  const previous = leftOnSession ? null : stored.previousChannelNumber
  return {
    channelNumber: start.number,
    previousNumber:
      previous !== null && previous !== start.number && previous !== SESSION_CHANNEL_NUMBER && channelByNumber(previous)
        ? previous
        : null,
  }
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
): () => void {
  let settled = false
  let cancelled = false
  const stall = setTimeout(() => {
    if (!settled && !cancelled) onPhase('failed')
  }, stallMs)
  const settle = (phase: Exclude<StartupPhase, 'loading'>) => {
    if (cancelled || settled) return
    settled = true
    clearTimeout(stall)
    onPhase(phase)
  }
  load().then(
    (usable) => settle(usable ? 'ready' : 'failed'),
    () => settle('failed'),
  )
  return () => {
    cancelled = true
    clearTimeout(stall)
  }
}
