/** How many LATEST channels a quiet post-startup pass will recheck. The channel just tuned is always included. */
export const LATEST_SWEEP_LIMIT = 8

/** Pause between channel checks so a sweep does not compete with playback. */
export const LATEST_SWEEP_GAP_MS = 2_000

/**
 * Watching channel first, then the other LATEST channels, capped so startup stays light.
 * Selecting a channel outside this list still checks that one on its own.
 */
export function latestRefreshOrder(numbers: readonly number[], watching: number | null, limit = LATEST_SWEEP_LIMIT): number[] {
  const unique: number[] = []
  for (const number of numbers) if (!unique.includes(number)) unique.push(number)
  const ordered = watching !== null && unique.includes(watching) ? [watching, ...unique.filter((number) => number !== watching)] : unique
  return ordered.slice(0, Math.max(0, limit))
}
