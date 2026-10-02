import { calculateSchedule } from '../scheduler/calculate.ts'
import { slotsOverlapping } from '../scheduler/window.ts'
import type { Channel } from '../types/channel.ts'
import type { MediaKind, Programme } from '../types/programme.ts'
import type { GuideSlot, ScheduleSnapshot } from '../types/schedule.ts'

export const SESSION_CHANNEL_NUMBER = 1000
const CHANNEL_ID = 'ch-1000'
const SOURCE_PREFIX = 'local:session-'

/** 1000 · Local Media, the reserved session channel. It exists in every session; only its programmes come and go. */
export const SESSION_CHANNEL: Channel = {
  id: CHANNEL_ID,
  number: SESSION_CHANNEL_NUMBER,
  name: 'Local Media',
  shortName: 'LOCAL MEDIA',
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

/** One imported file, playable through its object URL for as long as the session keeps it. */
export interface SessionItem {
  title: string
  durationSeconds: number
  url: string
  kind: MediaKind
}

interface Session {
  generation: number
  /** The running order: shuffled once at import, rotated (never reshuffled) by Play Now. */
  programmes: Programme[]
  urls: Map<string, string>
  /** The running order starts here and loops. */
  anchorMs: number
}

const EMPTY: Programme = {
  id: 'session-empty',
  title: 'Import media',
  description: 'Select MEDIA in the Guide, then Folder or Files, to play media from this device.',
  videoId: null,
  durationSeconds: 3600,
  channelId: CHANNEL_ID,
  category: 'Imported',
  source: 'imported',
  kind: 'programme',
  playbackMode: 'linear',
  programmeType: 'generated',
  playback: 'generated',
  sourceRef: 'generated:session-empty',
  caption: '1000 · LOCAL MEDIA · SELECT MEDIA IN THE GUIDE, THEN FOLDER OR FILES',
}

let session: Session | null = null
let generation = 0
let inUse: string | null = null
let retired: string[] = []
let revoke: (url: string) => void = (url) => URL.revokeObjectURL(url)
const listeners = new Set<() => void>()

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

export function sessionActive(): boolean {
  return session !== null
}

export function sessionGeneration(): number {
  return session?.generation ?? 0
}

export function isSessionProgramme(programme: { sourceRef?: string }): boolean {
  return Boolean(programme.sourceRef?.startsWith(SOURCE_PREFIX))
}

/** Picture comes from the network, or from a local file on the session channel. */
export function hasPicture(programme: { videoId: string | null; sourceRef?: string; liveStream?: unknown; mediaUrl?: string }): boolean {
  return programme.videoId !== null || isSessionProgramme(programme) || programme.liveStream !== undefined || programme.mediaUrl !== undefined
}

export function sessionUrlFor(programme: { id: string; sourceRef?: string }): string | null {
  if (!session || !isSessionProgramme(programme)) return null
  return session.urls.get(programme.id) ?? null
}

/**
 * Makes the session channel from these items, in the order given (the importer shuffles once), starting now.
 * Whatever the channel held before is dropped, and its URLs are revoked once no player holds them.
 */
export function replaceSession(items: readonly SessionItem[], nowMs: number): void {
  const previous = session
  if (items.length === 0) {
    clearSession()
    return
  }
  generation += 1
  const urls = new Map<string, string>()
  const programmes = items.map((item, index): Programme => {
    const id = `session-${generation}-${index + 1}`
    urls.set(id, item.url)
    return {
      id,
      title: item.title,
      description: '',
      videoId: null,
      durationSeconds: item.durationSeconds,
      channelId: CHANNEL_ID,
      category: 'Imported',
      source: 'imported',
      kind: 'programme',
      playbackMode: 'linear',
      programmeType: 'unclassified',
      playback: 'seekable-recorded',
      mediaKind: item.kind,
      sourceRef: `${SOURCE_PREFIX}${generation}-${index + 1}`,
    }
  })
  session = { generation, programmes, urls, anchorMs: nowMs }
  if (previous) retired.push(...previous.urls.values())
  sweep()
  changed()
}

export function clearSession(): void {
  if (!session) return
  retired.push(...session.urls.values())
  session = null
  sweep()
  changed()
}

/** Current running order: the empty-channel card until something is imported. */
export function sessionProgrammes(): readonly Programme[] {
  return session?.programmes ?? []
}

export function sessionBroadcast(nowMs: number): ScheduleSnapshot<Programme> {
  return calculateSchedule({
    channelId: CHANNEL_ID,
    phaseOffsetSeconds: 0,
    programmes: session?.programmes ?? [EMPTY],
    epochMs: session?.anchorMs ?? 0,
    nowMs,
  })
}

/** Guide slots. The imported running order has no history before it started. */
export function sessionGuideSlots(startMs: number, endMs: number): GuideSlot<Programme>[] {
  const request = {
    channelId: CHANNEL_ID,
    phaseOffsetSeconds: 0,
    programmes: session?.programmes ?? [EMPTY],
    epochMs: session?.anchorMs ?? 0,
    nowMs: startMs,
  }
  const slots = slotsOverlapping(request, startMs, endMs)
  return session ? slots.filter((slot) => slot.startMs >= session!.anchorMs - 1) : slots
}

/**
 * Play Now: the chosen programme starts from its beginning at `nowMs` and the running order continues
 * after it, rotated around the choice. Nothing is reshuffled.
 */
export function rebaseSession(programmeId: string, nowMs: number): boolean {
  if (!session) return false
  const index = session.programmes.findIndex((programme) => programme.id === programmeId)
  if (index < 0) return false
  session = {
    ...session,
    programmes: [...session.programmes.slice(index), ...session.programmes.slice(0, index)],
    anchorMs: nowMs,
  }
  changed()
  return true
}

/**
 * After an import or Play Now: already watching 1000 in single view, the new running order reloads in
 * place (not a channel change, so Previous stays); from anywhere else it is an ordinary tune to 1000.
 */
export function sessionRefresh(current: number, tuning: boolean, single: boolean): 'in-place' | 'tune' {
  return current === SESSION_CHANNEL_NUMBER && !tuning && single ? 'in-place' : 'tune'
}

/**
 * What choosing the session channel in the Guide plays: the first search match while searching,
 * otherwise the imported programme under the cursor. Null for the empty channel.
 */
export function sessionChoice(query: string, selected: Programme | null): Programme | null {
  if (query.trim()) {
    const match = searchSession(query)[0]
    if (match) return match
  }
  return selected && isSessionProgramme(selected) ? selected : null
}

/** Imported titles containing the search text, in running order. */
export function searchSession(query: string): readonly Programme[] {
  const needle = query.trim().toLowerCase()
  if (!needle || !session) return []
  return session.programmes.filter((programme) => programme.title.toLowerCase().includes(needle))
}
