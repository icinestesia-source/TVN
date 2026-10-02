import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'
import type { GuideSlot, ScheduleSnapshot } from '../types/schedule.ts'
import { calculateSchedule } from '../scheduler/calculate.ts'
import { slotsOverlapping } from '../scheduler/window.ts'
import { compiledWithoutProgrammes, containsExcluded, forgetFrozen, forgetRange, frozenHistory, readFrozen, resetScheduleMemory, scheduleBootstrapping, scheduleIsCurrent, writeFrozen } from './cache.ts'
import { compileDay } from './compile.ts'
import { setUserLibraryMode, schedulingPool } from '../library/mode.ts'
import { getChannelMedia } from '../library/query.ts'
import { DYNAMIC_VERSION } from '../dynamic/providers.ts'
import { freshFor, isDynamicChannel } from '../dynamic/runtime.ts'
import { originalCard, originalFormat } from '../originals/originals.ts'
import { mediaLibrary, setMediaLibrary } from './library.ts'
import { resetNetwork, scheduleSeed } from './network.ts'
import { policyFor } from './policies.ts'
import { xmur3 } from './prng.ts'
import { broadcastDateFor, broadcastMinute, datesCovering } from './time.ts'
import type { BroadcastUse, FrozenDailySchedule, MediaItem, ScheduleBlock, ScheduleChild } from './types.ts'

export interface DirectorStats {
  compiles: number
  cacheHits: number
  cacheMisses: number
  materialised: number
  eagerCompiles: number
  lazyCompiles: number
  lastCompileMs: number
  lastHitMs: number
  lastGuideMs: number
  lastAccess: 'hit' | 'miss' | 'none'
}

const blankStats = (): DirectorStats => ({
  compiles: 0,
  cacheHits: 0,
  cacheMisses: 0,
  materialised: 0,
  eagerCompiles: 0,
  lazyCompiles: 0,
  lastCompileMs: 0,
  lastHitMs: 0,
  lastGuideMs: 0,
  lastAccess: 'none',
})

export const directorStats: DirectorStats = blankStats()
let serial = 0

function usesFrom(schedules: readonly FrozenDailySchedule[]): BroadcastUse[] {
  const uses: BroadcastUse[] = []
  for (const schedule of schedules) {
    for (const block of schedule.blocks) {
      const minute = broadcastMinute(block.start)
      const primeTime = minute >= 19 * 60 && minute < 23 * 60
      for (const child of block.children) {
        if (!child.mediaItemId) continue
        uses.push({
          mediaItemId: child.mediaItemId,
          broadcastDate: schedule.broadcastDate,
          primeTime,
          programmeType: child.programmeType,
        })
      }
    }
  }
  return uses
}

/** Compile cost grows with pool size, so a large pool is cut to a seeded daily subset. */
const MAX_DAY_POOL = 600
/** Channels sharing a large routed pool each draw a different half of it per day. */
const ROUTED_SHARE = 0.5
const ROUTED_FULL_POOL = 120

function dayPool(items: MediaItem[], seed: string, routed: boolean): MediaItem[] {
  const limit = routed && items.length > ROUTED_FULL_POOL
    ? Math.min(MAX_DAY_POOL, Math.max(ROUTED_FULL_POOL, Math.ceil(items.length * ROUTED_SHARE)))
    : MAX_DAY_POOL
  if (items.length <= limit) return items
  return items
    .map((item) => ({ item, rank: xmur3(`${seed}|${item.id}`) }))
    .sort((a, b) => a.rank - b.rank || (a.item.id < b.item.id ? -1 : 1))
    .slice(0, limit)
    .map((entry) => entry.item)
}

const poolPresence = new WeakMap<readonly MediaItem[], Map<string, boolean>>()

function presenceFor(library: readonly MediaItem[]): Map<string, boolean> {
  let known = poolPresence.get(library)
  if (!known) {
    known = new Map()
    poolPresence.set(library, known)
  }
  return known
}

/** Rolling channels' pools change with the date, so their presence is recorded per broadcast date. */
function presenceKey(channelNumber: number, broadcastDate: string): string {
  return isDynamicChannel(channelNumber) ? `${channelNumber}|${broadcastDate}` : String(channelNumber)
}

function channelPool(library: readonly MediaItem[], channelNumber: number, broadcastDate: string): MediaItem[] {
  return freshFor(channelNumber, getChannelMedia(schedulingPool(library), channelNumber), broadcastDate)
}

function channelHasProgrammes(channelNumber: number, broadcastDate: string): boolean {
  const library = mediaLibrary()
  const known = presenceFor(library)
  const key = presenceKey(channelNumber, broadcastDate)
  let present = known.get(key)
  if (present === undefined) {
    present = channelPool(library, channelNumber, broadcastDate).length > 0
    known.set(key, present)
  }
  return present
}

/** The channel a day is compiled for, as TVN ships it; a viewer's rename of their copy is not a new channel. */
let identityOf = (channel: Channel): string => channel.name

export function setChannelIdentity(next: (channel: Channel) => string): void {
  identityOf = next
}

/**
 * A day frozen for whatever held this number before. Numbers are editorial slots: when TVN moves a channel,
 * the day kept for the old one must not air under the new one. A day records the channel it was compiled
 * for; one kept before days did is judged by its programmes instead, stale only when the channel carries
 * none of them now.
 */
function compiledForAnother(channel: Channel, broadcastDate: string, schedule: FrozenDailySchedule): boolean {
  if (schedule.channelName !== undefined) return schedule.channelName !== identityOf(channel)
  if (scheduleBootstrapping()) return false
  const library = mediaLibrary()
  const known = anotherChecked.get(schedule)
  if (known?.library === library) return known.result
  const ids = schedule.blocks.flatMap((block) => block.children).flatMap((child) => (!child.fallback && child.mediaItemId ? [child.mediaItemId] : []))
  const pool = ids.length ? new Set(channelPool(library, channel.number, broadcastDate).map((item) => item.id)) : new Set<string>()
  const result = pool.size > 0 && !ids.some((id) => pool.has(id))
  anotherChecked.set(schedule, { library, result })
  return result
}
const anotherChecked = new WeakMap<FrozenDailySchedule, { library: readonly MediaItem[]; result: boolean }>()

/** A dynamic channel's day compiled under an earlier provider config is recompiled. */
function dynamicStale(channelNumber: number, schedule: FrozenDailySchedule): boolean {
  return isDynamicChannel(channelNumber) && schedule.dynamicVersion !== DYNAMIC_VERSION
}

export function getSchedule(
  channel: Channel,
  broadcastDate: string,
  reason: 'playback' | 'guide' | 'prime' = 'playback',
): FrozenDailySchedule {
  const hitStarted = performance.now()
  const cached = readFrozen(channel.number, broadcastDate)
  const stale =
    cached &&
    (!scheduleIsCurrent(cached) ||
      dynamicStale(channel.number, cached) ||
      containsExcluded(cached) ||
      (compiledWithoutProgrammes(cached) && channelHasProgrammes(channel.number, broadcastDate)) ||
      compiledForAnother(channel, broadcastDate, cached))
  if (cached && stale) forgetFrozen(channel.number, broadcastDate)
  else if (cached) {
    directorStats.cacheHits += 1
    directorStats.lastHitMs = performance.now() - hitStarted
    directorStats.lastAccess = 'hit'
    return cached
  }
  const policy = policyFor(channel.number)
  if (!policy) throw new Error(`Channel ${channel.number} has no programming policy`)
  const started = performance.now()
  const library = mediaLibrary()
  const pool = channelPool(library, channel.number, broadcastDate)
  presenceFor(library).set(presenceKey(channel.number, broadcastDate), pool.length > 0)
  const compiled = compileDay({
    channel,
    broadcastDate,
    policy,
    library: dayPool(pool, scheduleSeed(channel.number, broadcastDate), Boolean(policy.eligibility.routedOnly)),
    history: usesFrom(frozenHistory(channel.number, broadcastDate)),
    generation: (serial += 1),
  })
  directorStats.lastCompileMs = performance.now() - started
  directorStats.cacheMisses += 1
  directorStats.compiles += 1
  directorStats.materialised += 1
  if (reason === 'guide') directorStats.lazyCompiles += 1
  else directorStats.eagerCompiles += 1
  directorStats.lastAccess = 'miss'
  if (isDynamicChannel(channel.number)) compiled.dynamicVersion = DYNAMIC_VERSION
  compiled.channelName = identityOf(channel)
  writeFrozen(compiled)
  return compiled
}

export function invalidateSchedule(channelNumber: number, broadcastDate: string): void {
  forgetFrozen(channelNumber, broadcastDate)
}

export function invalidateScheduleRange(channelNumber: number, from: string, to: string): void {
  forgetRange(channelNumber, from, to)
}

export function resetDirector(): void {
  resetScheduleMemory()
  setMediaLibrary([])
  resetNetwork()
  setUserLibraryMode('allow-eligible')
  serial = 0
  Object.assign(directorStats, blankStats())
}

function childProgramme(channel: Channel, block: ScheduleBlock, child: ScheduleChild): Programme {
  const card = child.fallback && !child.videoId && channel.number <= 999 ? originalCard(channel.number) : undefined
  return {
    id: child.id,
    title: card?.title ?? child.title,
    ...(card ? { caption: card.caption } : {}),
    description: card?.reason ?? (child.fallback
      ? 'No playable source is configured. The schedule continues.'
      : child.title),
    videoId: child.videoId ?? null,
    thumbnail: child.videoId ? `https://i.ytimg.com/vi/${child.videoId}/hqdefault.jpg` : undefined,
    mediaDurationSeconds: child.videoId ? child.durationSeconds : undefined,
    durationSeconds: child.durationSeconds,
    channelId: channel.id,
    category: channel.category,
    source: child.videoId ? 'imported' : 'demo',
    kind: 'programme',
    playbackMode: 'linear',
    playback: child.playback,
    programmeType: child.programmeType,
    mediaKind: channel.mediaKind ?? 'video',
    sourceRef: child.sourceRef,
    blockId: block.id,
    blockTitle: block.title,
    series: child.series,
    creator: child.creator,
    tags: child.topics,
  }
}

function blockProgramme(channel: Channel, block: ScheduleBlock): Programme {
  const lead = block.children.find((child) => !child.fallback && child.videoId)
  const card = !lead && channel.number <= 999 ? originalCard(channel.number) : undefined
  return {
    id: `${channel.id}:${block.id}:${block.startMs}`,
    title: lead?.title ?? card?.title ?? 'Programming resumes soon',
    ...(card ? { caption: card.caption } : {}),
    description: block.title,
    videoId: lead?.videoId ?? null,
    durationSeconds: Math.max(1, Math.round((block.endMs - block.startMs) / 1000)),
    channelId: channel.id,
    category: channel.category,
    source: 'demo',
    kind: 'programme',
    playbackMode: 'linear',
    playback: channel.mediaKind === 'audio' ? 'audio' : 'generated',
    programmeType: block.programmeType,
    mediaKind: channel.mediaKind ?? 'video',
    sourceRef: `block:${block.id}`,
    blockId: block.id,
    blockTitle: block.title,
  }
}

function flatten(channel: Channel, schedule: FrozenDailySchedule): Programme[] {
  const programmes: Programme[] = []
  for (const block of schedule.blocks) {
    for (const child of block.children) programmes.push(childProgramme(channel, block, child))
  }
  if (programmes.length > 0) return programmes
  const card = channel.number <= 999 ? originalCard(channel.number) : undefined
  return [
    {
      id: `${schedule.scheduleId}:fallback`,
      title: card?.title ?? 'Off air',
      description: card?.reason ?? 'No playable source is configured. The schedule continues.',
      ...(card ? { caption: card.caption } : {}),
      videoId: null,
      durationSeconds: Math.max(1, Math.round((schedule.dayEndMs - schedule.dayStartMs) / 1000)),
      channelId: channel.id,
      category: channel.category,
      source: 'demo',
      kind: 'programme',
      playbackMode: 'linear',
      playback: 'generated',
      programmeType: 'generated',
      mediaKind: channel.mediaKind ?? 'video',
      sourceRef: `generated:${schedule.scheduleId}`,
    },
  ]
}

/** The clock scheduler broadcasts a compiled day. It does not choose the programmes. */
export function directorBroadcast(channel: Channel, nowMs: number): ScheduleSnapshot<Programme> {
  const policy = policyFor(channel.number)
  if (!policy) throw new Error(`Channel ${channel.number} has no programming policy`)
  const date = broadcastDateFor(nowMs, policy.broadcastDayStart)
  const schedule = getSchedule(channel, date, 'playback')
  return calculateSchedule({
    channelId: channel.id,
    phaseOffsetSeconds: 0,
    programmes: flatten(channel, schedule),
    epochMs: schedule.dayStartMs,
    nowMs,
  })
}

/**
 * Guide cells are the same children the player broadcasts.
 * A block with no playable child stays one cell, titled as unprogrammed (or with the channel's card).
 */
function guideProgrammes(channel: Channel, schedule: FrozenDailySchedule): Programme[] {
  const programmes: Programme[] = []
  for (const block of schedule.blocks) {
    const playable = block.children.some((child) => !child.fallback && child.videoId)
    if (!playable) {
      programmes.push(blockProgramme(channel, block))
      continue
    }
    for (const child of block.children) programmes.push(childProgramme(channel, block, child))
  }
  return programmes
}

/** Guide cells follow the frozen running order. They do not invent a second schedule. */
export function directorGuideSlots(channel: Channel, startMs: number, endMs: number): GuideSlot<Programme>[] {
  const policy = policyFor(channel.number)
  if (!policy) return []
  const started = performance.now()
  const slots: GuideSlot<Programme>[] = []
  for (const date of datesCovering(startMs, endMs, policy.broadcastDayStart)) {
    const schedule = getSchedule(channel, date, 'guide')
    const programmes = guideProgrammes(channel, schedule)
    const rangeStart = Math.max(startMs, schedule.dayStartMs)
    const rangeEnd = Math.min(endMs, schedule.dayEndMs)
    if (programmes.length === 0 || rangeEnd <= rangeStart) continue
    slots.push(
      ...slotsOverlapping(
        {
          channelId: channel.id,
          phaseOffsetSeconds: 0,
          programmes,
          epochMs: schedule.dayStartMs,
          nowMs: rangeStart,
        },
        rangeStart,
        rangeEnd,
      ),
    )
  }
  directorStats.lastGuideMs = performance.now() - started
  return slots
}

/** An original's format intercepts broadcast(), so its Director day would never air. */
function intercepted(channel: Channel): boolean {
  return channel.number <= 999 && originalFormat(channel.number) !== undefined
}

export function primeDirector(channel: Channel, nowMs: number): void {
  const policy = policyFor(channel.number)
  if (!policy || intercepted(channel)) return
  getSchedule(channel, broadcastDateFor(nowMs, policy.broadcastDayStart), 'prime')
}

export interface AirPosition {
  schedule: FrozenDailySchedule
  block: ScheduleBlock
  child: ScheduleChild
  elapsedSeconds: number
}

export function airPosition(channel: Channel, nowMs: number): AirPosition | null {
  const policy = policyFor(channel.number)
  if (!policy) return null
  const schedule = getSchedule(channel, broadcastDateFor(nowMs, policy.broadcastDayStart), 'playback')
  for (const block of schedule.blocks) {
    for (const child of block.children) {
      if (nowMs >= child.startMs && nowMs < child.endMs) {
        return { schedule, block, child, elapsedSeconds: (nowMs - child.startMs) / 1000 }
      }
    }
  }
  return null
}

export interface DirectorInspection {
  channelNumber: number
  channelName: string
  broadcastDate: string
  policy: string
  archetype: string
  seed: string
  policyVersion: string
  catalogueVersion: string
  cache: 'hit' | 'miss' | 'none'
  dayKind: string
  generation: number
  blockTitle: string | null
  childTitle: string | null
  fallback: boolean
  penalties: string[]
  eventHook?: string
  blocks: { title: string; start: string; hard: boolean; children: number; fallbacks: number }[]
}

export function inspectDirector(channel: Channel, nowMs: number): DirectorInspection | null {
  const policy = policyFor(channel.number)
  if (!policy || intercepted(channel)) return null
  const date = broadcastDateFor(nowMs, policy.broadcastDayStart)
  const schedule = readFrozen(channel.number, date) ?? getSchedule(channel, date, 'playback')
  let block: ScheduleBlock | undefined
  let child: ScheduleChild | undefined
  for (const candidate of schedule.blocks) {
    for (const item of candidate.children) {
      if (nowMs >= item.startMs && nowMs < item.endMs) {
        block = candidate
        child = item
      }
    }
  }
  return {
    channelNumber: channel.number,
    channelName: channel.name,
    broadcastDate: date,
    policy: policy.scheduleStyle,
    archetype: policy.archetype,
    seed: schedule.seed,
    policyVersion: schedule.policyVersion,
    catalogueVersion: schedule.catalogueVersion,
    cache: directorStats.lastAccess,
    dayKind: schedule.dayKind,
    generation: schedule.generation,
    blockTitle: block?.title ?? null,
    childTitle: child?.title ?? null,
    fallback: child?.fallback ?? false,
    penalties: child?.penalties ?? [],
    eventHook: block?.eventHook,
    blocks: schedule.blocks.map((block) => ({
      title: block.title,
      start: block.start,
      hard: block.hardStart,
      children: block.children.length,
      fallbacks: block.children.filter((child) => child.fallback).length,
    })),
  }
}
