import type { ProgrammeType } from '../types/programme.ts'
import { daysBetween } from './time.ts'
import type { BroadcastUse, RepeatRule } from './types.ts'

/**
 * Programme-type repeat rules. These are the network defaults, not a hidden constant
 * inside the compiler. A policy may override them per type.
 */
export const REPEAT_RULES: Record<'default' | ProgrammeType, RepeatRule> = {
  default: { minimumGapDays: 1, preferredGapDays: 4, maxBroadcasts7d: 4, maxBroadcasts30d: 12 },
  film: { minimumGapDays: 6, preferredGapDays: 14, maxBroadcasts7d: 1, maxBroadcasts30d: 3 },
  episode: { minimumGapDays: 2, preferredGapDays: 7, maxBroadcasts7d: 2, maxBroadcasts30d: 6 },
  documentary: { minimumGapDays: 4, preferredGapDays: 10, maxBroadcasts7d: 2, maxBroadcasts30d: 4 },
  short: { minimumGapDays: 0, preferredGapDays: 2, maxBroadcasts7d: 6, maxBroadcasts30d: 16 },
  news: { minimumGapDays: 0, preferredGapDays: 1, maxBroadcasts7d: 8, maxBroadcasts30d: 20 },
  sport: { minimumGapDays: 1, preferredGapDays: 4, maxBroadcasts7d: 3, maxBroadcasts30d: 8 },
  gameplay: { minimumGapDays: 1, preferredGapDays: 4, maxBroadcasts7d: 3, maxBroadcasts30d: 8 },
  'classic-match': { minimumGapDays: 5, preferredGapDays: 12, maxBroadcasts7d: 1, maxBroadcasts30d: 3 },
  highlights: { minimumGapDays: 1, preferredGapDays: 3, maxBroadcasts7d: 4, maxBroadcasts30d: 10 },
  analysis: { minimumGapDays: 1, preferredGapDays: 4, maxBroadcasts7d: 3, maxBroadcasts30d: 8 },
  music: { minimumGapDays: 0, preferredGapDays: 1, maxBroadcasts7d: 10, maxBroadcasts30d: 30 },
  'music-video': { minimumGapDays: 0, preferredGapDays: 1, maxBroadcasts7d: 12, maxBroadcasts30d: 40 },
  'music-block': { minimumGapDays: 1, preferredGapDays: 4, maxBroadcasts7d: 3, maxBroadcasts30d: 8 },
  concert: { minimumGapDays: 3, preferredGapDays: 10, maxBroadcasts7d: 1, maxBroadcasts30d: 3 },
  interview: { minimumGapDays: 2, preferredGapDays: 7, maxBroadcasts7d: 2, maxBroadcasts30d: 5 },
  continuity: { minimumGapDays: 0, preferredGapDays: 0, maxBroadcasts7d: 48, maxBroadcasts30d: 200 },
  ident: { minimumGapDays: 0, preferredGapDays: 0, maxBroadcasts7d: 48, maxBroadcasts30d: 200 },
  advert: { minimumGapDays: 0, preferredGapDays: 0, maxBroadcasts7d: 30, maxBroadcasts30d: 80 },
  trailer: { minimumGapDays: 0, preferredGapDays: 1, maxBroadcasts7d: 8, maxBroadcasts30d: 20 },
  promo: { minimumGapDays: 0, preferredGapDays: 1, maxBroadcasts7d: 8, maxBroadcasts30d: 20 },
  'test-card': { minimumGapDays: 0, preferredGapDays: 0, maxBroadcasts7d: 20, maxBroadcasts30d: 60 },
  closedown: { minimumGapDays: 0, preferredGapDays: 1, maxBroadcasts7d: 8, maxBroadcasts30d: 20 },
  radio: { minimumGapDays: 0, preferredGapDays: 1, maxBroadcasts7d: 8, maxBroadcasts30d: 24 },
  live: { minimumGapDays: 0, preferredGapDays: 0, maxBroadcasts7d: 20, maxBroadcasts30d: 60 },
  webcam: { minimumGapDays: 0, preferredGapDays: 0, maxBroadcasts7d: 20, maxBroadcasts30d: 60 },
  generated: { minimumGapDays: 0, preferredGapDays: 0, maxBroadcasts7d: 48, maxBroadcasts30d: 200 },
  unclassified: { minimumGapDays: 1, preferredGapDays: 4, maxBroadcasts7d: 4, maxBroadcasts30d: 12 },
}

export const PRIME_REPEAT_PENALTY = 25

export function ruleFor(
  programmeType: ProgrammeType,
  overrides?: Partial<Record<ProgrammeType, RepeatRule>>,
): RepeatRule {
  return overrides?.[programmeType] ?? REPEAT_RULES[programmeType] ?? REPEAT_RULES.default
}

export interface RepeatDecision {
  status: 'ok' | 'penalized' | 'blocked'
  penalty: number
  reasons: string[]
}

export function repeatDecision(
  mediaItemId: string,
  history: readonly BroadcastUse[],
  today: string,
  rule: RepeatRule,
  primeSlot: boolean,
): RepeatDecision {
  const mine = history.filter((use) => use.mediaItemId === mediaItemId && use.broadcastDate <= today)
  if (mine.length === 0) return { status: 'ok', penalty: 0, reasons: [] }

  const gaps = mine.map((use) => daysBetween(use.broadcastDate, today))
  const closest = Math.min(...gaps)
  const in7 = gaps.filter((gap) => gap <= 7).length
  const in30 = gaps.filter((gap) => gap <= 30).length
  const reasons: string[] = []

  if (closest < rule.minimumGapDays) reasons.push('minimum-gap')
  if (in7 >= rule.maxBroadcasts7d) reasons.push('max-7d')
  if (in30 >= rule.maxBroadcasts30d) reasons.push('max-30d')
  if (reasons.length > 0) return { status: 'blocked', penalty: 0, reasons }

  let penalty = 0
  if (closest < rule.preferredGapDays) {
    penalty += (rule.preferredGapDays - closest) * 3
    reasons.push('preferred-gap')
  }
  if (primeSlot && mine.some((use) => use.primeTime && daysBetween(use.broadcastDate, today) < rule.preferredGapDays)) {
    penalty += PRIME_REPEAT_PENALTY
    reasons.push('prime-repeat')
  }
  return penalty > 0 ? { status: 'penalized', penalty, reasons } : { status: 'ok', penalty: 0, reasons }
}

export interface HistorySummary {
  lastBroadcast: string | null
  broadcastCount7d: number
  broadcastCount30d: number
  lastPrimeTimeBroadcast: string | null
}

export function summariseUses(mediaItemId: string, history: readonly BroadcastUse[], today: string): HistorySummary {
  const mine = history.filter((use) => use.mediaItemId === mediaItemId && use.broadcastDate < today)
  let lastBroadcast: string | null = null
  let lastPrime: string | null = null
  let in7 = 0
  let in30 = 0
  for (const use of mine) {
    const gap = daysBetween(use.broadcastDate, today)
    if (gap <= 30) in30 += 1
    if (gap <= 7) in7 += 1
    if (!lastBroadcast || use.broadcastDate > lastBroadcast) lastBroadcast = use.broadcastDate
    if (use.primeTime && (!lastPrime || use.broadcastDate > lastPrime)) lastPrime = use.broadcastDate
  }
  return { lastBroadcast, broadcastCount7d: in7, broadcastCount30d: in30, lastPrimeTimeBroadcast: lastPrime }
}
