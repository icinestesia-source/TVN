import type { HistoryCategory, HistoryEvent } from './types.ts'
import { HISTORY_ATTRIBUTION } from './types.ts'

type Json = Record<string, unknown>

const FEED = 'https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function localMonthDay(date = new Date()): { month: number; day: number; key: string } {
  return { month: date.getMonth() + 1, day: date.getDate(), key: `${pad(date.getMonth() + 1)}-${pad(date.getDate())}` }
}

function pageUrl(pages: unknown): string | null {
  if (!Array.isArray(pages) || !pages[0] || typeof pages[0] !== 'object') return null
  const titles = (pages[0] as Json).content_urls as Json | undefined
  const desktop = titles?.desktop as Json | undefined
  return typeof desktop?.page === 'string' ? desktop.page : null
}

function pageImage(pages: unknown): string | null {
  if (!Array.isArray(pages) || !pages[0] || typeof pages[0] !== 'object') return null
  const thumb = (pages[0] as Json).thumbnail as Json | undefined
  return typeof thumb?.source === 'string' ? thumb.source : null
}

function classify(text: string, bucket: string): HistoryCategory {
  const t = text.toLowerCase()
  if (bucket === 'births') return 'births'
  if (bucket === 'holidays') return 'anniversaries'
  if (/\b(film|movie|cinema|television|tv series|actor|actress|director|oscar|emmy)\b/.test(t)) return 'film-television'
  if (/\b(song|album|musician|singer|band|music|grammy)\b/.test(t)) return 'music'
  if (/\b(broadcast|bbc|radio station|television channel)\b/.test(t)) return 'broadcasting'
  if (/\b(football|cricket|olympics|world cup|championship|match|tournament)\b/.test(t)) return 'sport'
  if (/\b(science|scientist|physics|chemistry|computer|technology|invent)\b/.test(t)) return 'science'
  if (/\b(art|painting|novel|literature|theatre|poet|composer)\b/.test(t)) return 'arts'
  if (bucket === 'selected' || bucket === 'events') return 'news'
  return 'other'
}

function eventId(year: number, text: string): string {
  const key = `${year}|${text.slice(0, 80).toLowerCase()}`
  let hash = 2166136261
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `h${(hash >>> 0).toString(16)}`
}

/** Parse Wikimedia onthisday JSON into normalised TVN events (no invented facts). */
export function eventsFromWikimediaPayload(payload: unknown): HistoryEvent[] {
  if (!payload || typeof payload !== 'object') return []
  const doc = payload as Json
  const out: HistoryEvent[] = []
  const seen = new Set<string>()
  for (const bucket of ['selected', 'events', 'births', 'deaths', 'holidays'] as const) {
    const list = Array.isArray(doc[bucket]) ? doc[bucket] : []
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue
      const row = raw as Json
      const year = typeof row.year === 'number' ? row.year : null
      const text = typeof row.text === 'string' ? row.text.trim() : ''
      if (year == null || !text) continue
      // Skip death-only bucket for default service; births kept.
      if (bucket === 'deaths') continue
      const id = eventId(year, text)
      if (seen.has(id)) continue
      seen.add(id)
      const category = classify(text, bucket)
      out.push({
        id,
        year,
        title: text.length > 120 ? `${text.slice(0, 117)}…` : text,
        description: text,
        category,
        source: HISTORY_ATTRIBUTION,
        url: pageUrl(row.pages),
        imageUrl: pageImage(row.pages),
        uncertain: false,
      })
    }
  }
  return out.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title))
}

export async function fetchOnThisDay(
  month: number,
  day: number,
  fetchImpl: typeof fetch = fetch,
): Promise<HistoryEvent[]> {
  const url = `${FEED}/all/${pad(month)}/${pad(day)}`
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'Api-User-Agent': 'TVN-InfoHistory/1.0 (https://tvn.lol; on-this-day)',
    },
  })
  if (!response.ok) throw new Error(`Wikimedia ${response.status}`)
  const payload = await response.json()
  return eventsFromWikimediaPayload(payload)
}

export function filterHistory(
  events: readonly HistoryEvent[],
  options: { categories?: readonly HistoryCategory[]; entertainmentOnly?: boolean },
): HistoryEvent[] {
  let list = [...events]
  if (options.entertainmentOnly) {
    list = list.filter((event) => event.category === 'film-television' || event.category === 'music' || event.category === 'broadcasting')
  }
  if (options.categories?.length) {
    const allowed = new Set(options.categories)
    list = list.filter((event) => allowed.has(event.category))
  }
  return list
}
