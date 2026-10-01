import rawManifest from './canonical-network.json'

/**
 * Canonical default-network plan. Channel identity only.
 * A provider hint is not a playable source.
 */

export interface CanonicalChannel {
  number: number
  displayNumber: string
  name: string
  category: string
  group: string
  mediaKind: 'video' | 'audio' | 'generated'
  origin: 'default'
  sourcePolicy: string
  enabled: boolean
  channelType: string
  sourceStrategy: string
  sourceCapabilities: readonly string[]
  providerHint?: string
}

const CATEGORIES = new Set([
  'system',
  'main',
  'film',
  'entertainment',
  'sport',
  'knowledge',
  'music',
  'business-tech',
  'lifestyle',
  'specialist',
  'webcams',
  'news',
  'radio',
])

const MEDIA = new Set(['video', 'audio', 'generated'])
const CHANNEL_TYPES = new Set(['reserved', 'curated', 'official', 'live', 'radio'])
const STRATEGIES = new Set([
  'none',
  'curated-schedule',
  'official-source',
  'live-preferred',
  'live-youtube-preferred-with-recorded-fallback',
  'scheduled-audio',
])
const POLICIES = new Set([
  'none',
  'curated',
  'official-source-required',
  'official-or-authorized-source-required',
])
const CAPABILITIES = new Set(['seekableRecorded', 'generated', 'live'])

/** Guide filter id for a canonical category. Metadata, not a hard-coded number band. */
export function filterIdForCategory(category: string): string {
  if (category === 'film') return 'films'
  if (category === 'knowledge') return 'history'
  if (category === 'business-tech') return 'business'
  if (category === 'webcams') return 'live-world'
  return category
}

let cached: readonly CanonicalChannel[] | null = null
const byNumber = new Map<number, CanonicalChannel>()

export function canonicalChannels(): readonly CanonicalChannel[] {
  if (!cached) {
    cached = validateManifest(rawManifest)
    for (const entry of cached) byNumber.set(entry.number, entry)
  }
  return cached
}

export function canonicalByNumber(number: number): CanonicalChannel | undefined {
  canonicalChannels()
  return byNumber.get(number)
}

export function canonicalName(number: number): string | undefined {
  return canonicalByNumber(number)?.name
}

function validateManifest(raw: unknown): readonly CanonicalChannel[] {
  if (!raw || typeof raw !== 'object') throw new Error('Canonical network manifest is not an object')
  const channels = (raw as { channels?: unknown }).channels
  if (!Array.isArray(channels)) throw new Error('Canonical network manifest has no channels array')
  if (channels.length !== 1000) {
    throw new Error(`Canonical network manifest has ${channels.length} entries; expected 1000 including reserved 000`)
  }

  const seen = new Set<number>()
  const parsed: CanonicalChannel[] = []
  for (const item of channels) {
    const entry = parseChannel(item)
    if (seen.has(entry.number)) throw new Error(`Duplicate canonical channel number ${entry.number}`)
    seen.add(entry.number)
    parsed.push(entry)
  }

  if (!seen.has(0)) throw new Error('Canonical manifest is missing reserved 000')
  if (seen.has(1000)) throw new Error('Canonical manifest must not allocate 1000')
  for (let number = 1; number <= 999; number += 1) {
    if (!seen.has(number)) throw new Error(`Canonical manifest is missing channel ${number}`)
  }

  const zero = parsed.find((entry) => entry.number === 0)
  if (!zero || zero.enabled || zero.channelType !== 'reserved') {
    throw new Error('Channel 000 must be present, disabled, and reserved')
  }
  const broadcast = parsed.filter((entry) => entry.number >= 1 && entry.number <= 999)
  if (broadcast.length !== 999 || broadcast.some((entry) => !entry.enabled)) {
    throw new Error('Channels 001–999 must all exist and be enabled')
  }
  if (broadcast.filter((entry) => entry.mediaKind === 'audio').some((entry) => entry.category !== 'radio')) {
    throw new Error('Audio channels must use the radio category')
  }
  if (broadcast.filter((entry) => entry.category === 'radio').some((entry) => entry.mediaKind !== 'audio')) {
    throw new Error('Radio channels must use mediaKind audio')
  }

  return parsed
}

function parseChannel(item: unknown): CanonicalChannel {
  if (!item || typeof item !== 'object') throw new Error('Canonical channel is not an object')
  const record = item as Record<string, unknown>
  const number = record.number
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 0 || number > 999) {
    throw new Error(`Canonical channel number is invalid: ${String(number)}`)
  }
  const name = requiredString(record.name, number, 'name')
  const category = requiredString(record.category, number, 'category')
  const group = requiredString(record.group, number, 'group')
  const mediaKind = requiredString(record.mediaKind, number, 'mediaKind')
  const sourcePolicy = requiredString(record.sourcePolicy, number, 'sourcePolicy')
  const channelType = requiredString(record.channelType, number, 'channelType')
  const sourceStrategy = requiredString(record.sourceStrategy, number, 'sourceStrategy')
  const displayNumber = requiredString(record.displayNumber, number, 'displayNumber')
  if (!CATEGORIES.has(category)) throw new Error(`Channel ${number} has unknown category ${category}`)
  if (!MEDIA.has(mediaKind)) throw new Error(`Channel ${number} has unknown mediaKind ${mediaKind}`)
  if (!POLICIES.has(sourcePolicy)) throw new Error(`Channel ${number} has unknown sourcePolicy ${sourcePolicy}`)
  if (!CHANNEL_TYPES.has(channelType)) throw new Error(`Channel ${number} has unknown channelType ${channelType}`)
  if (!STRATEGIES.has(sourceStrategy)) throw new Error(`Channel ${number} has unknown sourceStrategy ${sourceStrategy}`)
  if (typeof record.enabled !== 'boolean') throw new Error(`Channel ${number} is missing enabled`)
  if (!Array.isArray(record.sourceCapabilities)) throw new Error(`Channel ${number} is missing sourceCapabilities`)
  const sourceCapabilities = record.sourceCapabilities.map((capability) => {
    if (typeof capability !== 'string' || !CAPABILITIES.has(capability)) {
      throw new Error(`Channel ${number} has unknown source capability ${String(capability)}`)
    }
    return capability
  })
  const providerHint = record.providerHint
  if (providerHint !== undefined && typeof providerHint !== 'string') {
    throw new Error(`Channel ${number} has an invalid providerHint`)
  }
  return {
    number,
    displayNumber,
    name,
    category,
    group,
    mediaKind: mediaKind as CanonicalChannel['mediaKind'],
    origin: 'default',
    sourcePolicy,
    enabled: record.enabled,
    channelType,
    sourceStrategy,
    sourceCapabilities,
    providerHint: typeof providerHint === 'string' ? providerHint : undefined,
  }
}

function requiredString(value: unknown, number: number, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Channel ${number} is missing ${field}`)
  }
  return value
}
