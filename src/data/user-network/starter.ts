import type { ParsedExport, StoredSource } from '../../services/channels-import.ts'

/**
 * The bundled starter User Network (1001–1081): the template is the shipped catalogue files and is
 * never written to; once installed, the channels are the viewer's own stored sources like any other.
 *
 * pending   claimed for a fresh viewer, installed once startup is ready (retried if interrupted)
 * installed the starter set was installed, automatically or on request
 * removed   the viewer removed it; it never returns unless they add it again
 * skipped   a viewer with earlier TVN state; their User Network is left exactly as it is
 */
export const STARTER_KEY = 'tvn.starter-network.v1'

export type StarterState = 'pending' | 'installed' | 'removed' | 'skipped'

type Store = Pick<Storage, 'getItem' | 'setItem' | 'key'> & { readonly length: number }

const STATES: readonly StarterState[] = ['pending', 'installed', 'removed', 'skipped']
const TVN_PREFIXES = ['tvn.', 'retrotv.']

function browserStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function starterState(store: Store | null = browserStore()): StarterState | null {
  try {
    const value = store?.getItem(STARTER_KEY) ?? null
    return STATES.includes(value as StarterState) ? (value as StarterState) : null
  } catch {
    return null
  }
}

export function setStarterState(state: StarterState, store: Store | null = browserStore()): void {
  try {
    store?.setItem(STARTER_KEY, state)
  } catch {
    // Private browsing may refuse storage.
  }
}

/** Any setting TVN has ever saved in this browser means the viewer is not new. */
export function hasEarlierState(store: Store): boolean {
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index)
    if (key && TVN_PREFIXES.some((prefix) => key.startsWith(prefix))) return true
  }
  return false
}

/**
 * Decide, before anything is saved this visit, whether the starter set is due. A genuinely new viewer
 * claims it ('pending'); a viewer with earlier TVN state and no marker is recorded as 'skipped'.
 */
export function claimStarterInstall(store: Store | null = browserStore()): boolean {
  if (!store) return false
  const state = starterState(store)
  if (state === 'pending') return true
  if (state !== null) return false
  try {
    const fresh = !hasEarlierState(store)
    setStarterState(fresh ? 'pending' : 'skipped', store)
    return fresh
  } catch {
    return false
  }
}

export function starterIds(template: ParsedExport): Set<string> {
  return new Set(template.sources.map((source) => source.id))
}

/** Every stored channel except those that came from the starter template, edited or not. */
export function withoutStarter(existing: readonly StoredSource[], ids: ReadonlySet<string>): StoredSource[] {
  return existing.filter((source) => !ids.has(source.id)).map((source) => ({ ...source, videos: source.videos.slice() }))
}
