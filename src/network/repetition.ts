import { listChannels, programmesFor } from '../data/catalogue.ts'
import { getSchedule } from '../director/director.ts'
import { policyFor } from '../director/policies.ts'
import { broadcastDateFor } from '../director/time.ts'
import { originalGuideSlots } from '../originals/originals.ts'
import { broadcast } from '../services/broadcast.ts'

export interface InstantRow {
  channel: number
  name: string
  programme: string
  mediaId: string | null
  videoId: string | null
}

export interface DuplicateUse {
  videoId: string
  channels: number
}

export interface DayRow {
  channel: number
  uniqueProgrammes: number
  repeats: number
}

export interface RepetitionReport {
  configured: number
  uniqueVideoIds: number
  duplicateVideoIds: DuplicateUse[]
  rows: InstantRow[]
  day: DayRow[]
  dayDuplicateVideoIds: DuplicateUse[]
}

function duplicates(ids: Array<string | null>): DuplicateUse[] {
  const counts = new Map<string, number>()
  for (const id of ids) {
    if (!id) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([videoId, channels]) => ({ videoId, channels }))
    .sort((left, right) => right.channels - left.channels || left.videoId.localeCompare(right.videoId))
}

/** Current picture on every configured channel, plus one compiled broadcast day. */
export function networkRepetition(nowMs: number): RepetitionReport {
  const configured = listChannels().filter((channel) => channel.enabled && channel.origin !== 'session')
  const rows: InstantRow[] = configured.map((channel) => {
    const current = broadcast(channel, nowMs).current
    return {
      channel: channel.number,
      name: channel.name,
      programme: current.programme.title,
      mediaId: current.programme.sourceRef ?? null,
      videoId: current.programme.videoId,
    }
  })
  const day: DayRow[] = []
  const dayIds: string[] = []
  for (const channel of configured) {
    const original = channel.number <= 999 ? originalGuideSlots(channel, nowMs - 43_200_000, nowMs + 43_200_000) : null
    if (original) {
      const ids = original.map((slot) => slot.programme.videoId).filter((id): id is string => Boolean(id))
      const unique = new Set(ids)
      day.push({ channel: channel.number, uniqueProgrammes: unique.size, repeats: ids.length - unique.size })
      dayIds.push(...ids)
      continue
    }
    const policy = policyFor(channel.number)
    if (!policy) {
      const ids = programmesFor(channel.id)
        .map((programme) => programme.videoId)
        .filter((id): id is string => Boolean(id))
      const unique = new Set(ids)
      day.push({ channel: channel.number, uniqueProgrammes: unique.size, repeats: ids.length - unique.size })
      dayIds.push(...ids)
      continue
    }
    const date = broadcastDateFor(nowMs, policy.broadcastDayStart)
    const schedule = getSchedule(channel, date, 'guide')
    const ids: string[] = []
    for (const block of schedule.blocks) {
      for (const child of block.children) {
        if (child.videoId) ids.push(child.videoId)
      }
    }
    const unique = new Set(ids)
    day.push({ channel: channel.number, uniqueProgrammes: unique.size, repeats: ids.length - unique.size })
    dayIds.push(...ids)
  }
  const instantIds = rows.map((row) => row.videoId)
  return {
    configured: configured.length,
    uniqueVideoIds: new Set(instantIds.filter((id): id is string => Boolean(id))).size,
    duplicateVideoIds: duplicates(instantIds),
    rows,
    day,
    dayDuplicateVideoIds: duplicates(dayIds),
  }
}
