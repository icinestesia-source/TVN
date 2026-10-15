export type GuideMode = 'closed' | 'integrated' | 'expanded'

/** G opens the full-screen guide. Any open guide closes back to the picture. */
export function toggleGuide(mode: GuideMode): GuideMode {
  return mode === 'closed' ? 'expanded' : 'closed'
}

/** Video share of a desktop split. Neither side may become a sliver. */
export function clampGuideSplit(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.min(0.7, Math.max(0.3, value))
}

export function guideTuneDecision(
  startMs: number,
  endMs: number,
  nowMs: number,
): 'tune' | 'later' | 'ended' {
  if (nowMs >= startMs && nowMs < endMs) return 'tune'
  if (nowMs < startMs) return 'later'
  return 'ended'
}

/**
 * Choosing a Guide programme: on air, the channel is tuned (unless the viewer asked for the start); otherwise a
 * programme with a picture plays from its beginning, and one without says it is later or has ended.
 */
export function guidePickAction(startMs: number, endMs: number, nowMs: number, playable: boolean, fromStart = false): 'tune' | 'play' | 'later' | 'ended' {
  const decision = guideTuneDecision(startMs, endMs, nowMs)
  if (decision === 'tune' && !fromStart) return 'tune'
  if (playable) return 'play'
  return decision === 'later' ? 'later' : 'ended'
}
