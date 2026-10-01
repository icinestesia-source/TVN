/** Minimum fields the scheduler needs. Full programme records satisfy this. */
export interface ScheduledItem {
  id: string
  durationSeconds: number
}

export interface BroadcastPosition<T> {
  programme: T
  index: number
  startMs: number
  endMs: number
  /** Seconds since this airing started. */
  elapsedSeconds: number
  /**
   * Where playback should be within the programme.
   * In V0.1 this is the elapsed broadcast time. The player may map it onto a
   * shorter demonstration film; that mapping is not the scheduler's job.
   */
  seekSeconds: number
}

export interface ScheduleSnapshot<T> {
  channelId: string
  epochMs: number
  nowMs: number
  cycleDurationSeconds: number
  /** Position within the current cycle, in seconds. */
  offsetSeconds: number
  current: BroadcastPosition<T>
  previous: BroadcastPosition<T>
  next: BroadcastPosition<T>
}

export interface GuideSlot<T> {
  programme: T
  index: number
  startMs: number
  endMs: number
}
