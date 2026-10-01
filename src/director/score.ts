import { tieBreak } from './prng.ts'
import { repeatDecision, ruleFor } from './repeat.ts'
import { broadcastMinute, daysBetween } from './time.ts'
import type { BroadcastUse, MediaItem, ProgrammingPolicy, TemplateBlock } from './types.ts'

const EXHAUSTED_BASE = 10_000
const EXHAUSTED_PER_DAY = 200


/** Editorial weights. Selection sorts on the total. The tie key only breaks equal scores. */
export const SCORE = {
  channelTopic: 28,
  blockType: 36,
  editorial: 3,
  freshness: 8,
  quality: 6,
  durationClose: 30,
  durationFair: 14,
  durationLoose: 4,
  creator: 12,
  affinity: 72,
  /** With freshness, outweighs the widest affinity spread, so a channel airs its unaired pool before rerunning the week's programmes. */
  rerun: 72,
  series: 14,
  topic: 8,
} as const

export interface PlacementState {
  creators: Map<string, number>
  series: Map<string, number>
  topics: Map<string, number>
  history: BroadcastUse[]
  usesById: Map<string, BroadcastUse[]>
}

export function emptyPlacement(history: readonly BroadcastUse[] = []): PlacementState {
  const usesById = new Map<string, BroadcastUse[]>()
  for (const use of history) usesById.set(use.mediaItemId, [...(usesById.get(use.mediaItemId) ?? []), use])
  return { creators: new Map(), series: new Map(), topics: new Map(), history: [...history], usesById }
}

export interface ScoreResult {
  total: number
  tie: number
  penalties: string[]
  blocked: boolean
}

function daypartWeight(policy: ProgrammingPolicy, block: TemplateBlock, type: MediaItem['programmeType']): number {
  const minute = broadcastMinute(block.start, policy.broadcastDayStart)
  for (const part of policy.dayparts) {
    const start = broadcastMinute(part.start, policy.broadcastDayStart)
    let end = broadcastMinute(part.end, policy.broadcastDayStart)
    if (end <= start) end += 24 * 60
    if (minute >= start && minute < end) return part.weights[type] ?? 0
  }
  return 0
}

export function scoreCandidate(
  item: MediaItem,
  policy: ProgrammingPolicy,
  block: TemplateBlock,
  remainSeconds: number,
  state: PlacementState,
  seed: string,
  today: string,
  eventWeights?: Record<string, number>,
  sameDayLoop = false,
  exhausted = false,
): ScoreResult {
  const penalties: string[] = []
  const prime = broadcastMinute(block.start, policy.broadcastDayStart) >= 19 * 60 && broadcastMinute(block.start, policy.broadcastDayStart) < 23 * 60
  const rule = ruleFor(item.programmeType, policy.typeRepeats)
  const uses = state.usesById.get(item.id) ?? []
  const repeat = repeatDecision(item.id, uses, today, rule, prime)
  const onlyToday = uses.length > 0 && uses.every((use) => use.broadcastDate === today)
  // An exhausted pool may repeat across days rather than leave the channel holding; the least
  // recently aired item wins because each day of recency is worth more than any editorial weight.
  // Once-a-week types (film, classic match, concert) are hard rules and still hold.
  const relaxed = repeat.status === 'blocked' && exhausted && rule.maxBroadcasts7d > 1
  if (repeat.status === 'blocked' && !(sameDayLoop && onlyToday) && !relaxed) {
    return { total: Number.NEGATIVE_INFINITY, tie: 0, penalties: repeat.reasons, blocked: true }
  }

  let total = 0
  if (item.topics?.some((topic) => policy.topics?.includes(topic))) total += SCORE.channelTopic
  if (block.preferTypes?.includes(item.programmeType)) total += SCORE.blockType
  total += daypartWeight(policy, block, item.programmeType)
  total += (item.editorialPriority ?? 0) * SCORE.editorial
  if (repeat.status === 'ok' && uses.length === 0) total += SCORE.freshness
  if (item.quality === 'high') total += SCORE.quality
  if (eventWeights) {
    for (const topic of item.topics ?? []) total += eventWeights[topic] ?? 0
  }

  const ratio = item.durationSeconds / remainSeconds
  if (block.strategy === 'segments') {
    const target = block.segmentSeconds ?? 300
    total += Math.max(0, 20 - Math.abs(item.durationSeconds - target) / 30)
  } else if (ratio >= 0.7) total += SCORE.durationClose
  else if (ratio >= 0.4) total += SCORE.durationFair
  else total += SCORE.durationLoose

  const scale = policy.diversityScale
  // Source balance: creator is the publisher. Each earlier placement of that
  // publisher on this day costs 12 points times the channel diversity scale.
  // A channel with only one publisher is not blocked; the penalty only
  // prefers a different publisher when one is eligible.
  const creatorCount = item.creator ? (state.creators.get(item.creator) ?? 0) : 0
  const seriesCount = item.series ? (state.series.get(item.series) ?? 0) : 0
  const topicCount = Math.max(0, ...(item.topics ?? []).map((topic) => state.topics.get(topic) ?? 0))
  if (creatorCount > 0) {
    total -= creatorCount * SCORE.creator * scale
    penalties.push('creator')
  }
  if (seriesCount > 0) {
    total -= seriesCount * SCORE.series * scale
    penalties.push('series')
  }
  if (topicCount > 0) {
    total -= topicCount * SCORE.topic * scale
    penalties.push('topic')
  }
  if (repeat.status === 'penalized') {
    total -= repeat.penalty
    penalties.push(...repeat.reasons)
  }
  if (!relaxed && uses.some((use) => use.broadcastDate < today && daysBetween(use.broadcastDate, today) <= 7)) {
    total -= SCORE.rerun
    penalties.push('rerun')
  }
  if (sameDayLoop && onlyToday) {
    total -= uses.length * EXHAUSTED_PER_DAY
    penalties.push('same-day-loop')
  }
  if (relaxed) {
    const latest = uses.reduce((last, use) => (use.broadcastDate > last ? use.broadcastDate : last), '')
    const sameDay = uses.filter((use) => use.broadcastDate === today).length
    total -= EXHAUSTED_BASE - Math.min(31, latest ? Math.max(0, daysBetween(latest, today)) : 31) * EXHAUSTED_PER_DAY + sameDay * EXHAUSTED_PER_DAY
    penalties.push('exhausted-repeat', ...repeat.reasons)
  }
  // Prefer a different item on each channel when several are eligible.
  // The preference is a function of the channel number and the media id, so
  // the compiled day does not depend on which channel was opened first.
  const affinity = affinityPenalty(policy.channelNumber, item.id)
  if (affinity > 0) {
    total -= affinity
    penalties.push('cross-channel')
  }

  return { total, tie: tieBreak(seed, item.id), penalties, blocked: false }
}

function fnv(text: string): number {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
  }
  return hash >>> 0
}

/**
 * Channels often share programmes. Each channel ranks what it shares in its own
 * order, strongly enough to outweigh block-filling duration bonuses, so a long
 * programme that fits a block exactly is not chosen by every channel at once.
 */
function affinityPenalty(channelNumber: number, mediaId: string): number {
  return (fnv(`${channelNumber}|${mediaId}`) / 0xffffffff) * SCORE.affinity
}

export function notePlacement(state: PlacementState, item: MediaItem, today: string, primeTime: boolean): void {
  if (item.creator) state.creators.set(item.creator, (state.creators.get(item.creator) ?? 0) + 1)
  if (item.series) state.series.set(item.series, (state.series.get(item.series) ?? 0) + 1)
  for (const topic of item.topics ?? []) state.topics.set(topic, (state.topics.get(topic) ?? 0) + 1)
  const use = { mediaItemId: item.id, broadcastDate: today, primeTime, programmeType: item.programmeType }
  state.history.push(use)
  const uses = state.usesById.get(item.id)
  if (uses) uses.push(use)
  else state.usesById.set(item.id, [use])
}
