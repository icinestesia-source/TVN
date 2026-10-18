/** Public http(s) website URLs for user-added shops — no privileged fetch. */

export function validateShopUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`)
  } catch {
    return { ok: false, error: 'Enter a valid website URL.' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'Only http(s) websites are allowed.' }
  }
  if (url.username || url.password) {
    return { ok: false, error: 'URLs must not include credentials.' }
  }
  const host = url.hostname.toLowerCase()
  if (!host.includes('.')) return { ok: false, error: 'Local and private addresses are not allowed.' }
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, error: 'Local and private addresses are not allowed.' }
  }
  if (/^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)) {
    return { ok: false, error: 'Local and private addresses are not allowed.' }
  }
  return { ok: true, url: url.toString() }
}

export function userShopId(name: string, websiteUrl: string): string {
  const key = `${name.trim().toLowerCase()}|${websiteUrl}`
  let hash = 2166136261
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `us${(hash >>> 0).toString(16)}`
}
