import type { ExportVideo } from '../src/services/user-network-export.ts'
import type { VideoCreator } from '../src/services/channels-import.ts'
import { isSignedUrl } from '../server/url-sources.ts'

/** A programme as a provider read gives it now. Only what the provider itself states. */
export interface FreshProgramme {
  id: string
  title: string
  durationSec: number
  published?: string
  creator?: VideoCreator
  summary?: string
  image?: string
  page?: string
}

export interface Enrichment {
  id: string
  fields: Partial<Pick<ExportVideo, 'published' | 'creator' | 'durationSec' | 'summary' | 'image' | 'page'>>
}

export interface MergeResult {
  /** New programmes, in the provider's order, as they join the pool. */
  added: ExportVideo[]
  /** Known programmes given something they lacked (a date counts here too). */
  enriched: Enrichment[]
  /** Known programmes the read saw again. */
  seen: string[]
  /** New programmes left out because the source is at its bound. */
  overflow: number
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A public http(s) link, never a personal or expiring one. */
function publicLink(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !isSignedUrl(url) ? raw : undefined
  } catch {
    return undefined
  }
}

/**
 * Additive, conservative merge of a fresh read into a held pool. Nothing held is removed, reordered or
 * overwritten: a known programme only gains what it lacked (a provider date, its creator, a summary). New
 * programmes are added, held back from the schedule when `hold` is set. A date is only ever the provider's
 * own calendar day; none is guessed, and the current date is never used.
 */
export function mergeFresh(held: readonly ExportVideo[], fresh: readonly FreshProgramme[], options: { hold: boolean; limit: number }): MergeResult {
  const known = new Map(held.map((video) => [video.id, video]))
  const added: ExportVideo[] = []
  const enriched: Enrichment[] = []
  const seen: string[] = []
  const taken = new Set<string>()
  let overflow = 0
  for (const raw of fresh) {
    const item = { ...raw, image: publicLink(raw.image), page: publicLink(raw.page) }
    if (taken.has(item.id)) continue
    taken.add(item.id)
    const published = item.published && DAY.test(item.published) ? item.published : undefined
    const current = known.get(item.id)
    if (current) {
      seen.push(item.id)
      const fields: Enrichment['fields'] = {}
      if (!current.published && published) fields.published = published
      if (!current.creator && item.creator) fields.creator = item.creator
      if (!(current.durationSec > 0) && item.durationSec > 0) fields.durationSec = Math.round(item.durationSec)
      if (!current.summary && item.summary) fields.summary = item.summary
      if (!current.image && item.image) fields.image = item.image
      if (!current.page && item.page) fields.page = item.page
      if (Object.keys(fields).length > 0) enriched.push({ id: item.id, fields })
      continue
    }
    if (!(item.durationSec > 0) || !item.title) continue
    if (held.length + added.length >= options.limit) {
      overflow += 1
      continue
    }
    added.push({
      id: item.id,
      title: item.title,
      durationSec: Math.round(item.durationSec),
      ...(published ? { published } : {}),
      ...(item.creator ? { creator: item.creator } : {}),
      ...(item.summary ? { summary: item.summary } : {}),
      ...(item.image ? { image: item.image } : {}),
      ...(item.page ? { page: item.page } : {}),
      ...(options.hold ? { pending: true as const } : {}),
    })
  }
  return { added, enriched, seen, overflow }
}

/** A held programme with its enrichment laid in, never replacing what it had. */
export function enrichedVideo(video: ExportVideo, fields: Enrichment['fields']): ExportVideo {
  const out: ExportVideo = { ...video }
  for (const [key, value] of Object.entries(fields) as [keyof Enrichment['fields'], unknown][]) {
    if (value !== undefined && (out[key] === undefined || (key === 'durationSec' && !(out.durationSec > 0)))) (out as unknown as Record<string, unknown>)[key] = value
  }
  return out
}
