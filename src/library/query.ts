import { explainEligibility, isEligible, routedPoolAccepts } from '../director/eligibility.ts'
import { canonicalChannels } from '../data/canonical.ts'
import { OWNED_SOURCES, channelNameMatches, isDedicatedSource, isGeneralChannel, isNativeSource } from '../director/fit.ts'
import { DIRECTOR_CHANNELS, policyFor } from '../director/policies.ts'
import type { EligibilityExplanation } from '../director/eligibility.ts'
import type { MediaItem, TemplateBlock } from '../director/types.ts'
import type { ProgrammeType } from '../types/programme.ts'
import type { LibraryMedia, SourceRecord } from './types.ts'
import { noteCalculatedPools, takeSavedPools } from './pool-cache.ts'

export interface LibraryQuery {
  text?: string
  programmeType?: ProgrammeType | 'any'
  topic?: string
  genre?: string
  year?: number
  mediaKind?: 'video' | 'audio'
  live?: boolean
  minDuration?: number
  maxDuration?: number
  provider?: string
  sourceId?: string
}

export interface LibrarySummary {
  mediaCount: number
  sourceCount: number
  totalSeconds: number
  watchedCount: number
  classifiedCount: number
  unclassifiedCount: number
  duplicateMemberships: number
  availability: Record<string, number>
  programmeTypes: Record<string, number>
}

/** In-memory filters. The current corpus fits; indexes exist for a larger library. */
export function queryLibrary(items: readonly LibraryMedia[], query: LibraryQuery = {}): LibraryMedia[] {
  const text = query.text?.trim().toLowerCase()
  return items.filter((item) => {
    if (text && !`${item.title} ${item.externalId} ${item.sourceCollection}`.toLowerCase().includes(text)) return false
    if (query.programmeType && query.programmeType !== 'any' && item.programmeType !== query.programmeType) return false
    if (query.topic && !item.topics?.includes(query.topic)) return false
    if (query.genre && !item.genres?.includes(query.genre)) return false
    if (query.year !== undefined && item.year !== query.year) return false
    if (query.mediaKind && item.mediaKind !== query.mediaKind) return false
    if (query.live !== undefined && item.isLive !== query.live) return false
    if (query.minDuration !== undefined && item.durationSeconds < query.minDuration) return false
    if (query.maxDuration !== undefined && item.durationSeconds > query.maxDuration) return false
    if (query.provider && item.provider !== query.provider) return false
    if (query.sourceId && !item.memberships.some((membership) => membership.sourceId === query.sourceId)) return false
    return true
  })
}

export function librarySummary(items: readonly LibraryMedia[], sources: readonly SourceRecord[]): LibrarySummary {
  const programmeTypes: Record<string, number> = {}
  const availability: Record<string, number> = {}
  let totalSeconds = 0
  let watchedCount = 0
  let classifiedCount = 0
  let duplicateMemberships = 0
  for (const item of items) {
    totalSeconds += item.durationSeconds
    if (item.watched) watchedCount += 1
    if (item.programmeType === 'unclassified') programmeTypes.unclassified = (programmeTypes.unclassified ?? 0) + 1
    else {
      classifiedCount += 1
      programmeTypes[item.programmeType] = (programmeTypes[item.programmeType] ?? 0) + 1
    }
    availability[item.availability] = (availability[item.availability] ?? 0) + 1
    if (item.memberships.filter((membership) => membership.present).length > 1) duplicateMemberships += 1
  }
  return {
    mediaCount: items.length,
    sourceCount: sources.length,
    totalSeconds,
    watchedCount,
    classifiedCount,
    unclassifiedCount: items.length - classifiedCount,
    duplicateMemberships,
    availability,
    programmeTypes,
  }
}

const routedIndexes = new WeakMap<readonly MediaItem[], Map<number, MediaItem[]>>()

function routedIndex(items: readonly MediaItem[]): Map<number, MediaItem[]> {
  const cached = routedIndexes.get(items)
  if (cached) return cached
  const index = new Map<number, MediaItem[]>()
  for (const item of items) {
    for (const number of item.explicitChannelIncludes ?? []) {
      const list = index.get(number)
      if (list) list.push(item)
      else index.set(number, [item])
    }
  }
  routedIndexes.set(items, index)
  return index
}

const siblingPools = new WeakMap<readonly MediaItem[], Map<readonly number[], MediaItem[]>>()

function routedPool(items: readonly MediaItem[], channelNumber: number, siblings?: readonly number[]): MediaItem[] {
  const index = routedIndex(items)
  const own = index.get(channelNumber) ?? []
  if (!siblings?.length) return own
  let pools = siblingPools.get(items)
  if (!pools) siblingPools.set(items, (pools = new Map()))
  let shared = pools.get(siblings)
  if (!shared) {
    const union = new Set<MediaItem>()
    for (const sibling of siblings) for (const item of index.get(sibling) ?? []) union.add(item)
    shared = [...union]
    pools.set(siblings, shared)
  }
  if (own.length === 0) return shared
  const merged = new Set(shared)
  for (const item of own) merged.add(item)
  return [...merged]
}

/** Candidates for one channel. The director does not need to know how they are stored. */
export function getEligibleMedia(
  items: readonly MediaItem[],
  channelNumber: number,
  block?: TemplateBlock,
): MediaItem[] {
  const policy = policyFor(channelNumber)
  if (!policy) return []
  if (policy.eligibility.routedOnly) {
    const pool = routedPool(items, channelNumber, policy.eligibility.routedFrom)
    if (block?.eligibility) return pool.filter((item) => isEligible(item, channelNumber, policy.eligibility, block.eligibility))
    return pool.filter((item) => routedPoolAccepts(item, channelNumber, policy.eligibility))
  }
  return items.filter((item) => isEligible(item, channelNumber, policy.eligibility, block?.eligibility))
}

/** Jaccard similarity above which a channel repeats an earlier one. */
const DUPLICATE_SIMILARITY = 0.6
const MIN_UNIQUE_SECONDS = 3 * 3600

const uniquePools = new WeakMap<readonly MediaItem[], Map<number, MediaItem[]>>()

/** Shipped catalogue items; user and hand-curated media are never deduplicated away. */
function catalogued(item: MediaItem): boolean {
  return Boolean((item as { sourceId?: string }).sourceId?.startsWith('src_'))
}

function seconds(items: readonly MediaItem[]): number {
  return items.reduce((sum, item) => sum + item.durationSeconds, 0)
}

function slot(id: string, count: number): number {
  let hash = 2166136261
  for (let index = 0; index < id.length; index += 1) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619)
  return (hash >>> 0) % count
}

/**
 * General mixes may overlap specialist channels, but not each other: mixes
 * built from substantially the same pool each take a distinct deterministic slice.
 */
function splitGeneralMixes(general: readonly { number: number; full: MediaItem[] }[]): Map<number, MediaItem[]> {
  const groups: { ids: Set<string>; members: { number: number; full: MediaItem[] }[] }[] = []
  for (const mix of general) {
    const ids = new Set(mix.full.filter(catalogued).map((item) => item.id))
    const group = groups.find((candidate) => {
      let shared = 0
      for (const id of ids) if (candidate.ids.has(id)) shared += 1
      return ids.size > 0 && shared / (ids.size + candidate.ids.size - shared) >= DUPLICATE_SIMILARITY
    })
    if (group) group.members.push(mix)
    else groups.push({ ids, members: [mix] })
  }
  const pools = new Map<number, MediaItem[]>()
  for (const { members } of groups) {
    members.forEach(({ number, full }, index) => {
      pools.set(number, members.length === 1 ? full : full.filter((item) => !catalogued(item) || slot(item.id, members.length) === index))
    })
  }
  return pools
}

/**
 * A main-network aggregate that repeats a home channel takes one of this many
 * disjoint deterministic shares of it. Specialists never do: they keep only
 * material their own name supports.
 */
const AGGREGATE_SHARES = 3
/** An aggregate share must hold half a day of its own selection, or the home keeps the inventory alone. */
const MIN_AGGREGATE_SECONDS = 12 * 3600

const Precedence = { Owned: 0, CategoryHome: 1, FamilyHome: 2, Specialist: 3, Aggregate: 4, General: 5 } as const
type Precedence = (typeof Precedence)[keyof typeof Precedence]

let precedences: Map<number, Precedence> | null = null

/**
 * Editorial precedence from the manifest: the first channel of each category is its
 * home, a channel whose name the manifest reuses for its siblings ("Football" for
 * "Football Classics", "Football Tactics") heads that family, and the main 001–099
 * network is made of aggregates.
 */
function precedenceOf(number: number): Precedence {
  if (!precedences) {
    precedences = new Map()
    const channels = canonicalChannels().filter((channel) => channel.number >= 1 && channel.number <= 999)
    const firstOfCategory = new Map<string, number>()
    for (const channel of channels) {
      if (!firstOfCategory.has(channel.category)) firstOfCategory.set(channel.category, channel.number)
    }
    const owners = new Set(OWNED_SOURCES.values())
    for (const channel of channels) {
      const name = channel.name.toLowerCase()
      const word = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
      const family = channels.filter(
        (other) => other.category === channel.category && other.number !== channel.number && other.name.toLowerCase() !== name && word.test(other.name.toLowerCase()),
      ).length
      precedences.set(
        channel.number,
        owners.has(channel.number)
          ? Precedence.Owned
          : isGeneralChannel(channel.number)
            ? Precedence.General
            : channel.category === 'main'
              ? Precedence.Aggregate
              : firstOfCategory.get(channel.category) === channel.number
                ? Precedence.CategoryHome
                : family >= 2
                  ? Precedence.FamilyHome
                  : Precedence.Specialist,
      )
    }
  }
  return precedences.get(number) ?? Precedence.Specialist
}

/** The channel's place in the editorial hierarchy, for manifests and diagnostics. */
export function channelTier(number: number): keyof typeof Precedence {
  const rank = precedenceOf(number)
  return (Object.keys(Precedence) as (keyof typeof Precedence)[]).find((key) => Precedence[key] === rank)!
}

/**
 * Each channel must offer its own programming. Channels claim inventory in
 * editorial precedence, not number order: owned-source channels, category homes,
 * family homes, specialists, then aggregates and general mixes. Within a tier, a
 * channel whose identity names most of its pool as native claims first. A channel that
 * largely repeats an earlier claim keeps only titles matching its own name plus
 * titles nobody has claimed, and goes dark if that is not enough; a truly specific specialist is never a
 * repeat of its broader home because the similarity measure is size-sensitive.
 * An aggregate that repeats a home takes a semantic subset, else a deterministic
 * minority share, else goes dark. General mixes are split among themselves.
 */
function uniquePoolsFor(items: readonly MediaItem[]): Map<number, MediaItem[]> {
  const cached = uniquePools.get(items)
  if (cached) return cached
  const saved = takeSavedPools(items)
  if (saved) {
    uniquePools.set(items, saved)
    return saved
  }
  const result = new Map<number, MediaItem[]>()
  const claims = new Map<MediaItem, number[]>()
  const sizes = new Map<number, number>()
  const similarity = (pool: readonly MediaItem[]): number => {
    const shared = new Map<number, number>()
    for (const item of pool) for (const owner of claims.get(item) ?? []) shared.set(owner, (shared.get(owner) ?? 0) + 1)
    let best = 0
    for (const [owner, count] of shared) best = Math.max(best, count / (pool.length + sizes.get(owner)! - count))
    return best
  }
  const distinct = (pool: readonly MediaItem[], minimum: number): boolean =>
    seconds(pool) >= minimum && similarity(pool) < DUPLICATE_SIMILARITY
  const general: { number: number; full: MediaItem[] }[] = []
  const fulls = new Map<number, MediaItem[]>()
  const native = new Set<number>()
  for (const number of DIRECTOR_CHANNELS) {
    if (number > 999) continue
    const full = getEligibleMedia(items, number)
    fulls.set(number, full)
    const pool = full.filter(catalogued)
    const own = pool.filter((item) => isNativeSource((item as { sourceId?: string }).sourceId ?? '', number))
    if (pool.length && own.length * 2 >= pool.length) native.add(number)
  }
  const order = [...fulls.keys()].sort(
    (a, b) => precedenceOf(a) - precedenceOf(b) || Number(native.has(b)) - Number(native.has(a)) || a - b,
  )
  for (const number of order) {
    const full = fulls.get(number)!
    if (full.length === 0) {
      result.set(number, full)
      continue
    }
    const own = full.filter((item) => !catalogued(item))
    let pool = full.filter(catalogued)
    const rank = precedenceOf(number)
    if (rank === Precedence.General && similarity(pool) < DUPLICATE_SIMILARITY) {
      general.push({ number, full })
      continue
    }
    const dedicated = new Set(
      pool.filter(
        (item) => isDedicatedSource((item as { sourceId?: string }).sourceId ?? '', number) || item.curatedChannels?.includes(number) || item.eraChannels?.includes(number) || item.genreChannels?.includes(number),
      ),
    )
    if (dedicated.size && dedicated.size < pool.length) {
      const inherited = pool.filter((item) => !dedicated.has(item))
      if (similarity(inherited) >= DUPLICATE_SIMILARITY) {
        const narrowed = inherited.filter((item) => !claims.has(item) || channelNameMatches(item, number))
        pool = [...dedicated, ...(distinct(narrowed, MIN_UNIQUE_SECONDS) ? narrowed : [])]
      }
    }
    if (pool.length && similarity(pool) >= DUPLICATE_SIMILARITY) {
      const fresh = pool.filter((item) => !claims.has(item))
      const taken = pool.filter((item) => claims.has(item))
      const narrowed = [...fresh, ...taken.filter((item) => channelNameMatches(item, number))]
      const aggregate = rank === Precedence.Aggregate || (rank === Precedence.General && number < 100)
      if (distinct(narrowed, aggregate ? MIN_AGGREGATE_SECONDS : MIN_UNIQUE_SECONDS)) pool = narrowed
      else if (aggregate) {
        let chosen: MediaItem[] = []
        for (let share = 0; share < AGGREGATE_SHARES && !chosen.length; share += 1) {
          const candidate = [...fresh, ...taken.filter((item) => slot(item.id, AGGREGATE_SHARES) === share)]
          if (distinct(candidate, MIN_AGGREGATE_SECONDS)) chosen = candidate
        }
        pool = chosen
      } else pool = []
    }
    result.set(number, own.length ? [...own, ...pool] : pool)
    if (!pool.length) continue
    sizes.set(number, pool.length)
    for (const item of pool) {
      const owners = claims.get(item)
      if (owners) owners.push(number)
      else claims.set(item, [number])
    }
  }
  for (const [number, pool] of splitGeneralMixes(general)) result.set(number, pool)
  uniquePools.set(items, result)
  noteCalculatedPools(items, result)
  return result
}

/** The channel's own programming: eligible media with network-wide duplication removed. */
export function getChannelMedia(items: readonly MediaItem[], channelNumber: number): MediaItem[] {
  if (channelNumber > 999) return getEligibleMedia(items, channelNumber)
  return uniquePoolsFor(items).get(channelNumber) ?? getEligibleMedia(items, channelNumber)
}

export function explainChannel(item: MediaItem, channelNumber: number): EligibilityExplanation {
  return explainEligibility(item, channelNumber)
}
