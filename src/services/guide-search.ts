/**
 * CREATE GUIDE FROM…: a temporary viewing Guide built from TVN's own catalogue metadata for a few words
 * (Music, Daft Punk, Michael Jordan, Italian cooking). Nothing here reaches the web or any API; it scores the
 * programmes TVN already airs and arranges the best of them into a watchable two to four hours.
 */
import type { GuideProgramme } from './viewing-guides.ts'

export interface SearchChannel {
  number: number
  name: string
  description?: string
  category?: string
  /** Editorial tags, purpose, desired coverage and eras, where the channel has them. */
  tags?: readonly string[]
  purpose?: string
  desired?: string
  eras?: string
  programmes: readonly SearchProgramme[]
}

export interface SearchProgramme {
  id: string
  title: string
  durationSeconds: number
  videoId?: string | null
  mediaUrl?: string
  /** The publisher or source it came from. */
  source?: string
  /** What a Guide keeps of it, when it is picked. */
  guide?: GuideProgramme
}

/** Small, explicit, editable: a broad word reaches its obvious neighbours, and nothing else does. */
export const TOPICS: Readonly<Record<string, readonly string[]>> = {
  music: ['music', 'concert', 'performance', 'band', 'singer', 'song', 'instrumental', 'karaoke', 'live session', 'album', 'orchestra'],
  camping: ['camping', 'camp', 'outdoors', 'hiking', 'bushcraft', 'wilderness', 'tent', 'trail', 'backpacking'],
  geography: ['geography', 'country', 'countries', 'place', 'map', 'travel', 'landscape', 'continent'],
  language: ['language', 'linguistics', 'vocabulary', 'pronunciation', 'language learning', 'grammar', 'phrases'],
}

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'for', 'to', 'with', 'about'])
/** Words that ask for short material; otherwise Shorts and fragments stay out. */
const WANTS_SHORT = new Set(['short', 'shorts', 'clip', 'clips', 'trailer', 'trailers', 'teaser', 'teasers'])
const SHORT_SECONDS = 120
/** Longer than this would be most of a Guide by itself. */
const LONGEST = 2.5 * 3600
export const SEARCH_TARGET = { min: 2 * 3600, target: 3 * 3600, max: 4 * 3600 } as const

export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** A word in its few plain forms, so "concerts" finds "concert" and "maps" finds "map", without a stemmer. */
function forms(word: string): string[] {
  const out = [word, `${word}s`, `${word}es`]
  if (word.length > 3 && word.endsWith('s')) out.push(word.slice(0, -1))
  if (word.length > 4 && word.endsWith('es')) out.push(word.slice(0, -2))
  // Vietnamese finds Vietnam, Japanese Japan; the word itself stays specific.
  if (word.length >= 8 && word.endsWith('ese')) out.push(word.slice(0, -3))
  return out
}

interface Field {
  text: string
  words: ReadonlySet<string>
}

function field(...parts: (string | undefined)[]): Field {
  const text = normalise(parts.filter(Boolean).join(' '))
  return { text: ` ${text} `, words: new Set(text.split(' ').filter(Boolean)) }
}

const hasWord = (into: Field, word: string) => forms(word).some((form) => into.words.has(form))
const hasPhrase = (into: Field, phrase: string) => (phrase.includes(' ') ? into.text.includes(` ${phrase} `) : hasWord(into, phrase))

export interface QueryPhrase {
  phrase: string
  words: string[]
  /** The topic a broad word names, if it names one. */
  topic: string | null
}

export interface ParsedQuery {
  text: string
  phrases: QueryPhrase[]
  wantsShort: boolean
}

/** "Music, Camping" is two searches together; "Vietnamese music" is one, about both words. */
export function parseQuery(text: string): ParsedQuery {
  const phrases = text
    .split(/[,;|]+/)
    .map((part) => normalise(part))
    .filter(Boolean)
    .map((phrase) => {
      const words = phrase.split(' ').filter((word) => word && !STOP.has(word))
      const topic = words.find((word) => forms(word).some((form) => form in TOPICS))
      return { phrase, words: words.length ? words : phrase.split(' '), topic: topic ? (forms(topic).find((form) => form in TOPICS) ?? null) : null }
    })
  const wantsShort = phrases.some((phrase) => phrase.words.some((word) => WANTS_SHORT.has(word)))
  return { text: text.replace(/\s+/g, ' ').trim(), phrases, wantsShort }
}

interface ChannelIndex {
  number: number
  name: string
  nameField: Field
  tagField: Field
  purposeField: Field
}

export interface IndexedProgramme {
  key: string
  channel: ChannelIndex
  programme: SearchProgramme
  title: Field
  source: Field
  /** The title without its brackets and boilerplate, to keep near-identical uploads apart. */
  core: string
}

export interface SearchIndex {
  entries: IndexedProgramme[]
}

const BOILERPLATE = new Set(['official', 'video', 'audio', 'lyrics', 'lyric', 'hd', '4k', 'remastered', 'remaster', 'visualizer', 'visualiser', 'full', 'mv'])

/** The title without boilerplate (official, video, HD…) or the channel's own name: two uploads of one thing share it. */
function coreTitle(title: string, channel: string): string {
  const name = new Set(normalise(channel).split(' '))
  const words = normalise(title)
    .split(' ')
    .filter((word) => word && !BOILERPLATE.has(word) && !name.has(word))
  return words.slice(0, 8).join(' ') || normalise(title)
}

/** A derived, disposable index over the programmes given. It is never kept and never authoritative. */
export function buildSearchIndex(channels: readonly SearchChannel[]): SearchIndex {
  const entries: IndexedProgramme[] = []
  for (const channel of channels) {
    const index: ChannelIndex = {
      number: channel.number,
      name: channel.name,
      nameField: field(channel.name),
      tagField: field(...(channel.tags ?? []), channel.category),
      purposeField: field(channel.purpose, channel.desired, channel.description, channel.eras),
    }
    for (const programme of channel.programmes) {
      const key = programme.videoId || programme.mediaUrl
      if (!key || !(programme.durationSeconds > 0)) continue
      entries.push({ key, channel: index, programme, title: field(programme.title), source: field(programme.source), core: coreTitle(programme.title, channel.name) })
    }
  }
  return { entries }
}

export interface ScoredProgramme {
  entry: IndexedProgramme
  score: number
  /** Why it matched, strongest first, for tests and diagnostics. Never shown as a score. */
  reasons: string[]
  /** Its title answers the query itself, not only its channel. */
  titled: boolean
  /** A several-word query appears as one phrase in its title, source or channel name. */
  phrase: boolean
  /** Its channel itself answers part of the query. */
  anchored: boolean
}

interface ChannelAnswer {
  score: number
  reasons: string[]
  answered: Set<string>
  near: boolean
}

/** What the channel itself says to a phrase: tags, name, purpose, the topic's neighbours. Worked out once per channel. */
function channelAnswer(channel: ChannelIndex, query: QueryPhrase): ChannelAnswer {
  const { nameField, tagField, purposeField } = channel
  const multi = query.words.length > 1
  const reasons: string[] = []
  const answered = new Set<string>()
  let score = 0
  const inTags = query.words.filter((word) => hasWord(tagField, word))
  if (inTags.length) {
    score += 12 * inTags.length
    reasons.push(`tags: ${inTags.join(' ')}`)
  }
  const inName = query.words.filter((word) => hasWord(nameField, word))
  if (inName.length) {
    score += (multi && hasPhrase(nameField, query.phrase) ? 14 : 8) * inName.length
    reasons.push(`channel: ${channel.name}`)
  }
  const inPurpose = query.words.filter((word) => hasWord(purposeField, word))
  if (inPurpose.length) {
    score += 4 * inPurpose.length
    reasons.push('channel purpose')
  }
  for (const word of [...inTags, ...inName, ...inPurpose]) answered.add(word)
  let near = false
  if (query.topic) {
    const terms = TOPICS[query.topic].map(normalise)
    const channelNear = terms.find((term) => hasPhrase(nameField, term) || hasPhrase(tagField, term))
    const purposeNear = terms.find((term) => hasPhrase(purposeField, term))
    if (channelNear) score += 3
    if (purposeNear) score += 1
    near = Boolean(channelNear || purposeNear)
    if (near) reasons.push(`topic ${query.topic}: ${channelNear ?? purposeNear}`)
  }
  return { score, reasons, answered, near }
}

/**
 * One programme against one phrase, in this priority: the exact phrase in the title, every word in the
 * title, each title word, editorial tags, the channel's name, the source, the channel's purpose, and last
 * the topic's neighbours. Every word must be answered somewhere, or nothing matched.
 */
function scorePhrase(entry: IndexedProgramme, query: QueryPhrase, channel: ChannelAnswer): Omit<ScoredProgramme, 'entry'> | null {
  const { title, source } = entry
  const reasons: string[] = []
  let score = 0
  const multi = query.words.length > 1
  const phrase = multi && (hasPhrase(title, query.phrase) || hasPhrase(source, query.phrase) || hasPhrase(entry.channel.nameField, query.phrase))
  if (multi && hasPhrase(title, query.phrase)) {
    score += 100
    reasons.push('title phrase')
  }
  const inTitle = query.words.filter((word) => hasWord(title, word))
  if (multi && inTitle.length === query.words.length) {
    score += 60
    reasons.push('all words in title')
  }
  if (inTitle.length) {
    score += 25 * inTitle.length
    reasons.push(`title: ${inTitle.join(' ')}`)
  }
  score += channel.score
  reasons.push(...channel.reasons.filter((reason) => !reason.startsWith('topic')))
  const inSource = query.words.filter((word) => hasWord(source, word))
  if (inSource.length) {
    score += 6 * inSource.length
    reasons.push(`source: ${entry.programme.source}`)
  }
  let titleNear: string | undefined
  if (query.topic) {
    titleNear = TOPICS[query.topic].map(normalise).find((term) => hasPhrase(title, term))
    if (titleNear) score += 5
    if (titleNear || channel.near) reasons.push(`topic ${query.topic}: ${titleNear ?? channel.reasons.find((reason) => reason.startsWith('topic'))?.split(': ')[1]}`)
  }
  const topical = titleNear !== undefined || channel.near
  const answered = query.words.every(
    (word) => inTitle.includes(word) || inSource.includes(word) || channel.answered.has(word) || (topical && query.topic !== null && forms(word).includes(query.topic)),
  )
  if (!answered || score === 0) return null
  return { score, reasons, titled: inTitle.length > 0 || titleNear !== undefined, phrase, anchored: channel.answered.size > 0 || channel.near }
}

/** Every programme that answers the query, best first, each once (a programme on several channels keeps its best). */
export function scoreProgrammes(index: SearchIndex, query: ParsedQuery): ScoredProgramme[] {
  const best = new Map<string, ScoredProgramme>()
  const answers = query.phrases.map(() => new Map<ChannelIndex, ChannelAnswer>())
  for (const entry of index.entries) {
    const seconds = entry.programme.durationSeconds
    if (seconds > LONGEST) continue
    if (!query.wantsShort && (seconds < SHORT_SECONDS || /#shorts?\b/i.test(entry.programme.title))) continue
    let top: ScoredProgramme | null = null
    query.phrases.forEach((phrase, at) => {
      let channel = answers[at].get(entry.channel)
      if (!channel) {
        channel = channelAnswer(entry.channel, phrase)
        answers[at].set(entry.channel, channel)
      }
      const found = scorePhrase(entry, phrase, channel)
      if (found && (!top || found.score > top.score)) top = { entry, ...found }
    })
    if (!top) continue
    const held = best.get(entry.key)
    if (!held || (top as ScoredProgramme).score > held.score) best.set(entry.key, top)
  }
  const all = [...best.values()]
  // Where the words appear together somewhere ("Michael Jordan"), a programme with them apart ("Michael B. Jordan")
  // needs its channel's support too.
  const together = query.phrases.some((phrase) => phrase.words.length > 1) && all.some((item) => item.phrase)
  return all.filter((item) => !together || item.phrase || item.anchored).sort((a, b) => b.score - a.score || a.entry.key.localeCompare(b.entry.key))
}

function hash(text: string): number {
  let value = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return (value >>> 0) / 4294967295
}

export interface SearchGuide {
  query: string
  picks: ScoredProgramme[]
  seconds: number
  /** How many programmes answered the query at all. */
  matched: number
  matchedSeconds: number
  /** Too few matches for a Rescan to differ much. */
  small: boolean
}

const CANDIDATES = 600

/**
 * A watchable schedule, not a results list: strong matches first in priority but spread through, channels
 * and sources taking turns, no programme or near-identical upload twice, nothing back to back from one
 * channel where another will do. About three hours, never over four; where fewer genuinely match, fewer.
 * `seed` varies the choice deterministically; `previous` are the keys of the schedule being replaced.
 */
export function buildSearchGuide(index: SearchIndex, text: string, options: { seed?: number; previous?: ReadonlySet<string> } = {}): SearchGuide {
  const query = parseQuery(text)
  const scored = query.phrases.length ? scoreProgrammes(index, query) : []
  const matchedSeconds = scored.reduce((sum, item) => sum + item.entry.programme.durationSeconds, 0)
  const seed = options.seed ?? 0
  const previous = options.previous ?? new Set<string>()
  const pool = scored.slice(0, CANDIDATES)
  const top = pool[0]?.score ?? 1
  const channelUses = new Map<number, number>()
  const sourceUses = new Map<string, number>()
  const cores = new Set<string>()
  const taken = new Set<string>()
  const picks: ScoredProgramme[] = []
  let seconds = 0
  while (seconds < SEARCH_TARGET.target) {
    const last = picks.at(-1)?.entry.channel.number
    let chosen: ScoredProgramme | null = null
    let chosenValue = -Infinity
    let fallback: ScoredProgramme | null = null
    let fallbackValue = -Infinity
    for (const item of pool) {
      const { entry } = item
      if (taken.has(entry.key) || cores.has(entry.core)) continue
      if (seconds + entry.programme.durationSeconds > SEARCH_TARGET.max) continue
      const jitter = 0.75 + 0.5 * hash(`${seed}:${entry.key}`)
      const repeat = previous.has(entry.key) ? 0.4 : 1
      const spread = 1 + 0.7 * (channelUses.get(entry.channel.number) ?? 0) + 0.4 * (sourceUses.get(entry.programme.source ?? '') ?? 0)
      const runs = entry.programme.durationSeconds
      const length = runs > 5400 ? 0.45 : runs > 3600 ? 0.75 : 1
      const value = (Math.sqrt(item.score / top) * jitter * repeat * length) / spread
      if (entry.channel.number === last) {
        if (value > fallbackValue) {
          fallback = item
          fallbackValue = value
        }
      } else if (value > chosenValue) {
        chosen = item
        chosenValue = value
      }
    }
    const next = chosen ?? fallback
    if (!next) break
    picks.push(next)
    taken.add(next.entry.key)
    cores.add(next.entry.core)
    channelUses.set(next.entry.channel.number, (channelUses.get(next.entry.channel.number) ?? 0) + 1)
    sourceUses.set(next.entry.programme.source ?? '', (sourceUses.get(next.entry.programme.source ?? '') ?? 0) + 1)
    seconds += next.entry.programme.durationSeconds
  }
  const repeated = picks.filter((item) => previous.has(item.entry.key)).length
  const small = picks.length === 0 || picks.length >= scored.length || (previous.size > 0 && repeated / picks.length >= 0.7)
  return { query: query.text, picks, seconds, matched: scored.length, matchedSeconds, small }
}
