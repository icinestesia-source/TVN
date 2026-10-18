/**
 * Load an INFO snapshot: prefer the live API (Blobs-backed in production), then the static seed file
 * shipped with the last application deploy. Never throws.
 */
export async function loadPublishedSnapshot<T>(
  apiUrl: string,
  staticUrl: string,
  parse: (value: unknown) => T | null,
): Promise<{ value: T; fromStatic: boolean } | { error: string }> {
  try {
    const response = await fetch(apiUrl, { cache: 'no-store' })
    if (response.ok) {
      const value = parse(await response.json())
      if (value) return { value, fromStatic: false }
    }
  } catch {
    // Fall through to the static seed.
  }
  try {
    const response = await fetch(staticUrl, { cache: 'no-store' })
    if (!response.ok) return { error: `Unavailable (${response.status})` }
    const value = parse(await response.json())
    if (!value) return { error: 'Data could not be read' }
    return { value, fromStatic: true }
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : 'Unavailable' }
  }
}
