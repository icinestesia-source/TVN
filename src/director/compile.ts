import type { Channel } from '../types/channel.ts'
import type { ProgrammeType } from '../types/programme.ts'
import { isEligible } from './eligibility.ts'
import { CATALOGUE_VERSION, POLICY_VERSION, SCHEDULE_VERSION, scheduleSeed } from './network.ts'
import { templateFor } from './policies.ts'
import { emptyPlacement, notePlacement, scoreCandidate } from './score.ts'
import { broadcastMinute, broadcastWindow, dayKindFor, localStartMs } from './time.ts'
import type {
  BroadcastUse,
  MediaItem,
  ProgrammingPolicy,
  ScheduleBlock,
  ScheduleChild,
  FrozenDailySchedule,
  TemplateBlock,
} from './types.ts'

export interface CompileInput {
  channel: Channel
  broadcastDate: string
  policy: ProgrammingPolicy
  library: readonly MediaItem[]
  history?: readonly BroadcastUse[]
  generatedAt?: number
  generation?: number
}

function fallbackChild(block: TemplateBlock, durationSeconds: number, audio: boolean): ScheduleChild {
  const playback = audio ? 'audio' : 'generated'
  const programmeType: ProgrammeType = audio ? 'radio' : 'generated'
  return {
    id: '',
    title: 'Programming resumes soon',
    startMs: 0,
    endMs: 0,
    durationSeconds,
    programmeType,
    playback,
    sourceRef: `holding:${block.id}`,
    fallback: true,
    penalties: ['fallback'],
  }
}

function itemChild(item: MediaItem, scored: number, penalties: string[]): ScheduleChild {
  return {
    id: '',
    title: item.title,
    startMs: 0,
    endMs: 0,
    durationSeconds: item.durationSeconds,
    programmeType: item.programmeType,
    playback: item.live ? 'live' : (item.playbackKind ?? (item.mediaKind === 'audio' ? 'audio' : 'seekable-recorded')),
    sourceRef: item.sourceRef ?? `library:${item.id}`,
    videoId: item.provider === 'youtube' ? item.externalId : undefined,
    fallback: false,
    mediaItemId: item.id,
    series: item.series,
    creator: item.creator,
    ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
    topics: item.topics,
    score: scored,
    penalties,
  }
}

function pick(
  policy: ProgrammingPolicy,
  block: TemplateBlock,
  maxSeconds: number,
  library: readonly MediaItem[],
  state: ReturnType<typeof emptyPlacement>,
  seed: string,
  today: string,
  eventWeights: Record<string, number> | undefined,
  sameDayLoop: boolean,
  exhausted = false,
  avoid?: string,
): { item: MediaItem; score: number; penalties: string[] } | null {
  let best: { item: MediaItem; score: number; penalties: string[]; tie: number } | null = null
  for (const item of library) {
    if (item.durationSeconds <= 0 || item.durationSeconds > maxSeconds || item.id === avoid) continue
    if (!isEligible(item, policy.channelNumber, policy.eligibility, block.eligibility)) continue
    const scored = scoreCandidate(item, policy, block, Math.max(maxSeconds, 1), state, seed, today, eventWeights, sameDayLoop, exhausted)
    if (scored.blocked) continue
    if (
      !best ||
      scored.total > best.score ||
      (scored.total === best.score && scored.tie > best.tie)
    ) {
      best = { item, score: scored.total, penalties: scored.penalties, tie: scored.tie }
    }
  }
  return best
}

function fillBlock(
  policy: ProgrammingPolicy,
  block: TemplateBlock,
  spanSeconds: number,
  roomSeconds: number,
  library: readonly MediaItem[],
  state: ReturnType<typeof emptyPlacement>,
  seed: string,
  today: string,
  audio: boolean,
  eventWeights?: Record<string, number>,
): ScheduleChild[] {
  if (spanSeconds <= 0) return []
  if (block.strategy === 'hold') return [fallbackChild(block, spanSeconds, audio)]

  const children: ScheduleChild[] = []
  let remain = spanSeconds
  let untilBarrier = Math.max(roomSeconds, spanSeconds)
  let guard = 0
  const segmented = block.strategy === 'segments'
  const segment = block.segmentSeconds ?? 300
  while (remain > 0 && guard < 500) {
    guard += 1
    const fitLimit = segmented ? Math.min(segment, remain) : remain
    // Widest choice first: a fresh programme (even one running past a soft block boundary) beats a
    // same-day loop, and a same-day loop beats repeating across days. Neither may air the programme that
    // has just finished while anything else fits; only then may it run again, and only then does the block hold.
    const canCross = !segmented && untilBarrier > remain
    const previous = state.history[state.history.length - 1]?.mediaItemId
    let chosen: ReturnType<typeof pick> = null
    let crosses = false
    for (const [loop, exhausted, avoid] of [[false, false, undefined], [true, false, previous], [true, true, previous], [true, true, undefined]] as const) {
      chosen = pick(policy, block, fitLimit, library, state, seed, today, eventWeights, loop, exhausted, avoid)
      if (!chosen && canCross) {
        chosen = pick(policy, block, untilBarrier, library, state, seed, today, eventWeights, loop, exhausted, avoid)
        crosses = Boolean(chosen)
      }
      if (chosen) break
    }
    if (!chosen) {
      const size = segmented ? Math.min(segment, remain) : remain
      children.push(fallbackChild(block, size, audio))
      remain -= size
      untilBarrier -= size
      continue
    }
    children.push(itemChild(chosen.item, chosen.score, chosen.penalties))
    remain -= chosen.item.durationSeconds
    untilBarrier -= chosen.item.durationSeconds
    const prime =
      broadcastMinute(block.start, policy.broadcastDayStart) >= 19 * 60 &&
      broadcastMinute(block.start, policy.broadcastDayStart) < 23 * 60
    notePlacement(state, chosen.item, today, prime)
    if (crosses) break
  }
  return children
}

function assign(children: ScheduleChild[], startMs: number, endMs: number, block: TemplateBlock, audio: boolean): void {
  let cursor = startMs
  for (const child of children) {
    child.startMs = cursor
    child.endMs = cursor + child.durationSeconds * 1000
    cursor = child.endMs
  }
  const drift = Math.round((endMs - cursor) / 1000)
  if (drift === 0) return
  const last = children[children.length - 1]
  if (last?.fallback && last.durationSeconds + drift > 0) {
    last.durationSeconds += drift
    last.endMs = endMs
    return
  }
  if (drift > 0) {
    const extra = fallbackChild(block, drift, audio)
    extra.startMs = cursor
    extra.endMs = endMs
    children.push(extra)
  }
}

export function compileDay(input: CompileInput): FrozenDailySchedule {
  const { channel, broadcastDate, policy, library } = input
  const history = input.history ?? []
  const dayStart = policy.broadcastDayStart
  const event = policy.specialEventRules.find((rule) => broadcastDate.slice(5) === rule.monthDay)
  const kind = event?.dayKind ?? dayKindFor(broadcastDate)
  const template = templateFor(policy, kind)
  const window = broadcastWindow(broadcastDate, dayStart)
  const seed = scheduleSeed(channel.number, broadcastDate)
  const audio = channel.mediaKind === 'audio'
  const state = emptyPlacement(history)
  const ordered = [...template.blocks].sort(
    (a, b) => broadcastMinute(a.start, dayStart) - broadcastMinute(b.start, dayStart),
  )
  const starts = ordered.map((block) => localStartMs(broadcastDate, block.start, dayStart))
  const blocks: ScheduleBlock[] = []
  let cursor = window.startMs

  for (let index = 0; index < ordered.length; index += 1) {
    const templateBlock = ordered[index]
    const nominalStart = starts[index]
    const nominalEnd = index + 1 < starts.length ? starts[index + 1] : window.endMs
    const startMs = Math.max(nominalStart, cursor)
    const endMs = Math.min(nominalEnd, window.endMs)
    if (startMs >= endMs) continue
    let barrier = window.endMs
    for (let next = index + 1; next < ordered.length; next += 1) {
      if (ordered[next].hardStart) {
        barrier = starts[next]
        break
      }
    }
    const span = Math.max(0, Math.round((endMs - startMs) / 1000))
    const room = Math.max(span, Math.round((barrier - startMs) / 1000))
    const title = event?.titleOverrides?.[templateBlock.id] ?? templateBlock.title
    const block = { ...templateBlock, title }
    const children = fillBlock(policy, block, span, room, library, state, seed, broadcastDate, audio, event?.weightTopics)
    assign(children, startMs, endMs, block, audio)
    const scheduleId = `${channel.id}|${broadcastDate}`
    children.forEach((child, childIndex) => {
      child.id = `${scheduleId}:${block.id}:${childIndex}`
      if (!child.sourceRef) child.sourceRef = `generated:${child.id}`
    })
    const coveredUntil = children.length ? children[children.length - 1].endMs : endMs
    cursor = Math.max(cursor, coveredUntil)
    blocks.push({
      id: block.id,
      title,
      start: block.start,
      startMs,
      endMs: coveredUntil,
      hardStart: Boolean(block.hardStart),
      programmeType: block.programmeType,
      eventHook: block.eventHook,
      children,
    })
  }

  return {
    scheduleId: `${channel.id}|${broadcastDate}`,
    channelId: channel.id,
    channelNumber: channel.number,
    broadcastDate,
    scheduleVersion: SCHEDULE_VERSION,
    policyVersion: POLICY_VERSION,
    catalogueVersion: CATALOGUE_VERSION,
    seed,
    generatedAt: input.generatedAt ?? Date.now(),
    generation: input.generation ?? 0,
    dayStartMs: window.startMs,
    dayEndMs: window.endMs,
    dayKind: kind,
    style: policy.scheduleStyle,
    blocks,
    poolSize: library.length,
  }
}
