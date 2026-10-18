/**
 * Resolve TMDB credentials by shape, not env var name alone.
 *
 * Product note: Netlify may store the TMDB API Read Access Token under TMDB_API_TOKEN.
 * That value must be sent as Authorization: Bearer, never as api_key=.
 *
 * Supported env vars (either may hold either credential type):
 * - TMDB_API_TOKEN
 * - TMDB_READ_ACCESS_TOKEN
 */

export type TmdbCredential =
  | { mode: 'bearer'; token: string }
  | { mode: 'api_key'; token: string }

/** TMDB Read Access Tokens are JWTs (three base64url segments). */
export function isTmdbBearerToken(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 40) return false
  return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)
}

/** Classic TMDB v3 API keys are short alphanumeric strings, not JWTs. */
export function isTmdbApiKey(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || isTmdbBearerToken(trimmed)) return false
  return /^[a-zA-Z0-9]{16,64}$/.test(trimmed)
}

export function classifyTmdbSecret(value: string | undefined | null): TmdbCredential | null {
  if (typeof value !== 'string') return null
  const token = value.trim()
  if (!token) return null
  if (isTmdbBearerToken(token)) return { mode: 'bearer', token }
  if (isTmdbApiKey(token)) return { mode: 'api_key', token }
  // Long opaque tokens: treat as Bearer (Read Access Token variants).
  if (token.length >= 80) return { mode: 'bearer', token }
  return null
}

export interface TmdbEnv {
  TMDB_API_TOKEN?: string
  TMDB_READ_ACCESS_TOKEN?: string
}

/**
 * Prefer an explicit bearer-shaped credential from either env var.
 * Fall back to a v3 API key. Never log the token value.
 */
export function resolveTmdbCredential(env: TmdbEnv): TmdbCredential | null {
  const namedRead = classifyTmdbSecret(env.TMDB_READ_ACCESS_TOKEN)
  const namedApi = classifyTmdbSecret(env.TMDB_API_TOKEN)
  const bearers = [namedRead, namedApi].filter((entry): entry is TmdbCredential => entry?.mode === 'bearer')
  if (bearers[0]) return bearers[0]
  const keys = [namedApi, namedRead].filter((entry): entry is TmdbCredential => entry?.mode === 'api_key')
  return keys[0] ?? null
}

export function applyTmdbCredential(
  upstream: URL,
  headers: Record<string, string>,
  credential: TmdbCredential,
): void {
  if (credential.mode === 'bearer') {
    headers.Authorization = `Bearer ${credential.token}`
    return
  }
  upstream.searchParams.set('api_key', credential.token)
}
