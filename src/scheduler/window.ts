import { calculateSchedule, type ScheduleRequest } from './calculate.ts'
import type { GuideSlot, ScheduledItem } from '../types/schedule.ts'

/**
 * Programme blocks that overlap a closed-open wall-clock window.
 * This is the horizontal window the guide renders. Virtualisation recycles
 * these slots; it should not invent a second schedule.
 */
export function slotsOverlapping<T extends ScheduledItem>(
  input: ScheduleRequest<T>,
  rangeStartMs: number,
  rangeEndMs: number,
): GuideSlot<T>[] {
  if (rangeEndMs <= rangeStartMs || input.programmes.length === 0) return []

  const sample = calculateSchedule({ ...input, nowMs: rangeStartMs })
  const slots: GuideSlot<T>[] = []
  let index = sample.current.index
  let startMs = sample.current.startMs
  const shortest = Math.min(...input.programmes.map((item) => item.durationSeconds))
  const limit =
    Math.ceil((rangeEndMs - rangeStartMs) / 1000 / shortest) + input.programmes.length + 2

  for (let n = 0; n < limit; n += 1) {
    const programme = input.programmes[index]
    const endMs = startMs + programme.durationSeconds * 1000
    if (endMs > rangeStartMs && startMs < rangeEndMs) {
      slots.push({ programme, index, startMs, endMs })
    }
    if (endMs >= rangeEndMs) break
    startMs = endMs
    index = (index + 1) % input.programmes.length
  }

  return slots
}

export function slotContaining<T>(slots: readonly GuideSlot<T>[], timeMs: number): GuideSlot<T> | null {
  for (const slot of slots) {
    if (timeMs >= slot.startMs && timeMs < slot.endMs) return slot
  }
  return null
}

export function adjacentSlotTime<T extends ScheduledItem>(
  slots: readonly GuideSlot<T>[],
  timeMs: number,
  direction: -1 | 1,
): { timeMs: number } | { edge: 'start' | 'end' } | null {
  const index = slots.findIndex((slot) => timeMs >= slot.startMs && timeMs < slot.endMs)
  if (index < 0) return null
  const nextIndex = index + direction
  if (nextIndex < 0) return { edge: 'start' }
  if (nextIndex >= slots.length) return { edge: 'end' }
  return { timeMs: slots[nextIndex].startMs + 1 }
}
