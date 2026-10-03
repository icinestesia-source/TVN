import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDB_PAGE, readAllPaged } from './library/idb-read.ts'
import { runStartup, startupReason } from './state/startup.ts'

const read = (path: string) => readFileSync(path, 'utf8')

/** An object store that answers like Firefox: any single response over `cap` records fails as "too large". */
function fakeStore(count: number, cap: number) {
  const rows = Array.from({ length: count }, (_, index) => ({ id: `item-${String(index).padStart(6, '0')}`, n: index }))
  const calls: number[] = []
  const store = {
    keyPath: 'id',
    getAll(range: { lower: string; lowerOpen: boolean } | null, limit?: number) {
      const request: { result?: unknown; error?: unknown; onsuccess?: () => void; onerror?: () => void } = {}
      const from = range ? rows.filter((row) => (range.lowerOpen ? row.id > range.lower : row.id >= range.lower)) : rows
      const batch = limit === undefined ? from : from.slice(0, limit)
      calls.push(batch.length)
      queueMicrotask(() => {
        if (batch.length > cap) {
          request.error = Object.assign(new Error(`The serialized value is too large (size=${batch.length} bytes, max=${cap} bytes).`), { name: 'UnknownError' })
          request.onerror?.()
        } else {
          request.result = batch
          request.onsuccess?.()
        }
      })
      return request
    },
  }
  return { store: store as unknown as IDBObjectStore, rows, calls }
}

beforeEach(() => {
  vi.stubGlobal('IDBKeyRange', { lowerBound: (lower: string, lowerOpen = false) => ({ lower, lowerOpen }) })
})
afterEach(() => vi.unstubAllGlobals())

describe('Firefox: the saved library is read a page at a time', () => {
  it('a library larger than Firefox allows in one response is read whole, in key order, with no record lost or repeated', async () => {
    const { store, rows, calls } = fakeStore(IDB_PAGE * 2 + 17, IDB_PAGE)
    const all = await readAllPaged<{ id: string }>(store, 'Could not read the media library')
    expect(all.map((row) => row.id)).toEqual(rows.map((row) => row.id))
    expect(calls).toEqual([IDB_PAGE, IDB_PAGE, 17])
  })

  it('an exact multiple of the page ends on an empty page, and an empty store reads as empty', async () => {
    expect((await readAllPaged(fakeStore(IDB_PAGE, IDB_PAGE).store, 'x')).length).toBe(IDB_PAGE)
    expect(await readAllPaged(fakeStore(0, IDB_PAGE).store, 'x')).toEqual([])
  })

  it('a genuine read error still rejects, so nothing is saved over a library TVN could not read', async () => {
    await expect(readAllPaged(fakeStore(30, 10).store, 'x', 20)).rejects.toThrow(/serialized value is too large/)
  })

  it('the library, the User Network and the schedule cache all read through the paged reader', () => {
    expect(read('src/library/store.ts')).toContain("return readAllPaged<T>(store, 'Could not read the media library')")
    expect(read('src/services/user-db.ts')).toContain("readAllPaged<StoredSource>(db.transaction(STORE, 'readonly').objectStore(STORE), 'Could not read the user catalogue')")
    expect(read('src/director/cache.ts')).toContain("readAllPaged<FrozenDailySchedule>(db.transaction(STORE, 'readonly').objectStore(STORE), 'Could not read schedules')")
    for (const path of ['src/library/store.ts', 'src/services/user-db.ts', 'src/director/cache.ts']) expect(read(path)).not.toMatch(/\.getAll\(\)/)
  })
})

describe('a start that fails says why, in the console only', () => {
  it('reports the rejection, an unusable network and a stall, once each; a later success reports nothing', async () => {
    vi.useFakeTimers()
    try {
      const reasons: string[] = []
      runStartup(() => Promise.reject(Object.assign(new Error('The serialized value is too large'), { name: 'UnknownError' })), () => undefined, 60_000, (reason) => reasons.push(reason))
      runStartup(() => Promise.resolve(false), () => undefined, 60_000, (reason) => reasons.push(reason))
      runStartup(() => new Promise<boolean>(() => undefined), () => undefined, 60_000, (reason) => reasons.push(reason))
      runStartup(() => Promise.resolve(true), () => undefined, 60_000, (reason) => reasons.push(reason))
      await vi.advanceTimersByTimeAsync(60_000)
      expect(reasons).toEqual(['UnknownError: The serialized value is too large', 'the shipped network did not load', 'still loading after 60 s'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('names the error in one short line, never a stack', () => {
    const error = new TypeError('x'.repeat(400))
    expect(startupReason(error)).toMatch(/^TypeError: x+$/)
    expect(startupReason(error).length).toBe(300)
    expect(startupReason('plain')).toBe('plain')
  })

  it('the provider logs the reason with the build commit; the viewer still sees only the off-air card', () => {
    const provider = read('src/state/TvProvider.tsx')
    expect(provider).toContain("}, undefined, (reason) => console.error(`TVN could not start (commit ${BUILD_INFO.commit}): ${reason}`))")
    expect(provider).toContain('console.error(`TVN could not start (commit ${BUILD_INFO.commit}): no channel to start on`)')
    expect(read('src/components/StartupScreen.tsx')).toContain("failed: 'TVN IS OFF THE AIR'")
  })
})
