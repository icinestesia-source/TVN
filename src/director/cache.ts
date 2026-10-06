import { excludedProgramme } from '../library/exclusions.ts'
import { readAllPaged } from '../library/idb-read.ts'
import { CATALOGUE_VERSION } from './network.ts'
import { addCalendarDays, broadcastDateFor } from './time.ts'
import type { FrozenDailySchedule } from './types.ts'
import { siteName } from '../app/site.ts'

/** A day from an older catalogue generation is not today's television. */
export function scheduleIsCurrent(schedule: Pick<FrozenDailySchedule, 'catalogueVersion' | 'seed'>): boolean {
  return schedule.catalogueVersion.startsWith(CATALOGUE_VERSION) || schedule.seed.includes(`|${CATALOGUE_VERSION}`)
}

/** A day frozen before a programme joined the 000–999 exclusions must not keep airing it. */
export function containsExcluded(schedule: Pick<FrozenDailySchedule, 'blocks'>): boolean {
  const known = excludedChecked.get(schedule)
  if (known !== undefined) return known
  const found = schedule.blocks.some((block) => block.children.some((child) => !child.fallback && excludedProgramme({ title: child.title, videoId: child.videoId })))
  excludedChecked.set(schedule, found)
  return found
}
const excludedChecked = new WeakMap<object, boolean>()

/** A day compiled before the channel's programmes were loaded carries no programming of its own. */
export function compiledWithoutProgrammes(schedule: Pick<FrozenDailySchedule, 'blocks' | 'poolSize'>): boolean {
  if (schedule.poolSize !== undefined) return schedule.poolSize === 0
  return schedule.blocks.every((block) => block.children.every((child) => child.fallback || !child.mediaItemId))
}

const DB_NAME = siteName('retrotv-schedules')
const DB_VERSION = 1
const STORE = 'days'
const RETAIN_DAYS = 31

const memory = new Map<string, FrozenDailySchedule>()
let bootstrapping = false
let bootstrapStarted = false
const ephemeral = new Set<string>()

/** Ignore schedule writes until the built-in library has been published. */
export function beginScheduleBootstrap(): void {
  if (bootstrapStarted) return
  bootstrapStarted = true
  bootstrapping = true
}

/** Whether the built-in library is still loading, so a pictureless schedule is provisional. */
export function scheduleBootstrapping(): boolean {
  return bootstrapping
}

/** Drop compiles made before the library was ready. Days loaded from storage stay. */
export function endScheduleBootstrap(): void {
  bootstrapping = false
  for (const id of ephemeral) memory.delete(id)
  ephemeral.clear()
}

export function scheduleKey(channelNumber: number, broadcastDate: string): string {
  return `ch-${String(channelNumber).padStart(3, '0')}|${broadcastDate}`
}

export function readFrozen(channelNumber: number, broadcastDate: string): FrozenDailySchedule | undefined {
  return memory.get(scheduleKey(channelNumber, broadcastDate))
}

export function writeFrozen(schedule: FrozenDailySchedule): void {
  memory.set(schedule.scheduleId, schedule)
  if (bootstrapping) {
    ephemeral.add(schedule.scheduleId)
    return
  }
  void persistIfAbsent(schedule)
}

export function forgetFrozen(channelNumber: number, broadcastDate: string): void {
  const key = scheduleKey(channelNumber, broadcastDate)
  memory.delete(key)
  void idbDelete(key)
}

export function forgetRange(channelNumber: number, from: string, to: string): void {
  let cursor = from
  let guard = 0
  while (cursor <= to && guard < 400) {
    forgetFrozen(channelNumber, cursor)
    cursor = addCalendarDays(cursor, 1)
    guard += 1
  }
}

export function frozenHistory(channelNumber: number, beforeDate: string): FrozenDailySchedule[] {
  const found: FrozenDailySchedule[] = []
  for (const schedule of memory.values()) {
    if (schedule.channelNumber !== channelNumber) continue
    if (schedule.broadcastDate >= beforeDate) continue
    found.push(schedule)
  }
  return found
}

export function resetScheduleMemory(): void {
  memory.clear()
}

export function retained(broadcastDate: string, today: string): boolean {
  return broadcastDate >= addCalendarDays(today, -RETAIN_DAYS)
}

function pruneMemory(today: string): void {
  for (const [key, schedule] of memory) {
    if (!retained(schedule.broadcastDate, today)) memory.delete(key)
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'scheduleId' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the schedule cache'))
  })
}

async function idbGet(scheduleId: string): Promise<FrozenDailySchedule | undefined> {
  if (typeof indexedDB === 'undefined') return undefined
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(scheduleId)
      request.onsuccess = () => resolve(request.result as FrozenDailySchedule | undefined)
      request.onerror = () => reject(request.error ?? new Error('Could not read a schedule'))
    })
  } finally {
    db.close()
  }
}

async function idbPut(schedule: FrozenDailySchedule): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(schedule)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error ?? new Error('Could not store a schedule'))
    })
  } finally {
    db.close()
  }
}

async function idbDelete(scheduleId: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(scheduleId)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error ?? new Error('Could not delete a schedule'))
    })
  } finally {
    db.close()
  }
}

async function idbAll(): Promise<FrozenDailySchedule[]> {
  if (typeof indexedDB === 'undefined') return []
  const db = await openDb()
  try {
    return await readAllPaged<FrozenDailySchedule>(db.transaction(STORE, 'readonly').objectStore(STORE), 'Could not read schedules')
  } finally {
    db.close()
  }
}

/**
 * A frozen day already in the store wins. A later catalogue must not rewrite it.
 * Only a missing record is written.
 */
async function persistIfAbsent(schedule: FrozenDailySchedule): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  try {
    const existing = await idbGet(schedule.scheduleId)
    const superseded =
      existing &&
      ((compiledWithoutProgrammes(existing) && !compiledWithoutProgrammes(schedule)) || existing.dynamicVersion !== schedule.dynamicVersion || (existing.channelName !== undefined && existing.channelName !== schedule.channelName))
    if (existing && scheduleIsCurrent(existing) && !superseded) {
      memory.set(existing.scheduleId, existing)
      return
    }
    await idbPut(schedule)
    const today = broadcastDateFor(Date.now())
    pruneMemory(today)
    const rows = await idbAll()
    for (const row of rows) {
      if (!retained(row.broadcastDate, today)) await idbDelete(row.scheduleId)
    }
  } catch {
    /* The broadcast continues from memory if the store is unavailable. */
  }
}

/** Load accepted days into memory. Does not compile and does not block the first picture. */
export function hydrateDirector(): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve()
  return idbAll()
    .then((rows) => {
      for (const row of rows) {
        if (!scheduleIsCurrent(row)) {
          void idbDelete(row.scheduleId)
          continue
        }
        memory.set(row.scheduleId, row)
        ephemeral.delete(row.scheduleId)
      }
      pruneMemory(broadcastDateFor(Date.now()))
    })
    .catch(() => undefined)
}
