import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { loadRegister } from '../credits/load.ts'
import { watchUrl, type SourceRegister } from '../credits/provenance.ts'
import { shippedChannel, shippedProgrammes } from '../data/catalogue.ts'
import { broadcast } from '../services/broadcast.ts'
import { admitted, canLoadMore, eligibilityKey, heldIds, holdNew, lengthRangeOf, withLengthRange, withWebsiteSlot, type ChannelEdit, type LoadMoreOptions } from '../services/channel-editor.ts'
import type { ChannelExportKind } from '../services/channel-file.ts'
import { reachesArchive, withSourceDrafts, type SourceDraft } from '../services/channel-curation.ts'
import type { ImportedVideo } from '../services/channels-import.ts'
import {
  airingSources,
  inOrder,
  inventoryOf,
  isStreamSource,
  liveStreamOf,
  newSource,
  singleVideoId,
  SLOT_CHOICES,
  sourceStatusText,
  SOURCE_CHOICES,
  type ChannelSource,
  type OrderKind,
  type SourceChoice,
} from '../services/channel-sources.ts'
import type { Channel } from '../types/channel.ts'
import { formatDuration, padChannel } from '../utils/time.ts'
import { useClock } from '../utils/use-clock.ts'
import type { EditorScope } from '../view/channel-edit.ts'
import { EditorialPanel, SourceFilterPanel, StatusPicker } from './ChannelCuration.tsx'
import { SourceDetails } from './SourceDetails.tsx'
import { OriginalSources } from './OriginalSources.tsx'
import { PlaylistDiscovery } from './PlaylistDiscovery.tsx'
import { playlistUrl } from '../services/add-channel.ts'
import { withOriginalOverride } from '../services/original-sources.ts'
import { addedContributions, addedSourceLabels, channelOriginals, contributionsOf, contributionText, originalLineup } from '../view/channel-provenance.ts'
import { alphabeticalVideos, latestVideos, rebuiltVideos, shuffledVideos } from '../view/programme-order.ts'

/** Rows drawn at once in a long list; the rest are a press away, so a deep source never slows the editor. */
const ROW_LIMIT = 200

/** What the running order heading calls each kind of order the viewer has chosen. */
const ORDER_KINDS: Record<OrderKind, { label: string; hint: string }> = {
  az: { label: 'A–Z', hint: 'Sorted by title, A to Z' },
  latest: { label: 'Latest first', hint: 'Newest upload first' },
  random: { label: 'Randomised', hint: 'Shuffled into a new order' },
  rebuilt: { label: 'Rebuilt', hint: 'Drawn afresh from every eligible programme, each source in turn' },
  manual: { label: 'Yours · manual', hint: 'Arranged by hand' },
}

/** An edit read from storage, given the fingerprint of what it compiles if it was saved before RESCAN kept one. */
const withBaseline = (edit: ChannelEdit): ChannelEdit => (edit.compiled ? edit : { ...edit, compiled: eligibilityKey(edit) })

/** Enter and Space press these controls; they must not also reach the Guide. */
function keepKey(event: KeyboardEvent<HTMLElement>) {
  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
}

function viewerMessage(caught: unknown, fallback: string): string {
  const message = caught instanceof Error ? caught.message.trim() : ''
  return message && message.length <= 90 && !/[<>{}]/.test(message) ? message.toUpperCase() : fallback
}

/**
 * How long each page of a website or post source holds the screen: 5, 10, 15 or 30 minutes, or any length
 * from 1 minute to 6 hours. A page has no length of its own, so the schedule's slot is the viewer's choice.
 */
function WebsiteSlot({ source, disabled, onChange }: { source: ChannelSource; disabled: boolean; onChange: (next: ChannelSource) => void }) {
  const current = source.videos?.[0]?.durationSec ?? 0
  const preset = SLOT_CHOICES.includes(current)
  const [custom, setCustom] = useState(preset ? '' : String(Math.round(current / 60)))
  const choose = (seconds: number) => onChange(withWebsiteSlot(source, seconds))
  return (
    <div className="editor-slot" role="group" aria-label="Slot length">
      <span>Slot</span>
      {SLOT_CHOICES.map((seconds) => (
        <button key={seconds} type="button" className={current === seconds ? 'tab is-on' : 'tab'} aria-pressed={current === seconds} disabled={disabled} onKeyDown={keepKey} onClick={() => choose(seconds)}>
          {seconds / 60} min
        </button>
      ))}
      <label className={preset ? 'editor-slot-custom' : 'editor-slot-custom is-on'}>
        Custom
        <input
          type="number"
          min={1}
          max={360}
          inputMode="numeric"
          value={custom}
          disabled={disabled}
          aria-label="Custom slot length in minutes"
          onChange={(event) => {
            setCustom(event.target.value)
            const minutes = Number(event.target.value)
            if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 360) choose(minutes * 60)
          }}
          onKeyDown={(event) => event.stopPropagation()}
        />
        min
      </label>
    </div>
  )
}

function sourceTitle(source: ChannelSource): string {
  if (source.kind === 'tvn') return 'TVN programming'
  if (source.kind === 'collection') return singleVideoId(source) ? source.label || source.url : `${source.label} · TVN list`
  return source.label && source.kind === 'youtube' ? source.label : source.url
}

/** The video on air on the channel as saved; a channel with nothing scheduled has none. */
function onAirVideo(channel: Channel, now: number): string | null {
  try {
    return broadcast(channel, now).current.programme.videoId
  } catch {
    return null
  }
}

interface ListedVideo {
  id: string
  title: string
  durationSec: number
  /** The provider's own page for it, when its id is a YouTube video id. */
  href?: string
  /** The source that supplied it, briefly. */
  from?: string
  /** One of TVN's original programmes, which the viewer keeps or leaves out. */
  original?: boolean
  /** Upload or publication day (YYYY-MM-DD), when the source gave one. */
  published?: string
}

/** What a source holds, from its last scan: nothing is fetched to show it. */
function sourceProgrammes(source: ChannelSource, number: number): ListedVideo[] {
  if (source.kind !== 'tvn') return (source.videos ?? []).map((video) => ({ ...video, href: watchUrl(video.id) }))
  const shipped = shippedChannel(number)
  return shipped
    ? shippedProgrammes(shipped.id).map((programme) => ({
        id: programme.id,
        title: programme.title,
        durationSec: programme.durationSeconds,
        href: watchUrl(programme.videoId),
      }))
    : []
}

/** TVN's own programmes for a curated channel that carry media: the ones a viewer can arrange or leave out. */
function tvnProgrammes(number: number): ListedVideo[] {
  const shipped = shippedChannel(number)
  return shipped
    ? shippedProgrammes(shipped.id)
        .filter((programme) => programme.videoId !== null)
        .map((programme) => ({ id: programme.id, title: programme.title, durationSec: programme.durationSeconds, href: watchUrl(programme.videoId), from: 'TVN catalogue', published: programme.publishedAt }))
    : []
}

/** Opens a programme where its provider hosts it; a programme with no address keeps the space empty. */
function OriginalLink({ video }: { video: ListedVideo }) {
  if (!video.href) return <span className="editor-link" aria-hidden="true" />
  return (
    <a
      className="tab editor-link"
      href={video.href}
      target="_blank"
      rel="noopener noreferrer"
      title="Open original"
      aria-label={`Open ${video.title} on YouTube`}
      onKeyDown={keepKey}
    >
      ↗
    </a>
  )
}

/**
 * How much of a source TVN holds, and LOAD ALL to read to the end (LOAD MORE sits on the source's own line): the first batch arrives fast,
 * the rest only when asked for. While loading, the count climbs and STOP keeps what has arrived.
 */
function SourceDepth({
  source,
  loading,
  disabled,
  canLoad,
  onAll,
  onStop,
}: {
  source: ChannelSource
  loading: { loaded: number; listed?: number; all: boolean } | null
  disabled: boolean
  canLoad: boolean
  onAll: () => void
  onStop: () => void
}) {
  const held = source.videos?.length ?? 0
  const listed = loading?.listed ?? source.listed
  const label = sourceTitle(source)
  return (
    <div className="editor-depth" role="group" aria-label={`How much of ${label} is loaded`}>
      <span className="editor-depth-count" role={loading ? 'status' : undefined}>
        {loading
          ? `Loading · ${loading.loaded}${listed ? ` of ${listed}` : ''} loaded…`
          : `${held} loaded${listed ? ` · ${listed} listed` : ''}${source.complete ? ' · whole source read' : ''}`}
      </span>
      {loading ? (
        <button type="button" className="tab" onKeyDown={keepKey} onClick={onStop}>
          Stop
        </button>
      ) : canLoad ? (
        <button type="button" className="tab" disabled={disabled} onKeyDown={keepKey} onClick={onAll} title="Read this source to the end of its public list">
          Load all
        </button>
      ) : null}
    </div>
  )
}

/**
 * The Channel Editor: one channel's name and sources, opened from the Guide by right-click, a long press
 * or E. It sits where the Guide's information bar is and closes back into it.
 */
export function ChannelEditor({
  channel,
  scope,
  onLoad,
  onSave,
  onRescan,
  onLoadMore,
  onAcquire,
  canLoad,
  onDelete,
  onClose,
  onExport,
  archiveOf,
  onPlay,
  initial = null,
}: {
  channel: Channel
  scope: EditorScope
  onLoad: (channelNumber: number) => Promise<ChannelEdit | null>
  onSave: (channelNumber: number, edit: ChannelEdit) => Promise<string>
  onRescan: (channelNumber: number, edit: ChannelEdit) => Promise<{ edit: ChannelEdit; message: string }>
  /** LOAD MORE / LOAD ALL: reads one source past its first batch; the editor saves what it brings. */
  onLoadMore?: (source: ChannelSource, options: LoadMoreOptions) => Promise<ChannelSource>
  /** A newly added source read for its first programmes; the editor saves them as available, not yet scheduled. */
  onAcquire?: (source: ChannelSource) => Promise<ChannelSource>
  /** Whether a source can be read further; without it, only YouTube and podcast sources can. */
  canLoad?: (source: ChannelSource) => boolean
  onDelete: (channelNumber: number) => Promise<string>
  onClose: () => void
  /**
   * EXPORT (user channels), the channel as shown: its tvn-channel-v1 file, or its editorial manifest as JSON
   * (tvn-editorial-manifest-v1) or readable text.
   */
  onExport?: (channelNumber: number, edit: ChannelEdit, as: ChannelExportKind) => Promise<string>
  /** TVN's shipped back catalogue for a source, so the filter preview counts what ARCHIVE and ALL would add. */
  archiveOf?: (source: ChannelSource) => readonly ImportedVideo[]
  /** Plays one of the channel's programmes now (PLAY LATEST); a message when it cannot, or nothing. */
  onPlay?: (channelNumber: number, programmeId: string) => string | null
  /** The channel as already read, shown until the editor's own read completes. */
  initial?: ChannelEdit | null
}) {
  const number = channel.number
  const [edit, setEdit] = useState<ChannelEdit | null>(initial ? withBaseline(initial) : null)
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [link, setLink] = useState('')
  const [kind, setKind] = useState<SourceChoice>('auto')
  const [confirming, setConfirming] = useState(false)
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const [notesOpen, setNotesOpen] = useState(false)
  const [lengthDraft, setLengthDraft] = useState<{ min: string; max: string } | null>(null)
  // Filters set on a source but not applied yet: the editor's RESCAN uses them too.
  const [drafts, setDrafts] = useState<ReadonlyMap<string, SourceDraft>>(new Map())
  // LOAD MORE / LOAD ALL in progress on one source, and how far it has got.
  const [loading, setLoading] = useState<{ id: string; loaded: number; listed?: number; all: boolean } | null>(null)
  // LOAD across every source that can give more: which source it is on, and the available count it started from and has reached.
  const [batch, setBatch] = useState<{ step: number; of: number; from: number; reached: number } | null>(null)
  const stopRef = useRef<AbortController | null>(null)
  const [allRows, setAllRows] = useState<ReadonlySet<string>>(new Set())
  const now = useClock(30_000)
  const rootRef = useRef<HTMLElement>(null)
  const linkRef = useRef<HTMLInputElement>(null)
  const [register, setRegister] = useState<SourceRegister | null>(null)

  useEffect(() => {
    if (scope !== 'curated') return
    let live = true
    void loadRegister().then((loaded) => live && setRegister(loaded))
    return () => {
      live = false
    }
  }, [scope])
  // TVN's original sources for this channel, named from the source register once it has loaded.
  const originals = useMemo(() => (scope === 'curated' ? channelOriginals(number, register ?? undefined) : []), [scope, number, register])

  useEffect(() => {
    let live = true
    setMissing(false)
    setNote(null)
    setAdding(false)
    setConfirming(false)
    setDrafts(new Map())
    onLoad(number).then(
      (loaded) => {
        if (!live) return
        if (loaded) setEdit(withBaseline(loaded))
        else setMissing(true)
      },
      () => live && setMissing(true),
    )
    rootRef.current?.focus({ preventScroll: true })
    return () => {
      live = false
    }
  }, [number, onLoad])

  useEffect(() => {
    if (adding) linkRef.current?.focus()
  }, [adding])

  useEffect(() => () => stopRef.current?.abort(), [])

  const change = (next: ChannelEdit) => {
    setEdit(next)
    setNote(null)
  }
  const setSource = (id: string, patch: Partial<ChannelSource>) =>
    edit && change({ ...edit, sources: edit.sources.map((source) => (source.id === id ? { ...source, ...patch } : source)) })
  const toggleOpen = (id: string) =>
    setOpened((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // A TVN channel carried by its own programming arranges, and leaves out, TVN's programmes.
  const tvnLineup =
    scope === 'curated' && edit !== null && edit.sources.some((source) => source.kind === 'tvn' && source.enabled) && inventoryOf(edit.sources).length === 0 && !liveStreamOf(edit.sources)
  const fromOriginals = tvnLineup && originals.length > 0
  // TVN's original sources and the viewer's added ones play together while TVN programming is on.
  const mixed =
    scope === 'curated' && edit !== null && originals.length > 0 && !tvnLineup && !liveStreamOf(edit.sources) && edit.sources.some((source) => source.kind === 'tvn' && source.enabled)
  const ownLabels = edit && !tvnLineup ? addedSourceLabels(edit.sources, sourceTitle) : null
  const shippedRows = (): ListedVideo[] => originalLineup(originals, edit?.originals).map((video): ListedVideo => ({ ...video, original: true }))
  const addedRows = (): ListedVideo[] => (edit ? inventoryOf(edit.sources).map((video): ListedVideo => ({ ...video, from: ownLabels?.get(video.id) })) : [])
  const mixedRows = (): ListedVideo[] => {
    const first = shippedRows()
    const seen = new Set(first.map((video) => video.id))
    return [...first, ...addedRows().filter((video) => !seen.has(video.id))]
  }
  const shippedPool = mixed ? contributionsOf(originals, edit?.originals) : null
  const added = edit && scope === 'curated' ? addedContributions(edit.sources, new Set(mixed ? shippedRows().map((video) => video.id) : [])) : null
  const channelSeconds = (shippedPool?.total ?? 0) + (added?.total ?? 0)
  const lineup: ListedVideo[] = edit
    ? inOrder(fromOriginals ? shippedRows() : mixed ? mixedRows() : tvnLineup ? tvnProgrammes(number) : addedRows(), edit.order)
    : []
  const decided = (edit?.originals?.length ?? 0) > 0
  const tvnSource = edit?.sources.find((source) => source.kind === 'tvn')
  const originalsIdle = !tvnSource?.enabled
    ? "TVN's programming is switched off, so none of these play."
    : edit && liveStreamOf(edit.sources)
      ? 'A live stream carries this channel, so none of these play while it does.'
      : null
  const left = new Set(edit?.excluded ?? [])
  const arranged = (edit?.order?.length ?? 0) > 0 || left.size > 0
  const ownOrder = arranged || decided
  const toggleLeft = (id: string) => {
    if (!edit) return
    const next = left.has(id) ? [...left].filter((item) => item !== id) : [...left, id]
    change({ ...edit, excluded: next.length ? next : undefined, orderKind: edit.orderKind ?? 'manual' })
  }
  const onAir = onAirVideo(channel, now)
  const sorted = ownOrder && (edit?.orderKind === 'az' || edit?.orderKind === 'latest') ? edit.orderKind : null
  const sortBy = (how: 'az' | 'latest') => {
    if (!edit) return
    const ids = (how === 'az' ? alphabeticalVideos(lineup) : latestVideos(lineup)).map((video) => video.id)
    change({ ...edit, order: ids, orderKind: how })
  }
  const latest = sorted === 'latest' ? lineup.find((video) => !left.has(video.id)) : undefined
  /** DELETE: one of TVN's own programmes is left out (tick it to bring it back); one from an added source is removed for good. */
  const deleteClip = (video: ListedVideo) => {
    if (!edit) return
    const order = edit.order?.filter((id) => id !== video.id)
    if (tvnLineup || video.original) {
      if (!left.has(video.id)) change({ ...edit, excluded: [...left, video.id], orderKind: edit.orderKind ?? 'manual' })
      return
    }
    const sources = edit.sources.map((source) =>
      source.videos?.some((item) => item.id === video.id) && !source.removed?.includes(video.id) ? { ...source, removed: [...(source.removed ?? []), video.id] } : source,
    )
    change({ ...edit, sources, ...(order ? { order } : {}), orderKind: edit.orderKind ?? 'manual' })
  }
  const deletedCount = new Set(edit?.sources.flatMap((source) => source.removed ?? []) ?? []).size
  const restoreDeleted = () => {
    if (!edit) return
    change({ ...edit, sources: edit.sources.map(({ removed: _removed, ...source }) => source) })
  }
  const move = (index: number, delta: -1 | 1) => {
    const to = index + delta
    if (!edit || to < 0 || to >= lineup.length) return
    const ids = lineup.map((video) => video.id)
    ;[ids[index], ids[to]] = [ids[to], ids[index]]
    change({ ...edit, order: ids, orderKind: 'manual' })
  }

  // SOURCES → AVAILABLE → FILTERS → ELIGIBLE → RUNNING ORDER → SCHEDULED: the counts the editor shows.
  // Programmes LOAD or a new source brought in are available and eligible, but scheduled only after RESCAN.
  const held = edit ? heldIds(edit.sources) : new Set<string>()
  const kept = lineup.filter((video) => !left.has(video.id))
  const airing = held.size ? kept.filter((video) => !held.has(video.id)) : kept
  const availableOf = (of: ChannelEdit) =>
    new Set([
      ...of.sources.filter((source) => source.enabled && !isStreamSource(source)).flatMap((source) => (source.videos ?? []).map((video) => video.id)),
      ...(mixed ? shippedRows().map((video) => video.id) : []),
    ]).size
  const available = edit ? (tvnLineup ? lineup.length : availableOf(edit)) : 0
  const scheduleSize = ownOrder && edit?.scheduleSize && edit.scheduleSize < airing.length ? edit.scheduleSize : null
  const scheduled = scheduleSize ?? airing.length
  const keptAt = new Map(airing.map((video, index) => [video.id, index]))
  const unscheduled = (id: string) => held.has(id) || (scheduleSize !== null && (keptAt.get(id) ?? -1) >= scheduleSize)
  // What RESCAN has to do: programmes held back, filters not applied, or sources and filters changed since the last rescan.
  const dirty = edit !== null && (held.size > 0 || drafts.size > 0 || (edit.compiled !== undefined && eligibilityKey(edit) !== edit.compiled))
  // Programmes newly read join the schedule at once only while the channel has nothing on air to disturb.
  const holding = edit !== null && (scope === 'curated' || inventoryOf(airingSources(edit.sources)).length > 0)
  const liveOrder = ownOrder && edit?.orderKind === 'latest' && edit.liveFromMs !== undefined
  const orderLabel = !ownOrder ? (tvnLineup ? "TVN's own" : 'Automatic') : liveOrder ? 'Latest first · live' : edit?.orderKind ? ORDER_KINDS[edit.orderKind].label : 'Yours'
  const orderHint = !ownOrder
    ? tvnLineup
      ? 'TVN schedules its own programmes for this channel'
      : 'TVN arranges these itself'
    : liveOrder
      ? 'The newest programme went to air when Latest first was pressed in the Guide; the rest follow newest to oldest'
      : edit?.orderKind
        ? ORDER_KINDS[edit.orderKind].hint
        : 'Your own running order'
  /** The order with the viewer's kept programmes first and any left out after them. */
  const withLeft = (ids: readonly string[]) => [...ids, ...lineup.filter((video) => left.has(video.id)).map((video) => video.id)]
  const setScheduleSize = (size: number | undefined) => {
    if (!edit) return
    const whole = size === undefined || !Number.isFinite(size) ? undefined : Math.max(1, Math.floor(size))
    change({
      ...edit,
      order: edit.order?.length ? edit.order : lineup.map((video) => video.id),
      orderKind: edit.orderKind ?? 'manual',
      scheduleSize: whole && whole < airing.length ? whole : undefined,
    })
  }
  // LENGTH: the shortest and longest programme the channel schedules, in minutes; applying it removes those outside.
  const lengths = edit ? lengthRangeOf(edit.sources) : {}
  const asMinutes = (seconds: number | undefined) => (seconds === undefined ? '' : String(Math.round((seconds / 60) * 10) / 10))
  const shownLength = lengthDraft ?? { min: asMinutes(lengths.minSeconds), max: asMinutes(lengths.maxSeconds) }
  const lengthChanged = lengthDraft !== null && (lengthDraft.min !== asMinutes(lengths.minSeconds) || lengthDraft.max !== asMinutes(lengths.maxSeconds))
  const applyLength = () => {
    if (!edit || !lengthDraft) return
    const seconds = (text: string) => (text.trim() === '' || !(Number(text) > 0) ? undefined : Number(text) * 60)
    const tvnRows = tvnLineup ? lineup : mixed ? shippedRows() : []
    const range = { minSeconds: seconds(lengthDraft.min), maxSeconds: seconds(lengthDraft.max) }
    const unfit = kept.filter(
      (video) => video.durationSec > 0 && ((range.minSeconds !== undefined && video.durationSec < range.minSeconds) || (range.maxSeconds !== undefined && video.durationSec > range.maxSeconds)),
    ).length
    setLengthDraft(null)
    change(withLengthRange(edit, range, tvnRows))
    setNote(unfit > 0 ? `${unfit} ${unfit === 1 ? 'PROGRAMME' : 'PROGRAMMES'} OUTSIDE THAT LENGTH REMOVED · SAVE TO KEEP IT` : 'NOTHING OUTSIDE THAT LENGTH · SAVE TO KEEP IT')
  }
  const lengthControl = edit ? (
    <span className="editor-pool-size editor-length" role="group" aria-label="Programme length">
      <span>Length</span>
      <input
        type="number"
        min={0}
        step={1}
        inputMode="decimal"
        placeholder="Any"
        value={shownLength.min}
        disabled={busy !== null}
        aria-label="Shortest programme, in minutes"
        onKeyDown={(event) => {
          keepKey(event)
          if (event.key === 'Enter') applyLength()
        }}
        onChange={(event) => setLengthDraft({ ...shownLength, min: event.target.value })}
      />
      <span>to</span>
      <input
        type="number"
        min={0}
        step={1}
        inputMode="decimal"
        placeholder="Any"
        value={shownLength.max}
        disabled={busy !== null}
        aria-label="Longest programme, in minutes"
        onKeyDown={(event) => {
          keepKey(event)
          if (event.key === 'Enter') applyLength()
        }}
        onChange={(event) => setLengthDraft({ ...shownLength, max: event.target.value })}
      />
      <span>min</span>
      {lengthChanged ? (
        <button type="button" className="tab is-on" disabled={busy !== null} onKeyDown={keepKey} onClick={applyLength}>
          Apply
        </button>
      ) : null}
    </span>
  ) : null
  /** RANDOMISE and REBUILD keep their result at once: the scheduler airs exactly the saved order. */
  const keepOrder = (next: ChannelEdit, message: string) => {
    setEdit(next)
    void run('order', async () => {
      await onSave(number, next)
      return message
    })
  }
  const randomise = () => {
    if (!edit) return
    const ids = airing.map((video) => video.id)
    const head = shuffledVideos(ids.slice(0, scheduled))
    keepOrder({ ...edit, order: withLeft([...head, ...ids.slice(scheduled)]), orderKind: 'random' }, `RANDOMISED · ${scheduled} SCHEDULED PROGRAMMES IN A NEW ORDER · SAVED`)
  }
  /** REBUILD compiles the channel as it stands: held programmes join, drawn into the new order with the rest. */
  const rebuild = () => {
    if (!edit) return
    const ids = rebuiltVideos(kept).map((video) => video.id)
    const sources = admitted(edit.sources)
    const next = { ...edit, sources, order: withLeft(ids), orderKind: 'rebuilt' as const }
    const size = scheduleSize ?? kept.length
    keepOrder({ ...next, compiled: eligibilityKey(next) }, `REBUILT FROM ${kept.length} ELIGIBLE · ${size} SCHEDULED · SAVED`)
  }
  /** REFRESH rebuilds the schedule from what the sources already hold; nothing is fetched. */
  const refresh = () => {
    if (!edit) return
    if (ownOrder && !tvnLineup) return rebuild()
    const next = { ...edit, sources: admitted(edit.sources) }
    keepOrder({ ...next, compiled: eligibilityKey(next) }, `SCHEDULE REBUILT FROM ${kept.length} ELIGIBLE · SAVED`)
  }
  const loadMore = (source: ChannelSource, all: boolean) => {
    if (!edit || !onLoadMore) return
    const stop = new AbortController()
    stopRef.current = stop
    setLoading({ id: source.id, loaded: source.videos?.length ?? 0, listed: source.listed, all })
    void run('load', async () => {
      const found = await onLoadMore(source, {
        all,
        signal: stop.signal,
        onProgress: (loaded, listed) => setLoading((current) => (current ? { ...current, loaded, listed } : current)),
      })
      const loaded = { ...edit, sources: admitted(edit.sources.map((item) => (item.id === source.id ? found : item))) }
      const next = { ...loaded, compiled: eligibilityKey(loaded) }
      setEdit(next)
      await onSave(number, next)
      const count = found.videos?.length ?? 0
      const before = source.videos?.length ?? 0
      return [
        stop.signal.aborted ? 'STOPPED' : count > before ? `${count - before} MORE LOADED` : 'NOTHING NEW',
        `${count}${found.listed ? ` OF ${found.listed}` : ''} IN THIS SOURCE`,
        found.complete ? 'WHOLE SOURCE READ' : null,
        count > before ? 'SCHEDULED · SAVED' : 'SAVED',
      ]
        .filter(Boolean)
        .join(' · ')
    }).finally(() => {
      stopRef.current = null
      setLoading(null)
    })
  }

  // Sources LOAD can read further: enabled, not yet read to the end.
  const loadableSource = (source: ChannelSource) => onLoadMore !== undefined && (canLoad ? canLoad(source) : canLoadMore(source))
  const loadable = edit ? edit.sources.filter(loadableSource) : []
  /**
   * LOAD MORE: one more batch from every enabled source that has more, one source after another. What arrives
   * joins the schedule as soon as the batch is in, after any running order of the viewer's own.
   */
  const loadBatch = () => {
    if (!edit || !onLoadMore || loadable.length === 0) return
    const stop = new AbortController()
    stopRef.current = stop
    const from = available
    setBatch({ step: 1, of: loadable.length, from, reached: from })
    void run('load', async () => {
      let next = edit
      let failed = 0
      for (const [index, source] of loadable.entries()) {
        if (stop.signal.aborted) break
        const base = availableOf(next)
        const start = source.videos?.length ?? 0
        setBatch({ step: index + 1, of: loadable.length, from, reached: base })
        setLoading({ id: source.id, loaded: start, listed: source.listed, all: false })
        try {
          const found = await onLoadMore(source, {
            signal: stop.signal,
            onProgress: (loaded, listed) => {
              setLoading((current) => (current ? { ...current, loaded, listed } : current))
              setBatch((current) => (current ? { ...current, reached: base + Math.max(0, loaded - start) } : current))
            },
          })
          next = { ...next, sources: next.sources.map((item) => (item.id === source.id ? found : item)) }
          setEdit(next)
        } catch {
          if (stop.signal.aborted) break
          failed += 1
        }
      }
      const reached = availableOf(next)
      const gained = reached > from
      if (gained) {
        const loaded = { ...next, sources: admitted(next.sources) }
        const scheduledNow = { ...loaded, compiled: eligibilityKey(loaded) }
        await onSave(number, scheduledNow)
        setEdit(scheduledNow)
      }
      return [
        stop.signal.aborted ? 'STOPPED' : null,
        gained ? `LOADED · ${from} → ${reached} AVAILABLE` : 'NOTHING NEW',
        failed ? `${failed} ${failed === 1 ? 'SOURCE' : 'SOURCES'} COULD NOT BE READ` : null,
        gained ? 'SCHEDULED · SAVED' : null,
      ]
        .filter(Boolean)
        .join(' · ')
    }).finally(() => {
      stopRef.current = null
      setLoading(null)
      setBatch(null)
    })
  }

  const noteDraft = (id: string, draft: SourceDraft | null) =>
    setDrafts((current) => {
      if (!draft && !current.has(id)) return current
      const next = new Map(current)
      if (draft) next.set(id, draft)
      else next.delete(id)
      return next
    })
  /** Rescans with every source's mode and filter as set now, applied ones and drafts alike. */
  const rescan = (base: ChannelEdit, extra?: ReadonlyMap<string, SourceDraft>) => {
    const all = new Map([...drafts, ...(extra ?? [])])
    const next = all.size > 0 ? { ...base, sources: withSourceDrafts(base.sources, all) } : base
    if (all.size > 0) setEdit(next)
    void run('rescan', async () => {
      const result = await onRescan(number, next)
      setEdit(result.edit)
      setDrafts(new Map())
      return result.message
    })
  }

  const run = async (label: string, work: () => Promise<string>) => {
    setBusy(label)
    setConfirming(false)
    setNote(label === 'rescan' ? 'RESCANNING THIS CHANNEL…' : null)
    try {
      setNote(await work())
    } catch (caught) {
      setNote(viewerMessage(caught, 'THAT DID NOT WORK'))
    } finally {
      setBusy(null)
    }
  }

  const addSource = (event: FormEvent | KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    if (!edit || !link.trim()) return
    try {
      const source = newSource(edit.sources, link, kind)
      const base = { ...edit, sources: [...edit.sources, source] }
      change(base)
      setLink('')
      setKind('auto')
      setAdding(false)
      if (onAcquire && (source.kind === 'youtube' || source.kind === 'podcast' || source.kind === 'website' || singleVideoId(source))) {
        acquire(base, source)
        return
      }
      setNote(
        source.kind === 'youtube'
          ? `SOURCE ADDED · ${source.url.replace(/^https:\/\/www\./, '').toUpperCase()} · RESCAN TO FETCH ITS PROGRAMMES`
          : source.kind === 'podcast'
            ? 'PODCAST ADDED · RESCAN TO FIND ITS FEED AND EPISODES'
            : source.kind === 'website'
              ? 'WEBSITE ADDED · RESCAN TO CHECK IT CAN BE SHOWN'
              : 'SOURCE ADDED · SAVE OR RESCAN TO USE IT',
      )
    } catch (caught) {
      setNote(viewerMessage(caught, 'THAT SOURCE COULD NOT BE ADDED'))
    }
  }

  /**
   * A new source's first programmes, read straight away and saved as available. On a channel already on air
   * they wait for RESCAN to be scheduled; the running order playing now is left as it is.
   */
  const acquire = (base: ChannelEdit, source: ChannelSource) => {
    if (!onAcquire) return
    void run('add', async () => {
      const found = await onAcquire(source)
      const count = found.videos?.length ?? 0
      const read = found.status?.state === 'ready' || count > 0
      const arrived = holding ? holdNew({ ...source, videos: [] }, found) : found
      const sources = base.sources.map((item) => (item.id === source.id ? arrived : item))
      const next = holding || !read ? { ...base, sources } : { ...base, sources, compiled: eligibilityKey({ ...base, sources }) }
      setEdit(next)
      await onSave(number, next)
      const title = sourceTitle(found).toUpperCase()
      if (!read) return `SOURCE ADDED · ${title} COULD NOT BE READ YET · SAVED · RESCAN TO TRY AGAIN`
      return `SOURCE ADDED · ${title} · ${count} ${count === 1 ? 'PROGRAMME' : 'PROGRAMMES'} AVAILABLE · SAVED${holding && count > 0 ? ' · RESCAN TO SCHEDULE THEM' : ''}`
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (adding) setAdding(false)
    else if (confirming) setConfirming(false)
    else onClose()
  }

  const kicker = (
    <p className="info-kicker">
      <span className="info-net">{scope === 'curated' ? 'TVN' : 'User'}</span>
      <span>{padChannel(number)}</span>
      <span>Edit channel</span>
    </p>
  )

  return (
    <footer ref={rootRef} className="guide-info guide-tool guide-editor" aria-label={`Edit channel ${padChannel(number)}`} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="info-actions editor-actions editor-toolbar">
        {edit ? (
          <>
            <button
              type="button"
              className="tab"
              disabled={busy !== null}
              onKeyDown={keepKey}
              title="Rebuild the schedule from the programmes already loaded; nothing is fetched"
              onClick={refresh}
            >
              {busy === 'order' ? 'Refreshing…' : 'Refresh'}
            </button>
            {onLoadMore ? (
              batch ? (
                <>
                  <span className="editor-load-progress" role="status">
                    Loading · {batch.of} {batch.of === 1 ? 'source' : 'sources'} · {batch.from} → {batch.reached}
                  </span>
                  <button type="button" className="tab" onKeyDown={keepKey} onClick={() => stopRef.current?.abort()}>
                    Stop
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="tab"
                  disabled={busy !== null || loadable.length === 0}
                  onKeyDown={keepKey}
                  title={
                    loadable.length === 0
                      ? 'Every enabled source is read as far as it goes'
                      : `Read the next batch of ${loadable.length === 1 ? 'the one source that has' : `all ${loadable.length} sources that have`} more, and schedule it`
                  }
                  onClick={loadBatch}
                >
                  Load more
                </button>
              )
            ) : null}
            <button
              type="button"
              className={dirty ? 'tab is-dirty' : 'tab'}
              disabled={busy !== null}
              onKeyDown={keepKey}
              title={
                drafts.size > 0
                  ? 'Rescans with the filter changes not applied yet'
                  : held.size > 0
                    ? `${held.size} loaded ${held.size === 1 ? 'programme waits' : 'programmes wait'} for RESCAN to be scheduled`
                    : dirty
                      ? 'Sources or filters have changed since the last rescan'
                      : undefined
              }
              onClick={() => rescan(edit)}
            >
              {busy === 'rescan' ? 'Rescanning…' : drafts.size > 0 ? 'Apply filters & rescan *' : dirty ? 'Rescan channel *' : 'Rescan channel'}
            </button>
            <button type="button" className="tune-key" disabled={busy !== null} onKeyDown={keepKey} onClick={() => void run('save', () => onSave(number, edit))}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
            {scope === 'user' && onExport ? (
              <>
                <button type="button" className="tab" disabled={busy !== null} onKeyDown={keepKey} onClick={() => void run('export', () => onExport(number, edit, 'json'))}>
                  Export channel
                </button>
              </>
            ) : null}
          </>
        ) : null}
        <button type="button" className="tab" onKeyDown={keepKey} onClick={onClose}>
          Close
        </button>
      </div>
      {edit ? (
        <p className="editor-actions-help" role="note">
          REFRESH rebuilds the schedule from the programmes already loaded. LOAD MORE reads the next batch from every source and
          schedules it at once. RESCAN CHANNEL reads every source again from the start, with its mode and filter.
        </p>
      ) : null}
      {note ? (
        <p className="guide-tool-status editor-toolbar-status" role="status">
          {note}
        </p>
      ) : null}
      <div className="info-main">
        {kicker}
        {scope === 'curated' ? (
          <p className="guide-tool-note">
            Your curation of this TVN channel is kept in this browser and in your complete export. TVN's own channel is never changed, and Restore TVN original drops your
            curation.
          </p>
        ) : null}
        {edit?.review?.length ? (
          <ul className="guide-tool-note editor-review" aria-label="To review">
            {edit.review.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        {missing ? (
          <p className="guide-tool-note">This channel could not be read.</p>
        ) : !edit ? (
          <p className="guide-tool-status">Reading…</p>
        ) : (
          <>
            <label className="editor-field">
              <span className="editor-heading">Channel name</span>
              <input
                type="text"
                value={edit.name}
                maxLength={80}
                autoComplete="off"
                spellCheck={false}
                disabled={busy !== null}
                onChange={(event) => change({ ...edit, name: event.target.value })}
              />
            </label>
            {scope === 'curated' ? (
              <label className="editor-field">
                <span className="editor-heading">Description</span>
                <textarea
                  rows={2}
                  value={edit.description ?? channel.description ?? ''}
                  maxLength={500}
                  disabled={busy !== null}
                  onKeyDown={keepKey}
                  onChange={(event) => change({ ...edit, description: event.target.value })}
                />
              </label>
            ) : null}
            <p className="editor-heading">Sources</p>
            {originals.length > 0 ? (
              <p className="guide-tool-note">
                TVN original: the sources behind TVN's own programming here. Disable or filter one in this browser only. Added: your sources; with programmes, they carry the channel in place of TVN's.
              </p>
            ) : (
              <p className="guide-tool-note">
                A channel can draw on several sources, each with its own mode and filter. Open a source to set them, check the preview, then rescan.
              </p>
            )}
            <ul className="editor-sources">
              {edit.sources.length === 0 ? <li className="editor-empty">No sources yet</li> : null}
              {edit.sources.map((source, index) => {
                const open = opened.has(source.id)
                const held = isStreamSource(source) ? [] : sourceProgrammes(source, number)
                const shipped = source.kind === 'tvn' && originals.length > 0
                const firstAdded = originals.length > 0 && source.kind !== 'tvn' && edit.sources.findIndex((item) => item.kind !== 'tvn') === index
                if (shipped) {
                  return (
                    <li key={source.id} className={source.enabled ? 'editor-source is-shipped' : 'editor-source is-shipped is-off'}>
                      <span className="editor-expand" aria-hidden="true" />
                      <label className="editor-check" title="All of TVN's own programming for this channel">
                        <input
                          type="checkbox"
                          checked={source.enabled}
                          disabled={busy !== null}
                          onKeyDown={keepKey}
                          onChange={() => setSource(source.id, { enabled: !source.enabled })}
                        />
                        <span className="editor-source-name editor-group-name">TVN original</span>
                      </label>
                      <span className="editor-source-status">{sourceStatusText(source, edit.sources)}</span>
                      <span className="editor-source-remove" aria-hidden="true" />
                      <OriginalSources
                        originals={originals}
                        overrides={edit.originals}
                        idle={originalsIdle}
                        disabled={busy !== null}
                        addedSeconds={mixed ? (added?.total ?? 0) : 0}
                        onDecide={(ref, next) => change({ ...edit, originals: withOriginalOverride(edit.originals, ref, next) })}
                      />
                    </li>
                  )
                }
                return (
                <Fragment key={source.id}>
                {firstAdded ? (
                  <li className="editor-group" aria-hidden="true">
                    Added
                  </li>
                ) : null}
                <li className={source.enabled ? 'editor-source' : 'editor-source is-off'}>
                  <button
                    type="button"
                    className="tab editor-expand"
                    aria-expanded={open}
                    aria-label={`${open ? 'Hide' : 'Show'} the details of ${sourceTitle(source)}`}
                    onKeyDown={keepKey}
                    onClick={() => toggleOpen(source.id)}
                  >
                    {open ? '−' : '+'}
                  </button>
                  <label className="editor-check" title={source.url || undefined}>
                    <input
                      type="checkbox"
                      checked={source.enabled}
                      disabled={busy !== null}
                      onKeyDown={keepKey}
                      onChange={() => setSource(source.id, { enabled: !source.enabled })}
                    />
                    <span className="editor-source-name">{sourceTitle(source)}</span>
                  </label>
                  <span className="editor-source-status">
                    {sourceStatusText(source, edit.sources)}
                    {added?.rows.get(source.id)?.programmes ? ` · adds ${contributionText(added.rows.get(source.id)!, channelSeconds)}` : null}
                  </span>
                  {onLoadMore && (source.kind === 'youtube' || source.kind === 'podcast' || (source.kind === 'collection' && !singleVideoId(source))) ? (
                    <button
                      type="button"
                      className="tab editor-source-load"
                      disabled={busy !== null || !loadableSource(source)}
                      aria-label={`Load more programmes from ${sourceTitle(source)}`}
                      title={
                        loadableSource(source)
                          ? 'Read the next batch of this source, and schedule it'
                          : source.complete
                            ? 'The whole source is read'
                            : !source.enabled
                              ? 'Enable this source to read more of it'
                              : 'TVN cannot read this source any further'
                      }
                      onKeyDown={keepKey}
                      onClick={() => loadMore(source, false)}
                    >
                      {loading?.id === source.id ? 'Loading…' : 'Load more'}
                    </button>
                  ) : null}
                  {source.kind === 'tvn' ? (
                    <span className="editor-source-remove" aria-hidden="true" />
                  ) : (
                    <button
                      type="button"
                      className="tab editor-source-remove"
                      disabled={busy !== null}
                      aria-label={`Remove source ${sourceTitle(source)}`}
                      onKeyDown={keepKey}
                      onClick={() => change({ ...edit, sources: edit.sources.filter((item) => item.id !== source.id) })}
                    >
                      Remove
                    </button>
                  )}
                  {(source.kind === 'youtube' || source.kind === 'podcast' || source.kind === 'collection') && (source.videos?.length ?? 0) > 0 ? (
                    <SourceDepth
                      source={source}
                      loading={loading?.id === source.id ? loading : null}
                      disabled={busy !== null}
                      canLoad={loadableSource(source)}
                      onAll={() => loadMore(source, true)}
                      onStop={() => stopRef.current?.abort()}
                    />
                  ) : null}
                  {source.kind === 'website' && (source.videos?.length ?? 0) > 0 ? (
                    <WebsiteSlot source={source} disabled={busy !== null} onChange={(next) => setSource(source.id, { videos: next.videos })} />
                  ) : null}
                  {open ? (
                    <SourceDetails source={source} number={number} disabled={busy !== null} onInfo={(info) => setSource(source.id, { info })} />
                  ) : null}
                  {open && (source.kind === 'youtube' || source.kind === 'collection' || source.kind === 'podcast') ? (
                    <SourceFilterPanel
                      source={source}
                      archive={archiveOf?.(source)}
                      disabled={busy !== null}
                      onApply={(filter, mode) => {
                        setSource(source.id, { filter, mode: mode === 'recent' ? undefined : mode })
                        setNote(filter || mode !== 'recent' ? 'FILTER APPLIED · RESCAN TO FETCH WITH IT · SAVE TO KEEP IT' : 'FILTER CLEARED · SAVE TO KEEP IT')
                      }}
                      onDraft={(draft) => noteDraft(source.id, draft)}
                      onRescan={(filter, mode) => rescan(edit, new Map([[source.id, { filter, mode }]]))}
                    />
                  ) : null}
                  {open && source.kind === 'youtube' && !source.url.includes('list=') ? (
                    <PlaylistDiscovery
                      channelUrl={source.url}
                      present={new Set(edit.sources.map((item) => item.url))}
                      disabled={busy !== null}
                      onAdd={(chosen) => {
                        let sources = edit.sources
                        for (const playlist of chosen) {
                          try {
                            sources = [...sources, { ...newSource(sources, playlistUrl(playlist.id), 'youtube'), label: playlist.title }]
                          } catch {
                            // Already on the channel.
                          }
                        }
                        change({ ...edit, sources })
                        setNote(`${sources.length - edit.sources.length} PLAYLISTS ADDED · RESCAN TO FETCH THEIR PROGRAMMES`)
                      }}
                    />
                  ) : null}
                  {open && !isStreamSource(source) ? (
                    held.length === 0 ? (
                      <p className="editor-videos-empty">
                        {source.kind === 'youtube' ? 'Nothing scanned yet · Rescan to fetch its programmes' : 'No programmes listed'}
                      </p>
                    ) : (
                      <>
                        <ol className="editor-videos" aria-label={`Programmes of ${sourceTitle(source)}`}>
                          {(allRows.has(source.id) ? held : held.slice(0, ROW_LIMIT)).map((video) => (
                            <li key={video.id}>
                              <span className="editor-video-title">{video.title}</span>
                              {video.published ? <span className="editor-video-day">{video.published}</span> : null}
                              <span className="editor-video-length">{formatDuration(video.durationSec)}</span>
                              <OriginalLink video={video} />
                            </li>
                          ))}
                        </ol>
                        {held.length > ROW_LIMIT && !allRows.has(source.id) ? (
                          <button type="button" className="tab editor-show-all" onKeyDown={keepKey} onClick={() => setAllRows((current) => new Set([...current, source.id]))}>
                            Show all {held.length}
                          </button>
                        ) : null}
                      </>
                    )
                  ) : null}
                </li>
                </Fragment>
                )
              })}
            </ul>
            {adding ? (
              <form className="add-channel editor-add" onSubmit={addSource} onKeyDown={keepKey}>
                <input
                  ref={linkRef}
                  type="text"
                  inputMode="url"
                  autoCapitalize="off"
                  value={link}
                  placeholder="@handle, YouTube link, podcast or website, or a stream address"
                  aria-label="Source address"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setLink(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addSource(event)
                  }}
                />
                <select value={kind} aria-label="Source type" onChange={(event) => setKind(event.target.value as SourceChoice)}>
                  {SOURCE_CHOICES.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
                <button type="submit" className="tab" disabled={!link.trim()}>
                  Add
                </button>
                <button type="button" className="tab" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <button type="button" className="tab editor-add-key" disabled={busy !== null} onKeyDown={keepKey} onClick={() => setAdding(true)}>
                + Add source
              </button>
            )}
            {(
              <>
                <div className="editor-lineup-head">
                  <button
                    type="button"
                    className="tab editor-expand"
                    aria-expanded={notesOpen}
                    aria-label={`${notesOpen ? 'Hide' : 'Show'} the editorial notes`}
                    onKeyDown={keepKey}
                    onClick={() => setNotesOpen((current) => !current)}
                  >
                    {notesOpen ? '−' : '+'}
                  </button>
                  <p className="editor-heading">Research · editorial{edit.editorial?.purpose?.trim() ? ` · ${edit.editorial.purpose.trim().slice(0, 60)}` : ''}</p>
                  <StatusPicker editorial={edit.editorial} disabled={busy !== null} onChange={(editorial) => change({ ...edit, editorial })} />
                </div>
                {notesOpen ? <EditorialPanel editorial={edit.editorial} disabled={busy !== null} onChange={(editorial) => change({ ...edit, editorial })} /> : null}
                {onExport ? (
                  <div className="editor-manifest" role="group" aria-label="Channel manifest">
                    <span className="guide-tool-note">Manifest: what the channel holds now, beside these notes and each source's filter.</span>
                    <button type="button" className="tab" disabled={busy !== null} onKeyDown={keepKey} onClick={() => void run('export', () => onExport(number, edit, 'manifest'))}>
                      Export manifest
                    </button>
                    <button type="button" className="tab" disabled={busy !== null} onKeyDown={keepKey} onClick={() => void run('export', () => onExport(number, edit, 'md'))}>
                      Readable manifest
                    </button>
                  </div>
                ) : null}
              </>
            )}
            <div className="editor-lineup-head">
              <p className="editor-heading">
                Running order ·{' '}
                <span className="editor-order-kind" title={orderHint} aria-label={`Running order: ${orderLabel}. ${orderHint}`}>
                  {orderLabel}
                </span>
              </p>
              {lineup.length > 1 && !liveStreamOf(edit.sources) ? (
                <span className="editor-sort" role="group" aria-label="Order the programmes">
                  <button type="button" className={sorted === 'az' ? 'tab is-on' : 'tab'} disabled={busy !== null} onKeyDown={keepKey} onClick={() => sortBy('az')} title="Order by title, A to Z">
                    A–Z
                  </button>
                  <button type="button" className={sorted === 'latest' ? 'tab is-on' : 'tab'} disabled={busy !== null} onKeyDown={keepKey} onClick={() => sortBy('latest')} title="Newest upload first; programmes with no date follow">
                    Latest
                  </button>
                  <button
                    type="button"
                    className="tab"
                    disabled={busy !== null}
                    onKeyDown={keepKey}
                    onClick={randomise}
                    title="Shuffle the scheduled programmes into a new order, and keep it"
                  >
                    Randomise
                  </button>
                  <button
                    type="button"
                    className="tab"
                    disabled={busy !== null}
                    onKeyDown={keepKey}
                    onClick={rebuild}
                    title="Draw a new running order from every eligible programme, taking each source in turn, and keep it"
                  >
                    Rebuild
                  </button>
                  {latest && onPlay ? (
                    <button type="button" className="tab" disabled={busy !== null} onKeyDown={keepKey} onClick={() => setNote(onPlay(number, latest.id))} title={`Play ${latest.title}`}>
                      Play latest
                    </button>
                  ) : null}
                </span>
              ) : null}
              {arranged ? (
                <button
                  type="button"
                  className="tab"
                  disabled={busy !== null}
                  onKeyDown={keepKey}
                  onClick={() => {
                    change({ ...edit, order: undefined, excluded: undefined, scheduleSize: undefined, orderKind: undefined })
                  }}
                >
                  {tvnLineup ? 'Reset order to TVN' : 'Reset to automatic'}
                </button>
              ) : null}
            </div>
            {liveStreamOf(edit.sources) ? (
              <p className="guide-tool-note">
                <span className="editor-live">Live</span> A live stream carries this channel, so it has no running order: tune to it to watch it live.
              </p>
            ) : lineup.length === 0 ? (
              <>
                <p className="guide-tool-note">
                  {edit.sources.some((source) => source.kind === 'tvn' && source.enabled)
                    ? "TVN schedules this channel's own programming. Add a source to set a running order of your own."
                    : 'No programmes yet. Add a source and rescan.'}
                </p>
                {lengths.minSeconds !== undefined || lengths.maxSeconds !== undefined ? <div className="editor-pool">{lengthControl}</div> : null}
              </>
            ) : (
              <>
                <div className="editor-pool" role="group" aria-label="Programmes">
                  <p className="editor-pool-count" role="status" aria-label="Programme counts">
                    <span>{available} available</span>
                    <span>{kept.length} eligible</span>
                    <span className="editor-pool-on">{scheduled} scheduled</span>
                    {held.size ? <span className="editor-pool-new">{held.size} new · rescan to schedule</span> : null}
                  </p>
                  {airing.length > 1 ? (
                    <label className="editor-pool-size">
                      <span>Schedule</span>
                      <input
                        type="number"
                        min={1}
                        max={airing.length}
                        step={1}
                        inputMode="numeric"
                        value={scheduleSize ?? airing.length}
                        disabled={busy !== null}
                        aria-label="Programmes scheduled"
                        onKeyDown={keepKey}
                        onChange={(event) => setScheduleSize(event.target.value === '' ? undefined : Number(event.target.value))}
                      />
                      <span>of {airing.length}</span>
                      {scheduleSize ? (
                        <button type="button" className="tab" disabled={busy !== null} onKeyDown={keepKey} onClick={() => setScheduleSize(undefined)}>
                          All
                        </button>
                      ) : null}
                    </label>
                  ) : null}
                  {lengthControl}
                </div>
                <p className="guide-tool-note">
                  {tvnLineup
                    ? ownOrder
                      ? 'The channel plays the programmes you keep, in this order, then starts again. Save to keep it.'
                      : fromOriginals
                        ? "TVN's own programmes for this channel, from its original sources, scheduled by TVN. Disable or filter a source, move a programme or leave one out to arrange it yourself."
                        : "TVN's own programmes for this channel, scheduled by TVN. Move one or leave one out to arrange it yourself."
                    : ownOrder
                    ? scheduleSize
                      ? `The channel plays the first ${scheduleSize} in this order, then starts again; the rest stay eligible, not scheduled. Save to keep it.`
                      : 'The channel plays these in this order, then starts again. Save to keep it.'
                    : reachesArchive(edit.sources)
                      ? 'TVN plays these in turn, from across the archive. Move one to set your own order.'
                      : 'TVN plays these in turn, with repeats and earlier uploads between them. Move one to set your own order.'}
                </p>
                <ol className="editor-lineup" aria-label="Running order">
                  {(allRows.has('lineup') ? lineup : lineup.slice(0, ROW_LIMIT)).map((video, index) => (
                    <li
                      key={video.id}
                      className={
                        [video.id === onAir ? 'is-on-air' : '', left.has(video.id) ? 'is-off' : '', unscheduled(video.id) ? 'is-unscheduled' : '', held.has(video.id) ? 'is-held' : '']
                          .filter(Boolean)
                          .join(' ') || undefined
                      }
                    >
                      {tvnLineup || (mixed && video.original) ? (
                        <input
                          type="checkbox"
                          className="editor-keep"
                          checked={!left.has(video.id)}
                          disabled={busy !== null}
                          aria-label={`Keep ${video.title}`}
                          onKeyDown={keepKey}
                          onChange={() => toggleLeft(video.id)}
                        />
                      ) : null}
                      <span className="editor-lineup-pos">{index + 1}</span>
                      <span className="editor-video-title">{video.title}</span>
                      {video.from ? (
                        <span className="editor-video-from" title={`From ${video.from}`}>
                          {video.from}
                        </span>
                      ) : null}
                      {video.id === onAir ? <span className="editor-lineup-now">On air</span> : null}
                      {held.has(video.id) ? (
                        <span className="editor-lineup-new" title="Loaded, not scheduled yet: RESCAN adds it to the schedule">
                          New
                        </span>
                      ) : null}
                      {scheduleSize !== null && keptAt.get(video.id) === scheduleSize ? <span className="editor-lineup-off">Not scheduled from here</span> : null}
                      <span className="editor-video-length">{formatDuration(video.durationSec)}</span>
                      <OriginalLink video={{ ...video, href: (video as ListedVideo).href ?? watchUrl(video.id) }} />
                      <button
                        type="button"
                        className="tab editor-move"
                        aria-label={`Move ${video.title} earlier`}
                        disabled={busy !== null || index === 0}
                        onKeyDown={keepKey}
                        onClick={() => move(index, -1)}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="tab editor-move"
                        aria-label={`Move ${video.title} later`}
                        disabled={busy !== null || index === lineup.length - 1}
                        onKeyDown={keepKey}
                        onClick={() => move(index, 1)}
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        className="tab editor-delete"
                        aria-label={`Delete ${video.title}`}
                        title="Delete this programme from the schedule. Save to keep it."
                        disabled={busy !== null || left.has(video.id)}
                        onKeyDown={keepKey}
                        onClick={() => deleteClip(video)}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ol>
                {deletedCount > 0 ? (
                  <button type="button" className="tab editor-restore-deleted" disabled={busy !== null} onKeyDown={keepKey} onClick={restoreDeleted}>
                    Restore {deletedCount} deleted
                  </button>
                ) : null}
                {lineup.length > ROW_LIMIT && !allRows.has('lineup') ? (
                  <button type="button" className="tab editor-show-all" onKeyDown={keepKey} onClick={() => setAllRows((current) => new Set([...current, 'lineup']))}>
                    Show all {lineup.length}
                  </button>
                ) : null}
              </>
            )}
          </>
        )}
      </div>
      {edit ? (
        <div className="editor-danger">
          {confirming ? (
            <>
              <span className="remove-ask">
                {scope === 'curated'
                  ? `Discard your changes to ${padChannel(number)} and restore it as TVN ships it?`
                  : `Delete ${padChannel(number)} from this browser? It leaves your User Network and Favourites; other channels keep their numbers.`}
              </span>
              <button type="button" className="tab remove-key" disabled={busy !== null} onKeyDown={keepKey} onClick={() => void run('delete', () => onDelete(number))}>
                {scope === 'curated' ? 'Yes, restore' : 'Yes, delete'}
              </button>
              <button type="button" className="tab" onKeyDown={keepKey} onClick={() => setConfirming(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className="tab remove-key" disabled={busy !== null} onKeyDown={keepKey} onClick={() => setConfirming(true)}>
              {scope === 'curated' ? 'Restore TVN original…' : 'Delete channel…'}
            </button>
          )}
        </div>
      ) : null}
    </footer>
  )
}
