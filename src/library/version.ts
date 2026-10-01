import type { MediaItem } from '../director/types.ts'
import { CATALOGUE_VERSION } from '../director/network.ts'

function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Empty library keeps the Stage 4A catalogue version, so existing schedule
 * seeds stay exact. A library with scheduling fields appends a stable hash.
 * Frozen schedules keep the version they were compiled with.
 */
export function libraryCatalogueVersion(items: readonly MediaItem[]): string {
  if (items.length === 0) return CATALOGUE_VERSION
  const lines = items
    .map((item) =>
      [
        item.id,
        item.durationSeconds,
        item.programmeType,
        [...(item.topics ?? [])].sort().join(','),
        item.editorialPriority ?? '',
        [...(item.explicitChannelIncludes ?? [])].sort((left, right) => left - right).join(','),
        [...(item.explicitChannelExcludes ?? [])].sort((left, right) => left - right).join(','),
      ].join('|'),
    )
    .sort()
  return `${CATALOGUE_VERSION}@${fnv1a(lines.join('\n'))}`
}
