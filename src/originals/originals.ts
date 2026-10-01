import raw from '../data/originals/originals.json'
import { OWNED_SOURCES } from '../director/fit.ts'
import { mediaLibrary } from '../director/library.ts'
import { broadcastDateFor, broadcastWindow, datesCovering } from '../director/time.ts'
import type { MediaItem } from '../director/types.ts'
import { artistOf, type OriginalBasis } from '../library/metadata-channels.ts'
import { calculateSchedule } from '../scheduler/calculate.ts'
import { slotsOverlapping } from '../scheduler/window.ts'
import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'
import type { GuideSlot, ScheduleSnapshot } from '../types/schedule.ts'

/**
 * RetroTV originals: deterministic channels built from a fixed format, not from a publisher.
 * Everything here is a pure function of the channel, the broadcast date and the catalogue, so every
 * viewer sees the same running order. No generated media and no network calls.
 */
/** The first three carry a manifest status; the rest are presentation only. */
export type CardClass = 'INTENTIONALLY_UNAVAILABLE' | 'UNRESOLVED' | 'RIGHTS_BLOCKED' | 'OFF_AIR' | 'LIVE_INTERRUPTED' | 'DYNAMIC_EMPTY'

export const STATUS_CARD_CLASSES: ReadonlySet<CardClass> = new Set(['INTENTIONALLY_UNAVAILABLE', 'UNRESOLVED', 'RIGHTS_BLOCKED'])

export interface OriginalCard {
  class: CardClass
  subtype: string
  title: string
  caption: string
  redirect?: number
  reason: string
}

interface TestCardFormat {
  kind: 'test-card'
  segments: [string, string, number][]
  /** The card shows the network time instead of an elapsed counter. */
  clock?: boolean
  programmeType?: 'test-card' | 'closedown'
}

/** A text service of real listings: each page shows what one network channel airs now, or next. */
interface ListingsFormat {
  kind: 'listings'
  mode: 'now' | 'next'
  title: string
  channels: number[]
  seconds: number
}

interface NightBlockFormat {
  kind: 'night-block'
  start: string
  hours: number
  from: number
  to: number
  basis: OriginalBasis
  card: [string, string]
}

type OriginalFormat = TestCardFormat | NightBlockFormat | ListingsFormat

export interface ListingEntry {
  name: string
  title: string
  endMs: number
  nextTitle: string
  nextStartMs: number
}

type ListingLookup = (channelNumber: number, nowMs: number) => ListingEntry | null

let listingLookup: ListingLookup = () => null

/** Installed by the broadcast service, which owns the schedules the listings read. */
export function setListingLookup(lookup: ListingLookup): void {
  listingLookup = lookup
}

interface OriginalsFile {
  version: string
  channels: Record<string, OriginalFormat>
  cards: Record<string, OriginalCard>
}

const originals = raw as unknown as OriginalsFile

export const ORIGINALS_VERSION = originals.version
export const ORIGINAL_CHANNELS: readonly number[] = Object.keys(originals.channels).map(Number)

export function originalFormat(channelNumber: number): OriginalFormat | undefined {
  return originals.channels[String(channelNumber)]
}

/** One-line description of the format, for the manifest and diagnostics. */
export function originalSummary(channelNumber: number): string {
  return (originals.channels[String(channelNumber)] as { summary?: string } | undefined)?.summary ?? ''
}

/** The presentation a channel shows when it has nothing to air, instead of a blank "Off air". */
export function originalCard(channelNumber: number): OriginalCard | undefined {
  return originals.cards[String(channelNumber)]
}

export function originalCards(): Readonly<Record<string, OriginalCard>> {
  return originals.cards
}

function hash(text: string): number {
  let value = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 0x01000193) >>> 0
  }
  return value
}

function card(channel: Channel, key: string, title: string, caption: string, seconds: number, type: Programme['programmeType']): Programme {
  return {
    id: `${channel.id}:original:${key}`,
    title,
    description: caption,
    caption,
    videoId: null,
    durationSeconds: Math.max(1, Math.round(seconds)),
    channelId: channel.id,
    category: channel.category,
    source: 'demo',
    kind: 'programme',
    playbackMode: 'linear',
    playback: 'generated',
    programmeType: type,
    mediaKind: channel.mediaKind ?? 'video',
    sourceRef: `generated:${channel.id}:${key}`,
  }
}

/** Verified recordings of the format's years, from built-in catalogue publishers only; user media never qualifies. */
export function nightPool(format: NightBlockFormat, items: readonly MediaItem[] = mediaLibrary()): MediaItem[] {
  return items.filter((item) => {
    const original = item.original
    const { sourceId = '', provenance, ingestedFrom } = item as { sourceId?: string; provenance?: string; ingestedFrom?: string }
    return (
      provenance !== 'built-in-user' &&
      ingestedFrom !== 'retrotv-user-network' &&
      original !== undefined &&
      original.basis === format.basis &&
      original.year >= format.from &&
      original.year <= format.to &&
      item.provider === 'youtube' &&
      !!item.externalId &&
      !OWNED_SOURCES.has(sourceId)
    )
  })
}

function recording(channel: Channel, item: MediaItem, date: string): Programme {
  const videoId = item.externalId as string
  return {
    id: `${channel.id}:night:${date}:${videoId}`,
    title: item.title,
    description: `${item.original?.year} recording.`,
    videoId,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    durationSeconds: item.durationSeconds,
    channelId: channel.id,
    category: channel.category,
    source: 'youtube',
    kind: 'programme',
    playbackMode: 'linear',
    playback: 'seekable-recorded',
    programmeType: 'music-video',
    mediaKind: 'video',
    sourceRef: `youtube:${videoId}`,
    year: item.original?.year,
    creator: item.creator,
  }
}

/** One act per night, in a date-seeded order, until the block is full; the card holds the rest of the day. */
function nightDay(channel: Channel, format: NightBlockFormat, date: string, items: readonly MediaItem[]): Programme[] {
  const { startMs, endMs } = broadcastWindow(date, format.start)
  const budget = format.hours * 3600
  const ranked = [...nightPool(format, items)].sort((a, b) => hash(`${date}|${a.id}`) - hash(`${date}|${b.id}`) || a.id.localeCompare(b.id))
  const acts = new Set<string>()
  const block: Programme[] = []
  let used = 0
  for (const item of ranked) {
    const act = artistOf(item as { sourceId?: string; title?: string })
    if (acts.has(act) || used + item.durationSeconds > budget) continue
    acts.add(act)
    block.push(recording(channel, item, date))
    used += item.durationSeconds
  }
  const [title, caption] = format.card
  return [...block, card(channel, `night-card:${date}`, title, caption, (endMs - startMs) / 1000 - used, 'continuity')]
}

function testCardDay(channel: Channel, format: TestCardFormat): Programme[] {
  return format.segments.map(([title, caption, minutes], index) => ({
    ...card(channel, `test-card:${index}`, title, caption, minutes * 60, format.programmeType ?? 'test-card'),
    ...(format.clock ? { tags: ['clock'] } : {}),
  }))
}

function day(channel: Channel, date: string, items: readonly MediaItem[]): { programmes: Programme[]; startMs: number; endMs: number } | null {
  const format = originalFormat(channel.number)
  if (!format || format.kind === 'listings') return null
  const window = broadcastWindow(date, format.kind === 'night-block' ? format.start : '00:00')
  const programmes = format.kind === 'night-block' ? nightDay(channel, format, date, items) : testCardDay(channel, format)
  return { programmes, ...window }
}

function dayStart(channelNumber: number): string {
  const format = originalFormat(channelNumber)
  return format?.kind === 'night-block' ? format.start : '00:00'
}

function pad(number: number): string {
  return String(number).padStart(3, '0')
}

function clock(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/**
 * One listings cycle is one programme, aligned to the Unix epoch so every viewer is on the same page.
 * The guide shows the cycle; the picture shows the page for the moment it is drawn.
 */
/** Listings air as hour-long programmes; the page within the hour rotates through `channels`. */
const LISTINGS_BLOCK_MS = 3600_000

function listingsProgramme(channel: Channel, format: ListingsFormat, blockStart: number, nowMs?: number): Programme {
  const base = card(channel, `listings:${blockStart}`, format.title, `${format.title.toUpperCase()} · TVN LISTINGS`, LISTINGS_BLOCK_MS / 1000, 'generated')
  if (nowMs === undefined) return base
  const page = Math.max(0, Math.floor((nowMs - blockStart) / (format.seconds * 1000))) % format.channels.length
  const number = format.channels[page]
  const entry = listingLookup(number, nowMs)
  if (!entry) return base
  const heading = `${pad(number)} ${entry.name}`
  return format.mode === 'now'
    ? { ...base, title: `${heading}: ${entry.title}`, caption: `NOW ON ${heading.toUpperCase()} · UNTIL ${clock(entry.endMs)}` }
    : { ...base, title: `${heading}: ${entry.nextTitle}`, caption: `NEXT ON ${heading.toUpperCase()} · FROM ${clock(entry.nextStartMs)}` }
}

function listingsSnapshot(channel: Channel, format: ListingsFormat, nowMs: number): ScheduleSnapshot<Programme> {
  const cycleMs = LISTINGS_BLOCK_MS
  const start = Math.floor(nowMs / cycleMs) * cycleMs
  const position = (at: number, programme: Programme, elapsed = 0) => ({
    programme,
    index: Math.floor(at / cycleMs),
    startMs: at,
    endMs: at + cycleMs,
    elapsedSeconds: elapsed,
    seekSeconds: elapsed,
  })
  const elapsed = (nowMs - start) / 1000
  return {
    channelId: channel.id,
    epochMs: 0,
    nowMs,
    cycleDurationSeconds: cycleMs / 1000,
    offsetSeconds: elapsed,
    current: position(start, listingsProgramme(channel, format, start, nowMs), elapsed),
    previous: position(start - cycleMs, listingsProgramme(channel, format, start - cycleMs)),
    next: position(start + cycleMs, listingsProgramme(channel, format, start + cycleMs)),
  }
}

export function originalBroadcast(channel: Channel, nowMs: number, items: readonly MediaItem[] = mediaLibrary()): ScheduleSnapshot<Programme> | null {
  const format = originalFormat(channel.number)
  if (format?.kind === 'listings') return listingsSnapshot(channel, format, nowMs)
  const today = day(channel, broadcastDateFor(nowMs, dayStart(channel.number)), items)
  if (!today) return null
  return calculateSchedule({ channelId: channel.id, phaseOffsetSeconds: 0, programmes: today.programmes, epochMs: today.startMs, nowMs })
}

/** The channel's card over pictureless slates, keeping their ids and timing on the clock scheduler. */
const carded = new WeakMap<readonly Programme[], readonly Programme[]>()

export function withCard(channelNumber: number, programmes: readonly Programme[]): readonly Programme[] {
  const found = originalCard(channelNumber)
  if (channelNumber > 999 || !found || programmes.some((programme) => programme.videoId)) return programmes
  let result = carded.get(programmes)
  if (!result) {
    result = programmes.map((programme) => ({ ...programme, title: found.title, caption: found.caption, description: found.reason }))
    carded.set(programmes, result)
  }
  return result
}

export function originalGuideSlots(channel: Channel, startMs: number, endMs: number, items: readonly MediaItem[] = mediaLibrary()): GuideSlot<Programme>[] | null {
  const format = originalFormat(channel.number)
  if (!format) return null
  if (format.kind === 'listings') {
    const cycleMs = LISTINGS_BLOCK_MS
    const slots: GuideSlot<Programme>[] = []
    for (let at = Math.floor(startMs / cycleMs) * cycleMs; at < endMs; at += cycleMs) {
      slots.push({ programme: listingsProgramme(channel, format, at), index: Math.floor(at / cycleMs), startMs: at, endMs: at + cycleMs })
    }
    return slots
  }
  return datesCovering(startMs, endMs, dayStart(channel.number)).flatMap((date) => {
    const current = day(channel, date, items)
    if (!current) return []
    const from = Math.max(startMs, current.startMs)
    const to = Math.min(endMs, current.endMs)
    if (to <= from) return []
    return slotsOverlapping({ channelId: channel.id, phaseOffsetSeconds: 0, programmes: current.programmes, epochMs: current.startMs, nowMs: from }, from, to).filter(
      (slot) => slot.startMs < current.endMs,
    )
  })
}

/** Seconds of verified material an original can draw on; the test card needs none. */
export function originalSeconds(channelNumber: number, items: readonly MediaItem[]): number {
  const format = originalFormat(channelNumber)
  if (!format) return 0
  if (format.kind !== 'night-block') return 24 * 3600
  return nightPool(format, items).reduce((sum, item) => sum + item.durationSeconds, 0)
}
