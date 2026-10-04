import { useSyncExternalStore } from 'react'

/**
 * Whether a website programme is on screen, and whether the viewer has chosen to use it. TVN's glass stays
 * over every picture; only a website on screen, and only after INTERACT, lets pointer and keys reach it.
 */
export interface WebInteraction {
  /** A website or post is the picture on screen. */
  shown: boolean
  /** The viewer chose INTERACT: the page has the pointer and keyboard until EXIT or ESC. */
  interacting: boolean
  /** When a website's slot ended while the viewer was using it, for a brief word as the next programme starts; 0 once that word is over. */
  endedAt: number
}

/** How long "website slot ended" stays up. */
export const WEB_ENDED_MS = 3_000

let state: WebInteraction = { shown: false, interacting: false, endedAt: 0 }
const listeners = new Set<() => void>()

function set(next: Partial<WebInteraction>) {
  const merged = { ...state, ...next }
  if (merged.shown === state.shown && merged.interacting === state.interacting && merged.endedAt === state.endedAt) return
  state = merged
  for (const listener of listeners) listener()
}

export const webInteraction = (): WebInteraction => state

function ended(now: number): Partial<WebInteraction> {
  if (typeof window !== 'undefined') window.setTimeout(() => state.endedAt === now && set({ endedAt: 0 }), WEB_ENDED_MS)
  return { interacting: false, endedAt: now }
}

export function subscribeWebInteraction(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** A website came on screen, or went: going ends any interaction, and one ended mid-use is noted. */
export function setWebShown(shown: boolean, now = Date.now()): void {
  if (shown === state.shown) return
  set(shown ? { shown } : { shown, interacting: false, ...(state.interacting ? ended(now) : {}) })
}

/** INTERACT: only while a website is on screen. */
export function startWebInteraction(): void {
  if (state.shown) set({ interacting: true })
}

/** EXIT or ESC: TVN owns input again. */
export function stopWebInteraction(): void {
  set({ interacting: false })
}

/** The next website load replaced the one being used: its slot is over. */
export function endWebSlot(now = Date.now()): void {
  if (state.interacting) set(ended(now))
}

export function useWebInteraction(): WebInteraction {
  return useSyncExternalStore(subscribeWebInteraction, webInteraction, webInteraction)
}

/**
 * The address a website programme may be shown from: https, or this computer while TVN itself runs here. Never
 * TVN's own origin (a sandboxed frame of TVN could reach back into it) and never a script or data address.
 */
export function showableWebUrl(raw: string | undefined, page: Pick<Location, 'origin' | 'hostname'> | undefined = typeof location === 'undefined' ? undefined : location): string | null {
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.username || url.password) return null
  const local = (host: string) => host === 'localhost' || host === '127.0.0.1'
  const allowed = url.protocol === 'https:' || (url.protocol === 'http:' && local(url.hostname) && page !== undefined && local(page.hostname))
  if (!allowed) return null
  if (page && url.origin === page.origin) return null
  return url.toString()
}
