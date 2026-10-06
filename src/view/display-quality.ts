/**
 * DISPLAY in Settings: the picture quality TVN asks YouTube for. YouTube's embedded player no longer takes a
 * quality request, but it never streams more than its own size needs, so the player is laid out at the chosen
 * height (in device pixels) and scaled to fill the screen. It is a ceiling, and on a slow connection YouTube may
 * still choose less. Kept in this browser.
 */
import { useSyncExternalStore } from 'react'

export type DisplayQuality = 'auto' | '480' | '720' | '1080'

export const DISPLAY_QUALITIES: readonly { id: DisplayQuality; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'YouTube chooses for the size of the screen' },
  { id: '480', label: 'SD 480p', hint: 'Standard definition: the least data' },
  { id: '720', label: 'HD 720p', hint: 'High definition' },
  { id: '1080', label: 'HD 1080p', hint: 'Full high definition, where the programme has it' },
]

export const DISPLAY_QUALITY_KEY = 'tvn.display-quality.v1'

type Store = Pick<Storage, 'getItem' | 'setItem'>

function browserStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function asDisplayQuality(value: unknown): DisplayQuality {
  return DISPLAY_QUALITIES.some((quality) => quality.id === value) ? (value as DisplayQuality) : 'auto'
}

export function loadDisplayQuality(store: Store | null = browserStore()): DisplayQuality {
  try {
    return asDisplayQuality(store?.getItem(DISPLAY_QUALITY_KEY))
  } catch {
    return 'auto'
  }
}

let current: DisplayQuality | null = null
const listeners = new Set<() => void>()

export function displayQuality(): DisplayQuality {
  current ??= loadDisplayQuality()
  return current
}

export function setDisplayQuality(quality: DisplayQuality, store: Store | null = browserStore()): void {
  current = asDisplayQuality(quality)
  try {
    store?.setItem(DISPLAY_QUALITY_KEY, current)
  } catch {
    // A browser that keeps nothing still changes the picture for this visit.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useDisplayQuality(): DisplayQuality {
  return useSyncExternalStore(subscribe, displayQuality, () => 'auto' as DisplayQuality)
}

/**
 * The player's box for a quality: as many CSS pixels as the quality's height in device pixels, the slot's shape,
 * scaled up (or down) to cover the slot exactly. None for Auto or a slot with no size yet.
 */
export function qualityFrame(
  quality: DisplayQuality,
  slot: { width: number; height: number },
  pixelRatio: number,
): { width: number; height: number; scale: number } | null {
  if (quality === 'auto' || slot.width <= 0 || slot.height <= 0) return null
  const height = Number(quality) / (pixelRatio > 0 ? pixelRatio : 1)
  const scale = slot.height / height
  return { width: slot.width / scale, height, scale }
}
