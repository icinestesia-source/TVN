import { describe, expect, it, vi } from 'vitest'
import {
  applyTmdbCredential,
  classifyTmdbSecret,
  isTmdbApiKey,
  isTmdbBearerToken,
  resolveTmdbCredential,
} from './info/entertainment/tmdb-auth.ts'
import { titleFromTmdb, titlesFromTmdbList } from './info/entertainment/tmdb.ts'

/** Synthetic JWT-shaped Read Access Token (not a real credential). */
const READ_TOKEN =
  'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ0ZXN0Iiwic3ViIjoidHZuIn0.signatureplaceholder0123456789abcdef'

describe('TMDB credential shape detection', () => {
  it('classifies Read Access Tokens as Bearer and v3 keys as api_key', () => {
    expect(isTmdbBearerToken(READ_TOKEN)).toBe(true)
    expect(isTmdbApiKey(READ_TOKEN)).toBe(false)
    expect(isTmdbApiKey('abcdefghijklmnopqrstuvwxyz12')).toBe(true)
    expect(classifyTmdbSecret(READ_TOKEN)).toEqual({ mode: 'bearer', token: READ_TOKEN })
    expect(classifyTmdbSecret('abcdefghijklmnopqrstuvwxyz12')).toEqual({
      mode: 'api_key',
      token: 'abcdefghijklmnopqrstuvwxyz12',
    })
  })

  it('uses Bearer when TMDB_API_TOKEN holds a Read Access Token (Netlify configuration)', () => {
    const credential = resolveTmdbCredential({ TMDB_API_TOKEN: READ_TOKEN })
    expect(credential).toEqual({ mode: 'bearer', token: READ_TOKEN })
    const upstream = new URL('https://api.themoviedb.org/3/movie/popular')
    const headers: Record<string, string> = {}
    applyTmdbCredential(upstream, headers, credential!)
    expect(headers.Authorization).toBe(`Bearer ${READ_TOKEN}`)
    expect(upstream.searchParams.has('api_key')).toBe(false)
  })

  it('uses api_key query only for classic v3 keys', () => {
    const credential = resolveTmdbCredential({ TMDB_API_TOKEN: 'abcdefghijklmnopqrstuvwxyz12' })
    expect(credential?.mode).toBe('api_key')
    const upstream = new URL('https://api.themoviedb.org/3/movie/popular')
    const headers: Record<string, string> = {}
    applyTmdbCredential(upstream, headers, credential!)
    expect(upstream.searchParams.get('api_key')).toBe('abcdefghijklmnopqrstuvwxyz12')
    expect(headers.Authorization).toBeUndefined()
  })

  it('prefers a bearer-shaped TMDB_READ_ACCESS_TOKEN when both env vars are set', () => {
    const credential = resolveTmdbCredential({
      TMDB_API_TOKEN: 'abcdefghijklmnopqrstuvwxyz12',
      TMDB_READ_ACCESS_TOKEN: READ_TOKEN,
    })
    expect(credential).toEqual({ mode: 'bearer', token: READ_TOKEN })
  })

  it('reports missing credentials', () => {
    expect(resolveTmdbCredential({})).toBeNull()
    expect(resolveTmdbCredential({ TMDB_API_TOKEN: '   ' })).toBeNull()
  })
})

describe('TMDB catalogue normalisation', () => {
  it('normalises successful list payloads and rejects invalid rows', () => {
    const titles = titlesFromTmdbList(
      {
        results: [
          { id: 1, title: 'Example Film', release_date: '2024-01-02', overview: 'A plot.', vote_average: 7.2 },
          { id: 2, name: 'Should skip when kind is film' },
        ],
      },
      'film',
    )
    expect(titles).toHaveLength(1)
    expect(titles[0]?.title).toBe('Example Film')
    expect(titleFromTmdb({ id: 9 }, 'film')).toBeNull()
    expect(titlesFromTmdbList(null, 'film')).toEqual([])
    expect(titlesFromTmdbList({ results: 'nope' }, 'film')).toEqual([])
  })
})

describe('TMDB proxy error surfaces', () => {
  it('surfaces missing configuration, rate limits, and provider errors without embedding secrets', async () => {
    const { tmdbProxy } = await import('./info/entertainment/tmdb.ts')
    await expect(
      tmdbProxy('/movie/popular', {}, async () => new Response(JSON.stringify({ error: 'not configured' }), { status: 503 })),
    ).rejects.toThrow(/not configured|TMDB/i)

    await expect(
      tmdbProxy('/movie/popular', {}, async () => new Response('{}', { status: 429 })),
    ).rejects.toThrow(/429/)

    await expect(
      tmdbProxy('/movie/popular', {}, async () => new Response('{}', { status: 500 })),
    ).rejects.toThrow(/500/)

    const ok = await tmdbProxy('/movie/popular', {}, async () =>
      new Response(JSON.stringify({ results: [{ id: 3, title: 'Ok', release_date: '2020-01-01' }] }), { status: 200 }),
    )
    expect(titlesFromTmdbList(ok, 'film')[0]?.title).toBe('Ok')
    expect(vi.isFakeTimers()).toBe(false)
  })
})
