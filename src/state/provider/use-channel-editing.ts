import { arrangementOn, arrangePlan, replaysHere, type ArrangeAsk } from '../../view/arrange.ts'
import { useCallback, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import {
  baselineChanged,
  canonicalEdit,
  clearCuratedEdit,
  curatedEditOf,
  loadCuratedEdit,
  madeForAnother,
  saveCuratedEdit,
  shippedBaseline,
} from '../../services/curated-edits.ts'
import { centralEdit } from '../../data/central-edits.ts'
import { installCurated, originalsOf, poolIdsOf, rescanDeps, restoreDeps, shippedIds } from './shared.ts'
import { reconcileOriginals } from '../../services/original-sources.ts'
import { loadRegister } from '../../credits/load.ts'
import { loadStoredSources, saveStoredSources } from '../../services/user-db.ts'
import {
  admitted,
  applyChannelEdit,
  canLoadMore,
  editOf,
  eligibilityKey,
  loadChannelWhole,
  loadMoreSource,
  rescanChannel,
  rescanSources,
  rescanSummary,
  widenSources,
  type ChannelEdit,
  type LoadMoreOptions,
} from '../../services/channel-editor.ts'
import { sourceArchive, uploaderIdFor } from '../../services/user-archive.ts'
import { migrateLegacyUserNumbers, type StoredSource } from '../../services/channels-import.ts'
import { lookUpBatch, lookUpChannel } from '../../services/add-channel.ts'
import { lookUpFeed } from '../../services/podcast-source.ts'
import { channelByNumber, listChannels, shippedProgrammes } from '../../data/catalogue.ts'
import { clearManual } from '../../player/manual.ts'
import { saveScheduleBeforeLatest, takeScheduleBeforeLatest } from '../../view/latest-mode-store.ts'
import { airingSources, inventoryOf, type ChannelSource, type OrderKind } from '../../services/channel-sources.ts'
import { alphabeticalVideos, latestVideos, rebuiltVideos, shuffledVideos } from '../../view/programme-order.ts'
import { USER_NUMBER_START, isLowUserNumber } from '../../data/network.ts'
import { padChannel } from '../../utils/time.ts'
import { curatedChannelManifest, manifestText, userChannelManifest } from '../../services/editorial-manifest.ts'
import { overrideRecord } from '../../services/central-curation.ts'
import { downloadText } from '../../services/user-network-export.ts'
import {
  addChannelFromFile,
  buildChannelFile,
  channelFilename,
  readChannelFile,
  serialiseChannelFile,
  type ChannelExportKind,
} from '../../services/channel-file.ts'
import { resolveRestored } from '../../services/user-network-restore.ts'
import {
  LOW_BLOCK,
  USER_BLOCK,
  alphabeticalOrder,
  blockFor,
  deleteUserChannel as deleteStoredUserChannel,
  moveTarget,
  moveTo,
  remapGuideLibrary,
  remapHistory,
  remapNumber,
  remapNumbers,
  renumberUserNetwork,
  shuffledOrder,
  userOrder,
  type NumberBlock,
} from '../../services/network-order.ts'
import { clearUserChannel } from '../../services/user-network.ts'
import type { SourceMode } from '../../services/channel-curation.ts'
import type { Channel } from '../../types/channel.ts'
import type { MultiviewMode } from '../../types/preferences.ts'
import type { LoadResult, PlayerHandle } from '../../player/types.ts'
import type { GuideCursor } from '../tv-context.ts'
import type { ViewingHistory } from '../history.ts'
import type { Tuned } from '../tuning.ts'
import type { GuideLibrary } from '../../services/viewing-guides.ts'
import type { Presentation } from '../transitions.ts'

export interface ChannelEditingDeps {
  forgetChannels: (gone: ReadonlySet<number>, sources: readonly StoredSource[]) => void
  scopeOf: (number: number) => { target: Channel; scope: "tvn" | "user" | "curated" | "local"; shipped: Channel }
  installSources: (sources: readonly StoredSource[], instead?: number | undefined) => void
  channelRef: RefObject<number>
  multiviewRef: RefObject<MultiviewMode>
  loadedKey: RefObject<string>
  tuningRef: RefObject<boolean>
  playerRef: RefObject<PlayerHandle | null>
  playerReadyRef: RefObject<boolean>
  loadProgramme: (target: Channel, nowMs: number) => Promise<LoadResult>
  exportUserNetwork: () => Promise<string>
  guideOpenRef: RefObject<boolean>
  flash: (message: string, ms?: number) => void
  readWholeRef: RefObject<(number: number) => void>
  playlistQueue: RefObject<Promise<void>>
  closeGuideTool: () => void
  closeScreenEdit: (quiet?: boolean) => void
  visibleRef: RefObject<Channel[]>
  focusGuide: (nextChannel: number, timeMs: number) => void
  cursorRef: RefObject<GuideCursor>
  setFavourites: Dispatch<SetStateAction<number[]>>
  historyRef: RefObject<ViewingHistory>
  setHistory: Dispatch<SetStateAction<ViewingHistory>>
  tilesRef: RefObject<number[]>
  setTiles: Dispatch<SetStateAction<number[]>>
  previousRef: RefObject<number | null>
  commitChannel: (next: Tuned, record?: boolean) => void
  guideLibraryRef: RefObject<GuideLibrary>
  setGuideLibrary: (next: GuideLibrary) => void
  setGuideCursor: Dispatch<SetStateAction<GuideCursor>>
  presentationRef: RefObject<Presentation | null>
}

/** EDIT Channel and the NETWORK editor: saving, rescanning and arranging channels, loading more, and deleting, moving and renumbering them. */
export function useChannelEditing({
  forgetChannels,
  scopeOf,
  installSources,
  channelRef,
  multiviewRef,
  loadedKey,
  tuningRef,
  playerRef,
  playerReadyRef,
  loadProgramme,
  exportUserNetwork,
  guideOpenRef,
  flash,
  readWholeRef,
  playlistQueue,
  closeGuideTool,
  closeScreenEdit,
  visibleRef,
  focusGuide,
  cursorRef,
  setFavourites,
  historyRef,
  setHistory,
  tilesRef,
  setTiles,
  previousRef,
  commitChannel,
  guideLibraryRef,
  setGuideLibrary,
  setGuideCursor,
  presentationRef,
}: ChannelEditingDeps) {
  const openChannelEdit = useCallback(async (number: number): Promise<ChannelEdit | null> => {
    const { scope, shipped } = scopeOf(number)
    if (scope === 'curated') {
      const saved = loadCuratedEdit(number) ?? centralEdit(number)
      if (saved && madeForAnother(saved, shipped)) {
        const label = String(number).padStart(3, '0')
        return { ...curatedEditOf(shipped, null), review: [`Your curation of ${saved.baseline?.name} is set aside, not applied: TVN now has ${shipped.name} at ${label} · saving here replaces it`] }
      }
      const edit = curatedEditOf(shipped, saved)
      const changed = saved && baselineChanged(saved, shippedBaseline(shipped, shippedIds(shipped))) ? ['TVN has changed this channel since you curated it'] : []
      const sources = reconcileOriginals(saved?.originals, originalsOf(number, await loadRegister()), String(number).padStart(3, '0')).conflicts
      const review = [...(saved?.conflicts ?? []), ...changed, ...sources.filter((line) => !saved?.conflicts?.includes(line))]
      return review.length ? { ...edit, review } : edit
    }
    const record = (await loadStoredSources()).find((item) => item.channelNumber === number)
    return record ? editOf(record) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveChannelEdit = useCallback(
    async (number: number, edit: ChannelEdit) => {
      const { scope, shipped } = scopeOf(number)
      if (scope === 'curated') {
        const saved = saveCuratedEdit(shipped, { ...edit, sources: widenSources(edit.sources, sourceArchive) }, Date.now(), undefined, shippedIds(shipped), poolIdsOf(number))
        installCurated()
        return saved ? 'SAVED · IN THIS BROWSER ONLY' : 'SAVED · AS TVN SHIPS IT'
      }
      const widened = { ...edit, sources: widenSources(edit.sources, sourceArchive) }
      const next = applyChannelEdit(migrateLegacyUserNumbers(await loadStoredSources()).sources, number, widened, Date.now())
      await saveStoredSources(next)
      installSources(next)
      return 'SAVED'
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [installSources],
  )

  const acquireChannelSource = useCallback(async (source: ChannelSource) => (await rescanSources([source], rescanDeps(), Date.now()))[0], [rescanDeps])

  const rescanChannelEdit = useCallback(
    async (number: number, edit: ChannelEdit) => {
      const { scope, shipped } = scopeOf(number)
      const deps = rescanDeps()
      const now = Date.now()
      if (scope === 'curated') {
        const sources = await rescanSources(edit.sources, deps, now)
        const next = { ...edit, sources, compiled: eligibilityKey({ ...edit, sources }) }
        saveCuratedEdit(shipped, next, now, undefined, shippedIds(shipped), poolIdsOf(number))
        installCurated()
        return { edit: next, message: rescanSummary(sources) }
      }
      const result = await rescanChannel(migrateLegacyUserNumbers(await loadStoredSources()).sources, number, edit, deps, now)
      await saveStoredSources(result.all)
      installSources(result.all)
      return { edit: result.edit, message: result.message }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [installSources, rescanDeps],
  )

  /**
   * The watched channel was rearranged: its new schedule plays from where it stands now. Any other channel only
   * has its schedule updated, and starts when the viewer chooses it; Multi View tiles follow their schedules.
   */
  const replayIfWatching = (number: number) => {
    const target = channelByNumber(number)
    if (!target) return
    if (!replaysHere(number, channelRef.current, multiviewRef.current)) return
    clearManual()
    loadedKey.current = ''
    if (!tuningRef.current && playerRef.current && playerReadyRef.current) void loadProgramme(target, Date.now())
  }

  /**
   * LATEST, A–Z and RANDOM in the Guide: one on at a time. Pressing one arranges the channel that way (LATEST
   * rescans first, so its very latest programme is on now); LATEST and A–Z pressed again, or RESET, return the
   * channel's default schedule, and RANDOM deals a fresh order every time it is pressed. Replayed if watched.
   * LATEST right-clicked ('latest-now') never switches it off: the channel is read again and set to its very
   * latest programmes from now, whatever it was arranged as before.
   */
  const arrangeChannel = useCallback(
    async (number: number, asked: ArrangeAsk) => {
      const edit = await openChannelEdit(number)
      if (!edit) throw new Error('This channel cannot be arranged here')
      const { review: _review, ...opened } = edit
      const on = arrangementOn(opened)
      const plan = arrangePlan(asked, on)
      const { again, name } = plan
      if (plan.step === 'already-default') return 'RESET · THIS IS ALREADY THE DEFAULT SCHEDULE'
      if (plan.step === 'restore') {
        const before = takeScheduleBeforeLatest(number)
        const restored = before?.order?.length
          ? { ...opened, order: before.order, orderKind: before.orderKind, scheduleSize: before.scheduleSize, liveFromMs: undefined }
          : { ...opened, order: undefined, orderKind: undefined, scheduleSize: undefined, liveFromMs: undefined }
        await saveChannelEdit(number, restored)
        replayIfWatching(number)
        return `${plan.how === 'reset' ? 'RESET' : `${name} OFF`} · ${before?.order?.length ? 'YOUR SCHEDULE IS BACK' : 'SCHEDULED BY TVN'}`
      }
      const { how } = plan
      const current =
        how === 'latest'
          ? await rescanChannelEdit(number, opened).then(
            (result) => result.edit,
            () => opened,
          )
          : opened
      const pool = inventoryOf(airingSources(current.sources))
      if (pool.length === 0) throw new Error(`TVN schedules this channel's own programming: add a source to arrange it ${name}`)
      const order = (how === 'latest' ? latestVideos(pool) : how === 'az' ? alphabeticalVideos(pool) : shuffledVideos(pool)).map((video) => video.id)
      // The default to come back to is what the channel had before any of the three was on.
      if (on === null) saveScheduleBeforeLatest(number, { order: opened.order, orderKind: opened.orderKind, scheduleSize: opened.scheduleSize })
      await saveChannelEdit(number, { ...current, order, orderKind: how, liveFromMs: how === 'latest' ? Date.now() : undefined, scheduleSize: undefined })
      replayIfWatching(number)
      if (how === 'az') return 'A–Z ON · THE SCHEDULE RUNS A TO Z'
      if (how === 'random') return on === 'random' ? 'RANDOM · SHUFFLED AGAIN' : 'RANDOM ON · THE SCHEDULE IS IN A RANDOM ORDER'
      const first = pool.find((video) => video.id === order[0])
      return `${again ? 'LATEST AGAIN' : 'LATEST ON'} · ${(first?.title ?? '').toUpperCase().slice(0, 60)} NOW, THEN NEWEST TO OLDEST`
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openChannelEdit, rescanChannelEdit, saveChannelEdit],
  )
  const latestFirst = useCallback((number: number) => arrangeChannel(number, 'latest'), [arrangeChannel])

  /**
   * RELOAD (X, no longer a Guide button): the channel rescanned and scheduled again. A running order arranged by
   * hand is kept, with what the rescan found joining it; A–Z sorts again and a shuffle reshuffles; any other
   * channel is rebuilt afresh from every eligible programme, each source in turn. Replayed if watched.
   */
  const reloadChannel = useCallback(
    async (number: number) => {
      const edit = await openChannelEdit(number)
      if (!edit) throw new Error('This channel cannot be reloaded here')
      const { review: _review, ...current } = edit
      const result = await rescanChannelEdit(number, current)
      const next = result.edit
      const pool = inventoryOf(airingSources(next.sources))
      const kind = next.order?.length ? next.orderKind : undefined
      if (kind === 'manual' || pool.length === 0) {
        replayIfWatching(number)
        return `${result.message} · ${kind === 'manual' ? 'YOUR ORDER KEPT' : 'SCHEDULED BY TVN'}`
      }
      if (kind === 'latest' && next.liveFromMs !== undefined) {
        const latest = { ...next, order: latestVideos(pool).map((video) => video.id), orderKind: 'latest' as const, liveFromMs: Date.now(), scheduleSize: undefined }
        await saveChannelEdit(number, { ...latest, compiled: eligibilityKey(latest) })
        replayIfWatching(number)
        return `${result.message} · LATEST FROM NOW`
      }
      const fromSource = new Map(next.sources.flatMap((source) => (source.videos ?? []).map((video) => [video.id, source.id] as const)))
      const order = kind === 'az' ? alphabeticalVideos(pool) : kind === 'random' ? shuffledVideos(pool) : rebuiltVideos(pool.map((video) => ({ ...video, from: fromSource.get(video.id) })))
      const orderKind: OrderKind = kind === 'az' || kind === 'random' ? kind : 'rebuilt'
      const scheduled = { ...next, order: order.map((video) => video.id), orderKind, liveFromMs: undefined }
      await saveChannelEdit(number, { ...scheduled, compiled: eligibilityKey(scheduled) })
      replayIfWatching(number)
      return `${result.message} · ${orderKind === 'az' ? 'RESCHEDULED A–Z' : orderKind === 'random' ? 'RESHUFFLED' : 'RESCHEDULED'}`
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openChannelEdit, rescanChannelEdit, saveChannelEdit],
  )

  const loadMoreChannelSource = useCallback(
    (source: ChannelSource, options: LoadMoreOptions) =>
      loadMoreSource(
        source,
        {
          resolveYouTube: (url: string, more?: { mode?: SourceMode }) => lookUpChannel(url, fetch, { ...more }),
          resolveBatch: (cursor: string, signal?: AbortSignal) => lookUpBatch(cursor, fetch, signal),
          resolveFeed: (url: string, more?: { mode?: SourceMode; as?: 'website' }) => lookUpFeed(url, fetch, { fresh: true, ...more }),
          uploaderOf: uploaderIdFor,
        },
        options,
      ),
    [],
  )

  /**
   * LOAD ALL & EXPORT in OPTIONS: every User Network channel, one after another, rescanned and read in full
   * (`loadChannelWhole`), each saved as soon as it is read, then the USER export. STOP keeps what has loaded and
   * exports nothing.
   */
  const loadAllAndExportUser = useCallback(
    async (onProgress: (percent: number, channel: string) => void, signal?: AbortSignal) => {
      const stored = async () => migrateLegacyUserNumbers(await loadStoredSources()).sources
      const numbers = (await stored())
        .map((record) => record.channelNumber)
        .filter((number): number is number => typeof number === 'number' && number >= USER_NUMBER_START)
        .sort((a, b) => a - b)
      const deps = rescanDeps()
      let channels = 0
      let failed = 0
      let before = 0
      let after = 0
      for (const [index, number] of numbers.entries()) {
        if (signal?.aborted) break
        const record = (await stored()).find((item) => item.channelNumber === number)
        if (!record) continue
        const label = `${padChannel(number)} ${record.name}`
        const report = (fraction: number) => onProgress(Math.min(99, Math.floor(((index + fraction) / numbers.length) * 100)), label)
        report(0)
        const edit = editOf(record)
        const whole = await loadChannelWhole(edit, deps, loadMoreChannelSource, { ...(signal ? { signal } : {}), onProgress: report }).catch(() => null)
        if (!whole) {
          failed += 1
          continue
        }
        const latest = await stored()
        if (!latest.some((item) => item.channelNumber === number)) continue
        const next = { ...whole, sources: widenSources(whole.sources, sourceArchive) }
        await saveStoredSources(applyChannelEdit(latest, number, { ...next, compiled: eligibilityKey(next) }, Date.now()))
        const count = (sources: readonly ChannelSource[]) => sources.reduce((sum, source) => sum + (source.enabled ? (source.videos?.length ?? 0) : 0), 0)
        before += count(edit.sources)
        after += count(next.sources)
        channels += 1
      }
      installSources(await stored())
      const loaded = `${channels} ${channels === 1 ? 'CHANNEL' : 'CHANNELS'} LOADED · ${after} PROGRAMMES (${after - before >= 0 ? '+' : ''}${after - before})${failed ? ` · ${failed} COULD NOT BE READ` : ''}`
      if (signal?.aborted) return `STOPPED · ${loaded} · KEPT, NOT EXPORTED`
      onProgress(100, '')
      return `${loaded} · ${await exportUserNetwork()}`
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exportUserNetwork, installSources, loadMoreChannelSource, rescanDeps],
  )

  const [loadAll, setLoadAll] = useState<{ percent: number; channel: string; result?: string } | null>(null)
  const loadAllStop = useRef<AbortController | null>(null)
  const startLoadAll = useCallback(() => {
    if (loadAllStop.current) return
    const stop = new AbortController()
    loadAllStop.current = stop
    setLoadAll({ percent: 0, channel: '' })
    const finish = (result: string, percent: number) => {
      loadAllStop.current = null
      setLoadAll({ percent, channel: '', result })
      if (!guideOpenRef.current) flash(result, 6000)
    }
    loadAllAndExportUser((percent, channel) => setLoadAll({ percent, channel }), stop.signal).then(
      (result) => finish(result, stop.signal.aborted ? 0 : 100),
      (caught: unknown) => finish(caught instanceof Error ? caught.message.toUpperCase() : 'LOAD ALL & EXPORT DID NOT WORK', 0),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAllAndExportUser])
  const stopLoadAll = useCallback(() => loadAllStop.current?.abort(), [])

  /**
   * A playlist added is read to its end (up to the ceiling) in the background, one channel and one page at a time,
   * and every programme found is scheduled. What the viewer changed meanwhile stays: only the playlists read are merged.
   */
  const readWholePlaylists = async (number: number) => {
    const stored = async () => migrateLegacyUserNumbers(await loadStoredSources()).sources
    const record = (await stored()).find((item) => item.channelNumber === number)
    const wanted = record ? editOf(record).sources.filter((source) => source.kind === 'youtube' && source.youtube === 'playlist' && canLoadMore(source)) : []
    if (wanted.length === 0) return
    const read = new Map<string, ChannelSource>()
    for (const source of wanted) {
      const found = await loadMoreChannelSource(source, { all: true }).catch(() => null)
      if (found) read.set(source.id, found)
    }
    if (read.size === 0) return
    const all = await stored()
    const latest = all.find((item) => item.channelNumber === number)
    if (!latest) return
    const current = editOf(latest)
    let loaded = 0
    let listed = 0
    const sources = current.sources.map((source) => {
      const found = read.get(source.id)
      if (!found || source.kind !== 'youtube' || source.url !== found.url) return source
      const ids = new Set((found.videos ?? []).map((video) => video.id))
      const videos = [...(found.videos ?? []), ...(source.videos ?? []).filter((video) => !ids.has(video.id))]
      loaded += videos.length
      listed += found.listed ?? videos.length
      const { more: _more, complete: _complete, listed: _listed, ...rest } = source
      return {
        ...rest,
        videos,
        deep: true,
        ...(found.listed !== undefined ? { listed: found.listed } : {}),
        ...(found.more ? { more: found.more } : {}),
        ...(found.complete ? { complete: true } : {}),
        status: { state: 'ready' as const, playable: videos.length, checkedAt: Date.now() },
      }
    })
    if (loaded === 0) return
    const next = { ...current, sources: admitted(sources) }
    const saved = applyChannelEdit(all, number, { ...next, sources: widenSources(next.sources, sourceArchive), compiled: eligibilityKey(next) }, Date.now())
    await saveStoredSources(saved)
    installSources(saved)
    flash(`${padChannel(number)} · WHOLE PLAYLIST READ · ${loaded} OF ${listed} PROGRAMMES SCHEDULED`, 2600)
  }
  readWholeRef.current = (number: number) => {
    playlistQueue.current = playlistQueue.current.then(() => readWholePlaylists(number)).catch(() => {})
  }

  const canLoadChannelSource = useCallback((source: ChannelSource) => canLoadMore(source, source.kind === 'collection' && !!source.ref && uploaderIdFor(source.ref) !== null), [])

  const exportChannelFile = useCallback(
    async (number: number, edit: ChannelEdit, as: ChannelExportKind) => {
      const { scope, shipped } = scopeOf(number)
      if (scope === 'curated') {
        if (as === 'json') throw new Error('Only your own channels can be exported as a channel file')
        const shown = canonicalEdit(shipped, { ...edit, sources: widenSources(edit.sources, sourceArchive) }, shippedIds(shipped), poolIdsOf(number))
        const manifest = curatedChannelManifest(number, shown, shippedProgrammes(shipped.id), originalsOf(number, await loadRegister()))
        const record = overrideRecord({ channelNumber: number, ...shown, savedAt: Date.now() })
        if (as === 'md') {
          downloadText(channelFilename(record, 'md'), manifestText(manifest, record), 'text/markdown')
          return 'READABLE MANIFEST EXPORTED'
        }
        downloadText(channelFilename(record, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
        return 'CHANNEL MANIFEST EXPORTED'
      }
      // What the editor shows, unsaved changes included, on a copy: exporting never saves.
      const shown = applyChannelEdit(migrateLegacyUserNumbers(await loadStoredSources()).sources, number, { ...edit, sources: widenSources(edit.sources, sourceArchive) }, Date.now())
      const record = shown.find((item) => item.channelNumber === number)
      if (!record) throw new Error('That channel is no longer in your User Network')
      if (as === 'md') {
        downloadText(channelFilename(record, 'md'), manifestText(userChannelManifest(record), record), 'text/markdown')
        return 'READABLE MANIFEST EXPORTED'
      }
      if (as === 'manifest') {
        downloadText(channelFilename(record, 'manifest.json'), `${JSON.stringify(userChannelManifest(record), null, 2)}\n`)
        return 'CHANNEL MANIFEST EXPORTED'
      }
      downloadText(channelFilename(record), serialiseChannelFile(buildChannelFile(record, new Date(), uploaderIdFor)))
      return 'CHANNEL EXPORTED'
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const importChannelFile = useCallback(
    async (text: string, owner: string) => {
      const read = readChannelFile(text)
      if (!read.ok) throw new Error(read.errors[0] ?? 'That channel file could not be read')
      const now = Date.now()
      const existing = migrateLegacyUserNumbers(await loadStoredSources()).sources
      const added = addChannelFromFile(existing, read.value, owner, now)
      const resolved = await resolveRestored([added.record], restoreDeps, now)
      const record = resolved.records[0]
      const next = added.sources.map((item) => (item === added.record ? record : item))
      await saveStoredSources(next)
      installSources(next)
      const failed = resolved.failed > 0 ? ` · ${resolved.failed} ${resolved.failed === 1 ? 'SOURCE' : 'SOURCES'} COULD NOT BE READ` : ''
      return { message: `CHANNEL IMPORTED AS ${added.number}${failed}`, number: added.number }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [installSources],
  )

  const restoreCuratedChannel = useCallback(
    async (number: number) => {
      if (scopeOf(number).scope !== 'curated') throw new Error('Only TVN channels can be restored')
      clearCuratedEdit(number)
      installCurated()
      closeGuideTool()
      closeScreenEdit()
      return `${String(number).padStart(3, '0')} RESTORED AS TVN SHIPS IT`
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  /**
   * Delete one user channel: it leaves the User Network entirely, and with it every Favourite, Multi View
   * window and history entry that named it. Saved Guides keep their items; one that named the channel
   * shows as missing, as a restored Guide's unresolvable items do. Watching it falls back safely.
   */
  const deleteUserChannel = useCallback(
    async (number: number, fromNetwork = false) => {
      if (scopeOf(number).scope !== 'user') throw new Error('Only your own channels can be deleted')
      const result = deleteStoredUserChannel(migrateLegacyUserNumbers(await loadStoredSources()).sources, number)
      if (result.status === 'missing') throw new Error('That channel is no longer in your User Network')
      const name = channelByNumber(number)?.name ?? `${number}`
      // The channel listed above the deleted one takes its place, or the one below when it was first.
      const rows = visibleRef.current.filter((channel) => channel.number !== number)
      const near = rows.findLast((channel) => channel.number < number) ?? rows.find((channel) => channel.number > number)
      // Deleted from NETWORK, the Network Editor stays open on its list.
      if (!fromNetwork) closeGuideTool()
      await saveStoredSources(result.sources)
      forgetChannels(new Set([number]), result.sources)
      installSources(result.sources, near?.number)
      if (guideOpenRef.current && near && !fromNetwork) focusGuide(near.number, cursorRef.current.timeMs)
      return `${name.toUpperCase()} DELETED`
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusGuide, installSources],
  )

  /**
   * Reorder the User Network: `ids` is every 1001+ channel's id in the new order. Each channel is renumbered
   * from 1001 with no gaps, and everything naming one by number follows it; the channel watched carries on
   * playing under its new number.
   */
  const reorderUserNetwork = useCallback(
    async (ids: readonly string[], block: NumberBlock = USER_BLOCK) => {
      const { sources, moves } = renumberUserNetwork(migrateLegacyUserNumbers(await loadStoredSources()).sources, ids, block)
      if (moves.size === 0) return 'THE ORDER IS UNCHANGED'
      await saveStoredSources(sources)
      const follow = (number: number) => remapNumber(number, moves)
      setFavourites((current) => remapNumbers(current, moves))
      historyRef.current = remapHistory(historyRef.current, moves)
      setHistory(historyRef.current)
      if (tilesRef.current.some((item) => moves.has(item))) {
        const kept = remapNumbers(tilesRef.current, moves)
        tilesRef.current = kept
        setTiles(kept)
      }
      commitChannel({ channelNumber: follow(channelRef.current), previousNumber: previousRef.current === null ? null : follow(previousRef.current) }, false)
      const guides = remapGuideLibrary(guideLibraryRef.current, moves)
      if (guides !== guideLibraryRef.current) setGuideLibrary(guides)
      if (moves.has(cursorRef.current.channelNumber)) {
        const nextCursor = { ...cursorRef.current, channelNumber: follow(cursorRef.current.channelNumber) }
        cursorRef.current = nextCursor
        setGuideCursor(nextCursor)
      }
      if (presentationRef.current && moves.has(presentationRef.current.number)) presentationRef.current = { ...presentationRef.current, number: follow(presentationRef.current.number) }
      installSources(sources)
      return `USER NETWORK RENUMBERED · ${moves.size} ${moves.size === 1 ? 'CHANNEL' : 'CHANNELS'} MOVED`
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [installSources],
  )

  /**
   * X in NETWORK. A 1001+ channel is deleted and the User Network closes up behind it, every later channel
   * moving up one number. One of the viewer's own 001–990 (a NEW network) becomes an empty channel on the
   * same number, and nothing else moves. TVN's own channels are never deleted.
   */
  const deleteNetworkChannel = useCallback(
    async (number: number) => {
      if (scopeOf(number).scope !== 'user') throw new Error('TVN’s own channels cannot be deleted')
      const label = `${String(number).padStart(3, '0')} ${(channelByNumber(number)?.name ?? '').toUpperCase()}`.trim()
      if (isLowUserNumber(number)) {
        const result = clearUserChannel(migrateLegacyUserNumbers(await loadStoredSources()).sources, number, Date.now())
        if (result.status === 'missing') throw new Error('That channel is no longer in your network')
        if (result.status === 'already-empty') return `${String(number).padStart(3, '0')} IS ALREADY AN EMPTY CHANNEL`
        await saveStoredSources(result.sources)
        installSources(result.sources)
        return `${label} DELETED · ${String(number).padStart(3, '0')} IS NOW AN EMPTY CHANNEL`
      }
      await deleteUserChannel(number, true)
      const remaining = userOrder(migrateLegacyUserNumbers(await loadStoredSources()).sources, USER_BLOCK)
      const moved = await reorderUserNetwork(remaining.map((source) => source.id), USER_BLOCK)
      return moved === 'THE ORDER IS UNCHANGED' ? `${label} DELETED` : `${label} DELETED · THE CHANNELS AFTER IT MOVED UP ONE`
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deleteUserChannel, reorderUserNetwork, installSources],
  )

  /** MOVE TO: one user channel taken out and put in at User position `to`; the rest close up and renumber from 1001. */
  const moveUserChannel = useCallback(
    async (number: number, to: number) => {
      // 001–990 and 1001+ each keep their own run of numbers.
      const block = blockFor(number)
      const order = userOrder(migrateLegacyUserNumbers(await loadStoredSources()).sources, block)
      const from = order.find((source) => source.channelNumber === number)
      if (!from) throw new Error('That channel is no longer in your User Network')
      const target = moveTarget(order, to, block)
      if ('error' in target) throw new Error(target.error)
      return reorderUserNetwork(moveTo(order.map((source) => source.id), from.id, target.index), block)
    },
    [reorderUserNetwork],
  )

  /** SORT A–Z or RANDOMISE: the whole User Network put in a new order once, kept as its running order. */
  const arrangeUserNetwork = useCallback(
    async (how: 'alphabetical' | 'shuffle') => {
      const sources = migrateLegacyUserNumbers(await loadStoredSources()).sources
      const shown = new Map(listChannels().map((channel) => [channel.id, channel.name]))
      const orderOf = (block: NumberBlock) =>
        how === 'alphabetical' ? alphabeticalOrder(sources, (source) => shown.get(`user-${source.id}`) ?? source.name, block) : shuffledOrder(userOrder(sources, block).map((source) => source.id))
      // Channels at 001–990 are arranged among themselves first; 1001+ as before.
      const low = userOrder(sources, LOW_BLOCK).length > 0 ? await reorderUserNetwork(orderOf(LOW_BLOCK), LOW_BLOCK) : 'THE ORDER IS UNCHANGED'
      const high = await reorderUserNetwork(orderOf(USER_BLOCK))
      const done = high === 'THE ORDER IS UNCHANGED' ? low : high
      if (done === 'THE ORDER IS UNCHANGED') return how === 'alphabetical' ? 'THE USER NETWORK IS ALREADY A–Z' : done
      return done.replace('USER NETWORK RENUMBERED', how === 'alphabetical' ? 'USER NETWORK SORTED A–Z' : 'USER NETWORK RANDOMISED')
    },
    [reorderUserNetwork],
  )
  return {
    openChannelEdit,
    saveChannelEdit,
    acquireChannelSource,
    rescanChannelEdit,
    arrangeChannel,
    latestFirst,
    reloadChannel,
    loadMoreChannelSource,
    loadAllAndExportUser,
    loadAll,
    startLoadAll,
    stopLoadAll,
    canLoadChannelSource,
    exportChannelFile,
    importChannelFile,
    restoreCuratedChannel,
    deleteUserChannel,
    deleteNetworkChannel,
    moveUserChannel,
    arrangeUserNetwork,
  }
}
