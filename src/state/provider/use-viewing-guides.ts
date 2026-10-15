import { useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import {
  NEW_MAP_NAME,
  addToGuide as addProgrammeToGuide,
  applyGuideAction,
  guideId,
  newGuide,
  nextPlayable,
  resolveItem,
  saveGuideLibrary,
  sourceChannel,
  unnamedMap,
  type GuideAction,
  type GuideItem,
  type GuideLibrary,
  type GuideRun,
  type GuideSource,
  type ItemLookup,
} from '../../services/viewing-guides.ts'
import { channelByNumber, listChannels, programmesFor, shippedChannel } from '../../data/catalogue.ts'
import { refusedVideos } from '../../services/embed-refusals.ts'
import { clearManual } from '../../player/manual.ts'
import { withCentralEdits } from '../../data/central-edits.ts'
import { appliedCuratedEdits } from '../../services/curated-edits.ts'
import { shippedEditorial } from '../../data/central-editorial.ts'
import { searchIndex } from '../../services/guide-search-pool.ts'
import { SEARCH_TARGET, buildChannelGuide, buildSearchGuide, channelSupply } from '../../services/guide-search.ts'
import { padChannel } from '../../utils/time.ts'
import type { Programme } from '../../types/programme.ts'
import type { Channel } from '../../types/channel.ts'
import type { ChannelEditorial } from '../../services/channel-curation.ts'
import type { GuideSearchState } from '../tv-context.ts'

export interface ViewingGuideDeps {
  guideLibraryRef: RefObject<GuideLibrary>
  setGuideLibraryState: Dispatch<SetStateAction<GuideLibrary>>
  guideRunRef: RefObject<GuideRun | null>
  setGuideRunState: Dispatch<SetStateAction<GuideRun | null>>
  loadedKey: RefObject<string>
  flash: (message: string, ms?: number) => void
  guideDrivingRef: RefObject<boolean>
  playFromGuide: (target: Channel, programme: Programme, slot?: { startMs: number; endMs: number } | undefined, fromSeconds?: number) => void
  guideEngine: RefObject<{ advance: (_finished: boolean) => void; skipFailed: (_channelNumber: number) => boolean; suspend: () => void; step: (_direction: 1 | -1) => void }>
  userEditorialRef: RefObject<Map<number, ChannelEditorial>>
  guideSearchRef: RefObject<GuideSearchState | null>
  setGuideSearchState: Dispatch<SetStateAction<GuideSearchState | null>>
}

/** MY GUIDE: the viewer's own viewing sequences, played through the same picks as the Guide grid. */
export function useViewingGuides({
  guideLibraryRef,
  setGuideLibraryState,
  guideRunRef,
  setGuideRunState,
  loadedKey,
  flash,
  guideDrivingRef,
  playFromGuide,
  guideEngine,
  userEditorialRef,
  guideSearchRef,
  setGuideSearchState,
}: ViewingGuideDeps) {
  // ── GUIDES: the viewer's own viewing sequences, played through the same picks as the Guide grid ──

  const setGuideLibrary = (next: GuideLibrary) => {
    guideLibraryRef.current = next
    setGuideLibraryState(next)
    saveGuideLibrary(next)
  }
  const setGuideRun = (next: GuideRun | null) => {
    guideRunRef.current = next
    setGuideRunState(next)
  }
  const guideLookup = (): ItemLookup => ({ channelByNumber, programmesFor, refused: refusedVideos() })

  /**
   * Plays the run's item at `index`, or the nearest one in `direction` that can play; an item that cannot
   * is passed for this run only. Going on past the last item ends the Guide and leaves the channel to NOW.
   */
  const playGuideFrom = (run: GuideRun, index: number, direction: 1 | -1): boolean => {
    const skipped = new Set(run.skipped)
    const lookup = guideLookup()
    const at = nextPlayable(run.guide, index, direction, (item) => {
      if (skipped.has(item.id)) return false
      const ok = resolveItem(item, lookup).ok
      if (!ok) skipped.add(item.id)
      return ok
    })
    if (at === null) {
      if (direction === 1) {
        setGuideRun(null)
        if (clearManual()) loadedKey.current = ''
        flash(run.guide.items.length > 0 && skipped.size >= run.guide.items.length ? 'NOTHING IN THIS GUIDE CAN PLAY' : 'GUIDE FINISHED · BACK TO NOW', 2400)
      }
      return false
    }
    const resolved = resolveItem(run.guide.items[at], lookup)
    if (!resolved.ok) return false
    const now = Date.now()
    setGuideRun({ ...run, index: at, state: 'active', programmeId: resolved.programme.id, endsAt: now + resolved.programme.durationSeconds * 1000, skipped: [...skipped] })
    guideDrivingRef.current = true
    try {
      playFromGuide(resolved.channel, resolved.programme)
    } finally {
      guideDrivingRef.current = false
    }
    return true
  }

  guideEngine.current = {
    /** The programme the Guide asked for has ended (or something else replaced it): on to the next item. */
    advance: (finished) => {
      const run = guideRunRef.current
      if (!run || run.state !== 'active') return
      const item = run.guide.items[run.index]
      const next = finished || !item ? run : { ...run, skipped: [...new Set([...run.skipped, item.id])] }
      playGuideFrom(next, run.index + 1, 1)
    },
    /** A Guide item that will not play is passed for this run, rather than the channel falling forward. */
    skipFailed: (channelNumber) => {
      const run = guideRunRef.current
      if (!run || run.state !== 'active' || run.guide.items[run.index]?.channelNumber !== channelNumber) return false
      guideEngine.current.advance(false)
      return true
    },
    /** The viewer chose something else: the Guide stays loaded but stops choosing. */
    suspend: () => {
      const run = guideRunRef.current
      if (run?.state === 'active') setGuideRun({ ...run, state: 'suspended' })
    },
    step: (direction) => guideStepAction(direction),
  }

  const addToGuideAction = (channelNumber: number, programme: Programme): string => {
    const channel = channelByNumber(channelNumber)
    if (!channel) throw new Error('That channel is not available')
    const now = Date.now()
    const library = guideLibraryRef.current
    const current = addProgrammeToGuide(library.current ?? newGuide(NEW_MAP_NAME, now), channel, programme, now)
    setGuideLibrary({ ...library, current })
    return `ADDED TO ${current.name.toUpperCase()} · ${current.items.length} ${current.items.length === 1 ? 'ITEM' : 'ITEMS'}`
  }

  /**
   * CREATE GUIDE FROM…: a new, unsaved Guide named after the words, built from TVN's own catalogue. RESCAN
   * (`rescan`) rebuilds the same words differently; the Guide on show stays until its replacement is ready.
   */
  /** The programmes every channel can lend a Guide now, after edits, filters and refusals. */
  const guideIndex = () => {
    const edits = withCentralEdits(appliedCuratedEdits(shippedChannel))
    const editorialFor = (number: number) => (number <= 999 ? (edits[String(number)]?.editorial ?? shippedEditorial(number)) : userEditorialRef.current.get(number))
    const stamp = JSON.stringify([Object.values(edits).map((edit) => [edit.channelNumber, edit.editorial ?? null]), [...userEditorialRef.current]])
    return searchIndex(editorialFor, refusedVideos(), stamp)
  }

  const runningTime = (seconds: number) => {
    const minutes = Math.round(seconds / 60)
    return minutes >= 60 ? `${Math.floor(minutes / 60)}H ${String(minutes % 60).padStart(2, '0')}M` : `${minutes}M`
  }

  /** What a CHANNEL SOURCE is now (followed by its id) and what it can supply. */
  const guideSupplyAction = (source: GuideSource) => {
    const channel = sourceChannel(source, listChannels())
    return channel ? { channel, ...channelSupply(guideIndex(), channel.number) } : { channel: undefined, programmes: 0, seconds: 0 }
  }

  /** ADD CHANNEL: a channel number becomes a source, stored by the channel's identity. */
  const addGuideSourceAction = (number: number): string => {
    const channel = channelByNumber(number)
    if (!channel) throw new Error(`No channel ${padChannel(number)}`)
    if (channel.origin === 'tvn' || channel.origin === 'session') throw new Error(`${padChannel(number)} ${channel.name} has no programmes of its own`)
    const current = guideLibraryRef.current.current?.sources ?? []
    if (current.some((source) => source.channelId === channel.id)) return `${padChannel(number)} · ${channel.name.toUpperCase()} IS ALREADY A SOURCE`
    editGuideAction({ type: 'sources', sources: [...current, { channelId: channel.id, channelNumber: channel.number, channelName: channel.name }] })
    const supply = channelSupply(guideIndex(), channel.number)
    const label = `${padChannel(number)} · ${channel.name.toUpperCase()}`
    if (supply.programmes === 0) return `${label} ADDED · NOTHING TO SCHEDULE FROM IT YET`
    return `${label} ADDED · ${supply.programmes} ${supply.programmes === 1 ? 'PROGRAMME' : 'PROGRAMMES'} · ${runningTime(supply.seconds)}`
  }

  const channelGuideSeed = useRef(0)
  /** BUILD MY GUIDE: the current Guide's programmes, scheduled afresh from its MY GUIDE SOURCES. */
  const buildChannelGuideAction = (): string => {
    const guide = guideLibraryRef.current.current
    const channels = (guide?.sources ?? []).map((source) => sourceChannel(source, listChannels())).filter((channel): channel is Channel => channel !== undefined)
    if (channels.length === 0) throw new Error('Add a channel to build from')
    const keyOf = (item: GuideItem) => item.programme.videoId || item.programme.mediaUrl || ''
    const previous = guide && guide.items.length ? new Set(guide.items.map(keyOf)) : undefined
    channelGuideSeed.current += 1
    const built = buildChannelGuide(guideIndex(), channels.map((channel) => channel.number), { seed: channelGuideSeed.current, previous })
    if (built.picks.length === 0) return 'THESE CHANNELS HAVE NOTHING TO SCHEDULE YET'
    const now = Date.now()
    const items: GuideItem[] = built.picks.map((pick) => ({
      id: guideId('i', now),
      channelNumber: pick.entry.channel.number,
      channelName: pick.entry.channel.name,
      programme: pick.entry.programme.guide ?? { id: pick.entry.programme.id, title: pick.entry.programme.title, videoId: pick.entry.programme.videoId ?? null, durationSeconds: pick.entry.programme.durationSeconds, source: 'imported' },
    }))
    if (unnamedMap(guide)) editGuideAction({ type: 'rename', name: channels.map((channel) => channel.name).join(' + ').slice(0, 60) })
    editGuideAction({ type: 'fill', items })
    guideSearchRef.current = null
    setGuideSearchState(null)
    const used = new Set(items.map((item) => item.channelNumber)).size
    return `${items.length} ${items.length === 1 ? 'PROGRAMME' : 'PROGRAMMES'} · ${runningTime(built.seconds)} · ${used} OF ${channels.length} ${channels.length === 1 ? 'CHANNEL' : 'CHANNELS'}`
  }

  const searchGuideAction = (text: string, rescan = false): string => {
    const state = guideSearchRef.current
    const library = guideLibraryRef.current
    const again = rescan && state !== null && library.current?.id === state.guideId
    const query = (again ? state.query : text).replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!query) throw new Error('Type what the Guide should be about')
    const index = guideIndex()
    const keyOf = (item: GuideItem) => item.programme.videoId || item.programme.mediaUrl || ''
    const previous = again && library.current ? new Set(library.current.items.map(keyOf)) : undefined
    const seed = again ? state.seed + 1 : 0
    const built = buildSearchGuide(index, query, { seed, previous })
    if (built.picks.length === 0) return again ? 'NOTHING ELSE MATCHES' : `NOTHING IN TVN MATCHES ${query.toUpperCase()}`
    if (previous && built.picks.every((pick) => previous.has(pick.entry.key)) && built.picks.length === previous.size) {
      guideSearchRef.current = { ...state!, seed, small: true }
      setGuideSearchState(guideSearchRef.current)
      return `ONLY ${built.matched} ${built.matched === 1 ? 'PROGRAMME MATCHES' : 'PROGRAMMES MATCH'} · NOTHING DIFFERENT TO RESCAN`
    }
    const now = Date.now()
    const items: GuideItem[] = built.picks.map((pick) => ({
      id: guideId('i', now),
      channelNumber: pick.entry.channel.number,
      channelName: pick.entry.channel.name,
      programme: pick.entry.programme.guide ?? { id: pick.entry.programme.id, title: pick.entry.programme.title, videoId: pick.entry.programme.videoId ?? null, durationSeconds: pick.entry.programme.durationSeconds, source: 'imported' },
    }))
    // The Map being edited takes the programmes; a Map that already has a name of its own keeps it.
    if (!again && !library.current) editGuideAction({ type: 'new', name: query })
    else if (!again && unnamedMap(library.current)) editGuideAction({ type: 'rename', name: query })
    editGuideAction({ type: 'fill', items })
    const guide = guideLibraryRef.current.current!
    guideSearchRef.current = { query, guideId: guide.id, seed, matched: built.matched, small: built.small }
    setGuideSearchState(guideSearchRef.current)
    const channels = new Set(items.map((item) => item.channelNumber)).size
    const hours = Math.round(built.seconds / 60)
    const length = hours >= 60 ? `${Math.floor(hours / 60)}H ${String(hours % 60).padStart(2, '0')}M` : `${hours}M`
    const summary = `${items.length} ${items.length === 1 ? 'PROGRAMME' : 'PROGRAMMES'} · ${length} · ${channels} ${channels === 1 ? 'CHANNEL' : 'CHANNELS'}`
    if (built.small) return `${summary} · ONLY ${built.matched} MATCH${again ? ' · RESCAN CANNOT VARY IT MUCH' : ''}`
    return built.seconds < SEARCH_TARGET.min ? `${summary} · ALL THAT MATCHES` : summary
  }

  const editGuideAction = (action: GuideAction): string => {
    const before = guideLibraryRef.current
    const next = applyGuideAction(before, action, Date.now())
    setGuideLibrary(next)
    const run = guideRunRef.current
    if (run && action.type === 'delete' && before.current?.id === run.guide.id) setGuideRun(null)
    else if (run && next.current && next.current.id === run.guide.id && action.type !== 'load') {
      // The Guide being played follows its edits; the item playing keeps its place if it is still there.
      const playing = run.guide.items[run.index]?.id
      const index = next.current.items.findIndex((item) => item.id === playing)
      setGuideRun({ ...run, guide: structuredClone(next.current), index: index >= 0 ? index : Math.min(run.index, Math.max(0, next.current.items.length - 1)) })
    }
    const name = next.current?.name.toUpperCase() ?? ''
    switch (action.type) {
      case 'new':
        return 'NEW MY GUIDE'
      case 'save':
        return `${name} SAVED`
      case 'duplicate':
        return `${name} SAVED AS A COPY`
      case 'delete':
        return 'MY GUIDE DELETED'
      case 'load':
        return `${name} LOADED`
      case 'clear':
        return 'MY GUIDE CLEARED'
      case 'rename':
        return `RENAMED ${name}`
      default:
        return ''
    }
  }

  const playGuideAction = (fromIndex = 0) => {
    const current = guideLibraryRef.current.current
    if (!current || current.items.length === 0) {
      flash('MY GUIDE IS EMPTY')
      return
    }
    playGuideFrom({ guide: structuredClone(current), index: fromIndex, state: 'active', programmeId: null, endsAt: null, skipped: [] }, fromIndex, 1)
  }

  /** Follows the Guide again from the item it was on, played from its beginning. */
  const resumeGuideAction = () => {
    const run = guideRunRef.current
    if (!run) return
    playGuideFrom(run, run.index, 1)
  }

  const stopGuideAction = () => {
    if (!guideRunRef.current) return
    setGuideRun(null)
    flash('GUIDE STOPPED')
  }

  const guideStepAction = (direction: -1 | 1) => {
    const run = guideRunRef.current
    if (!run) return
    if (direction === 1) {
      playGuideFrom({ ...run, state: 'active' }, run.index + 1, 1)
      return
    }
    if (!playGuideFrom({ ...run, state: 'active' }, run.index - 1, -1)) playGuideFrom({ ...run, state: 'active' }, run.index, 1)
  }

  return {
    setGuideLibrary,
    addToGuideAction,
    guideSupplyAction,
    addGuideSourceAction,
    buildChannelGuideAction,
    searchGuideAction,
    editGuideAction,
    playGuideAction,
    resumeGuideAction,
    stopGuideAction,
    guideStepAction,
  }
}
