import { useSyncExternalStore } from 'react'

/** The first-run notice, acknowledged once per browser. Bump the version when its substance changes. */
export const NOTICE_KEY = 'tvn.notice.v1'

type Store = Pick<Storage, 'getItem' | 'setItem'>

function browserStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function noticeAcknowledged(store: Store | null = browserStore()): boolean {
  try {
    return (store?.getItem(NOTICE_KEY) ?? null) !== null
  } catch {
    return false
  }
}

export function acknowledgeNotice(store: Store | null = browserStore()): void {
  try {
    store?.setItem(NOTICE_KEY, new Date().toISOString())
  } catch {
    // Private browsing may refuse storage; the notice simply returns next visit.
  }
  emit()
}

let aboutOpen = false
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function openAbout(): void {
  aboutOpen = true
  emit()
}

export function closeAbout(): void {
  aboutOpen = false
  emit()
}

export function useAboutOpen(): boolean {
  return useSyncExternalStore(subscribe, () => aboutOpen, () => false)
}

export function useNoticeAcknowledged(): boolean {
  return useSyncExternalStore(subscribe, () => noticeAcknowledged(), () => true)
}
