/**
 * LATEST, A–Z and RANDOM in the Guide are switches, one on at a time: on, a channel is scheduled that way;
 * off, its default schedule returns. That default (its own order, or TVN's) is kept here, in this browser, per channel.
 */
import type { OrderKind } from '../services/channel-sources.ts'

export const LATEST_MODE_KEY = 'tvn.latest-mode.v1'

/** A channel's schedule before LATEST was switched on. No order: TVN arranged it. */
export type ScheduleBeforeLatest = {
  order?: string[]
  orderKind?: OrderKind
  scheduleSize?: number
}

type Store = Pick<Storage, 'getItem' | 'setItem'>

function browserStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function readAll(store: Store | null): Record<string, ScheduleBeforeLatest> {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(LATEST_MODE_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, ScheduleBeforeLatest>) : {}
  } catch {
    return {}
  }
}

function writeAll(all: Record<string, ScheduleBeforeLatest>, store: Store | null): void {
  try {
    store?.setItem(LATEST_MODE_KEY, JSON.stringify(all))
  } catch {
    // A browser that keeps nothing still switches LATEST off; TVN then arranges the channel itself.
  }
}

function cleaned(value: ScheduleBeforeLatest | undefined): ScheduleBeforeLatest | null {
  if (!value || typeof value !== 'object') return null
  const order = Array.isArray(value.order) ? value.order.filter((id): id is string => typeof id === 'string') : []
  if (order.length === 0 || value.orderKind === 'latest' || value.orderKind === 'az' || value.orderKind === 'random') return {}
  return {
    order,
    ...(typeof value.orderKind === 'string' ? { orderKind: value.orderKind } : {}),
    ...(typeof value.scheduleSize === 'number' && value.scheduleSize > 0 ? { scheduleSize: value.scheduleSize } : {}),
  }
}

export function saveScheduleBeforeLatest(channelNumber: number, before: ScheduleBeforeLatest, store: Store | null = browserStore()): void {
  writeAll({ ...readAll(store), [String(channelNumber)]: cleaned(before) ?? {} }, store)
}

/** The schedule to return to, taken out of the store; null when none was kept. */
export function takeScheduleBeforeLatest(channelNumber: number, store: Store | null = browserStore()): ScheduleBeforeLatest | null {
  const all = readAll(store)
  const key = String(channelNumber)
  if (!(key in all)) return null
  const before = cleaned(all[key])
  const { [key]: _taken, ...rest } = all
  writeAll(rest, store)
  return before
}
