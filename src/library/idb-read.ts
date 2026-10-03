/**
 * Every record in an object store, read a page at a time in key order inside the caller's transaction.
 * Firefox refuses a single response over about 246 MiB ("The serialized value is too large"), which one
 * getAll() of the saved network library exceeds; a page stays far below it in every browser.
 */
export const IDB_PAGE = 5000

export function readAllPaged<T>(store: IDBObjectStore, failure: string, page = IDB_PAGE): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const rows: T[] = []
    // The next page is asked for inside the success callback, so the transaction never goes idle between pages.
    const next = (after: IDBValidKey | null) => {
      const request = store.getAll(after === null ? null : IDBKeyRange.lowerBound(after, true), page)
      request.onsuccess = () => {
        const batch = (request.result as T[]) ?? []
        for (const row of batch) rows.push(row)
        if (batch.length < page) return resolve(rows)
        const last = store.keyPath === null ? null : keyOf(batch[batch.length - 1], store.keyPath)
        if (last === null) return reject(new Error(failure))
        next(last)
      }
      request.onerror = () => reject(request.error ?? new Error(failure))
    }
    next(null)
  })
}

function keyOf(row: unknown, keyPath: string | string[]): IDBValidKey | null {
  if (Array.isArray(keyPath)) {
    const parts = keyPath.map((path) => keyOf(row, path))
    return parts.every((part) => part !== null) ? (parts as IDBValidKey[]) : null
  }
  let value: unknown = row
  for (const part of keyPath.split('.')) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined
  return typeof value === 'string' || typeof value === 'number' || value instanceof Date || Array.isArray(value) ? (value as IDBValidKey) : null
}
