import { libraryCatalogueVersion } from '../library/version.ts'
import { refreshAiring } from '../network/airing.ts'
import type { MediaItem } from './types.ts'
import { setCatalogueVersion } from './network.ts'

/** Production catalogue for automatic programming. Empty until real metadata is ingested. */
let library: MediaItem[] = []

export function mediaLibrary(): readonly MediaItem[] {
  return library
}

function sameItems(current: readonly MediaItem[], next: readonly MediaItem[]): boolean {
  if (current.length !== next.length || current.length === 0) return false
  for (let index = 0; index < current.length; index += 1) if (current[index] !== next[index]) return false
  return true
}

/**
 * Republishing the same records keeps the same library array, so the network-wide pool and version
 * caches keyed on it stay valid instead of being rebuilt for identical content.
 */
export function setMediaLibrary(items: readonly MediaItem[]): void {
  if (!sameItems(library, items)) {
    library = [...items]
    setCatalogueVersion(libraryCatalogueVersion(items))
  }
  refreshAiring(library)
}
