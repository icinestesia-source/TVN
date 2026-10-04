import { classifyChoice, classifySourceUrl, isXPostUrl, webAddress, youTubeLinkType, type SourceKind } from '../src/services/channel-sources.ts'
import { shippedChannel } from '../src/data/catalogue.ts'
import type { ExportSource, ExportSourceType } from '../src/services/user-network-export.ts'
import type { HealthThresholds } from './config.ts'
import { getMeta, setMeta, transaction, type Db } from './db.ts'
import { computeHealth, type ChannelHealth } from './health.ts'
import { readerOf, type Reader } from './importer.ts'

export const DESK_STATES = ['UNREVIEWED', 'REVIEWED', 'SKIPPED', 'ENRICHED', 'NEEDS MORE'] as const
export type DeskState = (typeof DESK_STATES)[number]

/** A pasted address as TVN's own detection reads it. Never throws: an address TVN cannot place is UNKNOWN. */
export interface Detection {
  url: string
  /** The identity duplicates are judged by, before any read. */
  canonical: string
  sourceType: ExportSourceType | null
  reader: Reader
  typeLabel: string
  ready: boolean
  note?: string
}

const sourceTypeOf = (kind: SourceKind, youtube: 'channel' | 'playlist'): ExportSourceType | null =>
  kind === 'youtube' ? (youtube === 'playlist' ? 'youtube-playlist' : 'youtube-channel') : kind === 'tvn' || kind === 'collection' ? null : kind

const STREAM_LABELS: Partial<Record<SourceKind, string>> = { 'video-hls': 'HLS live video', 'audio-hls': 'HLS live audio', video: 'Direct media / live video', audio: 'Direct media / live audio' }

export function detectSource(raw: string): Detection {
  const text = raw.trim()
  const unknown = (note: string): Detection => ({ url: text, canonical: canonicalSource(text), sourceType: null, reader: 'none', typeLabel: 'UNKNOWN', ready: false, note })
  try {
    const youtube = youTubeLinkType(text)
    if (youtube) {
      const { url } = classifySourceUrl(text, 'youtube')
      const labels = { channel: 'YouTube channel', playlist: 'YouTube playlist', video: 'YouTube video (its channel)', mix: 'YouTube Mix (as TVN reads it)' }
      const sourceType: ExportSourceType = youtube === 'playlist' || youtube === 'mix' ? 'youtube-playlist' : 'youtube-channel'
      return { url, canonical: canonicalSource(url), sourceType, reader: 'youtube', typeLabel: labels[youtube], ready: true }
    }
    if (isXPostUrl(text)) {
      const { url } = classifySourceUrl(text, 'website')
      return { url, canonical: canonicalSource(url), sourceType: 'website', reader: 'website', typeLabel: 'X post', ready: true }
    }
    for (const [choice, label] of [['vimeo', 'Vimeo'], ['odysee', 'Odysee'], ['bitchute', 'BitChute']] as const) {
      try {
        const { url } = classifyChoice(text, choice)
        return { url, canonical: canonicalSource(url), sourceType: 'podcast', reader: 'podcast', typeLabel: label, ready: true }
      } catch {
        // Not this provider.
      }
    }
    const { kind, url } = classifySourceUrl(text)
    const sourceType = sourceTypeOf(kind, 'channel')
    if (!sourceType) return unknown('TVN cannot add that kind of source by address')
    const path = new URL(url).pathname
    const looksLikePage = kind === 'audio' && !/\.[a-z0-9]{2,5}$/i.test(path)
    // TVN's Detect reads a page or feed address for its feed or public episode archive; so does the Source Desk.
    if (kind === 'podcast' || looksLikePage) {
      const feed = /\.(?:rss|xml|atom)$|\/(?:feed|rss|atom|podcasts?)(?:\/|$)/i.test(path)
      return { url, canonical: canonicalSource(url), sourceType: 'podcast', reader: 'podcast', typeLabel: feed ? 'RSS / podcast' : 'Website (its feed or archive)', ready: true }
    }
    return { url, canonical: canonicalSource(url), sourceType, reader: readerOf({ sourceType }), typeLabel: STREAM_LABELS[kind] ?? kind, ready: true }
  } catch (error) {
    return unknown(error instanceof Error ? error.message : 'Not a source address')
  }
}

/** Every address in a paste: one per line, or several on a line where spaces plainly separate them. */
export function extractUrls(text: string): string[] {
  const tokens = text.split(/[\s,;]+/).map((token) => token.trim().replace(/^[<("']+|[>)"'.]+$/g, '')).filter(Boolean)
  const found = tokens.filter((token) => /^https?:\/\//i.test(token) || /^@[\w.-]{3,100}$/.test(token) || /^UC[0-9A-Za-z_-]{22}$/.test(token) || /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}(?:[/?#]\S*)?$/i.test(token))
  return [...new Set(found)]
}

const TRACKING = /^(?:utm_\w+|fbclid|gclid|si|feature|pp|ab_channel|ref|ref_src)$/i

/**
 * A source's identity for duplicate checks: YouTube by channel id, handle, playlist or video; anything else by
 * host (without www./m.) and path, with tracking parameters, fragment and scheme set aside.
 */
export function canonicalSource(raw: string, providerId?: string | null): string {
  if (providerId && /^UC[\w-]{22}$/.test(providerId)) return `youtube:channel:${providerId}`
  if (providerId && /^(?:PL|OL|UU|FL|RD)[\w-]{10,64}$/.test(providerId)) return `youtube:playlist:${providerId}`
  const text = raw.trim()
  if (/^UC[\w-]{22}$/.test(text)) return `youtube:channel:${text}`
  if (/^@[\w.-]{3,100}$/.test(text)) return `youtube:handle:${text.toLowerCase()}`
  let url: URL
  try {
    url = webAddress(text)
  } catch {
    return `text:${text.toLowerCase()}`
  }
  const host = url.hostname.toLowerCase().replace(/^(?:www\.|m\.|music\.)/, '')
  const parts = url.pathname.split('/').filter(Boolean)
  if (host === 'youtube.com' || host === 'youtu.be') {
    const list = url.searchParams.get('list')
    if (list && /^(?:PL|OL|UU|FL)[\w-]{10,64}$/.test(list)) return `youtube:playlist:${list}`
    if (host === 'youtu.be' && parts[0]) return `youtube:video:${parts[0]}`
    if (parts[0] === 'watch' && url.searchParams.get('v')) return `youtube:video:${url.searchParams.get('v')}`
    if (['shorts', 'live', 'embed', 'v'].includes(parts[0] ?? '') && parts[1]) return `youtube:video:${parts[1]}`
    if (parts[0] === 'channel' && parts[1]) return `youtube:channel:${parts[1]}`
    if (parts[0]?.startsWith('@')) return `youtube:handle:${decodeURIComponent(parts[0]).toLowerCase()}`
    if ((parts[0] === 'c' || parts[0] === 'user') && parts[1]) return `youtube:${parts[0]}:${parts[1].toLowerCase()}`
  }
  const query = [...url.searchParams].filter(([key]) => !TRACKING.test(key)).sort(([a], [b]) => a.localeCompare(b))
  const search = query.length ? `?${new URLSearchParams(query).toString()}` : ''
  return `web:${host}/${parts.join('/')}${search}`
}

interface ChannelRef {
  id: number
  key: string
  scope: 'user' | 'central'
  layer: 'master' | 'shipped'
  number: number
  name: string
}

/** The Source Desk walks every channel by number: 001–999 first, then the User Network. */
export function deskChannels(db: Db): ChannelRef[] {
  return db.prepare("SELECT id, key, scope, layer, number, name FROM channels ORDER BY CASE scope WHEN 'central' THEN 0 ELSE 1 END, number").all() as unknown as ChannelRef[]
}

/** The channel the desk is on: where the operator left it, else 001. */
export function currentChannel(db: Db): ChannelRef {
  const channels = deskChannels(db)
  if (channels.length === 0) throw new Error('This workspace has no channels')
  const saved = Number(getMeta(db, 'desk_current'))
  return channels.find((channel) => channel.id === saved) ?? channels.find((channel) => channel.number >= 1) ?? channels[0]
}

export function deskStateOf(db: Db, channelId: number): DeskState {
  const row = db.prepare('SELECT state FROM desk WHERE channel_id = ?').get(channelId) as { state: string } | undefined
  return row && (DESK_STATES as readonly string[]).includes(row.state) ? (row.state as DeskState) : 'UNREVIEWED'
}

function setDeskState(db: Db, channelId: number, state: DeskState, at: string, stamp?: 'reviewed_at' | 'skipped_at' | 'enriched_at'): void {
  db.prepare(`INSERT INTO desk (channel_id, state, updated_at${stamp ? `, ${stamp}` : ''}) VALUES (?, ?, ?${stamp ? ', ?' : ''}) ON CONFLICT (channel_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at${stamp ? `, ${stamp} = excluded.${stamp}` : ''}`).run(
    channelId,
    state,
    at,
    ...(stamp ? [at] : []),
  )
}

export function goTo(db: Db, channelId: number): ChannelRef {
  const channel = deskChannels(db).find((item) => item.id === channelId)
  if (!channel) throw new Error('No such channel')
  setMeta(db, 'desk_current', String(channel.id))
  return channel
}

/** GO TO by number: a central channel first (001–999), else a User Network channel with that number. */
export function goToNumber(db: Db, number: number): ChannelRef {
  const channel = deskChannels(db).find((item) => item.number === number)
  if (!channel) throw new Error(`There is no channel ${String(number).padStart(3, '0')}`)
  return goTo(db, channel.id)
}

/** NEXT: on to the following channel; a channel left unreviewed has now been looked at. */
export function next(db: Db, now: Date): ChannelRef {
  const channels = deskChannels(db)
  const here = currentChannel(db)
  if (deskStateOf(db, here.id) === 'UNREVIEWED') setDeskState(db, here.id, 'REVIEWED', now.toISOString(), 'reviewed_at')
  const at = channels.findIndex((channel) => channel.id === here.id)
  return goTo(db, channels[Math.min(at + 1, channels.length - 1)].id)
}

export function previous(db: Db): ChannelRef {
  const channels = deskChannels(db)
  const at = channels.findIndex((channel) => channel.id === currentChannel(db).id)
  return goTo(db, channels[Math.max(at - 1, 0)].id)
}

/** SKIP: no source work here now. The channel is untouched and stays open to revisit. */
export function skip(db: Db, now: Date): ChannelRef {
  const here = currentChannel(db)
  if (deskStateOf(db, here.id) !== 'ENRICHED') setDeskState(db, here.id, 'SKIPPED', now.toISOString(), 'skipped_at')
  else db.prepare('UPDATE desk SET skipped_at = ? WHERE channel_id = ?').run(now.toISOString(), here.id)
  const channels = deskChannels(db)
  const at = channels.findIndex((channel) => channel.id === here.id)
  return goTo(db, channels[Math.min(at + 1, channels.length - 1)].id)
}

export function markNeedsMore(db: Db, now: Date, note?: string): void {
  const here = currentChannel(db)
  setDeskState(db, here.id, 'NEEDS MORE', now.toISOString(), 'reviewed_at')
  if (note !== undefined) db.prepare('UPDATE desk SET note = ? WHERE channel_id = ?').run(note.slice(0, 500), here.id)
}

export function markReviewed(db: Db, now: Date): void {
  setDeskState(db, currentChannel(db).id, 'REVIEWED', now.toISOString(), 'reviewed_at')
}

/** After a scan added sources: the channel is ENRICHED and its totals grow. */
export function recordEnrichment(db: Db, channelId: number, added: { sources: number; programmes: number; seconds: number }, now: Date): void {
  setDeskState(db, channelId, 'ENRICHED', now.toISOString(), 'enriched_at')
  db.prepare('UPDATE desk SET sources_added = sources_added + ?, programmes_added = programmes_added + ?, seconds_added = seconds_added + ? WHERE channel_id = ?').run(added.sources, added.programmes, added.seconds, channelId)
}

export interface PendingSource {
  id: number
  url: string
  typeLabel: string
  status: 'READY' | 'UNKNOWN — REVIEW' | 'ALREADY ADDED' | 'EXISTING SOURCE — DISABLED' | 'SCANNING' | 'ADDED' | 'FAILED' | 'PARTIAL'
  note: string | null
  result: SourceResult | null
  sourceId: number | null
}

export interface SourceResult {
  label: string
  programmes: number
  eligible: number
  seconds: number
  dated: number
  refused: number
  listed?: number
  complete: boolean
}

interface SourceIdentityRow {
  id: number
  channel_id: number
  url: string
  provider_id: string | null
  enabled: number
  number: number
  name: string
  scope: string
}

/** Where else a source already serves, by canonical identity. */
function usesOf(db: Db, canonical: string): SourceIdentityRow[] {
  const rows = db
    .prepare("SELECT s.id, s.channel_id, s.url, s.provider_id, s.enabled, c.number, c.name, c.scope FROM sources s JOIN channels c ON c.id = s.channel_id WHERE s.url != '' OR s.provider_id IS NOT NULL")
    .all() as unknown as SourceIdentityRow[]
  return rows.filter((row) => canonicalSource(row.url, row.provider_id) === canonical || (row.url && canonicalSource(row.url) === canonical))
}

const label = (row: Pick<SourceIdentityRow, 'number' | 'name'>) => `${String(row.number).padStart(3, '0')} · ${row.name}`

/** How a detected address stands against this channel and the rest of the corpus. */
export function duplicateCheck(db: Db, channelId: number, canonical: string): { status: 'READY' | 'ALREADY ADDED' | 'EXISTING SOURCE — DISABLED'; note: string | null } {
  const uses = usesOf(db, canonical)
  const here = uses.filter((row) => row.channel_id === channelId)
  if (here.some((row) => row.enabled)) return { status: 'ALREADY ADDED', note: null }
  if (here.length > 0) return { status: 'EXISTING SOURCE — DISABLED', note: 'Switched off on this channel; it stays off and is not added again' }
  const elsewhere = [...new Map(uses.filter((row) => row.channel_id !== channelId).map((row) => [row.channel_id, row])).values()]
  return { status: 'READY', note: elsewhere.length ? `ALSO USED BY ${elsewhere.slice(0, 3).map(label).join(', ')}${elsewhere.length > 3 ? ` +${elsewhere.length - 3}` : ''}` : null }
}

/** Paste into ADD SOURCES: each address found becomes a pending row, checked at once. */
export function addPending(db: Db, channelId: number, text: string, now: Date): PendingSource[] {
  const urls = extractUrls(text)
  const fallback = urls.length === 0 && text.trim() ? [text.trim()] : urls
  return transaction(db, () => {
    const waiting = new Set((db.prepare("SELECT url FROM desk_pending WHERE channel_id = ? AND status NOT IN ('ADDED', 'FAILED')").all(channelId) as { url: string }[]).map((row) => canonicalSource(row.url)))
    const insert = db.prepare('INSERT INTO desk_pending (channel_id, url, kind, type_label, status, note, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    const added: number[] = []
    for (const raw of fallback) {
      const found = detectSource(raw)
      if (waiting.has(found.canonical)) continue
      waiting.add(found.canonical)
      const check = found.ready ? duplicateCheck(db, channelId, found.canonical) : { status: 'UNKNOWN — REVIEW' as const, note: found.note ?? null }
      added.push(Number(insert.run(channelId, found.url, found.sourceType, found.typeLabel, check.status, check.note, now.toISOString()).lastInsertRowid))
    }
    return pendingOf(db, channelId).filter((row) => added.includes(row.id))
  })
}

export function removePending(db: Db, channelId: number, id: number): void {
  db.prepare("DELETE FROM desk_pending WHERE id = ? AND channel_id = ? AND status NOT IN ('SCANNING', 'ADDED', 'PARTIAL')").run(id, channelId)
}

/** Scanned rows are kept as the channel's history; the desk shows what is waiting and the latest results. */
export function pendingOf(db: Db, channelId: number): PendingSource[] {
  return (db.prepare('SELECT id, url, type_label, status, note, result, source_id FROM desk_pending WHERE channel_id = ? ORDER BY id').all(channelId) as { id: number; url: string; type_label: string; status: PendingSource['status']; note: string | null; result: string | null; source_id: number | null }[]).map((row) => ({
    id: row.id,
    url: row.url,
    typeLabel: row.type_label,
    status: row.status,
    note: row.note,
    result: row.result ? (JSON.parse(row.result) as SourceResult) : null,
    sourceId: row.source_id,
  }))
}

/** The ExportSource a new desk source starts as, before its first read names it. */
export function deskSourceBody(detection: Detection): ExportSource {
  return { sourceType: detection.sourceType as ExportSourceType, url: detection.url, label: detection.url.replace(/^https?:\/\/(?:www\.)?/, ''), enabled: true }
}

export interface ExistingSource {
  id: number
  provider: string
  label: string
  url: string
  enabled: boolean
  provenance: string
  programmes: number
  lastRefresh: string | null
  status: string | null
  complete: boolean
  partial: boolean
}

export interface DeskView {
  channel: {
    id: number
    number: number
    name: string
    scope: 'user' | 'central'
    layer: 'master' | 'shipped'
    stableId: string | null
    description: string
    category: string | null
    filters: string[]
    /** What TVN ships at this number when the master's override renamed it. */
    shippedAs: { name: string; description: string } | null
  }
  state: DeskState
  note: string | null
  health: ChannelHealth | null
  sources: ExistingSource[]
  pending: PendingSource[]
  index: number
  total: number
}

const PROVIDER_LABELS: Record<string, string> = { 'youtube-channel': 'YouTube', 'youtube-playlist': 'YouTube playlist', collection: 'List', podcast: 'Feed', website: 'Website', tvn: 'TVN', audio: 'Audio', 'audio-hls': 'HLS audio', video: 'Video', 'video-hls': 'HLS video' }

function filtersOf(body: Record<string, unknown>, sources: { body: string }[]): string[] {
  const out: string[] = []
  const describe = (filter: unknown, where: string) => {
    if (!filter || typeof filter !== 'object') return
    const parts = Object.entries(filter as Record<string, unknown>)
      .filter(([, value]) => value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0))
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    if (parts.length) out.push(`${where}${parts.join(' · ')}`)
  }
  describe(body.filter, '')
  for (const source of sources) {
    const parsed = JSON.parse(source.body) as ExportSource
    describe(parsed.filter, `${parsed.label}: `)
  }
  for (const original of (body.originals as { name?: string; filter?: unknown }[] | undefined) ?? []) describe(original.filter, `${original.name ?? 'original'}: `)
  return out
}

/** Everything the desk shows for one channel, as one effective channel. */
export function deskView(db: Db, channelId: number): DeskView {
  const channels = deskChannels(db)
  const index = channels.findIndex((channel) => channel.id === channelId)
  const row = db.prepare('SELECT id, number, name, scope, layer, stable_id, body FROM channels WHERE id = ?').get(channelId) as { id: number; number: number; name: string; scope: 'user' | 'central'; layer: 'master' | 'shipped'; stable_id: string | null; body: string }
  const body = JSON.parse(row.body) as Record<string, unknown>
  const sources = db.prepare('SELECT s.id, s.source_type, s.label, s.url, s.enabled, s.provenance, s.last_success_at, s.status, s.complete, s.continuation, s.body, (SELECT COUNT(*) FROM programmes p WHERE p.source_id = s.id) AS programmes FROM sources s WHERE s.channel_id = ? ORDER BY s.position').all(channelId) as {
    id: number
    source_type: string
    label: string
    url: string
    enabled: number
    provenance: string
    last_success_at: string | null
    status: string | null
    complete: number
    continuation: string | null
    body: string
    programmes: number
  }[]
  const health = db.prepare('SELECT metrics FROM health WHERE channel_id = ?').get(channelId) as { metrics: string } | undefined
  const desk = db.prepare('SELECT note FROM desk WHERE channel_id = ?').get(channelId) as { note: string | null } | undefined
  const shipped = row.scope === 'central' ? shippedChannel(row.number) : undefined
  return {
    channel: {
      id: row.id,
      number: row.number,
      name: row.name,
      scope: row.scope,
      layer: row.layer,
      stableId: row.stable_id,
      description: typeof body.description === 'string' && body.description ? body.description : shipped && shipped.name === row.name ? (shipped.description ?? '') : '',
      category: typeof body.category === 'string' ? body.category : (shipped?.category ?? null),
      filters: filtersOf(body, sources),
      shippedAs: shipped && shipped.name !== row.name ? { name: shipped.name, description: shipped.description ?? '' } : null,
    },
    state: deskStateOf(db, channelId),
    note: desk?.note ?? null,
    health: health ? (JSON.parse(health.metrics) as ChannelHealth) : null,
    sources: sources.map((source) => ({
      id: source.id,
      provider: PROVIDER_LABELS[source.source_type] ?? source.source_type,
      label: source.label,
      url: source.url,
      enabled: source.enabled === 1,
      provenance: source.provenance,
      programmes: source.programmes,
      lastRefresh: source.last_success_at,
      status: source.status,
      complete: source.complete === 1,
      partial: source.continuation !== null,
    })),
    pending: pendingOf(db, channelId),
    index: index + 1,
    total: channels.length,
  }
}

export interface DeskProgress {
  channel: { number: number; position: number; total: number; centralTotal: number }
  reviewed: number
  enriched: number
  skipped: number
  needsMore: number
  newSources: number
  newProgrammes: number
  newPlayableHours: number
}

export function deskProgress(db: Db): DeskProgress {
  const here = currentChannel(db)
  const channels = deskChannels(db)
  const counts = Object.fromEntries((db.prepare('SELECT state, COUNT(*) AS n FROM desk GROUP BY state').all() as { state: string; n: number }[]).map((row) => [row.state, row.n]))
  const totals = db.prepare('SELECT COALESCE(SUM(sources_added), 0) AS sources, COALESCE(SUM(programmes_added), 0) AS programmes, COALESCE(SUM(seconds_added), 0) AS seconds FROM desk').get() as { sources: number; programmes: number; seconds: number }
  return {
    channel: { number: here.number, position: channels.findIndex((channel) => channel.id === here.id) + 1, total: channels.length, centralTotal: channels.filter((channel) => channel.scope === 'central').length },
    reviewed: (counts.REVIEWED ?? 0) + (counts.SKIPPED ?? 0) + (counts.ENRICHED ?? 0) + (counts['NEEDS MORE'] ?? 0),
    enriched: counts.ENRICHED ?? 0,
    skipped: counts.SKIPPED ?? 0,
    needsMore: counts['NEEDS MORE'] ?? 0,
    newSources: totals.sources,
    newProgrammes: totals.programmes,
    newPlayableHours: Math.round((totals.seconds / 3600) * 10) / 10,
  }
}

/** One channel's health again, after a scan or refresh, so the desk shows AFTER at once. */
export function refreshChannelHealth(db: Db, channelId: number, thresholds: HealthThresholds, now: Date): ChannelHealth | null {
  return computeHealth(db, thresholds, now, [channelId])[0] ?? null
}
