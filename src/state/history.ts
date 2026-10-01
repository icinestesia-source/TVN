/**
 * The channels the viewer has watched, in order, with a cursor on the one on screen: Back and Forward move
 * the cursor like a browser's history, and a new tune from anywhere but the newest entry drops what was ahead.
 * Held for this session only, in memory.
 */
export interface ViewingHistory {
  entries: readonly number[]
  index: number
}

export const HISTORY_LIMIT = 200

export const EMPTY_HISTORY: ViewingHistory = { entries: [], index: -1 }

/** A channel the viewer tuned to. Staying on the same channel leaves history alone. */
export function visit(history: ViewingHistory, channelNumber: number): ViewingHistory {
  if (history.entries[history.index] === channelNumber) return history
  const entries = [...history.entries.slice(0, history.index + 1), channelNumber].slice(-HISTORY_LIMIT)
  return { entries, index: entries.length - 1 }
}

export function canGoBack(history: ViewingHistory): boolean {
  return history.index > 0
}

export function canGoForward(history: ViewingHistory): boolean {
  return history.index >= 0 && history.index < history.entries.length - 1
}

/** Where Back or Forward lands, or null at either end. */
export function historyStep(history: ViewingHistory, delta: -1 | 1): { channelNumber: number; index: number } | null {
  const index = history.index + delta
  if (index < 0 || index >= history.entries.length) return null
  return { channelNumber: history.entries[index], index }
}

/**
 * Records a committed tune. A tune made by Back or Forward moves the cursor to the entry it was aiming for,
 * so history navigation never appends; any other tune is a visit.
 */
export function commitHistory(history: ViewingHistory, channelNumber: number, aimed: number | null): ViewingHistory {
  if (aimed !== null && history.entries[aimed] === channelNumber) return { entries: history.entries, index: aimed }
  return visit(history, channelNumber)
}
