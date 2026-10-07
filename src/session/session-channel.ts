import { calculateSchedule } from '../scheduler/calculate.ts'
import { slotsOverlapping } from '../scheduler/window.ts'
import type { Remux } from '../player/flv.ts'
import type { Channel } from '../types/channel.ts'
import type { MediaKind, Programme } from '../types/programme.ts'
import type { GuideSlot, ScheduleSnapshot } from '../types/schedule.ts'
import { readLocalNames, writeLocalName } from './local-names.ts'

export const SESSION_CHANNEL_NUMBER = 1000
/** 992–1000 are Local Media: channels the viewer fills from files on this device, for this session only. */
export const LOCAL_MEDIA_FIRST = 992
export const LOCAL_MEDIA_NUMBERS: readonly number[] = Array.from({ length: SESSION_CHANNEL_NUMBER - LOCAL_MEDIA_FIRST + 1 }, (_, index) => LOCAL_MEDIA_FIRST + index)
const SOURCE_PREFIX = 'local:session-'
export const LOCAL_NAME_LIMIT = 40

export function isLocalMediaNumber(number: number): boolean {
  return Number.isInteger(number) && number >= LOCAL_MEDIA_FIRST && number <= SESSION_CHANNEL_NUMBER
}

/** 1000 is Local Media; 992–999 are Local Media 1 to 8 until the viewer names them. */
export function defaultLocalName(number: number): string {
  return number === SESSION_CHANNEL_NUMBER ? 'Local Media' : `Local Media ${number - LOCAL_MEDIA_FIRST + 1}`
}

/** 1000 keeps its long-standing id; 992–999 have their own, apart from the shipped radio ids they stand over. */
function channelId(number: number): string {
  return number === SESSION_CHANNEL_NUMBER ? `ch-${number}` : `ch-local-${number}`
}

/** The Local Media channel number behind a channel id, or null. */
export function localNumberForId(id: string): number | null {
  const found = /^ch-(?:local-)?(\d+)$/.exec(id)
  const number = found ? Number(found[1]) : NaN
  return isLocalMediaNumber(number) && id === channelId(number) ? number : null
}

function makeChannel(number: number, name: string): Channel {
  return {
    id: channelId(number),
    number,
    name,
    shortName: name.toUpperCase(),
    description: 'A temporary channel made from media on this device, for this session only.',
    logo: 'LM',
    color: '#3a3a3a',
    category: 'Imported',
    categoryId: 'imported',
    origin: 'session',
    mediaKind: 'video',
    enabled: true,
    sources: [],
    scheduleMode: 'loop',
    phaseOffsetSeconds: 0,
  }
}

/** 1000 · Local Media, the reserved session channel. It exists in every session; only its programmes come and go. */
export const SESSION_CHANNEL: Channel = makeChannel(SESSION_CHANNEL_NUMBER, defaultLocalName(SESSION_CHANNEL_NUMBER))

/** One imported file, playable through its object URL for as long as the session keeps it. */
export interface SessionItem {
  title: string
  durationSeconds: number
  url: string
  kind: MediaKind
  /** Set for a file the browser cannot play itself, which is repackaged as it plays. */
  remux?: Remux
}

interface Session {
  generation: number
  /** The running order: shuffled once at import, rotated (never reshuffled) by Play Now. */
  programmes: Programme[]
  urls: Map<string, string>
  remuxes: Map<string, Remux>
  /** The running order starts here and loops. */
  anchorMs: number
}

function emptyProgramme(number: number): Programme {
  const name = localChannel(number).name
  return {
    id: `session-empty-${number}`,
    title: 'Import media',
    description: 'Select MEDIA in the Guide, then Folder or Files, to play media from this device.',
    videoId: null,
    durationSeconds: 3600,
    channelId: channelId(number),
    category: 'Imported',
    source: 'imported',
    kind: 'programme',
    playbackMode: 'linear',
    programmeType: 'generated',
    playback: 'generated',
    sourceRef: `generated:session-empty-${number}`,
    caption: `${number} · ${name.toUpperCase()} · SELECT MEDIA IN THE GUIDE, THEN FOLDER OR FILES`,
  }
}

const sessions = new Map<number, Session>()
let generation = 0
let inUse: string | null = null
let retired: string[] = []
let revoke: (url: string) => void = (url) => URL.revokeObjectURL(url)
const listeners = new Set<() => void>()
const channels = new Map<number, Channel>([[SESSION_CHANNEL_NUMBER, SESSION_CHANNEL]])
let namesLoaded = false
let channelList: readonly Channel[] | null = null

function changed(): void {
  for (const listener of listeners) listener()
}

/** Revokes every retired URL except the one the local player is still showing. */
function sweep(): void {
  const keep: string[] = []
  for (const url of retired) {
    if (url === inUse) keep.push(url)
    else revoke(url)
  }
  retired = keep
}

function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, LOCAL_NAME_LIMIT) : ''
}

function loadNames(): void {
  if (namesLoaded) return
  namesLoaded = true
  const names = readLocalNames()
  for (const number of LOCAL_MEDIA_NUMBERS) {
    const name = cleanName(names[String(number)])
    if (name && name !== defaultLocalName(number)) channels.set(number, makeChannel(number, name))
  }
}

/** The Local Media channel at this number (992–1000). The object only changes when it is renamed. */
export function localChannel(number: number): Channel {
  loadNames()
  let channel = channels.get(number)
  if (!channel) {
    channel = makeChannel(number, defaultLocalName(number))
    channels.set(number, channel)
  }
  return channel
}

/** 992–1000 in order; a new list only after a rename. */
export function localChannels(): readonly Channel[] {
  if (!channelList) channelList = LOCAL_MEDIA_NUMBERS.map(localChannel)
  return channelList
}

/** Names a Local Media channel; an empty name restores the default. The name is kept between visits, the files are not. */
export function renameLocalChannel(number: number, name: string): boolean {
  if (!isLocalMediaNumber(number)) return false
  const next = cleanName(name) || defaultLocalName(number)
  if (localChannel(number).name === next) return false
  channels.set(number, number === SESSION_CHANNEL_NUMBER && next === SESSION_CHANNEL.name ? SESSION_CHANNEL : makeChannel(number, next))
  channelList = null
  writeLocalName(number, next === defaultLocalName(number) ? null : next)
  changed()
  return true
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Tests replace the revoker; the app uses the browser's. */
export function setUrlRevoker(next: (url: string) => void): void {
  revoke = next
}

/** The local player reports the URL it holds, so a replaced session is not revoked out from under it. */
export function noteLocalSource(url: string | null): void {
  inUse = url
  sweep()
}

/** Whether this Local Media channel (1000 unless given) has anything imported. */
export function sessionActive(number = SESSION_CHANNEL_NUMBER): boolean {
  return sessions.has(number)
}

export function sessionGeneration(number = SESSION_CHANNEL_NUMBER): number {
  return sessions.get(number)?.generation ?? 0
}

export function isSessionProgramme(programme: { sourceRef?: string }): boolean {
  return Boolean(programme.sourceRef?.startsWith(SOURCE_PREFIX))
}

/** Picture comes from the network, or from a local file on the session channel. */
export function hasPicture(programme: { videoId: string | null; sourceRef?: string; liveStream?: unknown; mediaUrl?: string }): boolean {
  return programme.videoId !== null || isSessionProgramme(programme) || programme.liveStream !== undefined || programme.mediaUrl !== undefined
}

function sessionHolding(programmeId: string): [number, Session] | null {
  for (const entry of sessions) if (entry[1].urls.has(programmeId)) return entry
  return null
}

export function sessionUrlFor(programme: { id: string; sourceRef?: string }): string | null {
  if (!isSessionProgramme(programme)) return null
  return sessionHolding(programme.id)?.[1].urls.get(programme.id) ?? null
}

export function sessionRemuxFor(programme: { id: string; sourceRef?: string }): Remux | undefined {
  if (!isSessionProgramme(programme)) return undefined
  return sessionHolding(programme.id)?.[1].remuxes.get(programme.id)
}

function toProgrammes(items: readonly SessionItem[], number: number, batch: number, urls: Map<string, string>, remuxes: Map<string, Remux>): Programme[] {
  return items.map((item, index): Programme => {
    const id = `session-${number}-${batch}-${index + 1}`
    urls.set(id, item.url)
    if (item.remux) remuxes.set(id, item.remux)
    return {
      id,
      title: item.title,
      description: '',
      videoId: null,
      durationSeconds: item.durationSeconds,
      channelId: channelId(number),
      category: 'Imported',
      source: 'imported',
      kind: 'programme',
      playbackMode: 'linear',
      programmeType: 'unclassified',
      playback: 'seekable-recorded',
      mediaKind: item.kind,
      sourceRef: `${SOURCE_PREFIX}${number}-${batch}-${index + 1}`,
    }
  })
}

/**
 * Makes a Local Media channel (1000 unless given) from these items, in the order given (the importer
 * shuffles once), starting now. Whatever the channel held before is dropped, and its URLs are revoked
 * once no player holds them.
 */
export function replaceSession(items: readonly SessionItem[], nowMs: number, number = SESSION_CHANNEL_NUMBER): void {
  const previous = sessions.get(number)
  if (items.length === 0) {
    clearSession(number)
    return
  }
  generation += 1
  const urls = new Map<string, string>()
  const remuxes = new Map<string, Remux>()
  const programmes = toProgrammes(items, number, generation, urls, remuxes)
  sessions.set(number, { generation, programmes, urls, remuxes, anchorMs: nowMs })
  if (previous) retired.push(...previous.urls.values())
  sweep()
  changed()
}

/**
 * The running order rotated so the programme airing at `nowMs` comes first, anchored at its start.
 * What is on air carries on undisturbed while programmes are added after it or taken out.
 */
function settled(session: Session, number: number, nowMs: number): Session {
  const current = sessionBroadcast(nowMs, number).current
  const index = session.programmes.findIndex((programme) => programme.id === current.programme.id)
  if (index < 0) return session
  return { ...session, programmes: [...session.programmes.slice(index), ...session.programmes.slice(0, index)], anchorMs: current.startMs }
}

/**
 * Adds these items to a Local Media channel's running order: after everything already there, without
 * moving what is on air. An empty channel simply starts with them now.
 */
export function appendSession(items: readonly SessionItem[], nowMs: number, number = SESSION_CHANNEL_NUMBER): void {
  if (items.length === 0) return
  const existing = sessions.get(number)
  if (!existing) {
    replaceSession(items, nowMs, number)
    return
  }
  generation += 1
  const base = settled(existing, number, nowMs)
  const urls = new Map(base.urls)
  const remuxes = new Map(base.remuxes)
  const added = toProgrammes(items, number, generation, urls, remuxes)
  sessions.set(number, { generation, programmes: [...base.programmes, ...added], urls, remuxes, anchorMs: base.anchorMs })
  changed()
}

/** Takes one file out of its channel. Removing the one on air starts the next now; removing the last empties the channel. */
export function removeSessionProgramme(programmeId: string, nowMs: number): boolean {
  const holder = sessionHolding(programmeId)
  if (!holder) return false
  const [number, existing] = holder
  if (existing.programmes.length === 1) {
    clearSession(number)
    return true
  }
  const base = settled(existing, number, nowMs)
  const onAir = base.programmes[0]?.id === programmeId
  const urls = new Map(base.urls)
  const remuxes = new Map(base.remuxes)
  const url = urls.get(programmeId)
  urls.delete(programmeId)
  remuxes.delete(programmeId)
  sessions.set(number, {
    ...base,
    programmes: base.programmes.filter((programme) => programme.id !== programmeId),
    urls,
    remuxes,
    anchorMs: onAir ? nowMs : base.anchorMs,
  })
  if (url) retired.push(url)
  sweep()
  changed()
  return true
}

/**
 * Moves one file to position `to` in its channel's running order (as the panel lists it). What is on air
 * keeps playing at the same point: the running order is re-anchored around it.
 */
export function moveSessionProgramme(programmeId: string, to: number, nowMs: number): boolean {
  const holder = sessionHolding(programmeId)
  if (!holder) return false
  const [number, existing] = holder
  const from = existing.programmes.findIndex((programme) => programme.id === programmeId)
  const target = Math.max(0, Math.min(Math.trunc(to), existing.programmes.length - 1))
  if (from < 0 || from === target) return false
  const current = sessionBroadcast(nowMs, number).current
  const programmes = existing.programmes.slice()
  const [moved] = programmes.splice(from, 1)
  programmes.splice(target, 0, moved!)
  const onAir = programmes.findIndex((programme) => programme.id === current.programme.id)
  const before = programmes.slice(0, Math.max(0, onAir)).reduce((sum, programme) => sum + programme.durationSeconds * 1000, 0)
  sessions.set(number, { ...existing, programmes, anchorMs: current.startMs - before })
  changed()
  return true
}

/** Empties a Local Media channel (1000 unless given); its name stays. */
export function clearSession(number = SESSION_CHANNEL_NUMBER): void {
  const session = sessions.get(number)
  if (!session) return
  retired.push(...session.urls.values())
  sessions.delete(number)
  sweep()
  changed()
}

/** Current running order: the empty-channel card until something is imported. */
export function sessionProgrammes(number = SESSION_CHANNEL_NUMBER): readonly Programme[] {
  return sessions.get(number)?.programmes ?? []
}

export function sessionBroadcast(nowMs: number, number = SESSION_CHANNEL_NUMBER): ScheduleSnapshot<Programme> {
  const session = sessions.get(number)
  return calculateSchedule({
    channelId: channelId(number),
    phaseOffsetSeconds: 0,
    programmes: session?.programmes ?? [emptyProgramme(number)],
    epochMs: session?.anchorMs ?? 0,
    nowMs,
  })
}

/** Guide slots. The imported running order has no history before it started. */
export function sessionGuideSlots(startMs: number, endMs: number, number = SESSION_CHANNEL_NUMBER): GuideSlot<Programme>[] {
  const session = sessions.get(number)
  const request = {
    channelId: channelId(number),
    phaseOffsetSeconds: 0,
    programmes: session?.programmes ?? [emptyProgramme(number)],
    epochMs: session?.anchorMs ?? 0,
    nowMs: startMs,
  }
  const slots = slotsOverlapping(request, startMs, endMs)
  return session ? slots.filter((slot) => slot.startMs >= session.anchorMs - 1) : slots
}

/**
 * Play Now: the chosen programme starts from its beginning at `nowMs` and the running order continues
 * after it, rotated around the choice. Nothing is reshuffled.
 */
export function rebaseSession(programmeId: string, nowMs: number): boolean {
  const holder = sessionHolding(programmeId)
  if (!holder) return false
  const [number, session] = holder
  const index = session.programmes.findIndex((programme) => programme.id === programmeId)
  if (index < 0) return false
  sessions.set(number, {
    ...session,
    programmes: [...session.programmes.slice(index), ...session.programmes.slice(0, index)],
    anchorMs: nowMs,
  })
  changed()
  return true
}

/** The Local Media channel holding this imported programme. */
export function sessionNumberFor(programmeId: string): number | null {
  return sessionHolding(programmeId)?.[0] ?? null
}

/**
 * B and N on Local Media: the imported programme before or after the one airing, round the running order.
 * With a single file, N or B starts it again. Null for an empty channel.
 */
export function sessionNeighbour(nowMs: number, direction: -1 | 1, number = SESSION_CHANNEL_NUMBER): Programme | null {
  const session = sessions.get(number)
  if (!session) return null
  const programmes = session.programmes
  const index = programmes.findIndex((programme) => programme.id === sessionBroadcast(nowMs, number).current.programme.id)
  if (index < 0) return programmes[0] ?? null
  return programmes[(index + direction + programmes.length) % programmes.length] ?? null
}

/**
 * After an import or Play Now: already watching that channel in single view, the new running order reloads
 * in place (not a channel change, so Previous stays); from anywhere else it is an ordinary tune to it.
 */
export function sessionRefresh(current: number, tuning: boolean, single: boolean, number = SESSION_CHANNEL_NUMBER): 'in-place' | 'tune' {
  return current === number && !tuning && single ? 'in-place' : 'tune'
}

/**
 * What choosing a Local Media channel in the Guide plays: the first search match while searching,
 * otherwise the imported programme under the cursor. Null for an empty channel.
 */
export function sessionChoice(query: string, selected: Programme | null, number = SESSION_CHANNEL_NUMBER): Programme | null {
  if (query.trim()) {
    const match = searchSession(query, number)[0]
    if (match) return match
  }
  return selected && isSessionProgramme(selected) ? selected : null
}

/** Imported titles containing the search text, in running order. */
export function searchSession(query: string, number = SESSION_CHANNEL_NUMBER): readonly Programme[] {
  const needle = query.trim().toLowerCase()
  const session = sessions.get(number)
  if (!needle || !session) return []
  return session.programmes.filter((programme) => programme.title.toLowerCase().includes(needle))
}
