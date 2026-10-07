const NAMES_KEY = 'tvn.local-media.names.v1'

/**
 * The names the viewer gave Local Media channels, by number. Only names are kept between visits; the files
 * a channel plays never leave the session.
 */
export function readLocalNames(): Record<string, string> {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(NAMES_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** Keeps one channel's name, or forgets it (`null`) so the default comes back. */
export function writeLocalName(number: number, name: string | null): void {
  try {
    const names = readLocalNames()
    if (name === null) delete names[String(number)]
    else names[String(number)] = name
    if (typeof localStorage !== 'undefined') localStorage.setItem(NAMES_KEY, JSON.stringify(names))
  } catch {
    // The name still holds for this session.
  }
}
