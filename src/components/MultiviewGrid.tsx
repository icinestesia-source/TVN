import { useEffect, useRef, useState } from 'react'
import { channelByNumber } from '../data/catalogue.ts'
import { useTv } from '../state/tv-context.ts'
import { compactTracks, gridRows, multiviewLayout, pageCount } from '../view/multiview.ts'
import { BroadcastTile } from './BroadcastTile.tsx'

export function MultiviewGrid({ width }: { width: number }) {
  const tv = useTv()
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const layout = multiviewLayout(tv.multiviewMode, width)
  const pages = pageCount(tv.tiles.length, layout.pageSize)
  const page = Math.min(tv.multiviewPage, pages - 1)
  const start = page * layout.pageSize
  const visible = tv.tiles.slice(start, start + layout.pageSize)

  useEffect(() => {
    const node = gridRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    // contentRect excludes the grid's padding, so the track sums below take none off.
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const rowClass = layout.stacked ? 'rows-2' : tv.multiviewMode === '2' ? 'rows-1' : layout.columns === 3 ? 'rows-3' : 'rows-2'
  const slot = tv.audioFocus - start
  const selected = slot >= 0 && slot < visible.length ? channelByNumber(visible[slot]) : undefined
  // Only a YouTube tile needs the room: radio faces and stills work at any size.
  const tracks = size && selected && selected.mediaKind !== 'audio' ? compactTracks(size, layout, gridRows(tv.multiviewMode, layout), slot, 4, 0) : null

  return (
    <div
      ref={gridRef}
      className={`mv cols-${layout.columns} ${rowClass} ${layout.stacked ? 'is-stacked' : ''}`}
      style={tracks ? { gridTemplateColumns: tracks.columns, gridTemplateRows: tracks.rows } : undefined}
    >
      {visible.map((number, offset) => {
        const index = start + offset
        return (
          <BroadcastTile
            key={`${tv.multiviewMode}-${index}-${number}`}
            channelNumber={number}
            index={index}
            active
            audible={index === tv.audioFocus && !tv.muted}
            focused={index === tv.audioFocus}
          />
        )
      })}
      {pages > 1 ? (
        <div className="mv-pages">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => tv.dispatch({ type: 'multiview-page', page: page - 1 })}
          >
            Previous
          </button>
          <span>
            {page + 1} / {pages}
          </span>
          <button
            type="button"
            disabled={page >= pages - 1}
            onClick={() => tv.dispatch({ type: 'multiview-page', page: page + 1 })}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  )
}
