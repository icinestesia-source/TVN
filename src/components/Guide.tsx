import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject, type WheelEvent } from 'react'
import {
  ROW_HEIGHT,
  TIME_HEADER_HEIGHT,
  centredScrollTop,
  openScrollLeft,
  basePxPerMinute,
  TITLE_MIN_PX,
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
  keyZoomAnchor,
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
import { hasPicture, searchSession, SESSION_CHANNEL, SESSION_CHANNEL_NUMBER, sessionProgrammes } from '../session/session-channel.ts'
import { TvnChannelPanel } from './TvnChannelPanel.tsx'
import { channelActions, cornerActions, type ChannelActions, type CornerActions } from '../view/info-shortcuts.ts'
import { historyActions, InfoActions, type HistoryActions } from './InfoActions.tsx'
import { ProgrammeInfo } from './ProgrammeInfo.tsx'
import { GuideOptions } from './GuideOptions.tsx'
import { loadGuideActionsAll, saveGuideActionsAll } from '../view/guide-actions-store.ts'
import { NetworkEditor } from './NetworkEditor.tsx'
import { GuidePanel } from './GuidePanel.tsx'
import { AddChannelForm, GuideActions, NewUserTools, SessionImportTools, UserNetworkImportTools, UserNetworkTools } from './GuideAdd.tsx'
import { filterUserId, freeUserName, TVN_OWNER, userFilter, userNetworkName } from '../data/user-network/users.ts'
import { ChannelEditor } from './ChannelEditor.tsx'
import { useEditPress } from './use-edit-press.ts'
import { createLongPress, editorScope } from '../view/channel-edit.ts'
import { isLiveStream } from '../dynamic/stream.ts'
import { manualAiring } from '../player/manual.ts'
import { parseChannelsExport } from '../services/channels-import.ts'
import { channelLinksFrom } from '../services/user-network.ts'
import { USER_NETWORK_FORMAT } from '../services/user-network-export.ts'
import { CHANNEL_FILE_FORMAT } from '../services/channel-file.ts'
import { isLowUserNumber, LOW_USER_FIRST, LOW_USER_LAST, USER_NUMBER_START } from '../data/network.ts'
import { currentNetworkBase, subChannelsOf } from '../data/user-overlay.ts'
import { guideLayout, loadOpenSubChannels, rowIndexOf, saveOpenSubChannels } from '../view/sub-channels-store.ts'
import { channelByNumber, listChannels } from '../data/catalogue.ts'
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
  // ADD's footer stands at the height of the programme information it replaces.
  useLayoutEffect(() => {
    const section = sectionRef.current
    const info = section?.querySelector<HTMLElement>('.guide-info.is-programme')
    if (section && info) section.style.setProperty('--programme-info-h', `${info.offsetHeight}px`)
  })
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

  /** Zoom to `next`, holding the time at `offsetPx` across the timeline; null holds the picked programme or the NOW line. */
  const applyZoom = (next: number, offsetPx: number | null) => {
    const grid = gridRef.current
    const zoom = clampZoom(next)
    if (!grid || zoom === drawn.current.zoom) return
    zoomAnchor.current =
      offsetPx === null ? null : { timeMs: anchorTime(grid.scrollLeft, offsetPx, drawn.current.startMs, drawn.current.px), offsetPx }
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
  // "+" on a channel with two or more sources lists each source under it as a sub-channel with its own schedule.
  const [openSubs, setOpenSubs] = useState(loadOpenSubChannels)
  const toggleSubs = (channelId: string) =>
    setOpenSubs((current) => {
      const next = new Set(current)
      if (next.has(channelId)) next.delete(channelId)
      else next.add(channelId)
      saveOpenSubChannels(next)
      return next
    })
  // "+" pressed on a row shows that channel's own rows, not the selected programme's channel.
  const subsPressed = useRef<number | null>(null)
  const pressSubs = (channel: Channel) => {
    subsPressed.current = channel.number
    toggleSubs(channel.id)
  }
  const layout = useMemo(() => guideLayout(tv.visibleChannels, openSubs, subChannelsOf), [tv.visibleChannels, openSubs])
  const range = visibleRowRange(scrollTop, viewport, ROW_HEIGHT, layout.length, 6)
  const rows = layout.slice(range.start, range.end)

  const slotsById = useMemo(() => {
    const map = new Map<string, GuideSlot<Programme>[]>()
    for (const row of layout.slice(range.start, range.end)) {
      map.set(row.channel.id, guideSlots(row.channel, startMs, endMs))
    }
    return map
  }, [endMs, range.end, range.start, startMs, layout])

  const focusedChannel =
    tv.visibleChannels.find((channel) => channel.number === tv.guideCursor.channelNumber) ?? null
  const focusedSlots = useMemo(
    () => (focusedChannel ? guideSlots(focusedChannel, startMs, endMs) : []),
    // The channel list is rebuilt when the session channel's running order changes; its slots follow it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [endMs, focusedChannel, startMs, tv.visibleChannels],
  )
  const focused = slotContaining(focusedSlots, tv.guideCursor.timeMs)
  // The cursor the Guide opened on, or NOW last put back: anything else is a programme the viewer picked.
  const restingCursor = useRef(tv.guideCursor)
  const chosenSlot = tv.guideCursor !== restingCursor.current ? focused : null
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
  const userChannels = listChannels().filter((channel) => channel.number >= USER_NUMBER_START)
  const userNumbers = userChannels.map((channel) => channel.number)
  // A new channel fills the lowest empty slot before opening a number after the last.
  const nextNumber =
    userChannels.find((channel) => channel.emptySlot)?.number ?? (userNumbers.length > 0 ? Math.max(...userNumbers) + 1 : USER_NUMBER_START)
  // A network of the viewer's own (NEW USER) has no TVN channels, so its own channels may also start at 001.
  const nextLowNumber = (() => {
    if (currentNetworkBase() !== 'new') return null
    const listed = listChannels()
    const empty = listed.find((channel) => channel.emptySlot && isLowUserNumber(channel.number))
    if (empty) return empty.number
    const used = new Set(listed.map((channel) => channel.number))
    for (let number = LOW_USER_FIRST; number <= LOW_USER_LAST; number += 1) if (!used.has(number)) return number
    return null
  })()
  // The + row (ADD USER CHANNEL) closes the list wherever the whole User Network is listed. It is a control,
  // not a channel: it has no number and allocates nothing until a source is imported.
  const owner = filterUserId(tv.guideFilter) ?? undefined
  const addRow = !searching && (tv.guideFilter === 'all' || tv.guideFilter === 'user' || owner !== undefined)
  const rowCount = layout.length + (addRow ? 1 : 0)
  const addInput = useRef<HTMLInputElement>(null)
  // MEDIA, IMPORT and ADD hold only while the Guide cursor is where they put it; moving on returns to the listings.
  // GUIDE (the viewer's viewing Guides) stays open while the cursor roams the grid to add to it.
  const tool =
    tv.guideTool && (tv.guideTool.kind === 'guides' || tv.guideTool.kind === 'editor' || tv.guideTool.cursor === tv.guideCursor) ? tv.guideTool.kind : null
  // A channel opened from the Network Editor is edited over it, and closing the Channel Editor goes back to it.
  const [fromEditor, setFromEditor] = useState(false)
  const lastTool = useRef(tool)
  useEffect(() => {
    const was = lastTool.current
    lastTool.current = tool
    if (!fromEditor || was === tool) return
    if (tool === null && was === 'edit') {
      setFromEditor(false)
      tv.dispatch({ type: 'guide-tool', tool: 'editor' })
    } else if (tool !== 'edit' && tool !== 'editor') setFromEditor(false)
  }, [fromEditor, tool, tv])
  const editFromNetwork = (channelNumber: number) => {
    setFromEditor(true)
    tv.dispatch({ type: 'guide-tool', tool: 'edit', channelNumber })
  }
  const networkShown = tool === 'editor' || (fromEditor && tool === 'edit')
  const following = tv.guideRun?.state === 'active'
  // Each right-click or hold on GUIDE asks the Guide panel to make CREATE GUIDE FROM… ready.
  const [addMenu, setAddMenu] = useState<AddMenu | null>(null)
  const [addNote, setAddNote] = useState<string | null>(null)
  // A channel's own action (LATEST FIRST, RELOAD, DELETE) in progress, and what it said.
  const [channelBusy, setChannelBusy] = useState<number | null>(null)
  const [actionsAll, setActionsAll] = useState(loadGuideActionsAll)
  const toggleActions = () =>
    setActionsAll((all) => {
      saveGuideActionsAll(!all)
      return !all
    })
  const channelAction = (number: number, action: (channelNumber: number) => Promise<string>, then?: () => void) => {
    if (channelBusy !== null) return
    setChannelBusy(number)
    setAddNote(`${padChannel(number)} · WORKING…`)
    action(number)
      .then(
        (message) => {
          setAddNote(message)
          then?.()
        },
        (caught: unknown) => setAddNote(caught instanceof Error && caught.message ? caught.message.toUpperCase().slice(0, 110) : 'THAT DID NOT WORK'),
      )
      .finally(() => setChannelBusy(null))
  }
  useEffect(() => {
    if (!addNote) return
    const id = window.setTimeout(() => setAddNote(null), 2200)
    return () => window.clearTimeout(id)
  }, [addNote])
  const guideMarks = useMemo(() => {
    const marks = new Map<string, 'queued' | 'active'>()
    const current = tv.guideLibrary.current
    for (const item of current?.items ?? []) marks.set(`${item.channelNumber}:${item.programme.id}`, 'queued')
    const run = tv.guideRun
    const playing = run?.state === 'active' ? run.guide.items[run.index] : undefined
    if (playing) marks.set(`${playing.channelNumber}:${playing.programme.id}`, 'active')
    return marks
  }, [tv.guideLibrary, tv.guideRun])
  const addToGuide = (menu: AddMenu) => {
    setAddMenu(null)
    try {
      setAddNote(tv.addToGuide(menu.channelNumber, menu.programme))
    } catch (caught) {
      const text = caught instanceof Error ? caught.message.trim() : ''
      setAddNote(text && text.length <= 90 ? text.toUpperCase() : 'THAT CANNOT JOIN A GUIDE')
    }
  }
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

  const newChannel = async (low = false) => {
    const number = await tv.createEmptyChannel(low)
    tv.dispatch({ type: 'guide-tool', tool: 'edit', channelNumber: number })
  }
  const restoreNetwork = () => tv.dispatch({ type: 'guide-tool', tool: 'network' })

  const addLink = async (link: string) => {
    const result = await tv.addChannel(link, owner)
    if (result.number !== null) tv.focusGuide(result.number, Date.now())
    return result.message
  }

  const addMany = async (links: readonly string[], onProgress: (done: number, total: number) => void) => {
    const result = await tv.addChannels(links, owner, onProgress)
    if (result.numbers.length > 0) tv.focusGuide(Math.min(...result.numbers), Date.now())
    return result
  }

  /** The combined channel opens with its sub-channels shown, one per playlist. */
  const combine = async (name: string, playlists: readonly { url: string; title: string }[], onProgress: (done: number, total: number) => void) => {
    const result = await tv.addCombinedChannel(name, playlists, owner, onProgress)
    const made = channelByNumber(result.number)
    if (made && !openSubs.has(made.id)) toggleSubs(made.id)
    tv.focusGuide(result.number, Date.now())
    return result
  }

  const importList = async (file: File, listOwner = owner) => {
    const text = await file.text()
    if (text.includes(USER_NETWORK_FORMAT)) throw new Error('A User Network file: use OPTIONS then RESTORE to restore it')
    if (text.includes(CHANNEL_FILE_FORMAT)) {
      const imported = await tv.importChannelFile(text, listOwner ?? TVN_OWNER)
      tv.focusGuide(imported.number, Date.now())
      return imported.message
    }
    const links = channelLinksFrom(text)
    if (!links) {
      const parsed = parseChannelsExport(text)
      await tv.applyImport(parsed, { library: true, automatic: true }, { filename: file.name, owner: listOwner })
      return `${parsed.sources.length} ${parsed.sources.length === 1 ? 'CHANNEL' : 'CHANNELS'} IMPORTED`
    }
    let added = 0
    const failed: string[] = []
    for (const link of links) {
      try {
        await tv.addChannel(link, listOwner)
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

  const createUser = (name: string) => {
    const user = tv.createNetworkUser(name)
    return `${user.name} ADDED · ADD CHANNELS TO IT WITH + ADD CHANNEL`
  }
  const [newUserName, setNewUserName] = useState('')
  const [newUserNote, setNewUserNote] = useState<string | null>(null)
  useEffect(() => {
    if (tool === 'users') return
    setNewUserName('')
    setNewUserNote(null)
  }, [tool])
  // + while its panel is open: a typed name becomes the new user; with no name the panel just closes.
  const pressPlus = () => {
    if (tool === 'users' && newUserName.trim()) {
      try {
        tv.createNetworkUser(newUserName, true)
      } catch (caught) {
        // A refused name explains itself (checkUserName); anything else is a plain failure.
        setNewUserNote(caught instanceof Error && caught.message ? caught.message.toUpperCase() : 'THAT USER COULD NOT BE CREATED')
      }
      return
    }
    tv.dispatch({ type: 'guide-tool', tool: 'users' })
  }
  // A channel list from + becomes a new user named after the file, and its tab opens.
  const importListAsUser = async (file: File) => {
    const user = tv.createNetworkUser(freeUserName(file.name.replace(/\.[^.]+$/, ''), tv.networkUsers))
    const message = await importList(file, user.id)
    tv.dispatch({ type: 'guide-filter', filter: userFilter(user.id) })
    return `${user.name} · ${message}`
  }
  const sessionMatches = searching && focusedChannel?.origin === 'session' ? searchSession(tv.guideQuery, focusedChannel.number) : []
  const mediaChannel = (tool === 'media' && focusedChannel?.origin === 'session' ? focusedChannel : null) ?? channelByNumber(SESSION_CHANNEL_NUMBER) ?? SESSION_CHANNEL
  const numbers = useMemo(() => layout.map((row) => (row.kind === 'sub' ? row.parent.number : row.channel.number)), [layout])
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
    const index = rowIndexOf(layout, tv.guideCursor.channelNumber)
    if (index >= 0) grid.scrollTop = centredScrollTop(index, ROW_HEIGHT, grid.clientHeight, layout.length)
    if (timeRef.current) timeRef.current.scrollLeft = grid.scrollLeft
    if (channelScrollRef.current) channelScrollRef.current.scrollTop = grid.scrollTop
    setScrollTop(grid.scrollTop)
    setScrollLeft(grid.scrollLeft)
    setViewport(grid.clientHeight)
    setViewWidth(grid.clientWidth)
    // Position once when the guide opens. Later movement is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // OPTIONS, the Network Editor (or a filter with nothing in it) take the listings away; they come back where they were.
  const gridShown = tool !== 'options' && !networkShown && tv.visibleChannels.length > 0
  const gridHidden = useRef(false)
  useLayoutEffect(() => {
    if (!gridShown) {
      gridHidden.current = true
      return
    }
    const grid = gridRef.current
    if (!grid || !gridHidden.current) return
    gridHidden.current = false
    grid.scrollLeft = scrollLeft
    grid.scrollTop = scrollTop
    if (timeRef.current) timeRef.current.scrollLeft = grid.scrollLeft
    if (channelScrollRef.current) channelScrollRef.current.scrollTop = grid.scrollTop
    setScrollTop(grid.scrollTop)
    setScrollLeft(grid.scrollLeft)
    setViewport(grid.clientHeight)
    setViewWidth(grid.clientWidth)
    // Only the listings coming back restores them; scrolling meanwhile is handled above and below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridShown])

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
    const { timeMs, offsetPx } =
      anchor ?? keyZoomAnchor({ scrollLeft: grid.scrollLeft, clientWidth: grid.clientWidth, windowStartMs: before.startMs, pxPerMinute: before.px }, Date.now(), chosenSlot)
    grid.scrollLeft = anchoredScrollLeft(timeMs, offsetPx, startMs, pxPerMinute)
    prevStart.current = startMs
    // A zoom, aimed by pinch or pressed as - / =, keeps the listings where the viewer had them: the time at the
    // anchor stays put and the rows do not move. Only NOW (its own effect below) brings the playing channel back.
    zoomHeld.current = true
    if (timeRef.current) timeRef.current.scrollLeft = grid.scrollLeft
    setScrollLeft(grid.scrollLeft)
    setViewWidth(grid.clientWidth)
    // Only a new scale moves the listings; the pick it holds is read as it stands then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const pressed = subsPressed.current
    if (pressed !== null) {
      subsPressed.current = null
      if (!grid) return
      const index = rowIndexOf(layout, pressed)
      if (index < 0) return
      let rows = 1
      while (layout[index + rows]?.kind === 'sub') rows += 1
      const rowTop = index * ROW_HEIGHT
      const blockBottom = Math.min(rowTop + rows * ROW_HEIGHT, rowTop + grid.clientHeight)
      if (blockBottom > grid.scrollTop + grid.clientHeight) grid.scrollTop = blockBottom - grid.clientHeight
      if (rowTop < grid.scrollTop) grid.scrollTop = rowTop
      if (channelScrollRef.current) channelScrollRef.current.scrollTop = grid.scrollTop
      setScrollTop(grid.scrollTop)
      return
    }
    if (!grid || !focused) return
    const index = rowIndexOf(layout, focusedChannel?.number ?? Number.NaN)
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
  }, [focused, focusedChannel?.number, pxPerMinute, startMs, tv.guideCursor, layout])

  // NOW centres the channel playing, with the current time in view as when the Guide opens.
  const nowAsked = useRef(tv.guideNowAsk)
  useLayoutEffect(() => {
    if (nowAsked.current === tv.guideNowAsk) return
    nowAsked.current = tv.guideNowAsk
    restingCursor.current = tv.guideCursor
    const grid = gridRef.current
    if (!grid) return
    grid.scrollLeft = openScrollLeft(Date.now(), startMs, pxPerMinute, grid.clientWidth)
    const index = rowIndexOf(layout, tv.guideCursor.channelNumber)
    if (index >= 0) grid.scrollTop = centredScrollTop(index, ROW_HEIGHT, grid.clientHeight, layout.length)
    if (timeRef.current) timeRef.current.scrollLeft = grid.scrollLeft
    if (channelScrollRef.current) channelScrollRef.current.scrollTop = grid.scrollTop
    setScrollTop(grid.scrollTop)
    setScrollLeft(grid.scrollLeft)
  }, [tv.guideNowAsk, tv.guideCursor, layout, startMs, pxPerMinute])

  useLayoutEffect(() => {
    const target = bandJump.current
    const grid = gridRef.current
    if (target === null || !grid || target !== tv.guideCursor.channelNumber) return
    bandJump.current = null
    const index = rowIndexOf(layout, target)
    if (index < 0) return
    grid.scrollTop = index * ROW_HEIGHT
    if (channelScrollRef.current) channelScrollRef.current.scrollTop = grid.scrollTop
    setScrollTop(grid.scrollTop)
    setBandAnchor({ channelNumber: target, scrollTop: grid.scrollTop })
  }, [tv.guideCursor, layout])

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
              ['user', userNetworkName(undefined, tv.networkUsers)],
              ...tv.networkUsers.map((user) => [userFilter(user.id), user.name] as const),
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
          <button
            type="button"
            className={tool === 'users' ? 'tab guide-plus is-on' : 'tab guide-plus'}
            aria-pressed={tool === 'users'}
            aria-label="New user or import a channel list"
            title="New user or import a channel list"
            onClick={pressPlus}
          >
            +
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tv.guideFilter === 'favourites'}
            className={tv.guideFilter === 'favourites' ? 'tab is-on' : 'tab'}
            onClick={() => tv.dispatch({ type: 'guide-filter', filter: 'favourites' })}
          >
            Fav
          </button>
        </div>
        <GuideSearch query={tv.guideQuery} onChange={tv.setGuideQuery} />
        <GuideActions
          tool={tool}
          picked={picked}
          following={following}
          onNow={() => tv.dispatch({ type: 'guide-now' })}
          onClose={() => tv.dispatch({ type: 'cancel' })}
          onTool={(kind) => tv.dispatch({ type: 'guide-tool', tool: kind })}
        />
        <button type="button" className="tab guide-close" onClick={() => tv.dispatch({ type: 'cancel' })}>
          Close
        </button>
      </header>

      {tool === 'options' ? (
        <GuideOptions />
      ) : networkShown ? (
        <NetworkEditor onEdit={editFromNetwork} />
      ) : tv.visibleChannels.length === 0 ? (
        <div className="guide-empty">
          <p>{searching ? 'No channels found' : emptyGuideCopy(tv.guideFilter)}</p>
          {addRow ? (
            <>
              <p className="guide-empty-note">Your User Network starts at {padChannel(USER_NUMBER_START)} and is kept in this browser.</p>
              <AddChannelForm nextNumber={nextNumber} onAdd={addLink} onPreview={tv.previewSource} onAddMany={addMany} onCombine={combine} onNewChannel={() => newChannel()} nextLowNumber={nextLowNumber} onNewLowChannel={() => newChannel(true)} onFocus={openAddRow} inputRef={addInput} />
              {owner ? null : <TestChannelsButton onLoad={tv.loadTestChannels} />}
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
                  {rows.map((row) => {
                    const channel = row.channel
                    if (row.kind === 'sub') return <SubChannelCell key={channel.id} channel={channel} parent={row.parent} onWatch={() => tv.playSubChannel(channel)} />
                    const subs = subChannelsOf(channel.id).length
                    return (
                    <ChannelCell
                      key={channel.id}
                      channel={channel}
                      subChannels={subs}
                      subsOpen={openSubs.has(channel.id)}
                      onSubs={() => pressSubs(channel)}
                      watching={channel.number === tv.channel.number}
                      visiting={channel.number === tv.guideVisiting}
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
                      live={channel.liveFromMs !== undefined}
                      busy={channelBusy === channel.number}
                      arranged={channel.arranged}
                      onArrange={
                        editorScope(channel) && channel.origin !== 'session'
                          ? (how) =>
                              channelAction(
                                channel.number,
                                (number) => tv.arrangeChannel(number, how),
                                // LATEST switched on goes to its very latest programme; the others stay in the Guide to show the new schedule.
                                how === 'latest' && channel.liveFromMs === undefined ? () => tv.dispatch({ type: 'cancel' }) : undefined,
                              )
                          : undefined
                      }
                      onDelete={editorScope(channel) === 'user' ? () => channelAction(channel.number, tv.deleteUserChannel) : undefined}
                      expanded={actionsAll}
                      onExpand={toggleActions}
                    />
                    )
                  })}
                </div>
                {addRow ? (
                  <div
                    className="channel-cell is-user add-cell"
                    style={{ position: 'absolute', top: layout.length * ROW_HEIGHT, left: 0, right: 0, height: ROW_HEIGHT }}
                  >
                    <button type="button" className="ch-tune" onClick={openAddRow} aria-label={`Add a channel as ${padChannel(nextNumber)}`} data-add-row="">
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
                  {rows.map((row) => {
                    const channel = row.channel
                    const slots = slotsById.get(channel.id) ?? []
                    if (row.kind === 'sub') {
                      return (
                        <ProgrammeRow
                          key={channel.id}
                          channel={channel}
                          sub
                          slots={slots}
                          playing={null}
                          windowStart={startMs}
                          pxPerMinute={pxPerMinute}
                          now={now}
                          scrollLeft={scrollLeft}
                          viewWidth={viewWidth}
                          cursorTime={null}
                          onFocus={(timeMs) => {
                            const slot = slotContaining(slots, timeMs)
                            if (slot) tv.playSubChannel(channel, { startMs: slot.startMs, endMs: slot.endMs, programmeId: slot.programme.id })
                          }}
                          onActivate={() => {}}
                          marks={guideMarks}
                          onMenu={(programme, x, y) => setAddMenu({ channelNumber: row.parent.number, channelName: row.parent.name, programme, x, y })}
                        />
                      )
                    }
                    return (
                    <ProgrammeRow
                      key={channel.id}
                      channel={channel}
                      slots={slots}
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
                      marks={guideMarks}
                      onMenu={(programme, x, y) => setAddMenu({ channelNumber: channel.number, channelName: channel.name, programme, x, y })}
                    />
                    )
                  })}
                </div>
                {addRow ? (
                  <div className="add-row" style={{ top: layout.length * ROW_HEIGHT, height: ROW_HEIGHT, left: scrollLeft + 8, width: Math.max(200, viewWidth - 16) }}>
                    <AddChannelForm nextNumber={nextNumber} onAdd={addLink} onPreview={tv.previewSource} onAddMany={addMany} onCombine={combine} onNewChannel={() => newChannel()} nextLowNumber={nextLowNumber} onNewLowChannel={() => newChannel(true)} onFocus={openAddRow} inputRef={addInput} />
                  </div>
                ) : null}
                <div className="now-line" style={{ left: nowX }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {addMenu ? <AddToGuideMenu menu={addMenu} guideName={tv.guideLibrary.current?.name ?? null} onAdd={addToGuide} onClose={() => setAddMenu(null)} /> : null}
      {addNote ? (
        <p className="guide-add-note" role="status">
          {addNote}
        </p>
      ) : null}
      {tool === 'guides' ? (
        <GuidePanel />
      ) : tool === 'edit' && focusedChannel && editScope === 'tvn' ? (
        <TvnChannelPanel onChooseAnother={tv.chooseAnotherTvn} onClose={() => tv.dispatch({ type: 'guide-tool', tool: 'edit' })} />
      ) : tool === 'edit' && focusedChannel && editScope && editScope !== 'local' ? (
        <ChannelEditor
          key={focusedChannel.number}
          channel={focusedChannel}
          scope={editScope}
          onLoad={tv.openChannelEdit}
          onSave={tv.saveChannelEdit}
          onRescan={tv.rescanChannelEdit}
          onLoadMore={tv.loadMoreChannelSource}
          onAcquire={tv.acquireChannelSource}
          canLoad={tv.canLoadChannelSource}
          onDelete={editScope === 'curated' ? tv.restoreCuratedChannel : tv.deleteUserChannel}
          onClose={() => tv.dispatch({ type: 'guide-tool', tool: 'edit' })}
          onExport={tv.exportChannelFile}
          archiveOf={tv.sourceArchive}
          onPlay={tv.playChannelProgramme}
        />
      ) : tool === 'media' ? (
        <SessionImportTools
          key={mediaChannel.number}
          channel={mediaChannel}
          programmes={sessionProgrammes(mediaChannel.number)}
          watching={tv.channel.number === mediaChannel.number}
          onImport={tv.importSession}
          onRemove={tv.removeSessionFile}
          onMove={tv.moveSessionFile}
          onReload={tv.reloadLocalMedia}
          onClear={tv.clearLocalChannel}
          onRename={tv.renameLocalChannel}
          onWatch={(channelNumber) => tv.dispatch({ type: 'tune', channelNumber })}
          onClose={() => tv.dispatch({ type: 'guide-tool', tool: 'media' })}
        />
      ) : tool === 'options' || tool === 'editor' ? null : tool === 'users' ? (
        <NewUserTools
          name={newUserName}
          note={newUserNote}
          onName={setNewUserName}
          onNote={setNewUserNote}
          onCreate={createUser}
          onImportList={importListAsUser}
          onCancel={() => tv.dispatch({ type: 'cancel' })}
        />
      ) : tool === 'network' ? (
        <UserNetworkImportTools userChannels={userChannels.filter((channel) => !channel.emptySlot).length} onApply={tv.importUserNetwork} onApplyComplete={tv.importTvn} />
      ) : tool === 'add' ? (
        <UserNetworkTools
          userChannels={userNumbers.length}
          onImportList={importList}
          onLoadTest={tv.loadTestChannels}
          onRemoveStarter={tv.removeStarterNetwork}
          onRemoveAll={() => tv.removeUserChannels('all')}
          onExport={tv.exportUserNetwork}
          onExportAll={tv.exportTvn}
          onRestore={restoreNetwork}
        />
      ) : sessionMatches.length > 0 ? (
        <SessionMatches channel={focusedChannel ?? SESSION_CHANNEL} matches={sessionMatches} onPlay={tv.playSession} />
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
          following={tv.guideRun?.state === 'active'}
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

type Arrangement = 'latest' | 'az' | 'random'

/** The Guide's three ways to arrange a channel's schedule, one on at a time. */
const ARRANGEMENTS: readonly { how: Arrangement; mark: string; name: string; about: string }[] = [
  { how: 'latest', mark: '◉', name: 'Latest', about: 'Latest: the very latest programme now, then newest to oldest' },
  { how: 'az', mark: 'AZ', name: 'A to Z', about: 'A to Z: schedule every programme alphabetically' },
  { how: 'random', mark: '⤮', name: 'Random', about: 'Random: schedule every programme in a random order' },
]

function ChannelCell({
  channel,
  watching,
  visiting,
  selected,
  userNetwork,
  offAir,
  favourite,
  onTune,
  onEdit,
  onFavourite,
  live = false,
  arranged,
  busy = false,
  onArrange,
  onDelete,
  expanded = false,
  onExpand,
  subChannels = 0,
  subsOpen = false,
  onSubs,
}: {
  channel: Channel
  /** How many sub-channels (one per source) it has; "+" shows and hides them. */
  subChannels?: number
  subsOpen?: boolean
  onSubs?: () => void
  watching: boolean
  /** Watched although the selected tab does not list it: shown here, not part of the tab. */
  visiting: boolean
  selected: boolean
  userNetwork: boolean
  offAir: boolean
  favourite: boolean
  onTune: () => void
  /** Present when this channel can be edited: right-click or a long press opens its editor. */
  onEdit?: () => void
  onFavourite: () => void
  /** The channel plays latest first, live. */
  live?: boolean
  /** Its schedule is sorted A to Z, or in a random order. */
  arranged?: 'az' | 'random'
  /** One of its own actions is in progress. */
  busy?: boolean
  /** LATEST, A–Z or RANDOM: the one pressed goes on and the others off; pressed when on, the default schedule returns. */
  onArrange?: (how: Arrangement) => void
  onDelete?: () => void
  /** The selected channel shows all of its actions, not just one. */
  expanded?: boolean
  onExpand?: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  // Selected and folded: the arrangement that is on, else the star of a favourite or else LATEST; the arrow shows the rest.
  const all = selected && expanded
  const on: Arrangement | null = live ? 'latest' : (arranged ?? null)
  const shows = (how: Arrangement) => onArrange !== undefined && (how === on || (selected && (all || (on === null && how === 'latest' && !favourite))))
  const showStar = selected ? all || favourite || onArrange === undefined : favourite
  const canExpand = selected && onExpand !== undefined && (onArrange ?? onEdit ?? onDelete) !== undefined
  useEffect(() => {
    if (!confirming) return
    const id = window.setTimeout(() => setConfirming(false), 4000)
    return () => window.clearTimeout(id)
  }, [confirming])
  const act = (action: (() => void) | undefined) => (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    action?.()
  }
  const editRef = useRef(onEdit)
  editRef.current = onEdit
  const [press] = useState(() => createLongPress(() => editRef.current?.()))
  const point = (event: PointerEvent<HTMLButtonElement>) => ({ pointerType: event.pointerType, clientX: event.clientX, clientY: event.clientY })
  return (
    <div
      className={`channel-cell${selected ? ' is-selected' : ''}${watching ? ' is-watching' : ''}${visiting ? ' is-visiting' : ''}${userNetwork ? ' is-user' : ''}${offAir ? ' is-off-air' : ''}`}
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
        title={visiting ? `${channel.name} · Watching, not in this tab` : offAir ? `${channel.name} · Off air` : undefined}
        aria-label={`${padChannel(channel.number)} ${channel.name}${visiting ? ', watching, not in this tab' : ''}${offAir ? ', off air' : ''}`}
      >
        <span className="ch-number">{padChannel(channel.number)}</span>
        <span className="ch-name">{channel.name}</span>
      </button>
      {subChannels > 0 && onSubs ? (
        <button
          type="button"
          className={subsOpen ? 'ch-act ch-subs is-open' : 'ch-act ch-subs'}
          onClick={act(onSubs)}
          aria-expanded={subsOpen}
          title={subsOpen ? 'Hide the sub-channels' : `Show its ${subChannels} sub-channels, one for each source`}
        >
          <span aria-hidden="true">{subsOpen ? '−' : '+'}</span>
          <span className="sr">{subsOpen ? `Hide the sub-channels of ${padChannel(channel.number)}` : `Show the ${subChannels} sub-channels of ${padChannel(channel.number)}`}</span>
        </button>
      ) : null}
      {canExpand ? (
        <button
          type="button"
          className={all ? 'ch-act ch-more is-open' : 'ch-act ch-more'}
          onClick={act(onExpand)}
          aria-expanded={all}
          title={all ? 'Show one button' : 'Show all buttons'}
        >
          <span aria-hidden="true">{all ? '›' : '‹'}</span>
          <span className="sr">{all ? 'Show one button' : 'Show all buttons'}</span>
        </button>
      ) : null}
      {ARRANGEMENTS.map(({ how, mark, name, about }) =>
        shows(how) ? (
          <button
            key={how}
            type="button"
            className={`ch-act ch-arrange ch-${how}${on === how ? ' is-on' : ''}`}
            disabled={busy || !selected}
            onClick={act(() => onArrange?.(how))}
            aria-pressed={on === how}
            title={on === how ? `${name} is on: press to return to the default schedule` : about}
          >
            <span aria-hidden="true">{mark}</span>
            <span className="sr">
              {name} {on === how ? 'off' : 'on'} {padChannel(channel.number)}
            </span>
          </button>
        ) : null,
      )}
      {all && onEdit ? (
        <button type="button" className="ch-act ch-extra" disabled={busy} onClick={act(onEdit)} title="Edit channel">
          <span aria-hidden="true">✎</span>
          <span className="sr">Edit channel {padChannel(channel.number)}</span>
        </button>
      ) : null}
      {all && onDelete ? (
        <button
          type="button"
          className={confirming ? 'ch-act ch-extra ch-delete is-confirm' : 'ch-act ch-extra ch-delete'}
          disabled={busy}
          onClick={act(() => {
            if (!confirming) return setConfirming(true)
            setConfirming(false)
            onDelete()
          })}
          title={confirming ? `Press again to delete ${padChannel(channel.number)}` : 'Delete channel'}
        >
          <span aria-hidden="true">{confirming ? '?' : '✕'}</span>
          <span className="sr">{confirming ? `Confirm deleting ${padChannel(channel.number)}` : `Delete channel ${padChannel(channel.number)}`}</span>
        </button>
      ) : null}
      {showStar ? (
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
      ) : null}
    </div>
  )
}

/** A sub-channel's name under its channel: pressing it watches what that source airs now, then its next. */
function SubChannelCell({ channel, parent, onWatch }: { channel: Channel; parent: Channel; onWatch: () => void }) {
  return (
    <div className="channel-cell is-user is-sub" style={{ height: ROW_HEIGHT }}>
      <button
        type="button"
        className="ch-tune"
        onClick={onWatch}
        title="Watch this sub-channel: what it airs now, then its next programmes"
        aria-label={`Watch ${channel.name}, a sub-channel of ${padChannel(parent.number)} ${parent.name}`}
      >
        <span className="ch-number ch-sub-mark" aria-hidden="true">
          ↳
        </span>
        <span className="ch-name">{channel.name}</span>
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
  marks,
  onMenu,
  sub = false,
}: {
  channel: Channel
  /** A sub-channel's row: a press plays the programme on it, and that source's next programmes follow. */
  sub?: boolean
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
  /** Programmes in the viewer's Guide, keyed `channel:programme`; the one being followed is 'active'. */
  marks: ReadonlyMap<string, 'queued' | 'active'>
  /** The secondary action on a programme (right-click or hold): offers ADD TO MY GUIDE. A click still plays. */
  onMenu: (programme: Programme, x: number, y: number) => void
}) {
  // A hold fires long after this render: it uses the handler and programme taken when the press began.
  const [hold] = useState(() => {
    const state: { onMenu: typeof onMenu; held: { programme: Programme; x: number; y: number } | null } = { onMenu, held: null }
    const press = createLongPress(() => {
      if (state.held) state.onMenu(state.held.programme, state.held.x, state.held.y)
    })
    return { state, press }
  })
  const press = hold.press
  const leftBound = scrollLeft - 280
  const rightBound = scrollLeft + viewWidth + 280
  return (
    <div className={sub ? 'prog-row is-sub' : 'prog-row'} style={{ height: ROW_HEIGHT }} data-channel={channel.number}>
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
        const mark = marks.get(`${channel.number}:${slot.programme.id}`)
        return (
          <div
            key={`${slot.programme.id}-${slot.startMs}`}
            className={`prog${flags.airing ? ' is-live' : ''}${isPlaying ? ' is-playing' : ''}${flags.past ? ' is-past' : ''}${flags.selected ? ' is-focused' : ''}${holding ? ' is-holding' : ''}${mark ? ` in-guide${mark === 'active' ? ' is-following' : ''}` : ''}`}
            style={{ left: frame.left, width: frame.width, paddingLeft: inset }}
            role="button"
            tabIndex={-1}
            aria-label={`${slot.programme.title}, ${isLiveStream(slot.programme) ? 'live' : formatRange(slot.startMs, slot.endMs)}`}
            aria-pressed={flags.selected}
            data-airing={flags.airing ? 'true' : 'false'}
            data-selected={flags.selected ? 'true' : 'false'}
            onClick={() => {
              if (press.swallowClick()) return
              if (flags.selected) onActivate()
              else onFocus(slot.startMs + 1)
            }}
            onContextMenu={(event: MouseEvent<HTMLDivElement>) => {
              event.preventDefault()
              press.opened()
              onMenu(slot.programme, event.clientX, event.clientY)
            }}
            onPointerDown={(event) => {
              hold.state.onMenu = onMenu
              hold.state.held = { programme: slot.programme, x: event.clientX, y: event.clientY }
              press.down({ pointerType: event.pointerType, clientX: event.clientX, clientY: event.clientY })
            }}
            onPointerMove={(event) => press.move({ pointerType: event.pointerType, clientX: event.clientX, clientY: event.clientY })}
            onPointerUp={press.up}
            onPointerCancel={press.cancel}
            onPointerLeave={press.cancel}
            onDoubleClick={() => {
              onFocus(slot.startMs + 1)
              onActivate()
            }}
          >
            {frame.width > TITLE_MIN_PX ? <span className="prog-title">{slot.programme.title}</span> : null}
            {frame.width > 168 ? (
              <span className="prog-time">{isLiveStream(slot.programme) ? 'Live' : formatRange(slot.startMs, slot.endMs)}</span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

interface AddMenu {
  channelNumber: number
  channelName: string
  programme: Programme
  x: number
  y: number
}

/** The small menu a right-click or hold on a programme opens: ADD TO MY GUIDE, kept to one choice. */
function AddToGuideMenu({ menu, guideName, onAdd, onClose }: { menu: AddMenu; guideName: string | null; onAdd: (menu: AddMenu) => void; onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => first.current?.focus(), [])
  const width = 240
  const left = Math.max(8, Math.min(menu.x, (typeof window === 'undefined' ? 1200 : window.innerWidth) - width - 8))
  const top = Math.max(8, Math.min(menu.y, (typeof window === 'undefined' ? 800 : window.innerHeight) - 120))
  return (
    <div className="guide-menu-scrim" onPointerDown={onClose} onContextMenu={(event) => event.preventDefault()}>
      <div
        className="guide-menu"
        role="menu"
        aria-label={`${menu.programme.title} on ${padChannel(menu.channelNumber)}`}
        style={{ left, top, width }}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') onClose()
        }}
      >
        <p className="guide-menu-title">
          {padChannel(menu.channelNumber)} · {menu.programme.title}
        </p>
        <button type="button" role="menuitem" ref={first} className="guide-menu-item" onClick={() => onAdd(menu)}>
          Add to {guideName ?? 'My Guide'}
        </button>
        <button type="button" role="menuitem" className="guide-menu-item is-quiet" onClick={onClose}>
          Cancel
        </button>
      </div>
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
  following = false,
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
  /** An active Guide controls what plays next: the GUIDE key shows it here too. */
  following?: boolean
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
        following={following}
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
function SessionMatches({ channel, matches, onPlay }: { channel: Channel; matches: readonly Programme[]; onPlay: (programmeId: string) => void }) {
  const shown = matches.slice(0, 6)
  return (
    <footer className="guide-info guide-matches">
      <div className="info-main">
        <p className="info-kicker">
          <span>{padChannel(channel.number)}</span>
          <span>{channel.name}</span>
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
  if (filter.startsWith('user:')) return 'No channels for this user yet'
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
  return basePxPerMinute(window.innerWidth)
}

function usePxPerMinute(): number {
  const [px, setPx] = useState(initialPxPerMinute)

  useEffect(() => {
    const apply = () => {
      setPx(basePxPerMinute(window.innerWidth))
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [])

  return px
}
