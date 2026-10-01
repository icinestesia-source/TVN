/** String hash to a 32-bit seed. Same text always yields the same seed. */
export function xmur3(text: string): number {
  let h = 1779033703 ^ text.length
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^ (h >>> 16)) >>> 0
}

/** Seeded generator. Callers must not use Math.random for programme selection. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Tie key for two equally scored items.
 * Derived from the schedule seed, so it does not depend on walk order.
 */
export function tieBreak(seed: string, itemId: string): number {
  return mulberry32(xmur3(`${seed}|${itemId}`))()
}
