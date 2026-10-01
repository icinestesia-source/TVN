/**
 * How the viewer came in. One TVN, two doors: tvn.lol/ turns the television on; tvn.lol/tvn turns it on
 * with TVN Surf running. The address sets only how this visit starts; channels, schedules and everything
 * saved in the browser are the same either way, and nothing about the entry is remembered.
 */
export type EntryMode = 'television' | 'tvn'

export const SURF_ENTRY_PATH = '/tvn'

export function entryMode(pathname: string): EntryMode {
  return pathname.replace(/\/+$/, '').toLowerCase() === SURF_ENTRY_PATH ? 'tvn' : 'television'
}

export function currentEntryMode(): EntryMode {
  return typeof window === 'undefined' ? 'television' : entryMode(window.location.pathname)
}

/** Surf runs from the start only for the /tvn entry; from / it waits for the viewer to press TVN. */
export function surfsOnEntry(mode: EntryMode): boolean {
  return mode === 'tvn'
}
