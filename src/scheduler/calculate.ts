import type { BroadcastPosition, ScheduleSnapshot, ScheduledItem } from '../types/schedule.ts'

export function cycleDurationSeconds(items: readonly ScheduledItem[]): number {
  let total = 0
  for (const item of items) {
    if (!Number.isFinite(item.durationSeconds) || item.durationSeconds <= 0) {
      throw new Error(`Programme ${item.id} has an invalid duration`)
    }
    total += item.durationSeconds
  }
  return total
}

/** Modulo that stays non-negative for times before the epoch. */
export function positiveModulo(value: number, modulus: number): number {
  if (modulus <= 0) return 0
  const remainder = value % modulus
  return remainder < 0 ? remainder + modulus : remainder
}

export interface ScheduleRequest<T extends ScheduledItem> {
  channelId: string
  phaseOffsetSeconds: number
  programmes: readonly T[]
  epochMs: number
  nowMs: number
}

/**
 * Pure schedule calculation. No React, no Date.now(), no storage.
 * The same inputs always return the same broadcast position.
 */
export function calculateSchedule<T extends ScheduledItem>(
  input: ScheduleRequest<T>,
): ScheduleSnapshot<T> {
  const { programmes } = input
  if (programmes.length === 0) {
    throw new Error(`Channel ${input.channelId} has an empty schedule`)
  }

  const cycle = cycleDurationSeconds(programmes)
  const sinceEpochSeconds = (input.nowMs - input.epochMs) / 1000
  const offsetSeconds = positiveModulo(sinceEpochSeconds + input.phaseOffsetSeconds, cycle)
  const current = positionAt(programmes, offsetSeconds, input.nowMs)

  const previousIndex = (current.index - 1 + programmes.length) % programmes.length
  const nextIndex = (current.index + 1) % programmes.length
  const previousProgramme = programmes[previousIndex]
  const nextProgramme = programmes[nextIndex]

  const previous: BroadcastPosition<T> = {
    programme: previousProgramme,
    index: previousIndex,
    startMs: current.startMs - previousProgramme.durationSeconds * 1000,
    endMs: current.startMs,
    elapsedSeconds: previousProgramme.durationSeconds,
    seekSeconds: previousProgramme.durationSeconds,
  }

  const next: BroadcastPosition<T> = {
    programme: nextProgramme,
    index: nextIndex,
    startMs: current.endMs,
    endMs: current.endMs + nextProgramme.durationSeconds * 1000,
    elapsedSeconds: 0,
    seekSeconds: 0,
  }

  return {
    channelId: input.channelId,
    epochMs: input.epochMs,
    nowMs: input.nowMs,
    cycleDurationSeconds: cycle,
    offsetSeconds,
    current,
    previous,
    next,
  }
}

function positionAt<T extends ScheduledItem>(
  programmes: readonly T[],
  offsetSeconds: number,
  nowMs: number,
): BroadcastPosition<T> {
  let cursor = 0
  let index = programmes.length - 1

  for (let i = 0; i < programmes.length; i += 1) {
    const duration = programmes[i].durationSeconds
    if (offsetSeconds < cursor + duration) {
      index = i
      break
    }
    cursor += duration
  }

  const programme = programmes[index]
  const elapsedSeconds = offsetSeconds - cursor
  const startMs = nowMs - elapsedSeconds * 1000

  return {
    programme,
    index,
    startMs,
    endMs: startMs + programme.durationSeconds * 1000,
    elapsedSeconds,
    seekSeconds: elapsedSeconds,
  }
}

export function liveKey(channelId: string, programmeId: string, startMs: number): string {
  return `${channelId}:${programmeId}:${startMs}`
}
