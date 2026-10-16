/**
 * Channels the viewer has taken off air in the Network Editor. They stay listed, but channel up, channel
 * down, random and Multi View do not land on them. Kept in this browser.
 */
export const OFF_AIR_KEY = 'tvn.off-air.v1'

type Store = Pick<Storage, 'getItem' | 'setItem'>

function browserStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadOffAir(store: Store | null = browserStore()): number[] {
  try {
    const parsed = JSON.parse(store?.getItem(OFF_AIR_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((number) => typeof number === 'number' && Number.isInteger(number) && number > 0))]
  } catch {
    return []
  }
}

let current: Set<number> | null = null
const listeners = new Set<() => void>()

export function offAirNumbers(): ReadonlySet<number> {
  current ??= new Set(loadOffAir())
  return current
}

export function isOffAir(number: number): boolean {
  return offAirNumbers().has(number)
}

export function setOffAir(number: number, off: boolean, store: Store | null = browserStore()): void {
  const next = new Set(offAirNumbers())
  if (off) next.add(number)
  else next.delete(number)
  current = next
  try {
    store?.setItem(OFF_AIR_KEY, JSON.stringify([...next].sort((a, b) => a - b)))
  } catch {
    // A browser that keeps nothing still holds the choice for this visit.
  }
  for (const listener of listeners) listener()
}

export function subscribeOffAir(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
