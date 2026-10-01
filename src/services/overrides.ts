import { canonicalChannels, canonicalName } from '../data/canonical.ts'
import type { ChannelOverride, SourceDefinition } from '../types/source.ts'
import { mergeSources } from '../types/source.ts'

/**
 * Stage 3 service identities whose canonical number is different and unique.
 * Ambiguous names are intentionally absent: those overrides stay on their number.
 */
const PROVISIONAL_SERVICE: Record<number, string> = {
  102: 'World Cinema',
  150: 'Classic Trailers',
  700: 'Cooking',
  901: 'Concert Hall',
  902: 'Night Music',
  910: 'CNN',
  911: 'Fox News',
  940: 'Information',
}

export interface OverrideMigration {
  overrides: ChannelOverride[]
  moved: { from: number; to: number; name: string }[]
  kept: { number: number; reason: string }[]
}

export const OVERRIDES_KEY = 'retrotv.channel-overrides.v1'

const listeners = new Set<() => void>()
let current: ChannelOverride[] = []

export function subscribeOverrides(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function loadOverrides(): ChannelOverride[] {
  const stored = readOverrides()
  const migrated = migrateProvisionalOverrides(stored, canonicalChannels())
  current = migrated.overrides
  if (migrated.moved.length > 0 || stored.some((item) => !item.boundName)) {
    writeOverrides(current)
  }
  return current.map(cloneOverride)
}

export function migrateProvisionalOverrides(
  overrides: readonly ChannelOverride[],
  channels: readonly { number: number; name: string }[],
): OverrideMigration {
  const nameAt = new Map(channels.map((channel) => [channel.number, channel.name]))
  const numbersForName = new Map<string, number[]>()
  for (const channel of channels) {
    const key = channel.name.toLowerCase()
    const list = numbersForName.get(key) ?? []
    list.push(channel.number)
    numbersForName.set(key, list)
  }

  const moved: OverrideMigration['moved'] = []
  const kept: OverrideMigration['kept'] = []
  const occupied = new Set(overrides.map((item) => item.channelNumber))
  const next: ChannelOverride[] = []

  for (const override of overrides) {
    if (override.boundName) {
      next.push(cloneOverride(override))
      continue
    }
    const service = PROVISIONAL_SERVICE[override.channelNumber]
    const here = nameAt.get(override.channelNumber)
    if (!service || (here && here.toLowerCase() === service.toLowerCase())) {
      next.push(stamp(override, here))
      continue
    }
    const hits = numbersForName.get(service.toLowerCase()) ?? []
    if (hits.length !== 1) {
      kept.push({ number: override.channelNumber, reason: `${service} does not match one canonical channel` })
      next.push(stamp(override, here))
      continue
    }
    const destination = hits[0]
    if (destination === undefined || occupied.has(destination)) {
      kept.push({ number: override.channelNumber, reason: `${service} already has a local override` })
      next.push(stamp(override, here))
      continue
    }
    occupied.delete(override.channelNumber)
    occupied.add(destination)
    moved.push({ from: override.channelNumber, to: destination, name: service })
    next.push(stamp({ ...override, channelNumber: destination }, nameAt.get(destination)))
  }

  return { overrides: next, moved, kept }
}

export function overridesNow(): readonly ChannelOverride[] {
  return current
}

export function overrideFor(channelNumber: number): ChannelOverride | undefined {
  return current.find((item) => item.channelNumber === channelNumber)
}

export function videoOverride(channelNumber: number): string | null {
  const extra = overrideFor(channelNumber)?.additionalSources ?? []
  const match = extra.find((source) => source.enabled && source.provider === 'youtube' && source.externalId)
  return match?.externalId ?? null
}

export function setVideoOverride(channelNumber: number, videoId: string | null): void {
  const rest = current.filter((item) => item.channelNumber !== channelNumber)
  if (videoId) {
    const source: SourceDefinition = {
      id: `override:${channelNumber}`,
      provider: 'youtube',
      mediaKind: 'video',
      capability: 'seekable-recorded',
      externalId: videoId,
      label: 'Local source',
      priority: 0,
      enabled: true,
    }
    rest.push({
      channelNumber,
      boundName: canonicalName(channelNumber),
      additionalSources: [source],
    })
  }
  current = rest
  writeOverrides(current)
  for (const listener of listeners) listener()
}

export function effectiveSources(
  channelNumber: number,
  defaults: readonly SourceDefinition[],
): SourceDefinition[] {
  return mergeSources(defaults, overrideFor(channelNumber))
}

function readOverrides(): ChannelOverride[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(OVERRIDES_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isOverride).map(cloneOverride)
  } catch {
    return []
  }
}

function writeOverrides(overrides: readonly ChannelOverride[]): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides))
  } catch {
    // Storage failures must not take the television down.
  }
}

function isOverride(value: unknown): value is ChannelOverride {
  return Boolean(value) && typeof value === 'object' && typeof (value as ChannelOverride).channelNumber === 'number'
}

function stamp(override: ChannelOverride, name: string | undefined): ChannelOverride {
  const copy = cloneOverride(override)
  copy.boundName = name
  if (copy.additionalSources) {
    copy.additionalSources = copy.additionalSources.map((source) =>
      source.id.startsWith('override:') ? { ...source, id: `override:${copy.channelNumber}` } : source,
    )
  }
  return copy
}

function cloneOverride(override: ChannelOverride): ChannelOverride {
  return {
    channelNumber: override.channelNumber,
    displayName: override.displayName,
    boundName: override.boundName,
    disabledSourceIds: override.disabledSourceIds?.slice(),
    additionalSources: override.additionalSources?.map((source) => ({ ...source })),
  }
}
