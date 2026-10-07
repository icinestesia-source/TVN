/**
 * REMEMBER LOCAL MEDIA, in Options, off unless the viewer turns it on. When on, TVN keeps where each Local
 * Media channel's folders and files are on this device (the browser's own file handles, never the media) and
 * the running order the viewer left, so a later visit can load them again with one press of RELOAD PREVIOUS.
 * Nothing is uploaded or copied. Only browsers that can keep file handles (Chrome, Edge) offer it.
 */
import { useSyncExternalStore } from 'react'

export const REMEMBER_MEDIA_KEY = 'tvn.local-media.remember.v1'
const DB_NAME = 'tvn-local-media'
const STORE = 'channels'

/** A folder or file the browser lets TVN find again; permission is asked for again on a later visit. */
export interface MediaHandle {
  kind: 'file' | 'directory'
  name: string
  queryPermission?: (options: { mode: 'read' }) => Promise<PermissionState>
  requestPermission?: (options: { mode: 'read' }) => Promise<PermissionState>
}

export interface RememberedChannel {
  number: number
  /** Every folder and file added to the channel, in the order they were added. */
  handles: MediaHandle[]
  /** Programme titles in the running order the viewer left. */
  order: string[]
  /** Titles the viewer took out; they stay out when the folder holding them is loaded again. */
  removed: string[]
}

type Store = Pick<Storage, 'getItem' | 'setItem'>

function browserStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** The browser can keep folder and file handles between visits. */
export function rememberSupported(scope: object = typeof window === 'undefined' ? {} : window): boolean {
  const picker = scope as { showDirectoryPicker?: unknown; showOpenFilePicker?: unknown }
  return typeof picker.showDirectoryPicker === 'function' && typeof picker.showOpenFilePicker === 'function' && typeof indexedDB !== 'undefined'
}

export function loadRememberMedia(store: Store | null = browserStore()): boolean {
  try {
    return store?.getItem(REMEMBER_MEDIA_KEY) === 'on'
  } catch {
    return false
  }
}

let current: boolean | null = null
const listeners = new Set<() => void>()

export function rememberMedia(): boolean {
  current ??= loadRememberMedia()
  return current
}

/** Turning it off forgets every remembered folder and file at once. */
export function setRememberMedia(on: boolean, store: Store | null = browserStore()): void {
  current = on
  try {
    store?.setItem(REMEMBER_MEDIA_KEY, on ? 'on' : 'off')
  } catch {
    // A browser that keeps nothing still has the choice for this visit.
  }
  if (!on) void forgetAll()
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useRememberMedia(): boolean {
  return useSyncExternalStore(subscribe, rememberMedia, () => false)
}

/**
 * The channel's record after its running order changed: titles that left it are remembered as removed,
 * and a title that is back (imported again) is no longer removed.
 */
export function nextRecord(previous: RememberedChannel, titles: readonly string[]): RememberedChannel {
  const now = new Set(titles)
  const gone = previous.order.filter((title) => !now.has(title))
  const removed = [...new Set([...previous.removed, ...gone])].filter((title) => !now.has(title))
  return { ...previous, order: [...titles], removed }
}

/**
 * Puts reloaded items back as the viewer left them: in the remembered order, without the ones taken out.
 * Anything new in a remembered folder joins the end.
 */
export function arrangeRemembered<T extends { title: string }>(items: readonly T[], record: Pick<RememberedChannel, 'order' | 'removed'>): T[] {
  const removed = new Set(record.removed)
  const pool = items.filter((item) => !removed.has(item.title))
  const placed: T[] = []
  for (const title of record.order) {
    const at = pool.findIndex((item) => item.title === title)
    if (at >= 0) placed.push(...pool.splice(at, 1))
  }
  return [...placed, ...pool]
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'number' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Local Media memory is unavailable'))
  })
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  if (typeof indexedDB === 'undefined') return undefined
  const db = await open()
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode)
      const request = work(transaction.objectStore(STORE))
      transaction.oncomplete = () => resolve(request ? request.result : undefined)
      transaction.onerror = () => reject(transaction.error ?? new Error('Local Media memory is unavailable'))
    })
  } finally {
    db.close()
  }
}

export async function rememberedChannels(): Promise<RememberedChannel[]> {
  try {
    return ((await run<RememberedChannel[]>('readonly', (store) => store.getAll() as IDBRequest<RememberedChannel[]>)) ?? []).sort((a, b) => a.number - b.number)
  } catch {
    return []
  }
}

async function remembered(number: number): Promise<RememberedChannel | undefined> {
  return run<RememberedChannel | undefined>('readonly', (store) => store.get(number) as IDBRequest<RememberedChannel | undefined>)
}

async function put(record: RememberedChannel): Promise<void> {
  await run('readwrite', (store) => {
    store.put(record)
  })
}

/** New folders or files for a channel, with the titles they brought, when REMEMBER is on. */
export async function rememberHandles(number: number, handles: readonly MediaHandle[], titles: readonly string[]): Promise<void> {
  if (!rememberMedia() || handles.length === 0) return
  try {
    const previous = (await remembered(number)) ?? { number, handles: [], order: [], removed: [] }
    await put(nextRecord({ ...previous, handles: [...previous.handles, ...handles] }, titles))
  } catch {
    // Remembering is a convenience; the import itself has already happened.
  }
}

/** The channel's running order changed (moved, removed, cleared). An empty channel forgets its folders. */
export async function rememberOrder(number: number, titles: readonly string[]): Promise<void> {
  if (!rememberMedia()) return
  try {
    const previous = await remembered(number)
    if (!previous) return
    if (titles.length === 0) await run('readwrite', (store) => void store.delete(number))
    else await put(nextRecord(previous, titles))
  } catch {
    // As above.
  }
}

export async function forgetAll(): Promise<void> {
  try {
    await run('readwrite', (store) => void store.clear())
  } catch {
    // Nothing kept, nothing to forget.
  }
}

/** Read access to a remembered handle, asking the viewer again if this visit has not been granted it. */
export async function readable(handle: MediaHandle): Promise<boolean> {
  try {
    if ((await handle.queryPermission?.({ mode: 'read' })) === 'granted') return true
    return (await handle.requestPermission?.({ mode: 'read' })) === 'granted'
  } catch {
    return false
  }
}
