import type { FeedEpisode, ResolvedFeed } from './podcast-feed.ts'
import { decodeText, FeedError, fnv, publicFeedUrl, refusal, TIMEOUT_MS, USER_AGENT } from './web-read.ts'

/**
 * Programmes that are a web page rather than a recording: an interactive website, or a public X post shown
 * through X's own embed. TVN reads only what anyone can: a website's response headers (to learn whether it
 * lets other sites frame it) and its title and description; an X post through X's public oEmbed record.
 * Nothing is injected into TVN, nothing signs in, and a site that refuses framing is refused, never worked round.
 */

/** A website has no length of its own: the slot it is given until the viewer chooses another. */
export const WEBSITE_SECONDS = 600
/** An X post's video length is not public; its slot is this until the viewer chooses another. */
export const POST_SECONDS = 180

export const NOT_EMBEDDABLE = 'SITE CANNOT BE EMBEDDED: it does not allow other sites to show it'

const X_HOST = /^(?:www\.|mobile\.)?(?:x|twitter)\.com$/i
const PAGE_BYTES = 256 * 1024

/** Whether a site's own headers let another site show it in a frame. */
export function frameAllowed(headers: Pick<Headers, 'get'>): boolean {
  const options = headers.get('x-frame-options')?.trim().toLowerCase()
  if (options && options !== 'allowall') return false
  const policy = headers.get('content-security-policy') ?? ''
  const ancestors = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => /^frame-ancestors\b/i.test(part))
  if (!ancestors) return true
  const allowed = ancestors.split(/\s+/).slice(1)
  return allowed.includes('*') || allowed.includes('https:')
}

/** A page's own title, description and artwork, as plain text and public addresses. */
export function pageFacts(html: string, base: string): { title?: string; summary?: string; image?: string } {
  const meta = (name: string) => {
    for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
      const key = tag.match(/\s(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase()
      if (key !== name) continue
      const content = tag.match(/\scontent\s*=\s*("([^"]*)"|'([^']*)')/i)
      if (content) return decodeText(content[2] ?? content[3] ?? '').trim()
    }
    return ''
  }
  const title = meta('og:title') || decodeText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim()
  const summary = meta('og:description') || meta('description')
  const art = meta('og:image')
  const image = art ? publicFeedUrl(art, base) : null
  return {
    ...(title ? { title: title.slice(0, 200) } : {}),
    ...(summary ? { summary: summary.slice(0, 300) } : {}),
    ...(image?.protocol === 'https:' ? { image: image.toString() } : {}),
  }
}

function single(feedUrl: string, provider: 'website' | 'x', episode: FeedEpisode, website: string | null): ResolvedFeed {
  return { feedUrl, website, title: episode.title, description: episode.summary ?? '', episodes: [episode], listed: 1, unplayable: 0, shape: 'feed', via: 'address', provider, form: 'video' }
}

/** A public https website as one interactive programme, when its own headers allow it to be framed. */
export async function resolveWebsite(start: URL, read: typeof fetch): Promise<ResolvedFeed> {
  if (start.protocol !== 'https:') throw new FeedError(400, 'A Website programme needs an https:// address')
  let response: Response
  try {
    response = await read(start.toString(), { headers: { 'user-agent': USER_AGENT, accept: 'text/html, */*;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw new FeedError(502, 'That site could not be reached')
  }
  const refused = refusal(response, 'That site')
  if (refused) throw refused
  if (response.status === 404) throw new FeedError(404, 'Nothing was found at that address')
  if (!response.ok) throw new FeedError(502, 'That site did not answer')
  const final = publicFeedUrl(response.url || start.toString())
  if (!final || final.protocol !== 'https:') throw new FeedError(400, 'That address leads somewhere TVN does not show')
  if (!frameAllowed(response.headers)) {
    await response.body?.cancel().catch(() => undefined)
    throw new FeedError(422, NOT_EMBEDDABLE)
  }
  const type = (response.headers.get('content-type') ?? '').toLowerCase()
  const html = type.includes('html') ? (await response.text()).slice(0, PAGE_BYTES) : ''
  if (!html) await response.body?.cancel().catch(() => undefined)
  const facts = pageFacts(html, final.toString())
  const url = final.toString()
  return single(
    url,
    'website',
    {
      id: `web-${fnv(url)}`,
      title: facts.title || final.hostname.replace(/^www\./, ''),
      durationSec: WEBSITE_SECONDS,
      media: url,
      type: 'text/html',
      web: 'website',
      page: url,
      ...(facts.summary ? { summary: facts.summary } : {}),
      ...(facts.image ? { image: facts.image } : {}),
    },
    final.origin,
  )
}

/** A public X post's account and id, from any of the addresses X gives one (…/status/ID, …/video/1, …/photo/1). */
export function xPostOf(url: URL): { account: string; id: string } | null {
  if (!X_HOST.test(url.hostname)) return null
  const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})(?:\/(?:video|photo)\/\d+)?\/?$/)
  return match ? { account: match[1], id: match[2] } : null
}

export const isXHost = (host: string): boolean => X_HOST.test(host)

/** X's own embed of one post: the frame its official widget creates, shown as it is. */
export const xEmbedUrl = (id: string) => `https://platform.twitter.com/embed/Tweet.html?id=${id}&dnt=true&theme=dark`

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** The post's text and day from X's oEmbed markup, as plain text: the markup itself is never shown. */
export function postFacts(html: string): { text: string; published?: string; media: boolean } {
  const text = decodeText(html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1]?.replace(/<br\s*\/?>/gi, ' ') ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s*pic\.(?:x|twitter)\.com\/\w+/gi, '')
    .replace(/\s*https?:\/\/t\.co\/\w+/gi, '')
    .trim()
  const written = [...html.matchAll(/>([A-Z][a-z]+) (\d{1,2}), (\d{4})<\/a>/g)].pop()
  const month = written ? MONTHS.indexOf(written[1].toLowerCase()) : -1
  const published = written && month >= 0 ? `${written[3]}-${String(month + 1).padStart(2, '0')}-${written[2].padStart(2, '0')}` : undefined
  return { text, ...(published ? { published } : {}), media: /pic\.(?:x|twitter)\.com\//i.test(html) }
}

/** A public X post with a video or picture, through X's public oEmbed record and its own embed. */
export async function resolveXPost(url: URL, read: typeof fetch): Promise<ResolvedFeed> {
  const post = xPostOf(url)
  if (!post) throw new FeedError(400, 'That is not the address of one X post')
  const canonical = `https://x.com/${post.account}/status/${post.id}`
  let record: Record<string, unknown> | null = null
  try {
    const response = await read(`https://publish.x.com/oembed?url=${encodeURIComponent(canonical)}&omit_script=1&dnt=true`, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    record = response.ok ? ((await response.json()) as Record<string, unknown>) : null
  } catch {
    record = null
  }
  if (!record || typeof record.html !== 'string') throw new FeedError(404, 'That X post is private, removed, or cannot be embedded')
  const facts = postFacts(record.html)
  if (!facts.media && !/\/video\/\d+\/?$/.test(url.pathname)) throw new FeedError(422, 'That X post has no video or picture for TVN to show')
  const author = typeof record.author_name === 'string' && record.author_name.trim() ? record.author_name.trim().slice(0, 60) : `@${post.account}`
  const title = facts.text ? `${author}: ${facts.text}`.slice(0, 200) : `${author} on X`
  return single(
    canonical,
    'x',
    {
      id: `x-${post.id}`,
      title,
      durationSec: POST_SECONDS,
      ...(facts.published ? { published: facts.published } : {}),
      media: xEmbedUrl(post.id),
      type: 'text/html',
      web: 'post',
      page: canonical,
      ...(facts.text ? { summary: facts.text.slice(0, 300) } : {}),
    },
    `https://x.com/${post.account}`,
  )
}
