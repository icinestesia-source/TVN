import type { ParsedExport, StoredSource } from '../../services/channels-import.ts'

/**
 * The bundled starter User Network (1001–1116): the shipped starter network file, never written to; once
 * installed, the channels are the viewer's own stored sources like any other.
 *
 * pending   due: installed after the viewer's own channels once startup is ready (retried if interrupted)
 * installed the starter set was installed, automatically or on request
 * removed   the viewer removed it with Remove starter or Remove all; it never returns unless they add it again
 * skipped   written by TVN 1.0.1–1.0.3 for browsers with earlier TVN state; not an opt-out, so it becomes pending
 */
export const STARTER_KEY = 'tvn.starter-network.v1'

export type StarterState = 'pending' | 'installed' | 'removed' | 'skipped'

type Store = Pick<Storage, 'getItem' | 'setItem'>

const STATES: readonly StarterState[] = ['pending', 'installed', 'removed', 'skipped']

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

/**
 * Whether the starter set is due this visit. Every browser gets it, new or upgrading, unless it is
 * already installed or the viewer removed it; only an explicit removal is an opt-out.
 */
export function claimStarterInstall(store: Store | null = browserStore()): boolean {
  if (!store) return false
  const state = starterState(store)
  if (state === 'installed' || state === 'removed') return false
  if (state !== 'pending') setStarterState('pending', store)
  return starterState(store) === 'pending'
}

/** The ids of the channels the starter installs: the current starter network's, and the template's TVN shipped before it. */
export function starterIds(template: ParsedExport, network: readonly { id: string }[] = []): Set<string> {
  return new Set([...template.sources.map((source) => source.id), ...network.map((source) => source.id)])
}

/** Every stored channel except those that came from the starter template, edited or not. */
export function withoutStarter(existing: readonly StoredSource[], ids: ReadonlySet<string>): StoredSource[] {
  return existing.filter((source) => !ids.has(source.id)).map((source) => ({ ...source, videos: source.videos.slice() }))
}
