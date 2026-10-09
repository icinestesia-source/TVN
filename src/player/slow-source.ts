import type { Programme } from '../types/programme.ts'

/** A YouTube picture is nearly always up within this; only a load that takes longer is titled. */
export const BUFFERING_TITLE_DELAY_MS = 1500

/**
 * Programmes TVN plays from a file or stream on the publisher's own servers (Odysee, BitChute, Vimeo, an
 * archive, a live stream). These can take a while to start or stall mid-way, unlike a YouTube embed.
 */
export function slowSource(programme: Pick<Programme, 'videoId' | 'mediaUrl' | 'liveStream' | 'programmeType'>): boolean {
  if (programme.videoId) return false
  if (programme.programmeType === 'website' || programme.programmeType === 'social-post') return false
  return Boolean(programme.mediaUrl || programme.liveStream)
}

const HOST_LABELS: readonly [RegExp, string][] = [
  [/(?:^|\.)(?:odysee\.com|odycdn\.com|lbry\.\w+)$/i, 'Odysee'],
  [/(?:^|\.)bitchute\.com$/i, 'BitChute'],
  [/(?:^|\.)(?:vimeo\.com|vimeocdn\.com)$/i, 'Vimeo'],
  [/(?:^|\.)archive\.org$/i, 'Internet Archive'],
  [/(?:^|\.)(?:rumble\.com|rumble\.cloud)$/i, 'Rumble'],
]

/** Who is sending the programme, named for the viewer: a known provider, else the address's own host. */
export function sourceHostLabel(url: string | undefined): string | null {
  if (!url) return null
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return null
  }
  const known = HOST_LABELS.find(([pattern]) => pattern.test(host))
  return known ? known[1] : host.replace(/^www\./i, '')
}
