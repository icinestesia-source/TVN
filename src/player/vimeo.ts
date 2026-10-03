/** A Vimeo programme is stored as its public player address; this is the only Vimeo address TVN ever frames. */
const PLAYER = /^https:\/\/player\.vimeo\.com\/video\/(\d{5,12})$/

export function vimeoIdOf(url: string | undefined): string | null {
  return url ? (url.match(PLAYER)?.[1] ?? null) : null
}

export const VIMEO_ORIGIN = 'https://player.vimeo.com'

/** The embed for a public video: Vimeo's own controls off, no tracking, started at the broadcast position. */
export function vimeoEmbedSrc(id: string, startSeconds: number, muted: boolean): string {
  const start = Math.max(0, Math.floor(startSeconds))
  const query = new URLSearchParams({ autoplay: '1', muted: muted ? '1' : '0', controls: '0', dnt: '1', playsinline: '1', title: '0', byline: '0', portrait: '0', keyboard: '0', api: '1' })
  return `${VIMEO_ORIGIN}/video/${id}?${query.toString()}${start > 0 ? `#t=${start}s` : ''}`
}

/** A message from the Vimeo player, whichever way it was sent. */
export function readVimeoMessage(data: unknown): { event?: string; method?: string; value?: unknown; data?: Record<string, unknown> } | null {
  let parsed: unknown = data
  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data)
    } catch {
      return null
    }
  }
  return parsed && typeof parsed === 'object' ? (parsed as { event?: string; method?: string; value?: unknown; data?: Record<string, unknown> }) : null
}
