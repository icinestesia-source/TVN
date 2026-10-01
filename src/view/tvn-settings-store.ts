import { useSyncExternalStore } from 'react'

/** Whether the TVN settings dialog is open; the TVN key in the information overlay opens it on a hold. */
let open = false
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function tvnSettingsOpen(): boolean {
  return open
}

export function openTvnSettings(): void {
  if (open) return
  open = true
  emit()
}

export function closeTvnSettings(): void {
  if (!open) return
  open = false
  emit()
}

export function useTvnSettingsOpen(): boolean {
  return useSyncExternalStore(subscribe, tvnSettingsOpen, () => false)
}
