import type { SourceDefinition } from '../types/source.ts'
import { canonicalChannels } from './canonical.ts'

/**
 * News identities taken from the canonical plan.
 * Sources stay empty until a verified embeddable id is configured.
 * A provider hint is not itself a source.
 */
export interface NewsServiceSlot {
  id: string
  name: string
  channelNumber: number
  sources: SourceDefinition[]
}

function slotsFromPlan(): NewsServiceSlot[] {
  return canonicalChannels()
    .filter((entry) => entry.category === 'news' && entry.providerHint && entry.enabled)
    .map((entry) => ({
      id: entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      name: entry.name,
      channelNumber: entry.number,
      sources: [],
    }))
}

export const NEWS_SERVICES: readonly NewsServiceSlot[] = slotsFromPlan()

export function configuredNewsSources(): NewsServiceSlot[] {
  return NEWS_SERVICES.filter((service) =>
    service.sources.some((source) => source.enabled && (source.externalId || source.url)),
  )
}
