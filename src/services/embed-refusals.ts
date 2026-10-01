/**
 * Videos whose publisher refuses playback in an embedded player (YouTube errors 100, 101 and 150).
 * The shipped lists (User Network and curated catalogue) are read at startup; the learned list is
 * what this browser has seen refused since. Refused videos never air. Neither needs a key at runtime.
 */
const LEARNED_KEY = 'tvn.embed-refused.v1'
export const PLAYBACK_PATH = '/user-network/playback.json'

/** YouTube player error codes that mean the video will never play embedded. */
const REFUSAL_CODES = new Set(['100', '101', '150'])

let shipped = new Set<string>()
let learned: Set<string> | null = null

function learnedSet(): Set<string> {
  if (learned) return learned
  learned = new Set()
  try {
    const raw = localStorage.getItem(LEARNED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (Array.isArray(parsed)) for (const id of parsed) if (typeof id === 'string') learned.add(id)
  } catch {
    /* private mode or a damaged value */
  }
  return learned
}

export function isRefusalCode(detail: string | undefined): boolean {
  return REFUSAL_CODES.has((detail ?? '').trim())
}

export function setShippedRefusals(ids: Iterable<string>): void {
  shipped = new Set(ids)
}

export function parsePlaybackManifest(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const list = (value as { embedRefused?: unknown }).embedRefused
  return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : []
}

/** The curated catalogue's list, found by loading each video in an embedded player (scripts/embed_probe.mjs). */
export const CURATED_PLAYBACK_PATH = '/independent/playback.json'

/** A missing or unreadable list leaves playback to the other list and the runtime refusals. */
export async function loadShippedRefusals(read: typeof fetch = fetch): Promise<void> {
  const lists = await Promise.all(
    [PLAYBACK_PATH, CURATED_PLAYBACK_PATH].map(async (path) => {
      try {
        const response = await read(path)
        return response.ok ? parsePlaybackManifest(await response.json()) : []
      } catch {
        return [] /* offline or not shipped */
      }
    }),
  )
  setShippedRefusals(lists.flat())
}

export function refusedVideos(): ReadonlySet<string> {
  return new Set([...shipped, ...learnedSet()])
}

export function isRefusedVideo(videoId: string): boolean {
  return shipped.has(videoId) || learnedSet().has(videoId)
}

/** True when the video was not already known to be refused. */
export function learnRefusal(videoId: string): boolean {
  const set = learnedSet()
  if (shipped.has(videoId) || set.has(videoId)) return false
  set.add(videoId)
  try {
    localStorage.setItem(LEARNED_KEY, JSON.stringify([...set]))
  } catch {
    /* private mode */
  }
  return true
}

export function resetRefusalsForTests(): void {
  shipped = new Set()
  learned = new Set()
}
