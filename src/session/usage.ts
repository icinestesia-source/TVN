import { useSyncExternalStore } from 'react'

/**
 * OPTIONS → Usage: what this tab has downloaded since it opened (or since the viewer reset it). Only what
 * the browser can measure is counted: TVN's own pages and data, other sites that share their sizes, and
 * video and audio TVN plays in its own player. YouTube and other embedded players fetch inside their own
 * frames, and local files are never downloaded, so neither is counted.
 */
export interface UsageTotals {
  startedAt: number
  /** Pages, scripts, images and data, as the network delivered them. */
  dataBytes: number
  dataRequests: number
  /** Requests to sites that do not share their sizes. */
  unmeasured: number
  /** Video and audio played in TVN's own player, as Chrome reports it. */
  mediaBytes: number
}

type MediaWithCounts = HTMLMediaElement & { webkitVideoDecodedByteCount?: number; webkitAudioDecodedByteCount?: number }

interface ResourceSize {
  initiatorType: string
  name: string
  transferSize: number
  encodedBodySize: number
}

const fresh = (now: number): UsageTotals => ({ startedAt: now, dataBytes: 0, dataRequests: 0, unmeasured: 0, mediaBytes: 0 })

let totals: UsageTotals = fresh(Date.now())
const listeners = new Set<() => void>()
const seenMedia = new WeakMap<HTMLMediaElement, { src: string; bytes: number }>()

const notify = () => {
  for (const listener of listeners) listener()
}

/** Adds one finished request. Media elements are counted from the elements themselves; cache hits cost nothing. */
export function countResource(current: UsageTotals, entry: ResourceSize): UsageTotals {
  if (entry.initiatorType === 'video' || entry.initiatorType === 'audio') return current
  if (entry.name.startsWith('blob:') || entry.name.startsWith('data:')) return current
  if (entry.transferSize > 0) return { ...current, dataBytes: current.dataBytes + entry.transferSize, dataRequests: current.dataRequests + 1 }
  if (entry.encodedBodySize > 0) return current
  return { ...current, unmeasured: current.unmeasured + 1 }
}

/** What a media element has fetched since it was last read; a new source starts its count again. */
export function mediaDelta(previous: { src: string; bytes: number } | undefined, src: string, bytes: number): number {
  if (!previous || previous.src !== src || bytes < previous.bytes) return bytes
  return bytes - previous.bytes
}

function readMedia(doc: Document): number {
  let added = 0
  for (const element of Array.from(doc.querySelectorAll<MediaWithCounts>('video, audio'))) {
    const src = element.currentSrc
    if (!src || src.startsWith('blob:') || src.startsWith('data:') || src.startsWith('file:')) continue
    const bytes = (element.webkitVideoDecodedByteCount ?? 0) + (element.webkitAudioDecodedByteCount ?? 0)
    added += mediaDelta(seenMedia.get(element), src, bytes)
    seenMedia.set(element, { src, bytes })
  }
  return added
}

let started = false

/** Starts counting for this tab; safe to call more than once. */
export function startUsageMonitor(win: Window = window): void {
  if (started || typeof PerformanceObserver === 'undefined') return
  started = true
  try {
    win.performance.setResourceTimingBufferSize?.(5000)
  } catch {
    // Older browsers keep their own buffer size; the observer still sees every entry.
  }
  try {
    const observer = new PerformanceObserver((list) => {
      let next = totals
      for (const entry of list.getEntries() as PerformanceResourceTiming[]) next = countResource(next, entry)
      if (next !== totals) {
        totals = next
        notify()
      }
    })
    observer.observe({ type: 'resource', buffered: true })
  } catch {
    // No resource timing here: only media is counted.
  }
  win.setInterval(() => {
    const added = readMedia(win.document)
    if (added > 0) {
      totals = { ...totals, mediaBytes: totals.mediaBytes + added }
      notify()
    }
  }, 2000)
}

export function resetUsage(now = Date.now()): void {
  totals = fresh(now)
  notify()
}

export function usageTotals(): UsageTotals {
  return totals
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useUsage(): UsageTotals {
  return useSyncExternalStore(subscribe, usageTotals, usageTotals)
}

/** 1.2 GB, 340 MB, 12 KB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}
