import type { Channel } from '../types/channel.ts'
import type { Programme } from '../types/programme.ts'
import type { BroadcastPosition, GuideSlot, ScheduleSnapshot } from '../types/schedule.ts'

/**
 * Channel 000, TVN: the network's own channel surfer. It picks a programme airing now elsewhere on the
 * network, joins it where it is, and after the viewer's Random Cycle wait (or sooner, if the programme ends)
 * picks another, for as long as the viewer stays on 000. It refers to programming; it never copies media,
 * learns nothing about the viewer, and never lists a future it has not chosen.
 */
export const TVN_CHANNEL_NUMBER = 0
const CHANNEL_ID = 'ch-tvn'

export const TVN_CHANNEL: Channel = {
  id: CHANNEL_ID,
  number: TVN_CHANNEL_NUMBER,
  name: 'Channel Zero',
  shortName: 'TVN',
  description: 'TVN’s own channel: TVN surfs the network for you, one channel after another.',
  logo: 'TVN',
  color: '#1b3a5c',
  category: 'TVN',
  categoryId: 'tvn',
  origin: 'tvn',
  mediaKind: 'video',
  enabled: true,
  sources: [],
  scheduleMode: 'loop',
  phaseOffsetSeconds: 0,
}

export interface TvnChannelSettings {
  /** Keep surfing: another choice after each Random Cycle wait, or when the programme ends. */
  autoNext: boolean
  /** Choose from the viewer's User Network (1001+) as well as 001–999. */
  includeUser: boolean
}

export const TVN_CHANNEL_DEFAULTS: TvnChannelSettings = { autoNext: true, includeUser: false }
const SETTINGS_KEY = 'tvn.tvn-channel.v1'

/** A choice needs at least this much left to be worth joining. */
export const MIN_REMAINING_MS = 180_000
/** Choices remembered this session, so the same channel, programme or source does not come straight back. */
export const HISTORY = 8
const RECENT_CHANNELS = 5
const RECENT_SOURCES = 2
const TRIES = 60
/** Only a request for the present can make a choice; the Guide asking about later never does. */
const PRESENT_MS = 5000
const PLACEHOLDER_MS = 1_800_000

export interface TvnLookup {
  channels: () => readonly Channel[]
  broadcastOf: (channel: Channel, nowMs: number) => ScheduleSnapshot<Programme>
  onAir: (channel: Channel) => boolean
  refused: () => ReadonlySet<string>
  /** How long 000 stays with a choice before surfing on: the Random Cycle's wait. */
  dwellMs?: () => number
}

interface Choice {
  programme: Programme
  channelNumber: number
  source: string
  startMs: number
  endMs: number
  /** When 000 joined it; its Guide slot starts here. */
  joinedMs: number
  /** When 000 surfs on: the Random Cycle wait from joining, or the programme's end if that comes first. */
  untilMs: number
}

let lookup: TvnLookup | null = null
let settings: TvnChannelSettings | null = null
let choice: Choice | null = null
let aired: Choice[] = []
/** Auto-next is off and the choice has ended: hold until the viewer comes back to 000 or asks for another. */
let holding = false
let random: () => number = Math.random
let clock: () => number = () => Date.now()
const listeners = new Set<() => void>()

export function setTvnLookup(next: TvnLookup): void {
  lookup = next
}

/** Tests fix the randomness and the clock. */
export function setTvnRandom(next: () => number, now?: () => number): void {
  random = next
  if (now) clock = now
}

export function resetTvnChannel(): void {
  choice = null
  aired = []
  holding = false
  settings = null
}

export function subscribeTvnChannel(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function changed(): void {
  for (const listener of listeners) listener()
}

export function asTvnChannelSettings(value: unknown): TvnChannelSettings {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    autoNext: typeof record.autoNext === 'boolean' ? record.autoNext : TVN_CHANNEL_DEFAULTS.autoNext,
    includeUser: typeof record.includeUser === 'boolean' ? record.includeUser : TVN_CHANNEL_DEFAULTS.includeUser,
  }
}

export function tvnChannelSettingsErrors(value: unknown, at: string): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${at} is not an object`]
  const record = value as Record<string, unknown>
  return (['autoNext', 'includeUser'] as const).filter((name) => typeof record[name] !== 'boolean').map((name) => `${at}.${name} is not true or false`)
}

export function tvnChannelSettings(): TvnChannelSettings {
  if (settings) return settings
  try {
    settings = asTvnChannelSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null'))
  } catch {
    settings = { ...TVN_CHANNEL_DEFAULTS }
  }
  return settings
}

export function setTvnChannelSettings(patch: Partial<TvnChannelSettings>): TvnChannelSettings {
  settings = { ...tvnChannelSettings(), ...patch }
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    /* private mode */
  }
  if (settings.autoNext && holding) holding = false
  changed()
  return settings
}

/** The channels 000 may choose from: 001–999 as the viewer has them, and 1001+ only when asked. Never 000 or 1000. */
export function tvnPool(channels: readonly Channel[], includeUser: boolean, onAir: (channel: Channel) => boolean): Channel[] {
  return channels.filter((channel) => {
    if (!channel.enabled || channel.emptySlot || channel.origin === 'session' || channel.origin === 'tvn') return false
    if (channel.number === TVN_CHANNEL_NUMBER || channel.number === 1000) return false
    const user = channel.number >= 1001 || channel.origin === 'user-import' || channel.origin === 'user-created'
    if (user ? !includeUser || channel.number < 1001 : channel.number < 1 || channel.number > 999) return false
    return onAir(channel)
  })
}

const programmeKey = (programme: Programme) => programme.videoId ?? programme.mediaUrl ?? programme.id
const sourceKey = (programme: Programme, channelNumber: number) => programme.creator?.trim().toLowerCase() || `channel:${channelNumber}`

/** What `channel` airs now, if 000 could join it: a real programme with a picture, not refused, with enough left. */
function airingOn(channel: Channel, nowMs: number): Omit<Choice, 'joinedMs' | 'untilMs'> | null {
  if (!lookup) return null
  let snap: ScheduleSnapshot<Programme>
  try {
    snap = lookup.broadcastOf(channel, nowMs)
  } catch {
    return null
  }
  const { programme, startMs, endMs } = snap.current
  // Live by type: a stream (`liveStream`) or a YouTube live broadcast or cam (`playback: 'live'`), whatever its channel.
  if (programme.kind !== 'programme' || programme.liveStream || programme.playback === 'live' || (!programme.videoId && !programme.mediaUrl)) return null
  if (programme.videoId && lookup.refused().has(programme.videoId)) return null
  if (endMs - nowMs < MIN_REMAINING_MS) return null
  return { programme, channelNumber: channel.number, source: sourceKey(programme, channel.number), startMs, endMs }
}

/**
 * Chooses what 000 shows from `nowMs`. The pool is shuffled; a candidate that repeats a recent channel,
 * programme or source is passed over, and only when nothing else airs are those limits eased.
 */
export function chooseTvn(nowMs: number): boolean {
  if (!lookup) return false
  const pool = tvnPool(lookup.channels(), tvnChannelSettings().includeUser, lookup.onAir)
  if (pool.length === 0) {
    // No channel to sample (a network cleared with NEW): 000 says so and looks again quietly until one is added.
    const shown = choice !== null || aired.length > 0 || holding
    choice = null
    aired = []
    holding = false
    if (shown) changed()
    return false
  }
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[pool[index], pool[swap]] = [pool[swap], pool[index]]
  }
  const history = [choice, ...aired.slice().reverse()].filter((item): item is Choice => item !== null).slice(0, HISTORY)
  const recentChannels = new Set(history.slice(0, RECENT_CHANNELS).map((item) => item.channelNumber))
  const recentProgrammes = new Set(history.map((item) => programmeKey(item.programme)))
  const recentSources = new Set(history.slice(0, RECENT_SOURCES).map((item) => item.source))
  const last = history[0]
  const strict: Omit<Choice, 'joinedMs' | 'untilMs'>[] = []
  const eased: Omit<Choice, 'joinedMs' | 'untilMs'>[] = []
  for (const channel of pool.slice(0, TRIES)) {
    const found = airingOn(channel, nowMs)
    if (!found) continue
    if (last && (found.channelNumber === last.channelNumber || programmeKey(found.programme) === programmeKey(last.programme))) continue
    if (recentChannels.has(found.channelNumber) || recentProgrammes.has(programmeKey(found.programme)) || recentSources.has(found.source)) eased.push(found)
    else {
      strict.push(found)
      break
    }
  }
  const next = strict[0] ?? eased[0]
  if (choice) aired = [...aired, { ...choice, endMs: Math.min(choice.endMs, Math.max(nowMs, choice.joinedMs)) }].slice(-HISTORY)
  holding = false
  // Surfing on waits the Random Cycle's time; with auto-next off the choice simply plays to its end.
  const dwell = tvnChannelSettings().autoNext ? lookup.dwellMs?.() : undefined
  choice = next ? { ...next, joinedMs: nowMs, untilMs: dwell === undefined ? next.endMs : Math.min(next.endMs, nowMs + Math.max(1000, dwell)) } : null
  changed()
  return choice !== null
}

/** Coming to 000: a new choice unless one is still running. Picks even with auto-next off. */
export function enterTvn(nowMs: number): void {
  if (choice && nowMs >= choice.startMs && nowMs < choice.untilMs) return
  chooseTvn(nowMs)
}

/**
 * Playing 000 at the present: chooses when it has nothing, and surfs on when the choice's time is up with
 * auto-next on. Only the player watching 000 drives this; the Guide and any other look at 000 only read.
 */
export function driveTvn(nowMs: number): void {
  keepRunning(nowMs)
}

/** The sampled programme really ended (the player said so) before its listed end: surf on now, or hold. */
export function endedTvn(nowMs: number, videoId: string | null): boolean {
  if (!choice || !videoId || choice.programme.videoId !== videoId) return false
  if (tvnChannelSettings().autoNext) return chooseTvn(nowMs)
  choice = { ...choice, endMs: Math.min(choice.endMs, nowMs), untilMs: Math.min(choice.untilMs, nowMs) }
  holding = true
  changed()
  return true
}

/** The current choice was refused or the viewer asked for another. */
export function chooseAnotherTvn(nowMs: number): boolean {
  return chooseTvn(nowMs)
}

export function tvnChoice(): { channelNumber: number; programme: Programme; startMs: number; endMs: number; untilMs: number } | null {
  return choice
}

function relayed(item: Choice): Programme {
  const from = lookup?.channels().find((channel) => channel.number === item.channelNumber)
  return { ...item.programme, relay: { channelNumber: item.channelNumber, channelName: from?.name ?? '' } }
}

function card(id: string, title: string, description: string, caption: string): Programme {
  return {
    id,
    title,
    description,
    videoId: null,
    durationSeconds: PLACEHOLDER_MS / 1000,
    channelId: CHANNEL_ID,
    category: 'TVN',
    source: 'demo',
    kind: 'programme',
    playbackMode: 'linear',
    programmeType: 'unclassified',
    playback: 'generated',
    sourceRef: `generated:${id}`,
    caption,
  }
}

/** What follows the current choice: nothing yet, honestly. */
export const TVN_SELECTION = card('tvn-selection', 'TVN Selection', 'To be selected', 'TVN · THE NEXT PROGRAMME IS TO BE SELECTED')
const TVN_HOLDING = card(
  'tvn-holding',
  'TVN Selection',
  'The programme TVN chose has ended. Choose another, or turn on automatic choice.',
  'TVN · THE PROGRAMME HAS ENDED · CHOOSE ANOTHER TO CARRY ON',
)
const TVN_NOTHING = card('tvn-nothing', 'TVN Selection', 'Nothing on the network can be joined right now.', 'TVN · NOTHING TO CHOOSE RIGHT NOW')

function position(programme: Programme, startMs: number, endMs: number, nowMs: number, index: number): BroadcastPosition<Programme> {
  const elapsedSeconds = Math.max(0, (nowMs - startMs) / 1000)
  return { programme, index, startMs, endMs, elapsedSeconds, seekSeconds: elapsedSeconds }
}

function snapshot(current: BroadcastPosition<Programme>, nowMs: number): ScheduleSnapshot<Programme> {
  const before = aired.at(-1)
  return {
    channelId: CHANNEL_ID,
    epochMs: current.startMs,
    nowMs,
    cycleDurationSeconds: Math.max(1, (current.endMs - current.startMs) / 1000),
    offsetSeconds: current.elapsedSeconds,
    current,
    previous: before ? position(relayed(before), before.startMs, before.endMs, nowMs, -1) : position(TVN_SELECTION, current.startMs - PLACEHOLDER_MS, current.startMs, nowMs, -1),
    next: position(TVN_SELECTION, current.endMs, current.endMs + PLACEHOLDER_MS, nowMs, current.index + 1),
  }
}

/** Keeps 000 running at the present: chooses when it has nothing, and when a choice's time is up with auto-next on. */
function keepRunning(nowMs: number): void {
  if (Math.abs(nowMs - clock()) > PRESENT_MS) return
  if (choice && nowMs < choice.untilMs) return
  // Auto-next turned off during a wait: the choice plays on to its end, then holds.
  if (choice && nowMs < choice.endMs && !tvnChannelSettings().autoNext) return
  if (!choice && aired.length === 0) {
    chooseTvn(nowMs)
    return
  }
  if (holding) return
  if (tvnChannelSettings().autoNext) chooseTvn(nowMs)
  else {
    holding = true
    changed()
  }
}

export function tvnBroadcast(nowMs: number): ScheduleSnapshot<Programme> {
  if (choice && nowMs >= choice.startMs && nowMs < choice.endMs) return snapshot(position(relayed(choice), choice.startMs, choice.endMs, nowMs, 0), nowMs)
  const past = aired.find((item) => nowMs >= Math.max(item.joinedMs, item.startMs) && nowMs < item.endMs)
  if (past) return snapshot(position(relayed(past), past.startMs, past.endMs, nowMs, -1), nowMs)
  const ended = choice !== null && nowMs >= choice.endMs
  const shown = ended && !tvnChannelSettings().autoNext ? TVN_HOLDING : choice || aired.length ? TVN_SELECTION : TVN_NOTHING
  const startMs = ended ? choice!.endMs : nowMs
  return snapshot(position(shown, startMs, Math.max(nowMs, startMs) + PLACEHOLDER_MS, nowMs, 1), nowMs)
}

/** The Guide row: what 000 has shown, what it shows now, then "TVN Selection · To be selected" and nothing invented. */
export function tvnGuideSlots(startMs: number, endMs: number): GuideSlot<Programme>[] {
  const shown = [...aired, ...(choice ? [choice] : [])]
  const slots: GuideSlot<Programme>[] = []
  let floor = -Infinity
  shown.forEach((item, index) => {
    const from = Math.max(item.joinedMs, item.startMs, floor)
    if (from >= item.endMs) return
    slots.push({ programme: relayed(item), index, startMs: from, endMs: item.endMs })
    floor = item.endMs
  })
  const after = choice ? choice.endMs : clock()
  const holdingCard = choice && clock() >= choice.endMs && !tvnChannelSettings().autoNext
  slots.push({ programme: holdingCard ? TVN_HOLDING : choice ? TVN_SELECTION : TVN_NOTHING, index: shown.length, startMs: after, endMs: Math.max(endMs, after + PLACEHOLDER_MS) })
  return slots.filter((slot) => slot.endMs > startMs && slot.startMs < endMs)
}
