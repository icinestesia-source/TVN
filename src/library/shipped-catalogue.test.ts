import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { commitPlayableCatalogue, librarySnapshot, loadShippedIndependentCatalogue, resetLibraryForTests, saveDeferredLibrary, setLibraryWriter, type LibraryWriter } from './store.ts'
import { expandPlayableCatalogue } from './playable-catalogue.ts'

const shipped = JSON.parse(readFileSync('public/independent/playable.json', 'utf8'))

function memoryWriter(fail = false, writes: unknown[] = []): LibraryWriter {
  return {
    async write(snapshot) {
      if (fail) throw new Error('quota exceeded')
      writes.push(snapshot)
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
    const session = { id: 's', startedAt: 1, completedAt: 1, sourceFormat: 'youtube-discovery', sourceVersion: '1', sourceCounts: { collections: 0, videos: 0 }, added: 0, updated: 0, unchanged: 0, duplicatesMerged: 0, userEditsPreserved: 0, missingFromImport: 0, errors: 0, status: 'complete' as const }
    await expect(commitPlayableCatalogue(expandPlayableCatalogue(shipped), session, true)).rejects.toThrow('quota exceeded')
    expect(librarySnapshot().media).toEqual([])
  }, 120_000)

  it('at startup the save waits; a failed save stores nothing and stays due until one succeeds', async () => {
    resetLibraryForTests()
    setLibraryWriter(memoryWriter(true))
    serve(async () => new Response(JSON.stringify(shipped), { status: 200 }))
    expect(await loadShippedIndependentCatalogue()).toBeGreaterThan(100_000)
    await expect(saveDeferredLibrary()).rejects.toThrow('quota exceeded')
    const writes: unknown[] = []
    setLibraryWriter(memoryWriter(false, writes))
    await saveDeferredLibrary()
    expect(writes).toHaveLength(1)
    await saveDeferredLibrary()
    expect(writes).toHaveLength(1)
  }, 120_000)
})
