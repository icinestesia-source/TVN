/**
 * What TVN's keyless source reader shares: public addresses only, plain text out of markup, and bounded reads
 * that never send credentials. Nothing here runs a page's scripts or decodes anything a publisher has hidden.
 */

export class FeedError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const MAX_BYTES = 12 * 1024 * 1024
export const TIMEOUT_MS = 15_000
export const USER_AGENT = 'TVN feed reader (+https://tvn.lol)'
const HEADERS = { 'user-agent': USER_AGENT, accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5' }

/** Public web addresses only: no credentials, no local or private hosts. */
export function publicFeedUrl(raw: string, base?: string): URL | null {
  let url: URL
  try {
    url = base ? new URL(raw, base) : new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host.includes('.') && !host.includes(':')) return null
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null
  if (/^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)) return null
  if (host.includes(':') && /^(?:::1?|f[cd]|fe80)/i.test(host)) return null
  return url
}

/** The site a host belongs to, for "the publisher's own": www. and other subdomains of it count as the same. */
export function sameSite(a: string, b: string): boolean {
  const left = a.toLowerCase().replace(/^www\./, '')
  const right = b.toLowerCase().replace(/^www\./, '')
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', raquo: '»', laquo: '«', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' }

export function decodeText(raw: string): string {
  const cdata = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  return cdata
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === '#') {
        const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
      }
      return ENTITIES[name.toLowerCase()] ?? whole
    })
    .replace(/\s+/g, ' ')
    .trim()
}

export const attr = (tag: string, name: string): string | null => {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'))
  return match ? decodeText(match[2] ?? match[3] ?? match[4] ?? '') : null
}

/** The first `<name>` element's text in a block (namespaced names such as itunes:duration included). */
export const field = (block: string, name: string): string | null => {
  const escaped = name.replace(/[.:]/g, (char) => `\\${char}`)
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, 'i'))
  return match ? decodeText(match[1]) : null
}

/** "1:02:03", "59:51", "3723" → seconds; 0 when it cannot be read. */
export function parseDuration(text: string | null): number {
  if (!text) return 0
  const trimmed = text.trim()
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed))
  if (!/^\d{1,3}(?::\d{1,2}){1,2}$/.test(trimmed)) return 0
  return trimmed.split(':').reduce((sum, part) => sum * 60 + Number(part), 0)
}

export function fnv(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** The calendar day the publisher wrote, not that moment's day in UTC: 19:01 on 3 Sep in California is still 3 Sep. */
export const dayOf = (text: string | null | undefined): string | undefined => {
  if (!text) return undefined
  const iso = text.match(/^\s*(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const written = text.match(/\b(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})\b/i)
  const month = written ? MONTHS.indexOf(written[2].toLowerCase()) : -1
  if (written && month >= 0) return `${written[3]}-${String(month + 1).padStart(2, '0')}-${written[1].padStart(2, '0')}`
  const time = Date.parse(text)
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : undefined
}

export interface FetchedText {
  text: string
  type: string
  url: string
  /** Where in the file reading stopped for time, just after the last whole tag: a later read can start there. */
  cut?: number
}

/**
 * A public page or feed as text. `stopAfter` ends a long feed's download once that many closing tags have
 * arrived, or at its deadline: a slow publisher's whole archive is never needed to list its newest episodes.
 */
export async function fetchText(
  url: string,
  read: typeof fetch,
  options: { stopAfter?: { tag: RegExp; count: number; deadline?: number }; from?: number } = {},
): Promise<FetchedText> {
  const from = options.from ?? 0
  let response: Response
  try {
    response = await read(url, { headers: from > 0 ? { ...HEADERS, range: `bytes=${from}-` } : HEADERS, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw new FeedError(502, 'That site could not be reached')
  }
  if (response.status === 401 || response.status === 402 || response.status === 403) throw new FeedError(403, 'That site needs a sign-in or subscription, which TVN does not use')
  if (response.status === 404) throw new FeedError(404, 'Nothing was found at that address')
  if (!response.ok) throw new FeedError(502, 'That site did not answer')
  if (from > 0 && response.status !== 206) throw new FeedError(502, 'That site cannot send the rest of its feed')
  const finalUrl = publicFeedUrl(response.url || url)
  if (!finalUrl) throw new FeedError(400, 'That address leads somewhere TVN does not read')
  const length = Number(response.headers.get('content-length')) || 0
  const type = (response.headers.get('content-type') ?? '').toLowerCase()
  const stop = options.stopAfter
  if (length > MAX_BYTES && !stop) throw new FeedError(413, 'That feed is too large to read')
  const got = stop && response.body ? await readUntil(response.body, stop) : { text: await response.text() }
  if (got.text.length > MAX_BYTES) throw new FeedError(413, 'That feed is too large to read')
  return { text: got.text, type, url: finalUrl.toString(), ...(got.cut !== undefined ? { cut: from + got.cut } : {}) }
}

async function readUntil(body: ReadableStream<Uint8Array>, stop: { tag: RegExp; count: number; deadline?: number }): Promise<{ text: string; cut?: number }> {
  const reader = body.getReader()
  // The mark is kept as text so that re-encoding what was read gives back its exact length in bytes.
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
  const tag = new RegExp(stop.tag.source, 'gi')
  let text = ''
  let seen = 0
  let from = 0
  let timedOut = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
      // Each scan starts after the last tag counted, so a tag is counted once even across chunks.
      tag.lastIndex = from
      for (let match = tag.exec(text); match !== null; match = tag.exec(text)) {
        seen += 1
        from = tag.lastIndex
      }
      if (seen >= stop.count || text.length > MAX_BYTES) break
      // Past the deadline, a feed's newest episodes so far are enough for this call; the rest can follow.
      if (stop.deadline !== undefined && seen > 0 && Date.now() >= stop.deadline) {
        timedOut = true
        break
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined)
  }
  return { text: text + decoder.decode(), ...(timedOut ? { cut: new TextEncoder().encode(text.slice(0, from)).length } : {}) }
}
