import { classifySourceUrl, webAddress } from '../services/channel-sources.ts'

/**
 * Where a source comes from and what TVN can do with it there. ADD identifies an address here first: YouTube
 * goes to the keyless channel lookup, every other public web address to TVN's source reader, which decides from
 * what the address actually serves. Unsafe schemes and broadcast ingest addresses never leave the browser.
 */

export type ProviderId = 'youtube' | 'vimeo' | 'odysee' | 'bitchute' | 'rumble' | 'rss' | 'archive' | 'hls' | 'dash' | 'direct' | 'website' | 'x' | 'unknown'
export type SourceForm = 'video' | 'collection' | 'live'

export interface Capabilities {
  canResolve: boolean
  canEmbed: boolean
  canEnumerate: boolean
  canPlay: boolean
  canPause: boolean
  canSeek: boolean
  canMute: boolean
  canSetVolume: boolean
  canReadDuration: boolean
  canReadPosition: boolean
  canDetectEnded: boolean
  canDetectLive: boolean
  canReadMetadata: boolean
  canReadPublishedDate: boolean
}

export interface Provider {
  id: ProviderId
  label: string
  forms: readonly SourceForm[]
  capabilities: Capabilities
}

const NONE: Capabilities = {
  canResolve: false,
  canEmbed: false,
  canEnumerate: false,
  canPlay: false,
  canPause: false,
  canSeek: false,
  canMute: false,
  canSetVolume: false,
  canReadDuration: false,
  canReadPosition: false,
  canDetectEnded: false,
  canDetectLive: false,
  canReadMetadata: false,
  canReadPublishedDate: false,
}

/** What a browser media element gives TVN for a public file it plays. */
const ELEMENT: Capabilities = { ...NONE, canResolve: true, canPlay: true, canPause: true, canSeek: true, canMute: true, canSetVolume: true, canReadDuration: true, canReadPosition: true, canDetectEnded: true }

export const PROVIDERS: Readonly<Record<ProviderId, Provider>> = {
  youtube: {
    id: 'youtube',
    label: 'YouTube',
    forms: ['video', 'collection', 'live'],
    capabilities: { ...ELEMENT, canEmbed: true, canEnumerate: true, canDetectLive: true, canReadMetadata: true, canReadPublishedDate: true },
  },
  vimeo: {
    id: 'vimeo',
    label: 'Vimeo',
    forms: ['video', 'collection'],
    capabilities: { ...ELEMENT, canEmbed: true, canEnumerate: true, canReadMetadata: true, canReadPublishedDate: true },
  },
  odysee: { id: 'odysee', label: 'Odysee', forms: ['video', 'collection'], capabilities: { ...ELEMENT, canEnumerate: true, canReadMetadata: true, canReadPublishedDate: true } },
  bitchute: { id: 'bitchute', label: 'BitChute', forms: ['video', 'collection'], capabilities: { ...ELEMENT, canEnumerate: true, canReadMetadata: true, canReadPublishedDate: true } },
  rumble: { id: 'rumble', label: 'Rumble', forms: ['video', 'collection'], capabilities: { ...ELEMENT, canEnumerate: true, canReadMetadata: true, canReadPublishedDate: true } },
  rss: { id: 'rss', label: 'RSS', forms: ['collection'], capabilities: { ...ELEMENT, canEnumerate: true, canReadMetadata: true, canReadPublishedDate: true } },
  archive: { id: 'archive', label: 'Website', forms: ['collection'], capabilities: { ...ELEMENT, canEnumerate: true, canReadMetadata: true, canReadPublishedDate: true } },
  hls: { id: 'hls', label: 'HLS', forms: ['video', 'live'], capabilities: { ...ELEMENT, canDetectLive: true } },
  dash: { id: 'dash', label: 'DASH', forms: [], capabilities: { ...NONE, canResolve: true } },
  direct: { id: 'direct', label: 'Direct media', forms: ['video', 'live'], capabilities: { ...ELEMENT, canDetectLive: true } },
  // A website is shown, not played: no length, position, seek or sound of its own for TVN to control.
  website: { id: 'website', label: 'Website', forms: ['video'], capabilities: { ...NONE, canResolve: true, canEmbed: true, canReadMetadata: true } },
  // X's own embed: TVN can show a public post and read its date, but cannot play, seek or time its video.
  x: { id: 'x', label: 'X / Twitter', forms: ['video'], capabilities: { ...NONE, canResolve: true, canEmbed: true, canReadMetadata: true, canReadPublishedDate: true } },
  unknown: { id: 'unknown', label: 'Unknown', forms: [], capabilities: NONE },
}

/** A live stream does not seek, end or have a length: what its provider can do with a file, it cannot do here. */
export function capabilitiesFor(provider: ProviderId, form: SourceForm): Capabilities {
  const base = PROVIDERS[provider].capabilities
  return form === 'live' ? { ...base, canSeek: false, canReadDuration: false, canDetectEnded: false, canReadPublishedDate: false } : base
}

export const INGEST_MESSAGE = 'That is an ingest address: TVN needs the public playback URL (.m3u8 or watch page)'
export const UNSAFE_MESSAGE = 'TVN only opens public web addresses'
export const UNKNOWN_MESSAGE = 'This URL cannot currently be used by TVN'

const INGEST_SCHEME = /^(?:rtmps?|rtsp|rtsps|srt|rist|udp|rtp):\/\//i
const ANY_SCHEME = /^([a-z][a-z0-9+.-]*):/i

const HOSTS: readonly [RegExp, ProviderId][] = [
  [/^(?:www\.|player\.)?vimeo\.com$/i, 'vimeo'],
  [/^(?:www\.)?odysee\.com$/i, 'odysee'],
  [/^(?:www\.|api\.|old\.)?bitchute\.com$/i, 'bitchute'],
  [/^(?:www\.)?rumble\.com$/i, 'rumble'],
  [/^(?:www\.|mobile\.)?(?:x|twitter)\.com$/i, 'x'],
]

export interface Identified {
  /** YouTube's keyless lookup, or TVN's source reader for everything else. */
  route: 'youtube' | 'reader'
  /** The provider the address names; 'unknown' until the reader has looked at what it serves. */
  provider: ProviderId
  url: string
}

/**
 * Which way ADD reads an address, or why it cannot. Only http(s) web addresses (and YouTube handles and ids)
 * get past here; an ingest address gets the message that says what TVN needs instead.
 */
export function identifyUrl(raw: string): Identified {
  const text = raw.trim()
  if (!text) throw new Error('Paste a source address')
  if (INGEST_SCHEME.test(text)) throw new Error(INGEST_MESSAGE)
  const scheme = text.match(ANY_SCHEME)?.[1]?.toLowerCase()
  // "example.com:8000/stream" reads as a scheme too; only a real one other than http(s) is refused.
  if (scheme && scheme !== 'http' && scheme !== 'https' && !/^[a-z0-9.-]+:\d{1,5}(?:[/?#]|$)/i.test(text)) throw new Error(UNSAFE_MESSAGE)
  const classified = classifySourceUrl(text)
  if (classified.kind === 'youtube') return { route: 'youtube', provider: 'youtube', url: classified.url }
  const url = webAddress(text)
  const provider = HOSTS.find(([host]) => host.test(url.hostname))?.[1] ?? 'unknown'
  return { route: 'reader', provider, url: url.toString() }
}

/**
 * ADD's route for what was typed. An unsafe or ingest address is refused with its reason; anything else that is
 * not a web address (a name, a handle) is left to the YouTube lookup, which says what it makes of it.
 */
export function addRoute(raw: string): Identified['route'] {
  try {
    return identifyUrl(raw).route
  } catch (error) {
    if (error instanceof Error && (error.message === INGEST_MESSAGE || error.message === UNSAFE_MESSAGE)) throw error
    return 'youtube'
  }
}

const FORM_LABEL: Record<SourceForm, string> = { video: 'Video', collection: 'Collection', live: 'Live stream' }

/** "Vimeo · Video", "HLS · Live stream": what the ADD preview calls a source. A single file of sound is "Audio". */
export function describeSource(provider: ProviderId, form: SourceForm, audio = false): string {
  return `${PROVIDERS[provider].label} · ${audio && form === 'video' ? 'Audio' : FORM_LABEL[form]}`
}
