import { createHash } from 'node:crypto'
import { initialData } from '../server/youtube-channel.ts'
import { excludedProgramme } from '../src/library/exclusions.ts'
import { playlistUrl } from '../src/services/add-channel.ts'
import { cleanFilter, eligibleOf, type SourceFilter } from '../src/services/channel-curation.ts'
import type { ExportSource, ExportVideo } from '../src/services/user-network-export.ts'
import { channelSource } from '../src/services/user-network-restore.ts'
import type { DiscoverySettings, Pacing } from './config.ts'
import { channelExport } from './corpus.ts'
import { transaction, type Db } from './db.ts'
import { canonicalSource, deskView } from './desk.ts'
import { readerOf } from './importer.ts'
import { Pacer, ReadFailure, readSource } from './provider.ts'

/**
 * DISCOVER SOURCES: plausible additional public sources for one channel, found from what the channel is meant
 * to contain (its name, description, filters, and the creators and programmes it already holds) through the
 * public, keyless lookups TVN already relies on: YouTube's public results pages (channels and playlists, read
 * as the page itself reads them) and Apple's public podcast directory. Nothing found is added: each result is
 * a CANDIDATE the operator approves or rejects. Only named fields are kept from a results page, never a
 * playback address or anything signed.
 */

export const CANDIDATE_STATUSES = ['NEW', 'APPROVED', 'ADDED', 'PARTIAL', 'FAILED', 'DUPLICATE', 'REJECTED', 'DROPPED'] as const
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number]
export type Relevance = 'HIGH' | 'MEDIUM' | 'LOW'
export type DiscoveryProvider = 'youtube-channels' | 'youtube-playlists' | 'apple-podcasts'

/** Every provider TVN can search keylessly, and the ones it cannot (reported honestly, never worked around). */
export const PROVIDERS_NOT_SEARCHED = ['Vimeo (no public keyless search TVN uses)', 'Odysee, BitChute and websites (paste their addresses)'] as const

const STOP = new Set(
  `the and for with from that this these those your you yours are was were have has had not but all any can our out new full official video videos
  episode episodes part parts live channel channels tvn programme programmes programming program programs late early best top most more ever how what why
  when who whom its into over about after before feat featuring hd 4k 1080p 720p remastered remaster version one two three four five six seven eight nine
  ten first second third season series vol volume ep no number just only also very much many some other such than then them they their there here where
  which while will would could should may might must each every per via get got make made like love great good day days week weeks year years time times
  today tonight now watch subscribe compilation clip clips highlights trailer official shorts short his her him she he its it's it ill i'm we us
  play playlist playing show shows monday tuesday wednesday thursday friday saturday sunday january february march april june july august september october november december`
    .split(/\s+/)
    .filter(Boolean),
)

const fold = (text: string) => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const stem = (token: string) => (token.length > 4 && token.endsWith('ies') ? `${token.slice(0, -3)}y` : token.length > 4 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token)

/** The meaningful words of a text, folded and lightly stemmed: no stopwords, nothing under three letters, no bare numbers. */
export function tokens(text: string): string[] {
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOP.has(token) && !/^\d+$/.test(token))
    .map(stem)
}

/** The meaningful words in their own order and spelling, for a search query. */
function words(text: string): string[] {
  return text
    .split(/[^\p{L}\p{N}'&-]+/u)
    .map((word) => word.replace(/^['&-]+|['&-]+$/g, ''))
    .filter((word) => word.length >= 3 && !STOP.has(fold(word)) && !/^\d+$/.test(word))
}

const GENERIC_CATEGORIES = new Set(['main', 'user', 'general', 'other', 'misc'])

export interface DiscoveryContext {
  channelId: number
  number: number
  name: string
  description: string
  category: string | null
  scope: 'user' | 'central'
  /** Include words across the channel's sources: the channel's editorial intent, stated. */
  include: string[]
  /** Exclude words across the channel's sources: an approved source carries them, as the channel's rules. */
  exclude: string[]
  excludeShorts: boolean
  creators: { name: string; n: number }[]
  /** The names of the channel's enabled sources and creators, folded: a playlist one of them owns is part of a source already here. */
  names: string[]
  /** Words that state the channel's proposition (name, description, category, include words), with weights. */
  proposition: Map<string, number>
  /** Words frequent in the programmes the channel already holds: a positive signal, weaker than the proposition. */
  vocabulary: Map<string, number>
  hasPodcast: boolean
  /** What the channel is meant to contain, hashed: a rejection stands until this changes. */
  key: string
}

const add = (map: Map<string, number>, token: string, weight: number) => map.set(token, Math.max(map.get(token) ?? 0, weight))

/** The channel as discovery understands it, from its effective corpus (every layer) and its Source Desk view. */
export function discoveryContext(db: Db, channelId: number): DiscoveryContext {
  const view = deskView(db, channelId)
  const exported = channelExport(db, channelId, 'effective')
  const description = view.channel.description || view.channel.shippedAs?.description || ''
  const include = new Set<string>()
  const exclude = new Set<string>()
  let excludeShorts = false
  const creators = new Map<string, number>()
  const titleFrequency = new Map<string, number>()
  let titles = 0
  let hasPodcast = false
  const names = new Set<string>()
  for (const source of exported.sources) {
    if (!source.enabled) continue
    if (source.label) names.add(fold(source.label).trim())
    if (source.sourceType === 'podcast') hasPodcast = true
    const filter = cleanFilter(source.filter)
    for (const term of filter?.include?.terms ?? []) include.add(term)
    for (const term of filter?.exclude?.terms ?? []) exclude.add(term)
    if (filter?.exclude?.shorts) excludeShorts = true
    for (const video of (source.videos ?? []) as ExportVideo[]) {
      const creator = video.creator?.name ?? source.label
      creators.set(creator, (creators.get(creator) ?? 0) + 1)
      if (video.creator?.name) names.add(fold(video.creator.name).trim())
      titles += 1
      for (const token of new Set(tokens(video.title))) titleFrequency.set(token, (titleFrequency.get(token) ?? 0) + 1)
    }
  }
  const proposition = new Map<string, number>()
  const nameTokens = tokens(view.channel.name)
  for (const token of nameTokens) add(proposition, token, 3)
  for (const token of tokens(description)) add(proposition, token, 3)
  if (view.channel.category && !GENERIC_CATEGORIES.has(fold(view.channel.category))) for (const token of tokens(view.channel.category)) add(proposition, token, 1)
  for (const term of include) for (const token of tokens(term)) add(proposition, token, 4)
  // Words from the names of its sources and creators say who, not what: they are not the channel's vocabulary.
  const named = new Set([...names].flatMap((name) => tokens(name)))
  const vocabulary = new Map<string, number>()
  for (const [token, count] of [...titleFrequency].filter(([token, count]) => count >= 2 && !named.has(token) && !proposition.has(token)).sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    vocabulary.set(token, 1 + Math.min(2, (count / Math.max(1, titles)) * 20))
  }
  const key = createHash('sha256')
    .update(JSON.stringify([view.channel.name, description, view.channel.category, [...include].sort(), [...exclude].sort(), excludeShorts]))
    .digest('hex')
    .slice(0, 16)
  return {
    channelId,
    number: view.channel.number,
    name: view.channel.name,
    description,
    category: view.channel.category,
    scope: view.channel.scope,
    include: [...include],
    exclude: [...exclude],
    excludeShorts,
    creators: [...creators].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
    names: [...names].filter(Boolean),
    proposition,
    vocabulary,
    hasPodcast,
    key,
  }
}

export interface DiscoveryQuery {
  text: string
  why: string
}

/**
 * The searches made for a channel: what its description and name say it is, the words its programmes share,
 * its include words, creators like its leading one, and the operator's own terms first when given. Never
 * merely "Channel 002".
 */
export function discoveryQueries(context: DiscoveryContext, extra = '', max = 5): DiscoveryQuery[] {
  const out: DiscoveryQuery[] = []
  const push = (text: string, why: string) => {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 120)
    if (clean.length >= 3 && !out.some((query) => fold(query.text) === fold(clean))) out.push({ text: clean, why })
  }
  const describing = words(context.description).slice(0, 7).join(' ')
  const named = words(context.name).join(' ')
  const category = context.category && !GENERIC_CATEGORIES.has(fold(context.category)) ? context.category : ''
  if (extra.trim()) {
    push(extra, 'operator terms')
    push(`${extra} ${words(context.description).slice(0, 3).join(' ')}`, 'operator terms with the channel description')
  }
  if (describing) push(describing, 'channel description')
  if (named && !/^(one|two|three|four|five|six|seven|eight|nine|ten)$/i.test(named)) push(`${named} ${category}`, 'channel name')
  if (context.include.length) push(context.include.slice(0, 4).join(' '), 'include words')
  const common = [...context.vocabulary.keys()].filter((token) => !context.creators.slice(0, 3).some((creator) => tokens(creator.name).includes(token))).slice(0, 3)
  if (common.length >= 2) push(common.join(' '), 'frequent in its programmes')
  if (context.creators[0]) push(context.creators[0].name, `creators like ${context.creators[0].name}`)
  return out.slice(0, Math.max(1, max))
}

/** One result from a provider search, before any judgement. */
export interface Found {
  provider: DiscoveryProvider
  sourceType: 'youtube-channel' | 'youtube-playlist' | 'podcast'
  url: string
  providerId: string | null
  handle: string | null
  label: string
  owner: string | null
  description: string
  listed: number | null
  audience: string | null
  sampleTitles: string[]
  genre: string | null
  query: string
  /** Where the provider ranked it for a search made from the channel's own description or the operator's terms. */
  rank?: number
}

const CHANNEL_ID = /^UC[\w-]{22}$/
const PLAYLIST_ID = /^(?:PL|OL)[\w-]{10,64}$/

type Node = Record<string, unknown>
const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null

function walk(node: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit)
    return
  }
  if (!isNode(node)) return
  visit(node)
  for (const value of Object.values(node)) walk(value, visit)
}

const textOf = (value: unknown): string => {
  if (!isNode(value)) return typeof value === 'string' ? value : ''
  if (typeof value.simpleText === 'string') return value.simpleText
  if (typeof value.content === 'string') return value.content
  if (Array.isArray(value.runs)) return value.runs.map((run) => (isNode(run) && typeof run.text === 'string' ? run.text : '')).join('')
  return ''
}

const countIn = (text: string, unit: RegExp): number | null => {
  const match = text.replace(/,/g, '').match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*([kKmM]?)\\s*${unit.source}`))
  if (!match) return null
  const scale = /k/i.test(match[2]) ? 1_000 : /m/i.test(match[2]) ? 1_000_000 : 1
  return Math.round(Number(match[1]) * scale)
}

/** Channels and playlists from a YouTube public results page (its ytInitialData), named fields only. */
export function parseYouTubeResults(data: unknown, query: string): Found[] {
  const found: Found[] = []
  const seen = new Set<string>()
  walk(data, (node) => {
    const channel = isNode(node.channelRenderer) ? node.channelRenderer : null
    if (channel && typeof channel.channelId === 'string' && CHANNEL_ID.test(channel.channelId) && !seen.has(channel.channelId)) {
      seen.add(channel.channelId)
      const base = isNode(channel.navigationEndpoint) && isNode(channel.navigationEndpoint.browseEndpoint) ? channel.navigationEndpoint.browseEndpoint.canonicalBaseUrl : null
      const counts = [textOf(channel.videoCountText), textOf(channel.subscriberCountText)]
      const handle = counts.find((text) => /^@[\w.-]{3,}$/.test(text)) ?? (typeof base === 'string' && base.startsWith('/@') ? base.slice(1) : null)
      found.push({
        provider: 'youtube-channels',
        sourceType: 'youtube-channel',
        url: `https://www.youtube.com/channel/${channel.channelId}`,
        providerId: channel.channelId,
        handle,
        label: textOf(channel.title) || handle || channel.channelId,
        owner: null,
        description: textOf(channel.descriptionSnippet).slice(0, 400),
        listed: counts.map((text) => countIn(text, /videos?/)).find((value) => value !== null) ?? null,
        audience: counts.find((text) => /subscriber/i.test(text)) ?? null,
        sampleTitles: [],
        genre: null,
        query,
      })
    }
    const lockup = isNode(node.lockupViewModel) ? node.lockupViewModel : null
    const legacy = isNode(node.playlistRenderer) ? node.playlistRenderer : null
    const id = lockup ? lockup.contentId : legacy ? legacy.playlistId : null
    if (typeof id !== 'string' || !PLAYLIST_ID.test(id) || seen.has(id)) return
    seen.add(id)
    let title = ''
    let owner: string | null = null
    let listed: number | null = null
    const sample: string[] = []
    if (lockup) {
      const metadata = isNode(lockup.metadata) && isNode(lockup.metadata.lockupMetadataViewModel) ? lockup.metadata.lockupMetadataViewModel : null
      title = textOf(metadata?.title)
      const rows: string[][] = []
      walk(metadata?.metadata, (inner) => {
        if (Array.isArray(inner.metadataParts)) rows.push(inner.metadataParts.map((part) => (isNode(part) ? textOf(part.text) : '')).filter(Boolean))
      })
      owner = rows[0]?.[0] ?? null
      for (const row of rows.slice(1)) for (const text of row) if (/·\s*\d+:\d{2}/.test(text)) sample.push(text.replace(/\s*·\s*[\d:]+$/, ''))
      walk(lockup.contentImage, (inner) => {
        const badge = isNode(inner.thumbnailBadgeViewModel) ? inner.thumbnailBadgeViewModel : null
        if (badge && listed === null) listed = countIn(textOf(badge.text), /videos?/)
      })
    } else if (legacy) {
      title = textOf(legacy.title)
      owner = textOf(legacy.shortBylineText) || null
      listed = typeof legacy.videoCount === 'string' ? Number(legacy.videoCount.replace(/,/g, '')) || null : null
    }
    if (!title) return
    found.push({ provider: 'youtube-playlists', sourceType: 'youtube-playlist', url: playlistUrl(id), providerId: id, handle: null, label: title, owner, description: '', listed, audience: null, sampleTitles: sample.slice(0, 4), genre: null, query })
  })
  return found
}

const RESULTS = 'https://www.youtube.com/results'
/** YouTube's own filters on its public results page: channels only, playlists only. */
const ONLY = { channels: 'EgIQAg%3D%3D', playlists: 'EgIQAw%3D%3D' } as const
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
  'accept-language': 'en-GB,en;q=0.9',
  cookie: 'SOCS=CAI; CONSENT=YES+cb',
}

export async function searchYouTube(query: string, kind: keyof typeof ONLY, read: typeof fetch): Promise<Found[]> {
  const response = await read(`${RESULTS}?search_query=${encodeURIComponent(query)}&sp=${ONLY[kind]}`, { headers: HEADERS })
  if (!response.ok) throw new Error(`YouTube search answered ${response.status}`)
  const data = initialData(await response.text())
  if (!data) throw new Error('YouTube search page could not be read')
  return parseYouTubeResults(data, query).filter((item) => (kind === 'channels' ? item.sourceType === 'youtube-channel' : item.sourceType === 'youtube-playlist'))
}

/** Apple's public, keyless podcast directory (the one TVN's feed lookup already uses). */
export async function searchPodcasts(query: string, read: typeof fetch): Promise<Found[]> {
  const response = await read(`https://itunes.apple.com/search?media=podcast&entity=podcast&limit=8&term=${encodeURIComponent(query)}`)
  if (!response.ok) throw new Error(`Podcast directory answered ${response.status}`)
  const body = (await response.json()) as { results?: unknown[] }
  return (body.results ?? []).flatMap((item): Found[] => {
    if (!isNode(item) || typeof item.feedUrl !== 'string' || !/^https:\/\//.test(item.feedUrl) || typeof item.collectionName !== 'string') return []
    return [
      {
        provider: 'apple-podcasts',
        sourceType: 'podcast',
        url: item.feedUrl,
        providerId: null,
        handle: null,
        label: item.collectionName,
        owner: typeof item.artistName === 'string' ? item.artistName : null,
        description: Array.isArray(item.genres) ? item.genres.filter((genre) => typeof genre === 'string').join(', ') : '',
        listed: typeof item.trackCount === 'number' ? item.trackCount : null,
        audience: null,
        sampleTitles: [],
        genre: typeof item.primaryGenreName === 'string' ? item.primaryGenreName : null,
        query,
      },
    ]
  })
}

/** Every identity a found source is known by: canonical address, and for a YouTube channel its handle too. */
export function identitiesOf(found: Pick<Found, 'url' | 'providerId' | 'handle'>): string[] {
  const ids = new Set([canonicalSource(found.url, found.providerId), canonicalSource(found.url)])
  if (found.handle) ids.add(canonicalSource(found.handle))
  return [...ids]
}

interface Use {
  channelId: number
  number: number
  name: string
  enabled: boolean
}

/** Where every source in the workspace already serves, by each identity it is known by. */
export function identityIndex(db: Db): Map<string, Use[]> {
  const rows = db.prepare('SELECT s.channel_id, s.url, s.provider_id, s.enabled, s.body, c.number, c.name FROM sources s JOIN channels c ON c.id = s.channel_id').all() as {
    channel_id: number
    url: string
    provider_id: string | null
    enabled: number
    body: string
    number: number
    name: string
  }[]
  const index = new Map<string, Use[]>()
  for (const row of rows) {
    const ids = new Set<string>()
    if (row.url) {
      ids.add(canonicalSource(row.url, row.provider_id))
      ids.add(canonicalSource(row.url))
    } else if (row.provider_id) ids.add(canonicalSource(row.provider_id, row.provider_id))
    const uploader = (JSON.parse(row.body) as ExportSource).uploaderChannelId
    if (uploader && CHANNEL_ID.test(uploader)) ids.add(`youtube:channel:${uploader}`)
    for (const id of ids) {
      if (id.startsWith('text:')) continue
      const list = index.get(id) ?? []
      if (!list.some((use) => use.channelId === row.channel_id)) list.push({ channelId: row.channel_id, number: row.number, name: row.name, enabled: row.enabled === 1 })
      index.set(id, list)
    }
  }
  return index
}

/** Excluded subjects for 001–999 at source level: factual space, aircraft and aerospace, religion. Fiction stays. */
const SUBJECT = new RegExp(
  [
    '\\b(nasa|spacex|astronom\\w*|astrophysic\\w*|cosmolog\\w*|planetarium|telescopes?|rocket launch\\w*|space (station|exploration|news|agency|flight|program\\w*|science)|',
    'aviation|aircraft|airliners?|airlines?|airports?|aerospace|plane ?spotting|flight sim\\w*|air ?shows?|warbirds?|pilot (training|life|vlog)|',
    'church(es)?|ministr(y|ies)|sermons?|gospel|bible|worship|christian|catholic|evangeli\\w*|pastor|islamic|quran|mosque|devotion\\w*|scripture|religio\\w*|spirituality)\\b',
  ].join(''),
  'i',
)
const SPACE_SUBJECT = /\b(nasa|spacex|astronom\w*|astrophysic\w*|cosmolog\w*|planetarium|telescopes?|rocket launch\w*|space \w+)\b/i
const FICTION = /\b(sci-?fi|science fiction|star trek|star wars|doctor who|anime|cartoons?|animated|animation|fiction|thunderbirds|gerry anderson|film|movie|drama)\b/i
const LECTURE = /\b(lectures?|courses?|tutorials?|lessons?|webinars?|masterclass(es)?|university|explained|how to|crash course|exam|professor|seminar)\b/i
const SPAM = /\b(full movies? free|free movies?|re-?uploads?|mirror|whatsapp status|ringtones?|8d audio|slowed|reverb|nightcore|1 hour loop|10 hours?|#shorts|tiktok compilation)\b/i

/** Whether a found source is principally about a subject TVN keeps off 001–999, and which. */
export function excludedSubject(texts: { label: string; description: string; genre?: string | null }, sample: readonly string[]): string | null {
  const own = `${texts.label} ${texts.description} ${texts.genre ?? ''}`
  const hit = own.match(SUBJECT)?.[0]
  if (hit && !(SPACE_SUBJECT.test(hit) && FICTION.test(own))) return hit.toLowerCase()
  if (/religion|spirituality|christianity|judaism|islam|hinduism|buddhism/i.test(texts.genre ?? '')) return (texts.genre as string).toLowerCase()
  if (sample.length >= 4) {
    const off = sample.filter((title) => excludedProgramme({ title }) || (SUBJECT.test(title) && !FICTION.test(title))).length
    if (off / sample.length >= 0.4) return `${off} of ${sample.length} sampled programmes`
  }
  return null
}

export interface Preview {
  /** Programmes read from the candidate's newest page (or feed). */
  read: number
  /** Of those, what this channel's rules (its exclude words, no Shorts where set, TVN's default exclusions) admit. */
  eligible: number
  listed: number | null
  refused: number
  dated: number
  newest: string | null
  oldest: string | null
  sample: { title: string; published?: string; durationSec: number }[]
}

export interface Judgement {
  relevance: Relevance
  score: number
  reasons: string[]
  sampleShare: number | null
  flags: string[]
}

/** The rules an approved source carries onto this channel: its exclude words, and no Shorts where any source sets it. */
export function channelRules(context: Pick<DiscoveryContext, 'exclude' | 'excludeShorts'>): SourceFilter | undefined {
  return cleanFilter({ exclude: { ...(context.exclude.length ? { terms: context.exclude.slice(0, 20) } : {}), ...(context.excludeShorts ? { shorts: true } : {}) } })
}

/** How many of some programmes this channel would admit: its rules, and on 001–999 TVN's default exclusions. */
export function eligibleCount(context: Pick<DiscoveryContext, 'exclude' | 'excludeShorts' | 'scope'>, videos: readonly ExportVideo[]): number {
  const filter = channelRules(context)
  const made = channelSource({ sourceType: 'youtube-channel', url: 'https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx', label: 'preview', enabled: true, videos: [...videos], ...(filter ? { filter } : {}) }, 0)
  return eligibleOf({ ...made, videos: made.videos ?? [...videos] }).filter((video) => context.scope !== 'central' || !excludedProgramme({ title: video.title, videoId: video.id })).length
}

/**
 * HIGH / MEDIUM / LOW: advisory, not objective. Built from how the candidate's own words and sampled programmes
 * meet the channel's proposition and the vocabulary of what it already holds, less what looks like a lecture
 * backbone, a reupload farm, or the channel's own exclude words.
 */
export function judge(context: DiscoveryContext, found: Pick<Found, 'label' | 'owner' | 'description' | 'sampleTitles' | 'listed' | 'sourceType' | 'rank'>, preview: Preview | null): Judgement {
  const own = `${found.label} ${found.owner ?? ''} ${found.description}`
  const ownTokens = new Set(tokens(own))
  const reasons: string[] = []
  const flags: string[] = []
  const proposed = [...ownTokens].filter((token) => context.proposition.has(token))
  const familiar = [...ownTokens].filter((token) => context.vocabulary.has(token) && !context.proposition.has(token))
  const propScore = proposed.reduce((sum, token) => sum + (context.proposition.get(token) ?? 0), 0)
  const vocabScore = Math.min(6, familiar.reduce((sum, token) => sum + (context.vocabulary.get(token) ?? 0), 0))
  if (proposed.length) reasons.push(`matches the channel: ${proposed.slice(0, 4).join(', ')}`)
  if (familiar.length) reasons.push(`like its programmes: ${familiar.slice(0, 4).join(', ')}`)
  const titles = preview?.sample.length ? preview.sample.map((item) => item.title) : found.sampleTitles
  let sampleShare: number | null = null
  if (titles.length) {
    // A playlist's titles repeat its own name; only the rest of each title says what its programmes are.
    const ownName = new Set(tokens(`${found.label} ${found.owner ?? ''}`))
    const onTheme = titles.filter((title) => tokens(title).some((token) => !ownName.has(token) && (context.proposition.has(token) || context.vocabulary.has(token)))).length
    sampleShare = onTheme / titles.length
    reasons.push(`sample ${onTheme}/${titles.length} on-theme`)
  }
  let score = propScore * 1.5 + vocabScore + (sampleShare ?? 0) * 6
  const listed = preview?.listed ?? found.listed
  if (listed !== null && listed !== undefined) {
    reasons.push(`~${listed.toLocaleString('en-GB')} listed`)
    if (listed >= 50) score += 1
  }
  if (found.sourceType !== 'podcast' || context.hasPodcast) score += 0.5
  if (found.rank !== undefined && found.rank < 3) {
    score += 3 - found.rank
    reasons.push(`top ${found.rank + 1} for the channel's own words`)
  }
  const lectureLike = LECTURE.test(own) || titles.filter((title) => LECTURE.test(title)).length >= Math.max(2, titles.length / 2)
  if (lectureLike && ![...context.proposition.keys()].some((token) => LECTURE.test(token))) {
    score -= 4
    flags.push('lecture/tutorial: off the channel proposition')
  }
  if (SPAM.test(own) || titles.filter((title) => SPAM.test(title)).length >= Math.max(2, titles.length / 2)) {
    score -= 5
    flags.push('looks like reuploads or a compilation farm')
  }
  const excludeHits = context.exclude.filter((term) => fold(own).includes(fold(term)))
  if (excludeHits.length) {
    score -= 6
    flags.push(`carries this channel's exclude words: ${excludeHits.slice(0, 3).join(', ')}`)
  }
  if (preview && preview.read > 0 && preview.eligible / preview.read < 0.5) flags.push(`${preview.read - preview.eligible} of ${preview.read} sampled would be kept off by this channel's rules`)
  score = Math.round(score * 10) / 10
  // One shared word ("bulletin") is not enough for HIGH: two of the channel's own words, or one and its programmes' vocabulary.
  const broad = proposed.length >= 2 || (proposed.length === 1 && familiar.length >= 1)
  const relevance: Relevance = score >= 8 && broad && (sampleShare === null ? propScore >= 6 : sampleShare >= 0.3) ? 'HIGH' : score >= 4 ? 'MEDIUM' : 'LOW'
  return { relevance, score, reasons, sampleShare, flags }
}

/** A candidate whose newest page was read for its preview. */
export function previewOf(context: DiscoveryContext, programmes: readonly ExportVideo[], listed: number | null | undefined, refused: number, sampleSize: number): Preview {
  const dated = programmes.map((video) => video.published).filter((day): day is string => Boolean(day)).sort()
  return {
    read: programmes.length,
    eligible: eligibleCount(context, programmes),
    listed: listed ?? null,
    refused,
    dated: dated.length,
    newest: dated.at(-1) ?? null,
    oldest: dated[0] ?? null,
    sample: programmes.slice(0, sampleSize).map((video) => ({ title: video.title, durationSec: video.durationSec, ...(video.published ? { published: video.published } : {}) })),
  }
}

export interface DiscoveryDeps {
  search: (query: string, provider: DiscoveryProvider) => Promise<Found[]>
  /** A small read of the candidate's newest page or feed; null when it could not be read now (kept, unpreviewed). */
  preview: (found: Found) => Promise<{ programmes: ExportVideo[]; listed?: number; refused: number } | { failure: 'DEAD' | 'UNSUPPORTED' | 'PRIVATE' | 'TEMPORARY'; message: string }>
  signal?: AbortSignal
  log?: (level: 'info' | 'warn', message: string) => void
}

export interface DiscoveryOptions {
  extra?: string
  /** Show candidates the operator rejected before (otherwise hidden until the channel's context changes). */
  includeRejected?: boolean
  /** SEARCH AGAIN: ask the providers even when a recent search for the same context is cached. */
  force?: boolean
  now: Date
}

export interface SearchSummary {
  id: number
  at: string
  cached: boolean
  extra: string
  queries: DiscoveryQuery[]
  providers: DiscoveryProvider[]
  notSearched: readonly string[]
  counts: { found: number; shown: number; dropped: Record<string, number>; hiddenRejected: number; previewed: number; failures: number }
}

const dropLabel = {
  here: 'ALREADY ON THIS CHANNEL',
  off: 'SWITCHED OFF ON THIS CHANNEL',
  pending: 'ALREADY WAITING TO BE SCANNED',
  dead: 'DEAD OR NOT FOUND',
  unsupported: 'UNSUPPORTED',
  private: 'PRIVATE OR RESTRICTED',
  empty: 'NO PROGRAMMES TVN CAN PLAY',
  subject: 'EXCLUDED SUBJECT',
  subset: 'PART OF A SOURCE ALREADY HERE',
  shortlist: 'BELOW THE SHORTLIST',
} as const

const usedByNote = (uses: readonly Use[]) => {
  const list = [...new Map(uses.map((use) => [use.channelId, use])).values()]
  return list.length ? `ALREADY USED BY ${list.slice(0, 3).map((use) => `${String(use.number).padStart(3, '0')} · ${use.name}`).join(', ')}${list.length > 3 ? ` +${list.length - 3}` : ''}` : null
}

/** The latest search for this channel and context (and terms), if it is recent enough to show again. */
export function cachedSearch(db: Db, channelId: number, contextKey: string, extra: string, hours: number, now: Date): number | null {
  const row = db.prepare("SELECT id, at FROM discovery_searches WHERE channel_id = ? AND context_key = ? AND extra = ? AND status = 'done' ORDER BY id DESC LIMIT 1").get(channelId, contextKey, extra.trim()) as
    | { id: number; at: string }
    | undefined
  return row && now.getTime() - Date.parse(row.at) < hours * 3600_000 ? row.id : null
}

/**
 * One DISCOVER SOURCES: search, pre-filter (exact duplicates, already here, waiting, rejected, dead, unsupported,
 * empty, excluded subjects), preview the most promising few, judge, and keep every result with its reason.
 * Shared sources are never rejected: they are shown with where else they serve.
 */
export async function discover(db: Db, channelId: number, settings: DiscoverySettings, deps: DiscoveryDeps, options: DiscoveryOptions): Promise<SearchSummary> {
  const context = discoveryContext(db, channelId)
  const extra = (options.extra ?? '').trim().slice(0, 120)
  if (!options.force) {
    const cached = cachedSearch(db, channelId, context.key, extra, settings.cacheHours, options.now)
    if (cached !== null) return { ...searchSummary(db, cached), cached: true }
  }
  const queries = discoveryQueries(context, extra, settings.maxQueries)
  const providers: DiscoveryProvider[] = ['youtube-channels', 'youtube-playlists']
  const podcastTerms = /podcast|radio|talk|interview|audio|conversation/i
  if (context.hasPodcast || podcastTerms.test(`${context.description} ${extra}`)) providers.push('apple-podcasts')
  let failures = 0
  const raw: Found[] = []
  for (const query of queries) {
    for (const provider of providers) {
      if (deps.signal?.aborted) throw new Error('Stopped')
      if (provider === 'apple-podcasts' && query !== queries[0] && query.why !== 'operator terms') continue
      // A results page that could not be read is usually momentary: asked once more before it counts as failed.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const ranked = query.why === 'channel description' || query.why.startsWith('operator terms')
          raw.push(...(await deps.search(query.text, provider)).slice(0, settings.perSearch).map((item, rank) => (ranked ? { ...item, rank } : item)))
          break
        } catch (error) {
          if (attempt === 0 && !deps.signal?.aborted) continue
          failures += 1
          deps.log?.('warn', `Discovery search "${query.text}" (${provider}) failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
  }
  const index = identityIndex(db)
  const waiting = new Set(
    (db.prepare("SELECT url FROM desk_pending WHERE channel_id = ? AND status IN ('READY', 'SCANNING')").all(channelId) as { url: string }[]).map((row) => canonicalSource(row.url)),
  )
  const rejected = new Map(
    (db.prepare('SELECT canonical, context_key FROM discovery_rejections WHERE channel_id = ?').all(channelId) as { canonical: string; context_key: string }[]).map((row) => [row.canonical, row.context_key]),
  )
  const approved = new Set(
    (db.prepare("SELECT canonical FROM discovery_candidates WHERE channel_id = ? AND status IN ('APPROVED', 'ADDED', 'PARTIAL')").all(channelId) as { canonical: string }[]).map((row) => row.canonical),
  )
  type Held = { found: Found; ids: string[]; uses: Use[]; drop: string | null; preview: Preview | null; judgement: Judgement | null; previewNote: string | null }
  const held: Held[] = []
  const seen = new Set<string>()
  let hiddenRejected = 0
  for (const found of raw) {
    const ids = identitiesOf(found)
    if (ids.some((id) => seen.has(id))) continue
    for (const id of ids) seen.add(id)
    const uses = ids.flatMap((id) => index.get(id) ?? [])
    const here = uses.filter((use) => use.channelId === channelId)
    let drop: string | null = null
    if (here.some((use) => use.enabled) || ids.some((id) => approved.has(id))) drop = dropLabel.here
    else if (here.length) drop = dropLabel.off
    else if (ids.some((id) => waiting.has(id))) drop = dropLabel.pending
    else if (found.sourceType === 'youtube-playlist' && found.owner && context.names.includes(fold(found.owner).trim())) drop = dropLabel.subset
    else if (context.scope === 'central') {
      const subject = excludedSubject(found, found.sampleTitles)
      if (subject) drop = `${dropLabel.subject}: ${subject}`
    }
    const rejectedIn = ids.map((id) => rejected.get(id)).find((key) => key !== undefined)
    if (!drop && rejectedIn !== undefined && rejectedIn === context.key && !options.includeRejected) {
      hiddenRejected += 1
      continue
    }
    held.push({ found, ids, uses: uses.filter((use) => use.channelId !== channelId), drop, preview: null, judgement: null, previewNote: null })
  }
  // Judge first on the cheap evidence, then preview the most promising few and judge again.
  const sameName = (item: Held) => !item.drop && item.found.sourceType !== 'youtube-playlist' && context.names.includes(fold(item.found.label).trim())
  for (const item of held) if (!item.drop) item.judgement = judge(context, item.found, null)
  const order = held.filter((item) => !item.drop).sort((a, b) => (b.judgement?.score ?? 0) - (a.judgement?.score ?? 0))
  let previewed = 0
  const previewing = order.slice(0, settings.previewTop)
  for (const [at, item] of previewing.entries()) {
    if (deps.signal?.aborted) throw new Error('Stopped')
    deps.log?.('info', `DISCOVER SOURCES ${String(context.number).padStart(3, '0')}: previewing ${at + 1} of ${previewing.length}: ${item.found.label}`)
    const read = await deps.preview(item.found)
    previewed += 1
    if ('failure' in read) {
      if (read.failure === 'TEMPORARY') item.previewNote = `preview not read now: ${read.message}`
      else item.drop = read.failure === 'DEAD' ? dropLabel.dead : read.failure === 'PRIVATE' ? dropLabel.private : dropLabel.unsupported
      continue
    }
    if (read.programmes.length === 0) {
      item.drop = dropLabel.empty
      continue
    }
    item.preview = previewOf(context, read.programmes, read.listed ?? item.found.listed, read.refused, settings.sampleSize)
    if (context.scope === 'central') {
      const subject = excludedSubject(item.found, item.preview.sample.map((video) => video.title))
      if (subject) {
        item.drop = `${dropLabel.subject}: ${subject}`
        continue
      }
    }
    item.judgement = judge(context, item.found, item.preview)
  }
  for (const item of held) if (sameName(item) && item.judgement) item.judgement.flags.push('same name as a source already here: check it is not a duplicate or reupload')
  const ranked = held.filter((item) => !item.drop).sort((a, b) => (b.judgement?.score ?? 0) - (a.judgement?.score ?? 0))
  for (const item of ranked.slice(settings.shortlist)) item.drop = dropLabel.shortlist
  const at = options.now.toISOString()
  const dropped: Record<string, number> = {}
  for (const item of held) if (item.drop) dropped[item.drop.replace(/:.*$/, '')] = (dropped[item.drop.replace(/:.*$/, '')] ?? 0) + 1
  const counts = { found: raw.length, shown: held.filter((item) => !item.drop).length, dropped, hiddenRejected, previewed, failures }
  const searchId = transaction(db, () => {
    const id = Number(
      db
        .prepare("INSERT INTO discovery_searches (channel_id, context_key, extra, queries, providers, counts, status, at) VALUES (?, ?, ?, ?, ?, ?, 'done', ?)")
        .run(channelId, context.key, extra, JSON.stringify(queries), JSON.stringify(providers), JSON.stringify(counts), at).lastInsertRowid,
    )
    const insert = db.prepare(
      `INSERT INTO discovery_candidates (search_id, channel_id, canonical, identities, provider, source_type, url, provider_id, label, owner, description, listed, preview, relevance, score, reasons, used_by, query, status, drop_reason, discovered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const item of held) {
      const judgement = item.judgement ?? { relevance: 'LOW' as const, score: 0, reasons: [], sampleShare: null, flags: [] }
      const reasons = { reasons: judgement.reasons, flags: judgement.flags, sampleShare: judgement.sampleShare, ...(item.previewNote ? { note: item.previewNote } : {}), ...(item.found.audience ? { audience: item.found.audience } : {}), ...(item.found.sampleTitles.length ? { listingSample: item.found.sampleTitles } : {}) }
      insert.run(
        id,
        channelId,
        item.ids[0],
        JSON.stringify(item.ids),
        item.found.provider,
        item.found.sourceType,
        item.found.url,
        item.found.providerId,
        item.found.label.slice(0, 200),
        item.found.owner?.slice(0, 200) ?? null,
        item.found.description.slice(0, 400),
        item.preview?.listed ?? item.found.listed,
        item.preview ? JSON.stringify(item.preview) : null,
        judgement.relevance,
        judgement.score,
        JSON.stringify(reasons),
        usedByNote(item.uses),
        item.found.query,
        item.drop ? 'DROPPED' : 'NEW',
        item.drop,
        at,
      )
    }
    return id
  })
  deps.log?.('info', `DISCOVER SOURCES ${String(context.number).padStart(3, '0')} ${context.name}: ${queries.length} searches, ${raw.length} results, ${counts.shown} candidates shown (${Object.entries(dropped).map(([reason, n]) => `${n} ${reason.toLowerCase()}`).join(', ') || 'none set aside'}${hiddenRejected ? `, ${hiddenRejected} rejected before hidden` : ''})`)
  return { ...searchSummary(db, searchId), cached: false }
}

export function searchSummary(db: Db, searchId: number): SearchSummary {
  const row = db.prepare('SELECT id, at, extra, queries, providers, counts FROM discovery_searches WHERE id = ?').get(searchId) as { id: number; at: string; extra: string; queries: string; providers: string; counts: string }
  return { id: row.id, at: row.at, cached: false, extra: row.extra, queries: JSON.parse(row.queries), providers: JSON.parse(row.providers), notSearched: PROVIDERS_NOT_SEARCHED, counts: JSON.parse(row.counts) }
}

export interface Candidate {
  id: number
  searchId: number
  status: CandidateStatus
  provider: DiscoveryProvider
  sourceType: string
  typeLabel: string
  url: string
  label: string
  owner: string | null
  description: string | null
  listed: number | null
  relevance: Relevance
  score: number
  reasons: string[]
  flags: string[]
  sampleShare: number | null
  note: string | null
  audience: string | null
  usedBy: string | null
  query: string
  preview: Preview | null
  dropReason: string | null
  decidedAt: string | null
  decidedBy: string | null
  result: Record<string, unknown> | null
}

const TYPE_LABELS: Record<string, string> = { 'youtube-channel': 'YouTube channel', 'youtube-playlist': 'YouTube playlist', podcast: 'Podcast feed' }

function candidateOf(row: Record<string, unknown>): Candidate {
  const reasons = JSON.parse(String(row.reasons)) as { reasons: string[]; flags: string[]; sampleShare: number | null; note?: string; audience?: string }
  return {
    id: Number(row.id),
    searchId: Number(row.search_id),
    status: row.status as CandidateStatus,
    provider: row.provider as DiscoveryProvider,
    sourceType: String(row.source_type),
    typeLabel: TYPE_LABELS[String(row.source_type)] ?? String(row.source_type),
    url: String(row.url),
    label: String(row.label),
    owner: (row.owner as string | null) ?? null,
    description: (row.description as string | null) || null,
    listed: (row.listed as number | null) ?? null,
    relevance: row.relevance as Relevance,
    score: Number(row.score),
    reasons: reasons.reasons,
    flags: reasons.flags,
    sampleShare: reasons.sampleShare,
    note: reasons.note ?? null,
    audience: reasons.audience ?? null,
    usedBy: (row.used_by as string | null) ?? null,
    query: String(row.query),
    preview: row.preview ? (JSON.parse(String(row.preview)) as Preview) : null,
    dropReason: (row.drop_reason as string | null) ?? null,
    decidedAt: (row.decided_at as string | null) ?? null,
    decidedBy: (row.decided_by as string | null) ?? null,
    result: row.result ? (JSON.parse(String(row.result)) as Record<string, unknown>) : null,
  }
}

const RANK: Record<Relevance, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }

export interface DiscoveryView {
  search: SearchSummary | null
  candidates: Candidate[]
  /** Approved (waiting for or under harvest) and harvested candidates from any search for this channel. */
  decided: Candidate[]
  dropped: Candidate[]
  rejected: number
}

/** What the desk shows for a channel's discovery: the latest search's candidates, best first, and every decision. */
export function discoveryView(db: Db, channelId: number): DiscoveryView {
  const latest = db.prepare("SELECT id FROM discovery_searches WHERE channel_id = ? AND status = 'done' ORDER BY id DESC LIMIT 1").get(channelId) as { id: number } | undefined
  const rows = latest ? (db.prepare('SELECT * FROM discovery_candidates WHERE search_id = ?').all(latest.id) as Record<string, unknown>[]).map(candidateOf) : []
  const decided = (db.prepare("SELECT * FROM discovery_candidates WHERE channel_id = ? AND status IN ('APPROVED', 'ADDED', 'PARTIAL', 'FAILED', 'DUPLICATE') ORDER BY decided_at DESC, id DESC").all(channelId) as Record<string, unknown>[]).map(candidateOf)
  return {
    search: latest ? searchSummary(db, latest.id) : null,
    candidates: rows.filter((item) => item.status === 'NEW').sort((a, b) => RANK[a.relevance] - RANK[b.relevance] || b.score - a.score),
    decided,
    dropped: rows.filter((item) => item.status === 'DROPPED'),
    rejected: (db.prepare('SELECT COUNT(*) AS n FROM discovery_rejections WHERE channel_id = ?').get(channelId) as { n: number }).n,
  }
}

/** ADD ALL SUITABLE: every HIGH or MEDIUM candidate still waiting for a decision. */
export function suitableIds(view: DiscoveryView): number[] {
  return view.candidates.filter((item) => item.relevance !== 'LOW').map((item) => item.id)
}

/**
 * AUTO-ADD HIGH CONFIDENCE (off unless turned on): only a HIGH candidate that was previewed, is a refreshable
 * channel, playlist or feed, clears the strict score, sample and volume bars, and carries no warning.
 */
export function autoApprovable(candidate: Candidate, settings: DiscoverySettings): boolean {
  const listed = candidate.preview?.listed ?? candidate.listed ?? candidate.preview?.read ?? 0
  return (
    candidate.status === 'NEW' &&
    candidate.relevance === 'HIGH' &&
    candidate.preview !== null &&
    candidate.flags.length === 0 &&
    candidate.score >= settings.autoMinScore &&
    (candidate.sampleShare ?? 0) >= settings.autoMinSampleShare &&
    listed >= settings.autoMinListed
  )
}

/**
 * Approval: each chosen candidate becomes a READY Source Desk row (linked to its candidate) for the channel's
 * harvest, with who approved it and when. Nothing becomes a source until the scan reads it.
 */
export function approveCandidates(db: Db, channelId: number, ids: readonly number[], by: 'operator' | 'auto-high-confidence', now: Date): number {
  const at = now.toISOString()
  return transaction(db, () => {
    const pick = db.prepare("SELECT * FROM discovery_candidates WHERE id = ? AND channel_id = ? AND status = 'NEW'")
    const insert = db.prepare("INSERT INTO desk_pending (channel_id, url, kind, type_label, status, note, added_at, candidate_id) VALUES (?, ?, ?, ?, 'READY', ?, ?, ?)")
    const mark = db.prepare("UPDATE discovery_candidates SET status = 'APPROVED', decided_at = ?, decided_by = ? WHERE id = ?")
    let approved = 0
    for (const id of ids) {
      const row = pick.get(id, channelId) as Record<string, unknown> | undefined
      if (!row) continue
      const candidate = candidateOf(row)
      insert.run(channelId, candidate.url, candidate.sourceType, `${candidate.typeLabel} · discovered`, `DISCOVERED (${candidate.relevance}) · ${candidate.query}${candidate.usedBy ? ` · ${candidate.usedBy}` : ''}`, at, id)
      mark.run(at, by, id)
      approved += 1
    }
    return approved
  })
}

/** REJECT: remembered for this channel and its current editorial context, so DISCOVER does not offer it again. */
export function rejectCandidates(db: Db, channelId: number, ids: readonly number[], now: Date): number {
  const at = now.toISOString()
  const context = discoveryContext(db, channelId)
  return transaction(db, () => {
    const pick = db.prepare("SELECT id, identities, label FROM discovery_candidates WHERE id = ? AND channel_id = ? AND status = 'NEW'")
    const remember = db.prepare('INSERT INTO discovery_rejections (channel_id, canonical, context_key, label, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (channel_id, canonical) DO UPDATE SET context_key = excluded.context_key, at = excluded.at')
    const mark = db.prepare("UPDATE discovery_candidates SET status = 'REJECTED', decided_at = ?, decided_by = 'operator' WHERE id = ?")
    let rejected = 0
    for (const id of ids) {
      const row = pick.get(id, channelId) as { id: number; identities: string; label: string } | undefined
      if (!row) continue
      for (const identity of JSON.parse(row.identities) as string[]) remember.run(channelId, identity, context.key, row.label, at)
      mark.run(at, row.id)
      rejected += 1
    }
    return rejected
  })
}

/**
 * The real lookups: the public results pages and Apple's directory for search, and TVN's own reader (newest
 * page only) for the preview, all paced as one more provider client and stopped by the job's STOP.
 */
export function liveDiscoveryDeps(pacing: Pacing, signal: AbortSignal, log?: DiscoveryDeps['log']): DiscoveryDeps {
  const pacer = new Pacer(pacing, signal)
  return {
    signal,
    log,
    search: (query, provider) =>
      provider === 'apple-podcasts' ? searchPodcasts(query, pacer.fetch) : searchYouTube(query, provider === 'youtube-channels' ? 'channels' : 'playlists', pacer.fetch),
    preview: async (found) => {
      try {
        const read = await readSource(
          { reader: readerOf({ sourceType: found.sourceType }), sourceType: found.sourceType, url: found.url, providerId: found.providerId, uploaderChannelId: null },
          'incremental',
          new Set(),
          pacer,
          0,
          signal,
        )
        return { programmes: read.programmes, ...(read.listed !== undefined ? { listed: read.listed } : {}), refused: read.refused }
      } catch (error) {
        if (!(error instanceof ReadFailure)) throw error
        const failure = { 'NOT FOUND': 'DEAD', 'PRIVATE/RESTRICTED': 'PRIVATE', 'EMBED REFUSED': 'UNSUPPORTED', UNSUPPORTED: 'UNSUPPORTED', 'TEMPORARY FAILURE': 'TEMPORARY' } as const
        return { failure: failure[error.outcome], message: error.message }
      }
    },
  }
}
