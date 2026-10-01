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
