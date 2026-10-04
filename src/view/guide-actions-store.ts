/**
 * The selected channel's actions in the Guide: folded to one button (the star of a favourite, or else
 * LATEST FIRST) or all of them. The viewer's choice is kept in this browser; folded is the default.
 */
export const GUIDE_ACTIONS_KEY = 'tvn.guide-actions.v1'

type Store = Pick<Storage, 'getItem' | 'setItem'>

function browserStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadGuideActionsAll(store: Store | null = browserStore()): boolean {
  try {
    return store?.getItem(GUIDE_ACTIONS_KEY) === 'all'
  } catch {
    return false
  }
}

export function saveGuideActionsAll(all: boolean, store: Store | null = browserStore()): void {
  try {
    store?.setItem(GUIDE_ACTIONS_KEY, all ? 'all' : 'one')
  } catch {
    // A browser that keeps nothing still folds and unfolds; it just forgets.
  }
}
