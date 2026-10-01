import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { librarySnapshot, loadShippedIndependentCatalogue, resetLibraryForTests, setLibraryWriter, type LibraryWriter } from './store.ts'

const shipped = JSON.parse(readFileSync('public/independent/playable.json', 'utf8'))

function memoryWriter(fail = false): LibraryWriter {
  return {
    async write() {
      if (fail) throw new Error('quota exceeded')
    },
    async read() {
      return { media: [], sources: [] }
    },
  }
}

function serve(response: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(response))
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetLibraryForTests()
})

describe('shipped catalogue refresh keeps the last valid programming', () => {
  it('a malformed, missing or unreachable file never clears programmes already loaded', async () => {
    resetLibraryForTests()
    setLibraryWriter(memoryWriter())
    serve(async () => new Response(JSON.stringify(shipped), { status: 200 }))
    expect(await loadShippedIndependentCatalogue()).toBeGreaterThan(0)
    const loaded = librarySnapshot().media.length
    expect(loaded).toBeGreaterThan(100_000)

    serve(async () => new Response('{"format":"retrotv-playable-v2","items":[[', { status: 200 }))
    expect(await loadShippedIndependentCatalogue()).toBe(0)
    expect(librarySnapshot().media.length).toBe(loaded)

    serve(async () => new Response(JSON.stringify({ format: 'retrotv-playable-v2', items: [['x']] }), { status: 200 }))
    expect(await loadShippedIndependentCatalogue()).toBe(0)
    expect(librarySnapshot().media.length).toBe(loaded)

    serve(async () => {
      throw new TypeError('network down')
    })
    expect(await loadShippedIndependentCatalogue()).toBe(0)
    expect(librarySnapshot().media.length).toBe(loaded)

    serve(async () => new Response('gateway', { status: 502 }))
    expect(await loadShippedIndependentCatalogue()).toBe(0)
    expect(librarySnapshot().media.length).toBe(loaded)
  }, 120_000)

  it('a failed local write rolls back instead of leaving a half-committed library', async () => {
    resetLibraryForTests()
    setLibraryWriter(memoryWriter(true))
    serve(async () => new Response(JSON.stringify(shipped), { status: 200 }))
    await expect(loadShippedIndependentCatalogue()).rejects.toThrow('quota exceeded')
    expect(librarySnapshot().media).toEqual([])
  }, 120_000)
})
