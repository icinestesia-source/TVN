import { useEffect, useState } from 'react'
import { BUFFERING_TITLE_DELAY_MS, sourceHostLabel } from '../player/slow-source.ts'
import type { Programme } from '../types/programme.ts'

/**
 * Over a picture that is slow to come (or has stalled) from a publisher's own servers: what is coming and
 * from where. It waits before showing, so a quick start never sees it.
 */
export function BufferingTitle({ programme, over = false }: { programme: Programme; over?: boolean }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setShown(true), BUFFERING_TITLE_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [])
  if (!shown) return null
  const from = sourceHostLabel(programme.liveStream?.url ?? programme.mediaUrl)
  return (
    <div className={over ? 'buffering-title is-over' : 'buffering-title'} role="status" aria-live="polite">
      <p className="buffering-kicker">
        Buffering<span className="buffering-dots" aria-hidden="true" />
      </p>
      <p className="buffering-name">{programme.title}</p>
      {from ? <p className="buffering-from">From {from} · this source can take a little longer to start</p> : null}
    </div>
  )
}
