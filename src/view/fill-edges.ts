/**
 * FILL EDGES in Options, off unless the viewer turns it on: where a programme does not cover the screen (a
 * vertical Short, a 4:3 film), the space around it shows the same picture, enlarged and blurred, instead of black.
 * Kept in this browser.
 */
import { useSyncExternalStore } from 'react'

export const FILL_EDGES_KEY = 'tvn.fill-edges.v1'

type Store = Pick<Storage, 'getItem' | 'setItem'>

function browserStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadFillEdges(store: Store | null = browserStore()): boolean {
  try {
    return store?.getItem(FILL_EDGES_KEY) === 'on'
  } catch {
    return false
  }
}

let current: boolean | null = null
const listeners = new Set<() => void>()

export function fillEdges(): boolean {
  current ??= loadFillEdges()
  return current
}

export function setFillEdges(on: boolean, store: Store | null = browserStore()): void {
  current = on
  try {
    store?.setItem(FILL_EDGES_KEY, on ? 'on' : 'off')
  } catch {
    // A browser that keeps nothing still changes the picture for this visit.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useFillEdges(): boolean {
  return useSyncExternalStore(subscribe, fillEdges, () => false)
}

/** The largest box of this shape (width ÷ height) inside the slot, centred. */
export function containedBox(slot: { width: number; height: number }, aspect: number): { left: number; top: number; width: number; height: number } {
  if (slot.width <= 0 || slot.height <= 0 || !(aspect > 0)) return { left: 0, top: 0, width: slot.width, height: slot.height }
  const width = Math.min(slot.width, slot.height * aspect)
  const height = width / aspect
  return { left: (slot.width - width) / 2, top: (slot.height - height) / 2, width, height }
}

/** Whether a picture of this shape leaves enough of the slot uncovered to be worth filling. */
export function leavesEdges(slot: { width: number; height: number }, aspect: number): boolean {
  if (slot.width <= 0 || slot.height <= 0 || !(aspect > 0)) return false
  const box = containedBox(slot, aspect)
  return box.width * box.height < slot.width * slot.height * 0.94
}

/** YouTube's thumbnail in the video's own shape; ordinary videos fall back to the usual 16:9 one. */
export const shapedThumbnail = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/oardefault.jpg`
export const plainThumbnail = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`

const shapes = new Map<string, Promise<number | null>>()

/**
 * A YouTube video's shape, read from its own-shape thumbnail (no API, no key). Null when YouTube has none,
 * which is the case for most 16:9 videos; those fill the screen as before.
 */
export function youtubeAspect(videoId: string, load: (src: string) => Promise<{ width: number; height: number } | null> = loadImageSize): Promise<number | null> {
  let shape = shapes.get(videoId)
  if (!shape) {
    shape = load(shapedThumbnail(videoId)).then((size) => (size && size.width > 0 && size.height > 0 ? size.width / size.height : null))
    shapes.set(videoId, shape)
  }
  return shape
}

function loadImageSize(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(null)
      return
    }
    const image = new Image()
    image.referrerPolicy = 'no-referrer'
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve(null)
    image.src = src
  })
}
