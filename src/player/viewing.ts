import { liveKey } from '../scheduler/calculate.ts'
import type { Channel } from '../types/channel.ts'
import { onScreen } from './manual.ts'
import type { Programme } from '../types/programme.ts'
import { playbackCommand, type PlaybackCommand } from './command.ts'
import type { PlayerHandle } from './types.ts'

export interface LiveAiring {
  key: string
  programme: Programme
  startMs: number
  command: PlaybackCommand
}

/** What the channel is showing at this instant (the broadcast, or a programme picked from the Guide) and where playback joins it. */
export function liveAiring(channel: Channel, nowMs: number, override: string | null): LiveAiring {
  const snap = onScreen(channel, nowMs)
  return {
    key: liveKey(channel.id, snap.current.programme.id, snap.current.startMs),
    programme: snap.current.programme,
    startMs: snap.current.startMs,
    command: playbackCommand(snap.current.programme, snap.current.seekSeconds, override),
  }
}

/** Pausing holds the picture only; the channel's schedule keeps running on the wall clock. */
export function pauseViewing(player: PlayerHandle | null): void {
  player?.pause()
}
