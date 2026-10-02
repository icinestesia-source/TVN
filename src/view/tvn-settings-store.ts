import { useSyncExternalStore } from 'react'

/** Whether the Random settings dialog is open; a right-click on R in the information overlay opens it. */
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

export function randomSettingsOpen(): boolean {
  return open
}

export function openRandomSettings(): void {
  if (open) return
  open = true
  emit()
}

export function closeRandomSettings(): void {
  if (!open) return
  open = false
  emit()
}

export function useRandomSettingsOpen(): boolean {
  return useSyncExternalStore(subscribe, randomSettingsOpen, () => false)
}
