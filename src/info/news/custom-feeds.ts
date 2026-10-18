import type { CustomNewsFeed } from '../preferences.ts'
import { itemsFromFeedXml } from './normalize.ts'
import type { NewsCategory, NewsItem } from './types.ts'

export interface CustomFeedPreview {
  title: string
  publisher: string
  items: NewsItem[]
}

const CUSTOM_TIMEOUT_MS = 10_000
const CUSTOM_MAX_BYTES = 800_000

/** Public http(s) only — mirrors TVN SSRF rules without importing server modules into the client. */
export function validateCustomFeedUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`)
  } catch {
    return { ok: false, error: 'Enter a valid feed URL.' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'Only http(s) feed URLs are allowed.' }
  }
  if (url.username || url.password) {
    return { ok: false, error: 'Feed URLs must not include credentials.' }
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host.includes('.') && !host.includes(':')) {
    return { ok: false, error: 'Local and private addresses are not allowed.' }
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, error: 'Local and private addresses are not allowed.' }
  }
  if (/^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)) {
    return { ok: false, error: 'Local and private addresses are not allowed.' }
  }
  if (host.includes(':') && /^(?:::1?|f[cd]|fe80)/i.test(host)) {
    return { ok: false, error: 'Local and private addresses are not allowed.' }
  }
  return { ok: true, url: url.toString() }
}

function channelTitle(xml: string): string | null {
  const match =
    xml.match(/<channel[\s>][\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i) ?? xml.match(/<feed[\s>][\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!match) return null
  return match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').replace(/<[^>]+>/g, '').trim() || null
}

function looksLikeFeed(xml: string): boolean {
  return /<rss[\s>]|<feed[\s>]|<rdf:RDF[\s>]/i.test(xml) && /<item[\s>]|<entry[\s>]/i.test(xml)
}

/**
 * Fetch and preview a custom RSS/Atom feed from the browser.
 * CORS may block some publishers — that is reported, not bypassed with an open proxy.
 */
export async function previewCustomFeed(
  rawUrl: string,
  category: NewsCategory = 'top',
  fetchImpl: typeof fetch = fetch,
): Promise<
  | { ok: true; preview: CustomFeedPreview; feed: Omit<CustomNewsFeed, 'id' | 'addedIso' | 'enabled'> }
  | { ok: false; error: string }
> {
  const checked = validateCustomFeedUrl(rawUrl)
  if (!checked.ok) return checked
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CUSTOM_TIMEOUT_MS)
  try {
    const response = await fetchImpl(checked.url, {
      signal: controller.signal,
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    })
    if (!response.ok) return { ok: false, error: `Feed returned ${response.status}` }
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > CUSTOM_MAX_BYTES) return { ok: false, error: 'Feed is too large' }
    const xml = new TextDecoder('utf-8').decode(buffer)
    if (!looksLikeFeed(xml)) return { ok: false, error: 'URL did not return RSS or Atom XML' }
    const title = channelTitle(xml) ?? new URL(checked.url).hostname
    const publisher = `Custom · ${title}`
    const items = itemsFromFeedXml(xml, { sourceId: 'custom:preview', publisher, category }).slice(0, 5)
    if (!items.length) return { ok: false, error: 'Feed contained no headlines' }
    return {
      ok: true,
      preview: { title, publisher, items },
      feed: { title, publisher, feedUrl: checked.url, category },
    }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Fetch failed'
    if (/failed to fetch|networkerror|cors/i.test(message) || message === 'Failed to fetch') {
      return {
        ok: false,
        error:
          'This feed could not be loaded in the browser (often blocked by CORS). TVN does not bypass publisher restrictions with an open proxy.',
      }
    }
    return { ok: false, error: message }
  } finally {
    clearTimeout(timer)
  }
}

export async function loadCustomFeedItems(feed: CustomNewsFeed, fetchImpl: typeof fetch = fetch): Promise<NewsItem[]> {
  if (!feed.enabled) return []
  const result = await previewCustomFeed(feed.feedUrl, feed.category, fetchImpl)
  if (!result.ok) return []
  return result.preview.items.map((item) => ({
    ...item,
    sourceId: `custom:${feed.id}`,
    publisher: feed.publisher,
    category: feed.category,
  }))
}

export function customFeedId(url: string): string {
  let hash = 2166136261
  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `cf${(hash >>> 0).toString(16)}`
}
