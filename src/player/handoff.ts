import type { LoadResult, PlayerHandle, PlayerLoadRequest, PlayerStatus } from './types.ts'

/** The longest the old picture is held for a destination that has not started; then the usual waiting cover. */
export const HANDOFF_MAX_MS = 6000

export type Slot = 0 | 1

/** One slot of the single-view player: a whole player that can also let go of its picture and sound. */
export interface SlotPlayer extends PlayerHandle {
  stop(): void
}

export interface HandoffOptions {
  slot: (index: Slot) => SlotPlayer | null
  /** INSTANT is the viewer's transition: a load may wait in the standby slot. */
  prebuffer: () => boolean
  /** The slot can take this load now (its YouTube player has been created). */
  ready: (index: Slot, request: PlayerLoadRequest) => boolean
  onPrimary: (index: Slot) => void
  /** The old picture is being held on screen while the destination loads unseen. */
  onHold: (held: boolean) => void
  emit: (status: PlayerStatus, detail?: string) => void
  maxWaitMs?: number
}

export interface HandoffPlayer extends PlayerHandle {
  status(index: Slot, status: PlayerStatus, detail?: string): void
}

/**
 * Two slots behind one handle. Normally every load goes to the slot on screen. With INSTANT, a load made
 * while a picture is playing goes to the hidden, silent standby slot instead; the old picture and sound
 * carry on until the destination reports that it is actually playing (or has failed, or the wait runs
 * out), and then the slots swap in one step: the destination is shown and given the viewer's sound once,
 * and the old slot is stopped.
 */
export function handoffPlayer(o: HandoffOptions): HandoffPlayer {
  let primary: Slot = 0
  let live = false
  let sound: [audible: boolean, volume: number, muted: boolean] = [true, 100, false]
  let pending: { timer: ReturnType<typeof setTimeout> } | null = null
  const standby = (): Slot => (primary === 0 ? 1 : 0)
  // Transport belongs to the programme last asked for, which is in the standby slot while it waits.
  const target = () => o.slot(pending ? standby() : primary)

  const swap = () => {
    if (!pending) return
    clearTimeout(pending.timer)
    pending = null
    const old = primary
    primary = standby()
    o.slot(primary)?.setAudible(...sound)
    o.slot(old)?.setAudible(false, 0, true)
    o.slot(old)?.stop()
    o.onPrimary(primary)
    o.onHold(false)
  }

  const cancel = () => {
    if (!pending) return
    clearTimeout(pending.timer)
    pending = null
    o.slot(standby())?.stop()
    o.onHold(false)
  }

  return {
    load(request): Promise<LoadResult> {
      const next = standby()
      if (o.prebuffer() && (live || pending) && o.ready(next, request)) {
        if (pending) clearTimeout(pending.timer)
        pending = { timer: setTimeout(swap, o.maxWaitMs ?? HANDOFF_MAX_MS) }
        o.onHold(true)
        const player = o.slot(next)
        player?.setAudible(false, 0, true)
        return player?.load(request) ?? Promise.resolve('error')
      }
      cancel()
      live = false
      return o.slot(primary)?.load(request) ?? Promise.resolve('error')
    },
    play() {
      target()?.play()
    },
    pause() {
      target()?.pause()
    },
    seek(seconds) {
      target()?.seek(seconds)
    },
    setAudible(audible, volume, muted) {
      sound = [audible, volume, muted]
      o.slot(primary)?.setAudible(audible, volume, muted)
      if (pending) o.slot(standby())?.setAudible(false, 0, true)
    },
    currentTime() {
      return target()?.currentTime() ?? 0
    },
    actualVideoId() {
      return target()?.actualVideoId() ?? null
    },
    status(index, status, detail) {
      if (pending) {
        // The old picture's own reports are not the viewer's any more; the destination's are, once it decides.
        if (index !== standby()) return
        if (status !== 'playing' && status !== 'paused' && status !== 'error' && status !== 'slate') return
        swap()
      } else if (index !== primary) {
        return
      }
      if (status === 'playing') live = true
      else if (status !== 'buffering' && status !== 'loading-api') live = false
      o.emit(status, detail)
    },
  }
}
