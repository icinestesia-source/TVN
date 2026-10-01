import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject, type WheelEvent } from 'react'
import {
  ROW_HEIGHT,
  TIME_HEADER_HEIGHT,
  openScrollLeft,
  programmeFlags,
  slotFrame,
  timeX,
  trackWidthPx,
  visibleRowRange,
} from '../epg/geometry.ts'
import { bandLabel, guideBandTarget, guideViewedChannel } from '../epg/navigation.ts'
import {
  GUIDE_ZOOM_MAX,
  GUIDE_ZOOM_MIN,
  GUIDE_ZOOM_STEP,
  anchorTime,
  anchoredScrollLeft,
  clampZoom,
} from '../epg/zoom.ts'
import { bindTimelinePinch, type TimelinePinchHandlers } from '../input/timeline-pinch.ts'
import { slotContaining } from '../scheduler/window.ts'
import { isOnAir } from '../network/airing.ts'
import { guideSlots } from '../services/broadcast.ts'
import { useTv } from '../state/tv-context.ts'
import type { Channel } from '../types/channel.ts'
import type { GuideSlot } from '../types/schedule.ts'
import type { Programme } from '../types/programme.ts'
import { useClock } from '../utils/use-clock.ts'
import { hasPicture, searchSession, SESSION_CHANNEL } from '../session/session-channel.ts'
import { channelActions, cornerActions, type ChannelActions, type CornerActions } from '../view/info-shortcuts.ts'
import { historyActions, InfoActions, type HistoryActions } from './InfoActions.tsx'
import { ProgrammeInfo } from './ProgrammeInfo.tsx'
import { AddChannelForm, GuideActions, SessionImportTools, UserNetworkTools } from './GuideAdd.tsx'
import { ChannelEditor } from './ChannelEditor.tsx'
import { useEditPress } from './use-edit-press.ts'
import { createLongPress, editorScope } from '../view/channel-edit.ts'
import { isLiveStream } from '../dynamic/stream.ts'
import { manualAiring } from '../player/manual.ts'
import { parseChannelsExport } from '../services/channels-import.ts'
import { channelLinksFrom } from '../services/user-network.ts'
import { USER_NUMBER_START } from '../data/network.ts'
import { listChannels } from '../data/catalogue.ts'
import {
  floorHalfHour,
  formatClock,
  formatDuration,
  formatGuideDate,
  formatRange,
  halfHourTicks,
  padChannel,
} from '../utils/time.ts'

export function Guide({ closing = false }: { closing?: boolean }) {
  const tv = useTv()
  const now = useClock(1000)
  // Timeline zoom widens the time axis only: at 1x this is exactly the standard scale.
  const pxPerMinute = usePxPerMinute() * tv.guideZoom
  const sectionRef = useRef<HTMLElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)

  // The guide rises out of, and folds back into, its information bar; the animation needs the bar's height.
  useLayoutEffect(() => {
    const section = sectionRef.current
    const info = section?.querySelector<HTMLElement>('.guide-info')
    if (section && info) section.style.setProperty('--info-h', `${info.offsetHeight}px`)
  }, [closing])
  const timeRef = useRef<HTMLDivElement>(null)
  const channelScrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(() =>
    openScrollLeft(Date.now(), tv.guideWindow.startMs, initialPxPerMinute() * tv.guideZoom, Math.max(480, window.innerWidth - 320)),
  )
  const [viewport, setViewport] = useState(480)
  const [viewWidth, setViewWidth] = useState(() => Math.max(480, window.innerWidth - 320))
  const revealArmed = useRef(false)
  const prevStart = useRef(tv.guideWindow.startMs)
  const scrollFrame = useRef(0)

  const { startMs, endMs } = tv.guideWindow

  // The scale on screen, a zoom waiting for the next frame, and the time a zoom must hold in place.
  const drawn = useRef({ px: pxPerMinute, startMs, zoom: tv.guideZoom })
  const pendingZoom = useRef<{ zoom: number; offsetPx: number | null } | null>(null)
  const zoomFrame = useRef(0)
  const zoomAnchor = useRef<{ timeMs: number; offsetPx: number } | null>(null)
  const zoomAim = useRef(tv.guideZoom)
  const zoomHeld = useRef(false)

  /** Zoom to `next`, holding the time at `offsetPx` across the timeline (its centre when null). */
  const applyZoom = (next: number, offsetPx: number | null) => {
    const grid = gridRef.current
    const zoom = clampZoom(next)
    if (!grid || zoom === drawn.current.zoom) return
    const offset = offsetPx ?? grid.clientWidth / 2
    zoomAnchor.current = { timeMs: anchorTime(grid.scrollLeft, offset, drawn.current.startMs, drawn.current.px), offsetPx: offset }
    zoomAim.current = zoom
    tv.setGuideZoom(zoom)
  }
  // Pinch and trackpad events arrive faster than frames; only the latest in each frame is drawn.
  const requestZoom = (next: number, offsetPx: number) => {
    pendingZoom.current = { zoom: clampZoom(next), offsetPx }
    if (zoomFrame.current) return
    zoomFrame.current = window.requestAnimationFrame(() => {
      zoomFrame.current = 0
      const request = pendingZoom.current
      pendingZoom.current = null
      if (request) applyZoom(request.zoom, request.offsetPx)
    })
  }
  const zoomBase = () => pendingZoom.current?.zoom ?? zoomAim.current
  useEffect(() => () => window.cancelAnimationFrame(zoomFrame.current), [])
  useTimelinePinch(timelineRef, tv.visibleChannels.length > 0, zoomBase, requestZoom)
  const width = trackWidthPx(startMs, endMs, pxPerMinute)
  const ticks = halfHourTicks(startMs, endMs)
  const gridOffset = timeX(floorHalfHour(startMs), startMs, pxPerMinute)
  const nowX = timeX(now, startMs, pxPerMinute)
  const range = visibleRowRange(scrollTop, viewport, ROW_HEIGHT, tv.visibleChannels.length, 6)
  const rows = tv.visibleChannels.slice(range.start, range.end)

  const slotsById = useMemo(() => {
    const map = new Map<string, GuideSlot<Programme>[]>()
    for (const channel of tv.visibleChannels.slice(range.start, range.end)) {
      map.set(channel.id, guideSlots(channel, startMs, endMs))
    }
    return map
  }, [endMs, range.end, range.start, startMs, tv.visibleChannels])

  const focusedChannel =
    tv.visibleChannels.find((channel) => channel.number === tv.guideCursor.channelNumber) ?? null
  const focusedSlots = useMemo(
    () => (focusedChannel ? guideSlots(focusedChannel, startMs, endMs) : []),
    // The channel list is rebuilt when the session channel's running order changes; its slots follow it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [endMs, focusedChannel, startMs, tv.visibleChannels],
  )
  const focused = slotContaining(focusedSlots, tv.guideCursor.timeMs)
  // What follows the chosen programme on its channel, even when it starts past the listed window.
  const followingSlot =
    focused && focusedChannel
      ? (focusedSlots.find((slot) => slot.startMs >= focused.endMs) ??
        guideSlots(focusedChannel, focused.endMs, focused.endMs + 60_000).find((slot) => slot.startMs >= focused.endMs) ??
        null)
      : null
  const precedingSlot =
    focused && focusedChannel
      ? (focusedSlots.findLast((slot) => slot.endMs <= focused.startMs) ??
        guideSlots(focusedChannel, focused.startMs - 60_000, focused.startMs).findLast((slot) => slot.endMs <= focused.startMs) ??
        null)
      : null

  const searching = tv.guideQuery.trim() !== ''
  const userNumbers = listChannels().filter((channel) => channel.number >= USER_NUMBER_START).map((channel) => channel.number)
  const nextNumber = userNumbers.length > 0 ? Math.max(...userNumbers) + 1 : USER_NUMBER_START
  // The Add Channel row closes the list wherever the whole User Network is listed.
  const addRow = !searching && (tv.guideFilter === 'all' || tv.guideFilter === 'user')
  const rowCount = tv.visibleChannels.length + (addRow ? 1 : 0)
  const addInput = useRef<HTMLInputElement>(null)
  // IMPORT and ADD hold only while the Guide cursor is where they put it; moving on returns to the listings.
  const tool = tv.guideTool && tv.guideTool.cursor === tv.guideCursor ? tv.guideTool.kind : null
  const manual = manualAiring(tv.channel.number, now)
  const picked = manual !== null
  // What the watched channel is playing: a programme picked from the Guide sits at its own slot, otherwise the airing one.
  const playingSlot: PlayingSlot = manual ? (manual.slot ? { startMs: manual.slot.startMs } : null) : 'airing'
  const editScope = focusedChannel ? editorScope(focusedChannel) : null

  // ADD goes straight to the ADD CHANNEL row at the foot of the User Network, ready for a link.
  useEffect(() => {
    if (tv.guideTool?.kind !== 'add' || tv.guideTool.cursor !== tv.guideCursor) return
    const grid = gridRef.current
    if (grid) {
      grid.scrollTop = grid.scrollHeight
      if (channelScrollRef.current) channelScrollRef.current.scrollTop = grid.scrollTop
      setScrollTop(grid.scrollTop)
    }
    const id = window.setTimeout(() => addInput.current?.focus(), 60)
    return () => window.clearTimeout(id)
    // Only a new ADD moves the Guide; the cursor is read to confirm it is still the one ADD placed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tv.guideTool])

  const addLink = async (link: string) => {
    const result = await tv.addChannel(link)
    if (result.number !== null) tv.focusGuide(result.number, Date.now())
    return result.message
  }

  const importList = async (file: File) => {
    const text = await file.text()
    const links = channelLinksFrom(text)
    if (!links) {
      const parsed = parseChannelsExport(text)
      await tv.applyImport(parsed, { library: true, automatic: true }, { filename: file.name })
      return `${parsed.sources.length} ${parsed.sources.length === 1 ? 'CHANNEL' : 'CHANNELS'} IMPORTED`
    }
    let added = 0
    const failed: string[] = []
    for (const link of links) {
      try {
        await tv.addChannel(link)
        added += 1
      } catch {
        failed.push(link)
      }
    }
    return `${added} ${added === 1 ? 'CHANNEL' : 'CHANNELS'} ADDED${failed.length > 0 ? ` · ${failed.length} COULD NOT BE READ` : ''}`
  }

  const openAddRow = () => {
    if (tool !== 'add') tv.dispatch({ type: 'guide-tool', tool: 'add' })
  }
  const sessionMatches = searching && focusedChannel?.origin === 'session' ? searchSession(tv.guideQuery) : []
  const numbers = useMemo(() => tv.visibleChannels.map((channel) => channel.number), [tv.visibleChannels])
  const [bandAnchor, setBandAnchor] = useState<{ channelNumber: number; scrollTop: number } | null>(null)
  const viewedNumber = guideViewedChannel(numbers, scrollTop, ROW_HEIGHT, bandAnchor) ?? tv.guideCursor.channelNumber
  const previousBand = guideBandTarget(numbers, viewedNumber, -1, tv.guideQuery)
  const nextBand = guideBandTarget(numbers, viewedNumber, 1, tv.guideQuery)
  const bandJump = useRef<number | null>(null)

  const jumpToBand = (target: number | null) => {
    if (target === null) return
    bandJump.current = target
    tv.focusGuide(target, tv.guideCursor.timeMs)
  }

  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    grid.scrollLeft = openScrollLeft(Date.now(), startMs, pxPerMinute, grid.clientWidth)
    const index = tv.visibleChannels.findIndex(
      (channel) => channel.number === tv.guideCursor.channelNumber,
    )
    if (index >= 0) grid.scrollTop = Math.max(0, index * ROW_HEIGHT - grid.clientHeight * 0.35)
    if (timeRef.current) timeRef.current.scrollLeft = grid.scrollLeft
    if (channelScrollRef.current) channelScrollRef.current.scrollTop = grid.scrollTop
    setScrollTop(grid.scrollTop)
    setScrollLeft(grid.scrollLeft)
    setViewport(grid.clientHeight)
    setViewWidth(grid.clientWidth)
    // Position once when the guide opens. Later movement is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A new scale keeps the anchored time exactly where it was on screen by moving scrollLeft.
  useLayoutEffect(() => {
    const before = drawn.current
    drawn.current = { px: pxPerMinute, startMs, zoom: tv.guideZoom }
    if (before.zoom !== tv.guideZoom) zoomAim.current = tv.guideZoom
    if (before.px === pxPerMinute) return
    const anchor = zoomAnchor.current
    zoomAnchor.current = null
    const grid = gridRef.current
    if (!grid) return
    const offsetPx = anchor?.offsetPx ?? grid.clientWidth / 2
    const timeMs = anchor?.timeMs ?? anchorTime(grid.scrollLeft, offsetPx, before.startMs, before.px)
    grid.scrollLeft = anchoredScrollLeft(timeMs, offsetPx, startMs, pxPerMinute)
    prevStart.current = startMs
    // A zoom the viewer aimed stays where they aimed it; NOW still brings the current programme into view.
    zoomHeld.current = anchor !== null
    if (timeRef.current) timeRef.current.scrollLeft = grid.scrollLeft
    setScrollLeft(grid.scrollLeft)
    setViewWidth(grid.clientWidth)
  }, [pxPerMinute, startMs, tv.guideZoom])

  useLayoutEffect(() => {
    const deltaMs = prevStart.current - startMs
    prevStart.current = startMs
    const grid = gridRef.current
    if (deltaMs > 0 && grid) {
      grid.scrollLeft += (deltaMs / 60_000) * pxPerMinute
      if (timeRef.current) timeRef.current.scrollLeft = grid.scrollLeft
    }
  }, [pxPerMinute, startMs])

  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    if (channelScrollRef.current) channelScrollRef.current.scrollTop = grid.scrollTop
    setScrollTop(grid.scrollTop)
  }, [tv.visibleChannels])

  useLayoutEffect(() => {
    if (!revealArmed.current) {
      revealArmed.current = true
      return
    }
    if (zoomHeld.current) {
      zoomHeld.current = false
      return
    }
    const grid = gridRef.current
    if (!grid || !focused) return
    const index = tv.visibleChannels.findIndex((channel) => channel.number === focusedChannel?.number)
    const frame = slotFrame(focused.startMs, focused.endMs, startMs, pxPerMinute)
    const viewRight = grid.scrollLeft + grid.clientWidth
    if (frame.left < grid.scrollLeft + 8) grid.scrollLeft = Math.max(0, frame.left - 24)
    else if (frame.left + frame.width > viewRight - 8) {
      grid.scrollLeft = Math.max(0, frame.left + frame.width - grid.clientWidth + 24)
    }
    if (index >= 0) {
      const rowTop = index * ROW_HEIGHT
      const viewBottom = grid.scrollTop + grid.clientHeight
      if (rowTop < grid.scrollTop) grid.scrollTop = rowTop
      else if (rowTop + ROW_HEIGHT > viewBottom) grid.scrollTop = rowTop + ROW_HEIGHT - grid.clientHeight
    }
    if (timeRef.current) timeRef.current.scrollLeft = grid.scrollLeft
    if (channelScrollRef.current) channelScrollRef.current.scrollTop = grid.scrollTop
    setScrollTop(grid.scrollTop)
    setScrollLeft(grid.scrollLeft)
  }, [focused, focusedChannel?.number, pxPerMinute, startMs, tv.guideCursor, tv.visibleChannels])

  useLayoutEffect(() => {
    const target = bandJump.current
    const grid = gridRef.current
    if (target === null || !grid || target !== tv.guideCursor.channelNumber) return
    bandJump.current = null
    const index = tv.visibleChannels.findIndex((channel) => channel.number === target)
    if (index < 0) return
    grid.scrollTop = index * ROW_HEIGHT
    if (channelScrollRef.current) channelScrollRef.current.scrollTop = grid.scrollTop
    setScrollTop(grid.scrollTop)
    setBandAnchor({ channelNumber: target, scrollTop: grid.scrollTop })
  }, [tv.guideCursor, tv.visibleChannels])

  useEffect(() => {
    if (tv.visibleChannels.length === 0) return
    if (!tv.visibleChannels.some((channel) => channel.number === tv.guideCursor.channelNumber)) {
      tv.focusGuide(tv.visibleChannels[0].number, tv.guideCursor.timeMs)
    }
  }, [tv, tv.guideCursor.channelNumber, tv.guideCursor.timeMs, tv.visibleChannels])

  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const observer = new ResizeObserver(() => setViewport(grid.clientHeight))
    observer.observe(grid)
    return () => observer.disconnect()
  }, [])

  const onScroll = () => {
    const grid = gridRef.current
    if (!grid) return
    if (timeRef.current) timeRef.current.scrollLeft = grid.scrollLeft
    if (channelScrollRef.current) channelScrollRef.current.scrollTop = grid.scrollTop
    if (scrollFrame.current) return
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = 0
      const current = gridRef.current
      if (!current) return
      setScrollTop(current.scrollTop)
      setScrollLeft(current.scrollLeft)
      setViewport(current.clientHeight)
      setViewWidth(current.clientWidth)
      if (current.scrollLeft + current.clientWidth > current.scrollWidth - 360) tv.extendGuide('end')
      else if (current.scrollLeft < 36) tv.extendGuide('start')
    })
  }

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    const grid = gridRef.current
    if (!grid) return
    if (event.shiftKey && event.deltaY !== 0) {
      event.preventDefault()
      grid.scrollLeft += event.deltaY
    }
  }

  return (
    <section
      ref={sectionRef}
      className={closing ? 'guide is-closing' : 'guide'}
      role="dialog"
      aria-label="Television guide"
      aria-hidden={closing || undefined}
      inert={closing || undefined}
    >
      <header className="guide-top">
        <div className="guide-brand">
          <p className="guide-brand-kicker">Guide</p>
          <p className="guide-clock">
            {formatGuideDate(now)} {formatClock(now)}
          </p>
        </div>
        <div className="tabs" role="tablist" aria-label="Guide mode">
          {(
            [
              ['all', 'All'],
              ['user', 'TVN'],
              ['favourites', 'Favourites'],
            ] as const
          ).map(([filter, label]) => (
            <button
              key={filter}
              type="button"
              role="tab"
              aria-selected={tv.guideFilter === filter}
              className={tv.guideFilter === filter ? 'tab is-on' : 'tab'}
              onClick={() => tv.dispatch({ type: 'guide-filter', filter })}
            >
              {label}
            </button>
          ))}
        </div>
        <GuideSearch query={tv.guideQuery} onChange={tv.setGuideQuery} />
        <GuideActions
          tool={tool}
          picked={picked}
          onNow={() => tv.dispatch({ type: 'guide-now' })}
          onTool={(kind) => tv.dispatch({ type: 'guide-tool', tool: kind })}
        />
        <button type="button" className="tab guide-close" onClick={() => tv.dispatch({ type: 'cancel' })}>
          Close
        </button>
      </header>

      {tv.visibleChannels.length === 0 ? (
        <div className="guide-empty">
          <p>{searching ? 'No channels found' : emptyGuideCopy(tv.guideFilter)}</p>
          {addRow ? (
            <>
              <p className="guide-empty-note">Your User Network starts at {padChannel(USER_NUMBER_START)} and is kept in this browser.</p>
              <AddChannelForm nextNumber={nextNumber} onAdd={addLink} onFocus={openAddRow} inputRef={addInput} />
              <TestChannelsButton onLoad={tv.loadTestChannels} />
            </>
          ) : null}
        </div>
      ) : (
        <div className="guide-main">
          <div className="guide-channels">
            <div className="ch-head" style={{ height: TIME_HEADER_HEIGHT }}>
              <button
                type="button"
                className="ch-band"
                disabled={previousBand === null}
                onClick={() => jumpToBand(previousBand)}
                onKeyDown={keepBandKey}
                aria-label="Previous 100 channels"
                title={previousBand === null ? undefined : bandLabel(previousBand)}
              >
                ‹
              </button>
              <span>Ch</span>
              <button
                type="button"
                className="ch-band"
                disabled={nextBand === null}
                onClick={() => jumpToBand(nextBand)}
                onKeyDown={keepBandKey}
                aria-label="Next 100 channels"
                title={nextBand === null ? undefined : bandLabel(nextBand)}
              >
                ›
              </button>
              <input
                type="range"
                className="guide-zoom"
                min={GUIDE_ZOOM_MIN}
                max={GUIDE_ZOOM_MAX}
                step={GUIDE_ZOOM_STEP}
                value={tv.guideZoom}
                onChange={(event) => applyZoom(Number(event.target.value), null)}
                aria-label="Guide timeline zoom"
                aria-valuetext={`${tv.guideZoom.toFixed(1)}x`}
                title={`Timeline zoom ${tv.guideZoom.toFixed(1)}x`}
              />
            </div>
            <div
              className="channel-scroll"
              ref={channelScrollRef}
              onWheel={(event) => {
                if (gridRef.current) gridRef.current.scrollTop += event.deltaY
              }}
            >
              <div style={{ height: rowCount * ROW_HEIGHT, position: 'relative' }}>
                <div style={{ transform: `translateY(${range.start * ROW_HEIGHT}px)` }}>
                  {rows.map((channel) => (
                    <ChannelCell
                      key={channel.id}
                      channel={channel}
                      watching={channel.number === tv.channel.number}
                      selected={channel.number === tv.guideCursor.channelNumber}
                      userNetwork={channel.number >= 1001}
                      offAir={!isOnAir(channel)}
                      favourite={tv.favourites.includes(channel.number)}
                      onTune={() => tv.dispatch({ type: 'tune', channelNumber: channel.number })}
                      onEdit={
                        editorScope(channel)
                          ? () => tv.dispatch({ type: 'guide-tool', tool: 'edit', channelNumber: channel.number })
                          : undefined
                      }
                      onFavourite={() =>
                        tv.dispatch({ type: 'favourite', channelNumber: channel.number })
                      }
                    />
                  ))}
                </div>
                {addRow ? (
                  <div
                    className="channel-cell is-user add-cell"
                    style={{ position: 'absolute', top: tv.visibleChannels.length * ROW_HEIGHT, left: 0, right: 0, height: ROW_HEIGHT }}
                  >
                    <button type="button" className="ch-tune" onClick={openAddRow} aria-label={`Add a channel as ${padChannel(nextNumber)}`}>
                      <span className="ch-number">{padChannel(nextNumber)}</span>
                      <span className="ch-name">+ Add channel</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="guide-grid" ref={timelineRef}>
            <div className="time-scroll" ref={timeRef} style={{ height: TIME_HEADER_HEIGHT }}>
              <div className="time-inner" style={{ width }}>
                {ticks.map((tick) => {
                  const date = new Date(tick)
                  const midnight = date.getHours() === 0 && date.getMinutes() === 0
                  const x = timeX(tick, startMs, pxPerMinute)
                  const coveredByNow = Math.abs(x - nowX) < 42
                  return (
                    <div
                      key={tick}
                      className="tick"
                      style={{ left: x }}
                    >
                      {midnight && !coveredByNow ? <span className="tick-date">{formatGuideDate(tick)}</span> : null}
                      {coveredByNow ? null : <span>{formatClock(tick)}</span>}
                    </div>
                  )
                })}
                <div className="now-flag" style={{ left: nowX }}>
                  Now
                </div>
              </div>
            </div>
            <div className="grid-scroll" ref={gridRef} onScroll={onScroll} onWheel={onWheel}>
              <div
                className="grid-canvas"
                style={{
                  width,
                  height: rowCount * ROW_HEIGHT,
                  backgroundSize: `${30 * pxPerMinute}px 100%`,
                  backgroundPositionX: gridOffset,
                }}
              >
                <div style={{ transform: `translateY(${range.start * ROW_HEIGHT}px)` }}>
                  {rows.map((channel) => (
                    <ProgrammeRow
                      key={channel.id}
                      channel={channel}
                      slots={slotsById.get(channel.id) ?? []}
                      playing={channel.number === tv.channel.number ? playingSlot : null}
                      windowStart={startMs}
                      pxPerMinute={pxPerMinute}
                      now={now}
                      scrollLeft={scrollLeft}
                      viewWidth={viewWidth}
                      cursorTime={
                        tv.guideCursor.channelNumber === channel.number ? tv.guideCursor.timeMs : null
                      }
                      onFocus={(timeMs) => tv.focusGuide(channel.number, timeMs)}
                      onActivate={() => tv.activateGuide()}
                    />
                  ))}
                </div>
                {addRow ? (
                  <div className="add-row" style={{ top: tv.visibleChannels.length * ROW_HEIGHT, height: ROW_HEIGHT, left: scrollLeft + 8, width: Math.max(260, viewWidth - 16) }}>
                    <AddChannelForm nextNumber={nextNumber} onAdd={addLink} onFocus={openAddRow} inputRef={addInput} />
                  </div>
                ) : null}
                <div className="now-line" style={{ left: nowX }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {tool === 'edit' && focusedChannel && editScope ? (
        <ChannelEditor
          key={focusedChannel.number}
          channel={focusedChannel}
          scope={editScope}
          onLoad={tv.openChannelEdit}
          onSave={tv.saveChannelEdit}
          onRescan={tv.rescanChannelEdit}
          onDelete={editScope === 'curated' ? tv.restoreCuratedChannel : tv.deleteUserChannel}
          onClose={() => tv.dispatch({ type: 'guide-tool', tool: 'edit' })}
        />
      ) : tool === 'import' ? (
        <SessionImportTools onImport={tv.importSession} />
      ) : tool === 'add' ? (
        <UserNetworkTools
          userChannels={userNumbers.length}
          onImportList={importList}
          onLoadTest={tv.loadTestChannels}
          onRemoveStarter={tv.removeStarterNetwork}
          onRemoveAll={() => tv.removeUserChannels('all')}
        />
      ) : sessionMatches.length > 0 ? (
        <SessionMatches matches={sessionMatches} onPlay={tv.playSession} />
      ) : (
        <ProgrammePanel
          channel={focusedChannel}
          slot={focused}
          next={followingSlot}
          now={now}
          note={tv.guideNote}
          onPrev={precedingSlot ? () => tv.dispatch({ type: 'nav', direction: 'left' }) : undefined}
          onNext={followingSlot ? () => tv.dispatch({ type: 'nav', direction: 'right' }) : undefined}
          history={historyActions(tv)}
          corners={cornerActions(tv)}
          channels={channelActions(tv)}
          onEdit={
            focusedChannel && editScope
              ? () => tv.dispatch({ type: 'guide-tool', tool: 'edit', channelNumber: focusedChannel.number })
              : undefined
          }
        />
      )}
    </section>
  )
}

function ChannelCell({
  channel,
  watching,
  selected,
  userNetwork,
  offAir,
  favourite,
  onTune,
  onEdit,
  onFavourite,
}: {
  channel: Channel
  watching: boolean
  selected: boolean
  userNetwork: boolean
  offAir: boolean
  favourite: boolean
  onTune: () => void
  /** Present when this channel can be edited: right-click or a long press opens its editor. */
  onEdit?: () => void
  onFavourite: () => void
}) {
  const editRef = useRef(onEdit)
  editRef.current = onEdit
  const [press] = useState(() => createLongPress(() => editRef.current?.()))
  const point = (event: PointerEvent<HTMLButtonElement>) => ({ pointerType: event.pointerType, clientX: event.clientX, clientY: event.clientY })
  return (
    <div
      className={`channel-cell${selected ? ' is-selected' : ''}${watching ? ' is-watching' : ''}${userNetwork ? ' is-user' : ''}${offAir ? ' is-off-air' : ''}`}
      style={{ height: ROW_HEIGHT }}
    >
      <button
        type="button"
        className="ch-tune"
        onClick={() => {
          // The lift that ends a hold opened the editor; it is not a tune.
          if (!press.swallowClick()) onTune()
        }}
        onContextMenu={(event: MouseEvent<HTMLButtonElement>) => {
          if (!onEdit) return
          event.preventDefault()
          press.opened()
          onEdit()
        }}
        onPointerDown={(event) => (onEdit ? press.down(point(event)) : undefined)}
        onPointerMove={(event) => press.move(point(event))}
        onPointerUp={press.up}
        onPointerCancel={press.cancel}
        onPointerLeave={press.cancel}
        title={offAir ? `${channel.name} · Off air` : undefined}
        aria-label={`${padChannel(channel.number)} ${channel.name}${offAir ? ', off air' : ''}`}
      >
        <span className="ch-number">{padChannel(channel.number)}</span>
        <span className="ch-name">{channel.name}</span>
      </button>
      <button
        type="button"
        className={favourite ? 'star is-on' : 'star'}
        onClick={(event) => {
          event.stopPropagation()
          onFavourite()
        }}
        aria-pressed={favourite}
      >
        <span aria-hidden="true">{favourite ? '★' : '☆'}</span>
        <span className="sr">
          {favourite ? 'Remove favourite' : 'Add favourite'} {padChannel(channel.number)}
        </span>
      </button>
    </div>
  )
}

/** The slot the watched channel is playing: the airing one, a picked one's place in the schedule, or none in view. */
type PlayingSlot = 'airing' | { startMs: number } | null

function ProgrammeRow({
  channel,
  slots,
  playing,
  windowStart,
  pxPerMinute,
  now,
  scrollLeft,
  viewWidth,
  cursorTime,
  onFocus,
  onActivate,
}: {
  channel: Channel
  slots: readonly GuideSlot<Programme>[]
  /** Only for the channel being watched. */
  playing: PlayingSlot
  windowStart: number
  pxPerMinute: number
  now: number
  scrollLeft: number
  viewWidth: number
  cursorTime: number | null
  onFocus: (timeMs: number) => void
  onActivate: () => void
}) {
  const leftBound = scrollLeft - 280
  const rightBound = scrollLeft + viewWidth + 280
  return (
    <div className="prog-row" style={{ height: ROW_HEIGHT }} data-channel={channel.number}>
      {slots.map((slot) => {
        const frame = slotFrame(slot.startMs, slot.endMs, windowStart, pxPerMinute)
        const selected = cursorTime !== null && cursorTime >= slot.startMs && cursorTime < slot.endMs
        if (!selected && (frame.left + frame.width < leftBound || frame.left > rightBound)) return null
        const inset = Math.min(
          Math.max(0, scrollLeft - frame.left + 8),
          Math.max(0, frame.width - 28),
        )
        const flags = programmeFlags(slot.startMs, slot.endMs, now, cursorTime)
        const holding = !hasPicture(slot.programme)
        const isPlaying = playing === 'airing' ? flags.airing : playing !== null && playing.startMs === slot.startMs
        return (
          <div
            key={`${slot.programme.id}-${slot.startMs}`}
            className={`prog${flags.airing ? ' is-live' : ''}${isPlaying ? ' is-playing' : ''}${flags.past ? ' is-past' : ''}${flags.selected ? ' is-focused' : ''}${holding ? ' is-holding' : ''}`}
            style={{ left: frame.left, width: frame.width, paddingLeft: inset }}
            role="button"
            tabIndex={-1}
            aria-label={`${slot.programme.title}, ${isLiveStream(slot.programme) ? 'live' : formatRange(slot.startMs, slot.endMs)}`}
            aria-pressed={flags.selected}
            data-airing={flags.airing ? 'true' : 'false'}
            data-selected={flags.selected ? 'true' : 'false'}
            onClick={() => {
              if (flags.selected) onActivate()
              else onFocus(slot.startMs + 1)
            }}
            onDoubleClick={() => {
              onFocus(slot.startMs + 1)
              onActivate()
            }}
          >
            {frame.width > 72 ? <span className="prog-title">{slot.programme.title}</span> : null}
            {frame.width > 168 ? (
              <span className="prog-time">{isLiveStream(slot.programme) ? 'Live' : formatRange(slot.startMs, slot.endMs)}</span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function ProgrammePanel({
  channel,
  slot,
  next,
  now,
  note,
  onPrev,
  onNext,
  history,
  corners,
  channels,
  onEdit,
}: {
  channel: Channel | null
  slot: GuideSlot<Programme> | null
  /** The programme after this one on the channel, for the Next line. */
  next: GuideSlot<Programme> | null
  now: number
  note: 'later' | 'ended' | null
  /** Moves the Guide back to the previous programme. */
  onPrev?: () => void
  /** Moves the Guide on to the next programme. */
  onNext?: () => void
  history: HistoryActions
  corners: CornerActions
  channels: ChannelActions
  /** Present when the channel can be edited: a right-click or a hold on the bar, apart from its buttons, opens its editor. */
  onEdit?: () => void
}) {
  const { handlers } = useEditPress(onEdit)
  if (!channel || !slot) {
    return (
      <footer className="guide-info">
        <p className="info-title">No programme selected</p>
      </footer>
    )
  }

  const live = now >= slot.startMs && now < slot.endMs
  const later = now < slot.startMs
  const alert = (note === 'later' && later) || (note === 'ended' && !live && !later)

  return (
    <footer className="guide-info is-programme" {...handlers} onPointerLeave={handlers.onPointerCancel}>
      <ProgrammeInfo
        channel={channel}
        programme={slot.programme}
        startMs={slot.startMs}
        endMs={slot.endMs}
        now={now}
        alert={alert}
        next={next ? { title: next.programme.title, startMs: next.startMs, endMs: next.endMs } : undefined}
      />
      <InfoActions
        key={channel.number}
        channel={channel}
        programme={slot.programme}
        onPrev={onPrev}
        onNext={onNext}
        history={history}
        corners={corners}
        channels={channels}
      />
    </footer>
  )
}

/** The bundled starter network, offered again while the viewer's own User Network is empty. */
function TestChannelsButton({ onLoad }: { onLoad: () => Promise<string> }) {
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <p className="guide-empty-test">
      <button
        type="button"
        className="tab"
        disabled={busy}
        onKeyDown={keepBandKey}
        onClick={() => {
          setBusy(true)
          void onLoad()
            .then(setNote, (caught: unknown) => setNote(caught instanceof Error ? caught.message.toUpperCase() : 'THAT DID NOT WORK'))
            .finally(() => setBusy(false))
        }}
      >
        {busy ? 'Loading…' : 'Add starter network'}
      </button>
      {note ? <span role="status"> {note}</span> : null}
    </p>
  )
}

/** Search results on the session channel: imported titles, each a Play Now. */
function SessionMatches({ matches, onPlay }: { matches: readonly Programme[]; onPlay: (programmeId: string) => void }) {
  const shown = matches.slice(0, 6)
  return (
    <footer className="guide-info guide-matches">
      <div className="info-main">
        <p className="info-kicker">
          <span className="info-net">Session</span>
          <span>{padChannel(SESSION_CHANNEL.number)}</span>
          <span>{SESSION_CHANNEL.name}</span>
          <span>
            {matches.length} {matches.length === 1 ? 'match' : 'matches'}
          </span>
        </p>
        <ul className="match-list">
          {shown.map((programme) => (
            <li key={programme.id}>
              <button type="button" className="match" onClick={() => onPlay(programme.id)} onKeyDown={keepBandKey}>
                <span className="match-title">{programme.title}</span>
                <span className="match-time">{formatDuration(programme.durationSeconds)}</span>
                <span className="match-play">Play now</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  )
}

/** Enter and Space press the band button rather than confirming (and tuning) the guide cursor. */
function keepBandKey(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
}

function GuideSearch({ query, onChange }: { query: string; onChange: (query: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className={query ? 'guide-search is-on' : 'guide-search'} role="search">
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder="Search"
        aria-label="Search guide channels"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            if (query) onChange('')
            else event.currentTarget.blur()
          } else if (event.key === 'Enter') {
            event.currentTarget.blur()
          }
        }}
      />
      {query ? (
        <button
          type="button"
          className="guide-search-clear"
          aria-label="Clear search"
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  )
}

function emptyGuideCopy(filter: string): string {
  if (filter === 'favourites') return 'No favourite channels'
  if (filter === 'user') return 'No user channels'
  return 'No channels'
}

/** Pinch over the Guide timeline zooms the timeline; the listeners come and go with the timeline. */
function useTimelinePinch(
  timelineRef: RefObject<HTMLDivElement | null>,
  attached: boolean,
  zoomBase: () => number,
  requestZoom: (zoom: number, offsetPx: number) => void,
) {
  const handlers = useRef<TimelinePinchHandlers>({ zoomBase, requestZoom })
  useLayoutEffect(() => {
    handlers.current = { zoomBase, requestZoom }
  })

  useEffect(() => {
    const timeline = timelineRef.current
    if (!attached || !timeline) return
    return bindTimelinePinch(timeline, () => handlers.current)
  }, [attached, timelineRef])
}

function initialPxPerMinute(): number {
  if (typeof window === 'undefined') return 8
  const width = window.innerWidth
  return width < 720 ? 4.6 : width < 1100 ? 6.2 : 8
}

function usePxPerMinute(): number {
  const [px, setPx] = useState(initialPxPerMinute)

  useEffect(() => {
    const apply = () => {
      const width = window.innerWidth
      setPx(width < 720 ? 4.6 : width < 1100 ? 6.2 : 8)
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [])

  return px
}
