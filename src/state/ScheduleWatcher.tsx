import { useEffect } from 'react'
import { useTv } from './tv-context.ts'
import { useClock } from '../utils/use-clock.ts'

/** Follows the wall clock and cuts to the next programme when a slot ends. */
export function ScheduleWatcher() {
  const now = useClock(1000)
  const { syncLive } = useTv()

  useEffect(() => {
    syncLive(now)
  }, [now, syncLive])

  return null
}
