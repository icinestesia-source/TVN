/**
 * tvn.lol/tvn: TVN with no shipped channels and no users, for a viewer building a network of their own. It shares
 * the origin with tvn.lol, so everything it keeps in the browser lives under its own names and never meets the
 * main site's channels, users or settings.
 */
export const EMPTY_SITE_PATH = '/tvn'
/** Arriving from NEW USER on the main site's notice, which has already been read there. */
export const EMPTY_SITE_WELCOMED = '#welcomed'
const EMPTY_SITE_PREFIX = 'tvn-empty:'

export function isEmptySite(pathname: string | undefined = typeof location === 'undefined' ? undefined : location.pathname): boolean {
  if (!pathname) return false
  return pathname === EMPTY_SITE_PATH || pathname.startsWith(`${EMPTY_SITE_PATH}/`)
}

export const EMPTY_SITE = isEmptySite()

/** The name a browser database or setting has on this site. */
export function siteName(name: string, empty = EMPTY_SITE): string {
  return empty ? `${EMPTY_SITE_PREFIX}${name}` : name
}

/** A Storage whose keys are kept apart from the main site's. */
export function prefixedStorage(store: Storage, prefix = EMPTY_SITE_PREFIX): Storage {
  const own = () => {
    const keys: string[] = []
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index)
      if (key?.startsWith(prefix)) keys.push(key.slice(prefix.length))
    }
    return keys
  }
  return {
    get length() {
      return own().length
    },
    key: (index) => own()[index] ?? null,
    getItem: (key) => store.getItem(prefix + key),
    setItem: (key, value) => store.setItem(prefix + key, value),
    removeItem: (key) => store.removeItem(prefix + key),
    clear: () => {
      for (const key of own()) store.removeItem(prefix + key)
    },
  }
}

/** Run before anything reads storage: on the empty site, localStorage answers with that site's own keys. */
export function installSiteStorage(): void {
  if (!EMPTY_SITE || typeof window === 'undefined') return
  let store: Storage
  try {
    store = window.localStorage
  } catch {
    return
  }
  const own = prefixedStorage(store)
  Object.defineProperty(window, 'localStorage', { configurable: true, get: () => own })
}
