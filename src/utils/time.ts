import { formatChannelNumber } from '../input/tuner.ts'

export function padChannel(number: number): string {
  return formatChannelNumber(number)
}

export function formatClock(ms: number, seconds = false): string {
  const date = new Date(ms)
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  if (!seconds) return `${hours}:${minutes}`
  return `${hours}:${minutes}:${date.getSeconds().toString().padStart(2, '0')}`
}

export function formatGuideDate(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  })
    .format(ms)
    .toUpperCase()
}

export function formatRange(startMs: number, endMs: number): string {
  return `${formatClock(startMs)}–${formatClock(endMs)}`
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  if (total < 60) return `${total} sec`
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remain = total % 60
  if (total < 120) {
    return remain ? `${minutes} min ${remain} sec` : `${minutes} min`
  }
  if (hours > 0 && minutes > 0) return `${hours} hr ${minutes} min`
  if (hours > 0) return `${hours} hr`
  return `${minutes} min`
}

export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const mm = minutes.toString().padStart(2, '0')
  const ss = secs.toString().padStart(2, '0')
  if (hours > 0) return `${hours}:${mm}:${ss}`
  return `${mm}:${ss}`
}

/** Local half-hour at or immediately before `ms`. */
export function floorHalfHour(ms: number): number {
  const cursor = new Date(ms)
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() < 30 ? 0 : 30)
  return cursor.getTime()
}

/** Half-hour marks across a guide window, starting from the aligned tick at or before the start. */
export function halfHourTicks(startMs: number, endMs: number): number[] {
  const cursor = new Date(floorHalfHour(startMs))
  const ticks: number[] = []
  while (cursor.getTime() < endMs) {
    ticks.push(cursor.getTime())
    cursor.setMinutes(cursor.getMinutes() + 30)
  }
  return ticks
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
