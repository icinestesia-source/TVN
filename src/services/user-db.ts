import { readAllPaged } from '../library/idb-read.ts'
import type { StoredSource } from './channels-import.ts'

const DB_NAME = 'retrotv-user'
const DB_VERSION = 1
const STORE = 'sources'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the user catalogue'))
  })
}

export async function loadStoredSources(): Promise<StoredSource[]> {
  if (typeof indexedDB === 'undefined') return []
  const db = await openDb()
  try {
    return await readAllPaged<StoredSource>(db.transaction(STORE, 'readonly').objectStore(STORE), 'Could not read the user catalogue')
  } finally {
    db.close()
  }
}

export async function saveStoredSources(sources: readonly StoredSource[]): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      store.clear()
      for (const source of sources) store.put(source)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Could not save the user catalogue'))
    })
  } finally {
    db.close()
  }
}
