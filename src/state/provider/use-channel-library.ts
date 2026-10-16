import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { setVideoOverride } from '../../services/overrides.ts'
import { ingestParsed, saveDeferredLibrary } from '../../library/store.ts'
import { loadStoredSources, saveStoredSources } from '../../services/user-db.ts'
import {
  channelsFromSources,
  emptySlotRecord,
  firstEmptySlot,
  migrateLegacyUserNumbers,
  planImport,
  type ParsedExport,
  type StoredSource,
} from '../../services/channels-import.ts'
import { channelByNumber, channels, programmesFor, shippedChannel, shippedProgrammes } from '../../data/catalogue.ts'
import { refusedVideos } from '../../services/embed-refusals.ts'
import { sourceArchive, uploaderArchive, uploaderIdFor } from '../../services/user-archive.ts'
import { currentNetworkBase, installCuratedEdits, installUserCatalogue, setNetworkBase } from '../../data/user-overlay.ts'
import { userLibraryMode } from '../../library/mode.ts'
import { addRoute } from '../../sources/providers.ts'
import {
  ADD_MANY_AT_ONCE,
  STARTER_AFTER_PICTURE_MS,
  STARTUP_RETRY_MS,
  goneNumbers,
  installCurated,
  keepPools,
  originalsOf,
  readerFeed,
  rescanDeps,
  restoreDeps,
  shippedIds,
} from './shared.ts'
import {
  addChannelSource,
  addPodcastChannel,
  addStreamChannel,
  planStarterNetwork,
  removeUserChannels as withoutUserChannels,
  starterCollections,
} from '../../services/user-network.ts'
import { lookUpChannel } from '../../services/add-channel.ts'
import { addClipsChannel, clipVideo } from '../../services/bookmark-channel.ts'
import { applyChannelEdit, rescanSources, widenSources } from '../../services/channel-editor.ts'
import { LOW_USER_FIRST, LOW_USER_LAST, USER_NUMBER_LIMIT, USER_NUMBER_START, isLowUserNumber } from '../../data/network.ts'
import { addUser, checkUserName, releaseUserChannels, userFilter, type NetworkUser } from '../../data/user-network/users.ts'
import {
  favouritesAfterRangeRestore,
  favouritesAfterRestore,
  inRange,
  recordsFromExport,
  resolveRestored,
  appendPackedChannels,
  favouritesAfterAppend,
  restoreChannelRange,
  restoreUserNetwork,
  usersAfterRangeRestore,
  usersFromExport,
  type ChannelRange,
} from '../../services/user-network-restore.ts'
import { setStarterState, starterIds, starterState, withoutStarter } from '../../data/user-network/starter.ts'
import { BUILT_IN_CATALOGUE_ID, PREVIOUS_STARTER_FILES, readStarterNetwork, readStarterTemplate } from '../../data/user-network/bootstrap.ts'
import { PLAYER_LOAD_TIMEOUT_MS } from '../../player/picture.ts'
import { afterPaint } from '../after-paint.ts'
import { placeStarterFavourites, starterFavouriteSources } from '../../services/default-favourites.ts'
import { followMovedChannels, loadCuratedEdits, replaceCuratedEdits, shippedBaseline, type CuratedEdit } from '../../services/curated-edits.ts'
import { buildUserNetworkExport, downloadText, exportFilename, serialiseUserNetworkExport, type UserNetworkExport } from '../../services/user-network-export.ts'
import { loadRegister } from '../../credits/load.ts'
import {
  buildPickedExport,
  buildRangeExport,
  buildTvnExport,
  pickedExportFilename,
  rangeExportFilename,
  serialiseTvnExport,
  tvnExportFilename,
  validateTvnExport,
  type TvnExport,
} from '../../services/tvn-export.ts'
import { VOLUME_FULL } from '../../player/volume.ts'
import { setTvnChannelSettings, tvnChannelSettings } from '../../tvn/tvn-channel.ts'
import { BUILD_INFO } from '../../build-info.ts'
import { padChannel } from '../../utils/time.ts'
import { editorScope } from '../../view/channel-edit.ts'
import { CENTRAL_CURATION_FORMAT, overrideRecord, overridesFromExport, reconcileOverride, type CentralCuration } from '../../services/central-curation.ts'
import { libraryFrom, type GuideLibrary } from '../../services/viewing-guides.ts'
import { clampGuideSplit } from '../../view/guide-mode.ts'
import { asShortcuts, type ShortcutAssignment } from '../../view/info-shortcuts.ts'
import { asSurfRange, saveSurfRange, type SurfRange } from '../surf.ts'
import { asTransitionSettings, saveTransitionSettings, type TransitionSettings } from '../transitions.ts'
import type { FoundFeed } from '../../services/podcast-source.ts'
import type { Bookmark } from '../../view/bookmarks-store.ts'
import type { ChannelSource } from '../../services/channel-sources.ts'
import type { ChannelEditorial } from '../../services/channel-curation.ts'
import type { GuideFilter } from '../../types/preferences.ts'
import type { StartupPhase } from '../startup.ts'
import type { PlayerHandle } from '../../player/types.ts'

export interface ChannelLibraryDeps {
  userIds: () => Set<string>
  flash: (message: string, ms?: number) => void
  userEditorialRef: RefObject<Map<number, ChannelEditorial>>
  channelRef: RefObject<number>
  requestTune: (number: number, keepPick?: boolean) => void
  readWholeRef: RefObject<(number: number) => void>
  usersRef: RefObject<NetworkUser[]>
  commitUsers: (next: NetworkUser[]) => void
  setGuideFilter: Dispatch<SetStateAction<GuideFilter>>
  closeGuideTool: () => void
  startupPhase: StartupPhase
  startupSettled: boolean
  setStartupSettled: Dispatch<SetStateAction<boolean>>
  startupFailed: boolean
  starterDue: boolean
  favouritesSeeded: boolean
  setFavourites: Dispatch<SetStateAction<number[]>>
  forgetChannels: (gone: ReadonlySet<number>, sources: readonly StoredSource[]) => void
  chooseAnotherOnTvn: () => void
  guideFilter: GuideFilter
  favouritesRef: RefObject<number[]>
  volumeRef: RefObject<number>
  mutedRef: RefObject<boolean>
  subtitlesRef: RefObject<boolean>
  sleepMinutesRef: RefObject<number>
  guideSplitRef: RefObject<number>
  infoShortcutsRef: RefObject<ShortcutAssignment>
  surfRangeRef: RefObject<SurfRange>
  transitionRef: RefObject<TransitionSettings>
  guideLibraryRef: RefObject<GuideLibrary>
  setGuideLibrary: (next: GuideLibrary) => void
  setVolume: Dispatch<SetStateAction<number>>
  setMuted: Dispatch<SetStateAction<boolean>>
  setSubtitles: Dispatch<SetStateAction<boolean>>
  setSleepMinutes: Dispatch<SetStateAction<number>>
  setGuideSplit: Dispatch<SetStateAction<number>>
  setInfoShortcuts: Dispatch<SetStateAction<ShortcutAssignment>>
  setSurfRangeState: Dispatch<SetStateAction<SurfRange>>
  setTransitionState: Dispatch<SetStateAction<TransitionSettings>>
  playerRef: RefObject<PlayerHandle | null>
  tuningRef: RefObject<boolean>
}

/** ADD, the User Network and its users, the starter network, and EXPORT and RESTORE of channels and of the whole of TVN. */
export function useChannelLibrary({
  userIds,
  flash,
  userEditorialRef,
  channelRef,
  requestTune,
  readWholeRef,
  usersRef,
  commitUsers,
  setGuideFilter,
  closeGuideTool,
  startupPhase,
  startupSettled,
  setStartupSettled,
  startupFailed,
  starterDue,
  favouritesSeeded,
  setFavourites,
  forgetChannels,
  chooseAnotherOnTvn,
  guideFilter,
  favouritesRef,
  volumeRef,
  mutedRef,
  subtitlesRef,
  sleepMinutesRef,
  guideSplitRef,
  infoShortcutsRef,
  surfRangeRef,
  transitionRef,
  guideLibraryRef,
  setGuideLibrary,
  setVolume,
  setMuted,
  setSubtitles,
  setSleepMinutes,
  setGuideSplit,
  setInfoShortcuts,
  setSurfRangeState,
  setTransitionState,
  playerRef,
  tuningRef,
}: ChannelLibraryDeps) {
  const setSourceOverride = useCallback((channelNumber: number, videoId: string | null) => {
    setVideoOverride(channelNumber, videoId)
  }, [])

  const applyImport = useCallback(
    async (
      parsed: ParsedExport,
      mode: { library: boolean; automatic: boolean },
      options?: {
        filename?: string
        owner?: string
        onPhase?: (phase: import('../../library/types.ts').ImportPhase, counts?: import('../../library/types.ts').IngestCounts) => void
      },
    ) => {
      const report = await ingestParsed(parsed, { filename: options?.filename, onPhase: options?.onPhase })
      const existing = await loadStoredSources()
      const plan = planImport(
        existing,
        parsed,
        mode,
        channels.map((item) => item.number),
        Date.now(),
      )
      const before = new Set(existing.map((source) => source.id))
      const owner = options?.owner
      if (owner) plan.sources = plan.sources.map((source) => (before.has(source.id) ? source : { ...source, owner }))
      await saveStoredSources(plan.sources)
      const built = channelsFromSources(plan.sources, { refused: refusedVideos(), archive: uploaderArchive, users: userIds() })
      installUserCatalogue(built.channels, built.programmes, built.subChannels)
      const hours = (parsed.totalSeconds / 3600).toFixed(1)
      const scheduleNote =
        userLibraryMode() === 'off'
          ? 'User library programming is off until that setting is changed.'
          : 'Imported media will be used in newly generated schedules.'
      flash(
        `${scheduleNote} ${parsed.sources.length} sources · ${parsed.videoCount} videos · ${hours} h · ${report.added} added · ${report.updated} updated`,
      )
    },
    [],
  )

  /** Rebuild 1001+ from the stored sources; a removed channel that was on screen hands over to `instead`, or 001. */
  const installSources = useCallback((sources: readonly StoredSource[], instead?: number) => {
    userEditorialRef.current = new Map(sources.flatMap((source) => (source.channelNumber && source.editorial ? [[source.channelNumber, source.editorial] as const] : [])))
    const built = channelsFromSources(sources, { refused: refusedVideos(), archive: uploaderArchive, users: userIds() })
    installUserCatalogue(built.channels, built.programmes, built.subChannels)
    if (!channelByNumber(channelRef.current)) requestTune(instead !== undefined && channelByNumber(instead) ? instead : 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // What a preview found, so adding it does not read the source a second time.
  const previewedRef = useRef<{ link: string; feed: FoundFeed } | null>(null)

  const previewSource = useCallback(async (link: string, onProgress?: (text: string) => void): Promise<FoundFeed | null> => {
    if (addRoute(link) !== 'reader') return null
    const feed = await readerFeed(link, onProgress)
    previewedRef.current = { link: link.trim(), feed }
    return feed
  }, [])

  const addChannel = useCallback(
    async (link: string, owner?: string) => {
      if (addRoute(link) === 'reader') {
        // A website, feed, video provider, file or stream: what the source reader found becomes a channel named after it.
        const previewed = previewedRef.current?.link === link.trim() ? previewedRef.current.feed : null
        previewedRef.current = null
        const feed = previewed ?? (await readerFeed(link))
        const existing = migrateLegacyUserNumbers(await loadStoredSources()).sources
        const live = feed.live
        const result = live
          ? addStreamChannel(existing, { url: live.url, title: feed.title, kind: live.format === 'hls' ? (live.media === 'audio' ? 'audio-hls' : 'video-hls') : live.media }, Date.now())
          : addPodcastChannel(existing, feed, Date.now())
        if (result.status === 'full') throw new Error('The User Network is full')
        if (result.status === 'duplicate') return { number: result.number, message: `${feed.title} IS ALREADY ON ${result.number}` }
        if (owner) result.sources = result.sources.map((source) => (source.channelNumber === result.number ? { ...source, owner } : source))
        await saveStoredSources(result.sources)
        installSources(result.sources)
        const count = feed.episodes.length
        const slot = feed.episodes[0]?.web ? `${Math.round(feed.episodes[0].durationSec / 60)} MIN SLOT` : null
        const what = live ? 'LIVE' : slot ? (feed.provider === 'x' ? `X POST · ${slot}` : `WEBSITE · ${slot}`) : feed.provider === 'rss' || feed.provider === 'archive' ? `${count} EPISODES` : `${count} PROGRAMME${count === 1 ? '' : 'S'}`
        return { number: result.number, message: `${feed.title} ADDED ON ${result.number} · ${what}` }
      }
      const found = await lookUpChannel(link)
      const existing = migrateLegacyUserNumbers(await loadStoredSources()).sources
      const result = addChannelSource(existing, found, Date.now(), uploaderIdFor)
      if (result.status === 'full') throw new Error('The User Network is full')
      if (result.status === 'duplicate') return { number: result.number, message: `${found.title} IS ALREADY ON ${result.number}` }
      if (owner && result.status === 'added') {
        result.sources = result.sources.map((source) => (source.channelNumber === result.number ? { ...source, owner } : source))
      }
      await saveStoredSources(result.sources)
      installSources(result.sources)
      if (found.sourceType === 'youtube-playlist' && result.number !== null) readWholeRef.current(result.number)
      const verb = result.status === 'updated' ? 'UPDATED' : 'ADDED'
      const mix = found.mix ? ' · YOUTUBE MIX: SEED VIDEO KEPT, THEN ITS CHANNEL · THE MIX ITSELF CANNOT BE LISTED' : ''
      return { number: result.number, message: `${found.title} ${verb} ON ${result.number} · ${found.videos.length} VIDEOS${mix}` }
    },
    [installSources],
  )

  const createBookmarkChannel = useCallback(
    async (name: string, bookmarks: readonly Bookmark[]) => {
      // A bookmark saved before clips were kept is looked up on its channel, if the clip is still there.
      const videos = bookmarks.flatMap((bookmark) => {
        if (bookmark.video) return [bookmark.video]
        const channel = channelByNumber(bookmark.channelNumber)
        const programme = channel ? programmesFor(channel.id).find((item) => item.videoId === bookmark.programmeId || item.id === bookmark.programmeId) : undefined
        const video = programme ? clipVideo(programme) : null
        return video ? [video] : []
      })
      const existing = migrateLegacyUserNumbers(await loadStoredSources()).sources
      const result = addClipsChannel(existing, { name, videos }, Date.now())
      if (result.status === 'empty') throw new Error('NONE OF THOSE CLIPS CAN BE MADE INTO A CHANNEL')
      if (result.status === 'full') throw new Error('The User Network is full')
      await saveStoredSources(result.sources)
      installSources(result.sources)
      const made = result.sources.find((source) => source.channelNumber === result.number)
      const count = made?.videos.length ?? videos.length
      const left = bookmarks.length - count
      if (result.number !== null) requestTune(result.number)
      const message = `${made?.name ?? name} CREATED ON ${result.number} · ${count} PROGRAMME${count === 1 ? '' : 'S'}${left > 0 ? ` · ${left} LEFT OUT (NO LONGER AVAILABLE, OR ALREADY IN)` : ''}`
      flash(message, 4000)
      return { number: result.number, message }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [installSources],
  )

  const addChannels = useCallback(
    async (links: readonly string[], owner?: string, onProgress?: (done: number, total: number) => void) => {
      const numbers: number[] = []
      const placed: (number | null)[] = links.map(() => null)
      let already = 0
      let unread = 0
      let full = false
      let done = 0
      const playlists: number[] = []
      for (let start = 0; start < links.length && !full; start += ADD_MANY_AT_ONCE) {
        const batch = links.slice(start, start + ADD_MANY_AT_ONCE)
        const read = await Promise.allSettled(
          batch.map((link) =>
            lookUpChannel(link).finally(() => {
              onProgress?.(++done, links.length)
            }),
          ),
        )
        let sources = migrateLegacyUserNumbers(await loadStoredSources()).sources
        let changed = false
        for (const [offset, outcome] of read.entries()) {
          if (outcome.status === 'rejected') {
            unread += 1
            continue
          }
          const result = addChannelSource(sources, outcome.value, Date.now(), uploaderIdFor)
          if (result.status === 'full') {
            full = true
            break
          }
          placed[start + offset] = result.number
          if (result.status !== 'added' || result.number === null) {
            already += 1
            continue
          }
          sources = owner ? result.sources.map((source) => (source.channelNumber === result.number ? { ...source, owner } : source)) : result.sources
          numbers.push(result.number)
          if (outcome.value.sourceType === 'youtube-playlist') playlists.push(result.number)
          changed = true
        }
        if (changed) {
          await saveStoredSources(sources)
          installSources(sources)
        }
        for (const number of playlists.splice(0)) readWholeRef.current(number)
      }
      const range = numbers.length === 0 ? '' : numbers.length === 1 ? ` ON ${numbers[0]}` : ` ON ${Math.min(...numbers)}–${Math.max(...numbers)}`
      const message = `${numbers.length} ${numbers.length === 1 ? 'CHANNEL' : 'CHANNELS'} ADDED${range}${already > 0 ? ` · ${already} ALREADY ON THE GUIDE` : ''}${
        unread > 0 ? ` · ${unread} COULD NOT BE READ` : ''
      }${full ? ' · THE USER NETWORK IS FULL' : ''}`
      return { numbers, placed, message }
    },
    [installSources],
  )

  /**
   * COMBINE: one new channel holding each playlist as a source of its own, so each is a sub-channel of it and
   * the channel airs them all. The playlists are read first; the channel is made only once something was.
   */
  const addCombinedChannel = useCallback(
    async (name: string, playlists: readonly { url: string; title: string }[], owner?: string, onProgress?: (done: number, total: number) => void) => {
      const now = Date.now()
      const wanted: ChannelSource[] = playlists.map((playlist, index) => ({
        id: `s${index + 1}`,
        kind: 'youtube',
        url: playlist.url,
        label: playlist.title,
        enabled: true,
        youtube: 'playlist',
        status: { state: 'unchecked', checkedAt: 0 },
      }))
      const deps = rescanDeps()
      const read: ChannelSource[] = []
      for (let start = 0; start < wanted.length; start += ADD_MANY_AT_ONCE) {
        read.push(...(await rescanSources(wanted.slice(start, start + ADD_MANY_AT_ONCE), deps, now)))
        onProgress?.(read.length, wanted.length)
      }
      const sources = read.filter((source) => (source.videos?.length ?? 0) > 0)
      if (sources.length === 0) throw new Error('None of those playlists could be read')
      const existing = migrateLegacyUserNumbers(await loadStoredSources()).sources
      const slot = firstEmptySlot(existing.filter((source) => (source.channelNumber ?? 0) >= USER_NUMBER_START))
      const taken = existing.flatMap((source) => (source.channelNumber !== null && source.channelNumber >= USER_NUMBER_START ? [source.channelNumber] : []))
      const number = slot?.channelNumber ?? (taken.length ? Math.max(...taken) + 1 : USER_NUMBER_START)
      if (number >= USER_NUMBER_LIMIT) throw new Error('The User Network is full')
      const withSlot = slot ? existing : [...existing, emptySlotRecord(number, now)]
      const owned = owner ? withSlot.map((record) => (record.channelNumber === number ? { ...record, owner } : record)) : withSlot
      const label = name.trim() || sources[0].label
      const next = applyChannelEdit(owned, number, { name: label, sources: widenSources(sources, sourceArchive) }, now)
      await saveStoredSources(next)
      installSources(next)
      readWholeRef.current(number)
      const programmes = next.find((record) => record.channelNumber === number)?.videos.length ?? 0
      const unread = wanted.length - sources.length
      return {
        number,
        message: `${label.toUpperCase()} ADDED ON ${number} · ${sources.length} PLAYLISTS AS SUB-CHANNELS · ${programmes} PROGRAMMES${unread > 0 ? ` · ${unread} COULD NOT BE READ` : ''}`,
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [installSources],
  )

  const createNetworkUser = useCallback(
    (name: string, closePanel = false) => {
      const next = addUser(usersRef.current, name, Date.now())
      commitUsers(next.users)
      setGuideFilter(userFilter(next.user.id))
      if (closePanel) closeGuideTool()
      return next.user
    },
    [],
  )

  /**
   * The starter's YouTube channels and playlists arrive as addresses: they are read through the keyless
   * lookup after the install, a few at a time, and each fills in only if the viewer has not changed it since.
   */
  const resolveStarterSources = useCallback(
    async (pending: readonly StoredSource[]) => {
      if (pending.length === 0) return
      const resolved = await resolveRestored(pending, restoreDeps, Date.now())
      const found = new Map(resolved.records.map((record) => [record.id, record]))
      const latest = migrateLegacyUserNumbers(await loadStoredSources()).sources
      let changed = false
      const next = latest.map((record) => {
        const read = found.get(record.id)
        if (!read || read.videos.length === 0 || record.videos.length > 0 || record.channelNumber !== read.channelNumber) return record
        changed = true
        return {
          ...record,
          videos: read.videos,
          ...(read.channelSources ? { channelSources: read.channelSources } : {}),
          ...(read.runningOrder?.length ? { runningOrder: read.runningOrder } : {}),
        }
      })
      if (!changed) return
      await saveStoredSources(next)
      installSources(next)
    },
    [installSources],
  )

  /** Whether two reads of the stored User Network hold the same channels, as last saved. */
  const sameStoredSources = (a: readonly StoredSource[], b: readonly StoredSource[]) =>
    a.length === b.length && a.every((record, index) => record.id === b[index].id && record.updatedAt === b[index].updatedAt && record.channelNumber === b[index].channelNumber)

  /** Add the starter network after the viewer's own channels; anything already present is left as it is. */
  const loadTestChannels = useCallback(
    async (automatic = false) => {
      if (automatic && (starterState() !== 'pending' || currentNetworkBase() === 'new')) return ''
      const now = Date.now()
      const starter = recordsFromExport(await readStarterNetwork(), now)
      await ingestParsed(starterCollections(starter), { filename: BUILT_IN_CATALOGUE_ID })
      // The viewer may add or change a channel while the starter is read: it is planned around what is stored
      // now, and planned again if anything changed before it could be saved. The viewer's channels win.
      let plan = planStarterNetwork([], starter, now, uploaderIdFor)
      let settled = false
      for (let attempt = 0; attempt < 4 && !settled; attempt += 1) {
        const stored = await loadStoredSources()
        plan = planStarterNetwork(migrateLegacyUserNumbers(stored).sources, starter, now, uploaderIdFor)
        if (plan.added.length > 0 && !sameStoredSources(stored, await loadStoredSources())) continue
        if (plan.added.length > 0) await saveStoredSources(plan.sources)
        settled = true
      }
      // Still changing under it: the starter waits for the next start rather than overwrite the viewer.
      if (!settled) return ''
      setStarterState('installed')
      if (plan.added.length === 0) return 'THE STARTER NETWORK IS ALREADY INSTALLED'
      installSources(plan.sources)
      const added = new Set(plan.added)
      void resolveStarterSources(plan.sources.filter((record) => added.has(record.channelNumber ?? -1) && !record.emptySlot && record.videos.length === 0)).catch(() => undefined)
      const range = plan.added.length === 1 ? `${plan.added[0]}` : `${plan.added[0]}–${plan.added[plan.added.length - 1]}`
      return `${plan.added.length} STARTER CHANNELS ADDED ON ${range}${plan.skipped > 0 ? ` · ${plan.skipped} ALREADY PRESENT` : ''}`
    },
    [installSources, resolveStarterSources],
  )

  // However the first load goes (blocked autoplay, a load that never starts, a card or radio), the logo gives way
  // once the player's own load timeout has passed.
  useEffect(() => {
    if (startupPhase !== 'ready' || startupSettled) return
    const timer = window.setTimeout(() => setStartupSettled(true), PLAYER_LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [startupPhase, startupSettled])

  // A failed first programme keeps the logo up while its replacement loads, but not for the whole load timeout.
  useEffect(() => {
    if (startupPhase !== 'ready' || startupSettled || !startupFailed) return
    const timer = window.setTimeout(() => setStartupSettled(true), STARTUP_RETRY_MS)
    return () => window.clearTimeout(timer)
  }, [startupPhase, startupSettled, startupFailed])

  const starterRanRef = useRef(false)
  /** The automatic starter install (and its Favourites) while it runs, so NEW can wait for it to finish. */
  const starterRunRef = useRef<Promise<unknown> | null>(null)
  const [starterClear, setStarterClear] = useState(false)
  // The install holds the main thread for seconds in Firefox, so it waits for the logo to finish fading off.
  useEffect(() => {
    if (!startupSettled || starterClear) return
    const timer = window.setTimeout(() => setStarterClear(true), STARTER_AFTER_PICTURE_MS)
    return () => window.clearTimeout(timer)
  }, [startupSettled, starterClear])
  useEffect(() => {
    if (startupPhase !== 'ready' || (!starterDue && !favouritesSeeded) || starterRanRef.current) return
    // A fresh install's starter channels wait until the first picture is up (or the start has settled otherwise).
    if (starterDue && !starterClear) return
    starterRanRef.current = true
    const installed = starterDue ? loadTestChannels(true).catch(() => undefined) : Promise.resolve()
    starterRunRef.current = installed
    if (starterDue) void installed.then(() => afterPaint(() => void saveDeferredLibrary().catch(() => undefined).then(keepPools)))
    if (!favouritesSeeded) return
    starterRunRef.current = installed
      .then(async () => {
        if (currentNetworkBase() === 'new') return
        const expected = starterFavouriteSources(recordsFromExport(await readStarterNetwork(), 0))
        const sources = migrateLegacyUserNumbers(await loadStoredSources()).sources
        if (currentNetworkBase() === 'new') return
        setFavourites((current) => placeStarterFavourites(current, expected, sources))
      })
      .catch(() => undefined)
  }, [startupPhase, starterDue, favouritesSeeded, loadTestChannels, starterClear])

  const removeStarterNetwork = useCallback(async () => {
    const previous = await Promise.all(PREVIOUS_STARTER_FILES.map((path) => readStarterNetwork(path).then((doc) => recordsFromExport(doc, 0)).catch(() => [])))
    const ids = starterIds(await readStarterTemplate(), [...recordsFromExport(await readStarterNetwork(), 0), ...previous.flat()])
    const existing = await loadStoredSources()
    const remaining = withoutStarter(existing, ids)
    setStarterState('removed')
    const removed = existing.length - remaining.length
    if (removed === 0) return 'NO STARTER CHANNELS TO REMOVE'
    await saveStoredSources(remaining)
    forgetChannels(goneNumbers(existing, remaining), remaining)
    installSources(remaining)
    return `${removed} STARTER ${removed === 1 ? 'CHANNEL' : 'CHANNELS'} REMOVED`
  }, [installSources])

  const removeUserChannels = useCallback(
    async (numbers: 'all' | readonly number[]) => {
      const existing = await loadStoredSources()
      const remaining = withoutUserChannels(existing, numbers)
      await saveStoredSources(remaining)
      forgetChannels(goneNumbers(existing, remaining), remaining)
      installSources(remaining)
      if (numbers === 'all') setStarterState('removed')
      const removed = existing.length - remaining.length
      return removed === 0 ? 'NO USER CHANNELS REMOVED' : `${removed} USER ${removed === 1 ? 'CHANNEL' : 'CHANNELS'} REMOVED`
    },
    [installSources],
  )

  /** Whether NEW would remove anything the viewer made or changed, rather than only the example TVN ships. */
  const networkCustomised = useCallback(async () => {
    if (Object.keys(loadCuratedEdits()).length > 0) return true
    const existing = await loadStoredSources()
    if (existing.length === 0) return false
    if (currentNetworkBase() === 'new') return true
    const previous = await Promise.all(PREVIOUS_STARTER_FILES.map((path) => readStarterNetwork(path).then((doc) => recordsFromExport(doc, 0)).catch(() => [])))
    const ids = starterIds(await readStarterTemplate(), [...recordsFromExport(await readStarterNetwork(), 0), ...previous.flat()])
    return withoutStarter(existing, ids).length > 0
  }, [])

  /**
   * NEW: this browser's network becomes the viewer's own, empty but for 000 TVN and 1000 Local Media. The shipped
   * 001–999 leave their network, every stored User channel and change to a curated channel is removed, and the
   * starter network is marked removed so nothing seeds it again. The channel on screen (000) stays.
   */
  const startNewNetwork = useCallback(async () => {
    setStarterState('removed')
    const existing = await loadStoredSources()
    await saveStoredSources([])
    replaceCuratedEdits([])
    installCuratedEdits([], new Map())
    const gone = new Set<number>([
      ...channels.map((channel) => channel.number),
      ...existing.flatMap((source) => (source.channelNumber === null ? [] : [source.channelNumber])),
    ])
    setNetworkBase('new')
    forgetChannels(gone, [])
    installSources([])
    // 000 lets go of a programme from a channel that has just left the network, and shows what it has now.
    chooseAnotherOnTvn()
    // A starter install already under way finishes in the background: whatever it stored is swept out again,
    // leaving any channel the viewer has added since.
    void starterRunRef.current
      ?.catch(() => undefined)
      .then(async () => {
        if (currentNetworkBase() !== 'new') return
        setStarterState('removed')
        const previous = await Promise.all(PREVIOUS_STARTER_FILES.map((path) => readStarterNetwork(path).then((doc) => recordsFromExport(doc, 0)).catch(() => [])))
        const ids = starterIds(await readStarterTemplate(), [...recordsFromExport(await readStarterNetwork(), 0), ...previous.flat()])
        const stored = await loadStoredSources()
        const remaining = withoutStarter(stored, ids)
        if (remaining.length === stored.length) return
        await saveStoredSources(remaining)
        forgetChannels(goneNumbers(stored, remaining), remaining)
        installSources(remaining)
      })
    return 'NEW NETWORK · ADD CHANNELS TO BUILD IT'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installSources])

  /** A new, empty 1001+ channel for Edit Channel to fill: the lowest empty slot, or the next number. */
  /** A new, empty channel: after the User Network (1001+), or with `low` at the first free number from 001 in a network of the viewer's own. */
  const createEmptyChannel = useCallback(
    async (low = false) => {
      const existing = migrateLegacyUserNumbers(await loadStoredSources()).sources
      let number: number
      if (low) {
        if (currentNetworkBase() !== 'new') throw new Error('001–990 are the TVN network here')
        const slot = firstEmptySlot(existing.filter((source) => isLowUserNumber(source.channelNumber)))
        if (slot?.channelNumber) return slot.channelNumber
        const used = new Set(existing.map((source) => source.channelNumber))
        number = LOW_USER_FIRST
        while (number <= LOW_USER_LAST && used.has(number)) number += 1
        if (number > LOW_USER_LAST) throw new Error('Channels 001–990 are all in use')
      } else {
        const slot = firstEmptySlot(existing.filter((source) => (source.channelNumber ?? 0) >= USER_NUMBER_START))
        if (slot?.channelNumber) return slot.channelNumber
        const taken = existing.flatMap((source) => (source.channelNumber !== null && source.channelNumber >= USER_NUMBER_START ? [source.channelNumber] : []))
        number = taken.length ? Math.max(...taken) + 1 : USER_NUMBER_START
        if (number >= USER_NUMBER_LIMIT) throw new Error('The User Network is full')
      }
      const owner = usersRef.current.find((user) => userFilter(user.id) === guideFilter)?.id
      const next = [...existing, { ...emptySlotRecord(number, Date.now()), ...(owner ? { owner } : {}) }]
      await saveStoredSources(next)
      installSources(next)
      return number
    },
    [guideFilter, installSources],
  )

  const renameNetworkUser = useCallback(
    (id: string, name: string) => {
      const checked = checkUserName(name, usersRef.current.filter((user) => user.id !== id))
      if (!checked.ok) throw new Error(checked.error)
      commitUsers(usersRef.current.map((user) => (user.id === id ? { ...user, name: checked.name } : user)))
      return `RENAMED ${checked.name}`
    },
    [],
  )

  /** Remove a named user. Its channels either move to TVN (owner cleared) or are removed with it. */
  const deleteNetworkUser = useCallback(
    async (id: string, channels: 'move' | 'remove') => {
      const user = usersRef.current.find((item) => item.id === id)
      if (!user) return 'THAT USER IS ALREADY GONE'
      const existing = await loadStoredSources()
      const owned = existing.filter((source) => source.owner === id && !source.emptySlot)
      // Removed with the user, its channels leave the network entirely, like any deleted channel.
      const remaining = channels === 'remove' ? existing.filter((source) => source.owner !== id) : releaseUserChannels(existing, id, 'move')
      commitUsers(usersRef.current.filter((item) => item.id !== id))
      if (remaining.length !== existing.length || remaining.some((source, index) => source !== existing[index])) {
        await saveStoredSources(remaining)
        forgetChannels(goneNumbers(existing, remaining), remaining)
        installSources(remaining)
      }
      if (guideFilter === userFilter(id)) setGuideFilter('user')
      const count = `${owned.length} ${owned.length === 1 ? 'CHANNEL' : 'CHANNELS'}`
      if (owned.length === 0) return `${user.name} DELETED`
      return channels === 'remove' ? `${user.name} DELETED WITH ${count}` : `${user.name} DELETED · ${count} MOVED TO TVN`
    },
    [guideFilter, installSources],
  )

  const exportUserNetwork = useCallback(async () => {
    const now = new Date()
    const document = buildUserNetworkExport(await loadStoredSources(), now, uploaderIdFor, usersRef.current, favouritesRef.current)
    downloadText(exportFilename(now), serialiseUserNetworkExport(document))
    const count = document.channels.length
    const users = document.users?.length ?? 0
    const favourites = document.favourites?.length ?? 0
    return `EXPORTED USER · ${count} ${count === 1 ? 'CHANNEL' : 'CHANNELS'}${users > 0 ? ` · ${users} ${users === 1 ? 'USER' : 'USERS'}` : ''} · ${favourites} ${favourites === 1 ? 'FAVOURITE' : 'FAVOURITES'}`
  }, [])

  const exportTvn = useCallback(async () => {
    const now = new Date()
    const register = await loadRegister()
    const document = buildTvnExport({
      stored: await loadStoredSources(),
      users: usersRef.current,
      favourites: favouritesRef.current,
      settings: {
        volume: Math.min(VOLUME_FULL, volumeRef.current),
        muted: mutedRef.current,
        subtitles: subtitlesRef.current,
        sleepMinutes: sleepMinutesRef.current,
        guideSplit: guideSplitRef.current,
        infoShortcuts: infoShortcutsRef.current,
        surfRange: surfRangeRef.current,
        transition: transitionRef.current.id,
        transitionStyle: transitionRef.current,
        tvnChannel: tvnChannelSettings(),
      },
      now,
      app: { commit: BUILD_INFO.commit, build: BUILD_INFO.build },
      uploaderOf: uploaderIdFor,
      curated: Object.values(loadCuratedEdits()),
      guides: guideLibraryRef.current,
      originalsOf: (number) => originalsOf(number, register),
      shippedOf: (number) => {
        const shipped = shippedChannel(number)
        return shipped ? shippedProgrammes(shipped.id) : []
      },
    })
    downloadText(tvnExportFilename(now), serialiseTvnExport(document))
    const count = document.userNetwork.channels.length
    const curated = document.central?.overrides.length ?? 0
    const guides = document.guides?.saved.length ?? 0
    return `TVN EXPORTED · ${count} USER ${count === 1 ? 'CHANNEL' : 'CHANNELS'} · ${curated} CURATED · ${guides} ${guides === 1 ? 'GUIDE' : 'GUIDES'} · ${document.favourites.length} FAVOURITES · SETTINGS`
  }, [])

  const exportRange = useCallback(async (from: number, to: number) => {
    const now = new Date()
    const register = await loadRegister()
    const document = buildRangeExport(
      {
        stored: await loadStoredSources(),
        users: usersRef.current,
        favourites: favouritesRef.current,
        now,
        app: { commit: BUILD_INFO.commit, build: BUILD_INFO.build },
        uploaderOf: uploaderIdFor,
        curated: Object.values(loadCuratedEdits()),
        originalsOf: (number) => originalsOf(number, register),
        shippedOf: (number) => {
          const shipped = shippedChannel(number)
          return shipped ? shippedProgrammes(shipped.id) : []
        },
      },
      from,
      to,
    )
    const range = document.range ?? { first: from, last: to }
    const user = document.userNetwork.channels.length
    const curated = document.central?.overrides.length ?? 0
    downloadText(rangeExportFilename(now, range), serialiseTvnExport(document))
    const span = `${padChannel(range.first)}–${padChannel(range.last)}`
    if (user + curated === 0) return `EXPORTED ${span} · BLANK · RESTORING IT CLEARS YOUR CHANNELS THERE`
    return `EXPORTED ${span} · ${user} USER ${user === 1 ? 'CHANNEL' : 'CHANNELS'} · ${curated} CURATED`
  }, [])

  /** The channels ticked in NETWORK: only those, as a JSON file. Restoring it changes only those numbers. */
  const exportPicked = useCallback(async (numbers: readonly number[]) => {
    const now = new Date()
    const register = await loadRegister()
    const document = buildPickedExport(
      {
        stored: await loadStoredSources(),
        users: usersRef.current,
        favourites: favouritesRef.current,
        now,
        app: { commit: BUILD_INFO.commit, build: BUILD_INFO.build },
        uploaderOf: uploaderIdFor,
        curated: Object.values(loadCuratedEdits()),
        originalsOf: (number) => originalsOf(number, register),
        shippedOf: (number) => {
          const shipped = shippedChannel(number)
          return shipped ? shippedProgrammes(shipped.id) : []
        },
      },
      numbers,
    )
    const count = document.picked?.length ?? document.userNetwork.channels.length
    downloadText(pickedExportFilename(now, document.picked ?? numbers), serialiseTvnExport(document))
    const first = document.picked?.[0]
    const last = document.picked?.[document.picked.length - 1]
    const span = first !== undefined && last !== undefined ? (first === last ? padChannel(first) : `${padChannel(first)}–${padChannel(last)}`) : ''
    return `EXPORTED ${count} ${count === 1 ? 'CHANNEL' : 'CHANNELS'} AS A NEW LIST${span ? ` · ${span}` : ''}`
  }, [])

  /** The editor's scope for this channel number, checked again on every action rather than trusted from the view. */
  const scopeOf = (number: number) => {
    const target = channelByNumber(number)
    const scope = target ? editorScope(target) : null
    if (!target || !scope) throw new Error('This channel cannot be edited')
    const shipped = scope === 'curated' ? shippedChannel(number) : undefined
    if (scope === 'curated' && !shipped) throw new Error('This channel cannot be edited')
    return { target, scope, shipped: shipped as NonNullable<typeof shipped> }
  }

  const restoreRun = useRef(0)

  /**
   * Read a just-restored network's sources again and bring in what changed. A channel the viewer has touched
   * since the restore, or a later restore, wins: only records still exactly as restored are replaced.
   */
  const refreshRestored = useCallback(
    async (records: readonly StoredSource[], restored: readonly StoredSource[], run: number, onProgress?: (note: string) => void) => {
      const current = () => run === restoreRun.current
      const fresh = await resolveRestored(records, restoreDeps, Date.now(), 4, {
        onProgress: (done, total) => {
          if (current()) onProgress?.(`UPDATING SOURCES · ${done} OF ${total}`)
        },
      })
      if (!current()) return
      const asRestored = new Map(restored.map((record) => [record.id, JSON.stringify(record)]))
      const updates = new Map(fresh.records.map((record) => [record.id, record]))
      const stored = await loadStoredSources()
      if (!current()) return
      let changed = false
      const next = stored.map((record) => {
        const update = updates.get(record.id)
        if (!update || asRestored.get(record.id) !== JSON.stringify(record)) return record
        changed = true
        return update
      })
      if (changed) {
        await saveStoredSources(next)
        if (!current()) return
        installSources(next)
      }
      onProgress?.(`SOURCES UPDATED${fresh.failed > 0 ? ` · ${fresh.failed} ${fresh.failed === 1 ? 'SOURCE' : 'SOURCES'} COULD NOT BE READ` : ''}`)
    },
    [installSources],
  )

  /**
   * Replace the User Network with a validated export the viewer has confirmed; 001–999 and 000 are not touched.
   * The channels come back at once from what the file holds; their sources are read again afterwards.
   */
  const importUserNetwork = useCallback(
    async (document: UserNetworkExport, onProgress?: (note: string) => void) => {
      const now = Date.now()
      const run = ++restoreRun.current
      const records = recordsFromExport(document, now)
      const resolved = await resolveRestored(records, restoreDeps, now, 4, { read: false })
      const next = restoreUserNetwork(await loadStoredSources(), resolved.records)
      await saveStoredSources(next)
      if (starterState() === 'pending') setStarterState('installed')
      setFavourites((current) => favouritesAfterRestore(current, resolved.records, document.favourites))
      const users = usersFromExport(document)
      commitUsers(users)
      setGuideFilter((current) => (current.startsWith('user:') && !users.some((user) => userFilter(user.id) === current) ? 'user' : current))
      installSources(next)
      void refreshRestored(records, resolved.records, run, onProgress).catch(() => {
        if (run === restoreRun.current) onProgress?.('SOURCES COULD NOT BE UPDATED')
      })
      const count = resolved.records.length
      const empty = resolved.records.filter((record) => record.emptySlot).length
      return `USER NETWORK IMPORTED · ${count} ${count === 1 ? 'CHANNEL' : 'CHANNELS'}${empty > 0 ? ` · ${empty} EMPTY` : ''}${
        users.length > 0 ? ` · ${users.length} ${users.length === 1 ? 'USER' : 'USERS'}` : ''
      }${document.favourites ? ` · ${document.favourites.length} ${document.favourites.length === 1 ? 'FAVOURITE' : 'FAVOURITES'}` : ''}`
    },
    [installSources, refreshRestored],
  )

  /**
   * Replace this browser's 001–999 overrides with an export's, already validated. Only the override layer
   * changes; each override is checked against the channel TVN ships now, and what no longer fits is reported.
   */
  const restoreCentralCuration = async (central: CentralCuration, range?: ChannelRange, picked?: readonly number[]): Promise<string> => {
    const now = Date.now()
    const followed = followMovedChannels(Object.fromEntries(overridesFromExport(central).map((edit) => [String(edit.channelNumber), edit])), channels, (shipped) => shippedBaseline(shipped, shippedIds(shipped)))
    const read = Object.values(followed.edits)
    const resolved = await resolveRestored(read.map(overrideRecord), restoreDeps, now)
    const register = await loadRegister()
    const kept: CuratedEdit[] = []
    const conflicts: string[] = []
    read.forEach((edit, index) => {
      const shipped = shippedChannel(edit.channelNumber)
      const sources = resolved.records[index]?.channelSources ?? edit.sources
      const result = reconcileOverride({ ...edit, sources }, shipped, shipped ? shippedProgrammes(shipped.id).map((programme) => programme.id) : [], shipped ? originalsOf(shipped.number, register) : [])
      // Only a move adds notes before reconciling; they stay with the override.
      const carried = edit.conflicts ?? []
      if (result.edit) kept.push(carried.length ? { ...result.edit, conflicts: [...carried, ...(result.edit.conflicts ?? [])] } : result.edit)
      conflicts.push(...carried, ...result.conflicts)
    })
    const chosen = picked ? new Set(picked) : null
    const touches = (number: number) => (chosen ? chosen.has(number) : range ? inRange(number, range) : false)
    const outside = range || picked ? Object.values(loadCuratedEdits()).filter((edit) => !touches(edit.channelNumber) && !kept.some((item) => item.channelNumber === edit.channelNumber)) : []
    replaceCuratedEdits([...outside, ...kept])
    installCurated()
    return ` · ${kept.length} CURATED${conflicts.length ? ` · ${conflicts.length} TO REVIEW` : ''}`
  }

  /**
   * Restore a complete TVN export the viewer has confirmed. The whole file is checked again first; the User
   * Network is restored next, and only once that has succeeded do Favourites and settings follow.
   */
  const importTvn = useCallback(
    async (document: TvnExport, scope: 'all' | 'user' = 'all', onProgress?: (note: string) => void) => {
      const checked = validateTvnExport(document)
      if (!checked.ok) throw new Error(`Not a complete TVN export · ${checked.errors[0]}`)
      // USER only: the User Network and its Favourites; curation, Guides, settings and other Favourites stay as they are.
      if (scope === 'user') {
        const favourites = checked.value.favourites.filter((number) => number >= USER_NUMBER_START || (currentNetworkBase() === 'new' && isLowUserNumber(number)))
        return importUserNetwork({ ...checked.value.userNetwork, favourites }, onProgress)
      }
      const restored = await importUserNetwork(checked.value.userNetwork, onProgress)
      const central = checked.value.central ? await restoreCentralCuration(checked.value.central) : ''
      const guides = checked.value.guides
      if (guides) setGuideLibrary(libraryFrom(guides))
      const { favourites: favouriteNumbers, settings } = checked.value
      setFavourites([...favouriteNumbers])
      if (settings.volume !== undefined) {
        volumeRef.current = settings.volume
        setVolume(settings.volume)
      }
      if (settings.muted !== undefined) {
        mutedRef.current = settings.muted
        setMuted(settings.muted)
      }
      if (settings.subtitles !== undefined) {
        subtitlesRef.current = settings.subtitles
        setSubtitles(settings.subtitles)
      }
      if (settings.sleepMinutes !== undefined) {
        sleepMinutesRef.current = settings.sleepMinutes
        setSleepMinutes(settings.sleepMinutes)
      }
      if (settings.guideSplit !== undefined) setGuideSplit(clampGuideSplit(settings.guideSplit))
      if (settings.infoShortcuts !== undefined) setInfoShortcuts(asShortcuts(settings.infoShortcuts))
      if (settings.surfRange !== undefined) {
        const range = asSurfRange(settings.surfRange)
        saveSurfRange(range)
        setSurfRangeState(range)
      }
      // A file from before the transition's look was saved restores its defaults.
      transitionRef.current = asTransitionSettings({ ...settings.transitionStyle, id: settings.transition ?? settings.transitionStyle?.id })
      saveTransitionSettings(transitionRef.current)
      setTransitionState(transitionRef.current)
      if (settings.tvnChannel !== undefined) setTvnChannelSettings(settings.tvnChannel)
      playerRef.current?.setAudible(!tuningRef.current, volumeRef.current, mutedRef.current)
      return `${restored.replace('USER NETWORK IMPORTED', 'TVN RESTORED')}${central}${guides ? ` · ${guides.saved.length} ${guides.saved.length === 1 ? 'GUIDE' : 'GUIDES'}` : ''}`
    },
    [importUserNetwork],
  )

  /**
   * Restore a range export the viewer has confirmed: every channel numbered inside its range becomes what
   * the file holds (a number the file leaves out is cleared of the viewer's channel or curation); nothing
   * outside the range, no setting and no Guide changes.
   */
  const importTvnRange = useCallback(
    async (document: TvnExport, onProgress?: (note: string) => void) => {
      const checked = validateTvnExport(document)
      if (!checked.ok || !checked.value.range) throw new Error(`Not a TVN range export${checked.ok ? '' : ` · ${checked.errors[0]}`}`)
      const { range, userNetwork, favourites, picked } = checked.value
      const now = Date.now()
      const run = ++restoreRun.current
      const records = recordsFromExport(userNetwork, now)
      const resolved = await resolveRestored(records, restoreDeps, now, 4, { read: false })
      if (picked?.length) {
        const { sources, placed } = appendPackedChannels(await loadStoredSources(), resolved.records)
        await saveStoredSources(sources)
        commitUsers(usersAfterRangeRestore(usersRef.current, userNetwork))
        installSources(sources)
        void refreshRestored(records, resolved.records, run, onProgress).catch(() => {
          if (run === restoreRun.current) onProgress?.('SOURCES COULD NOT BE UPDATED')
        })
        const fileNumbers = [...resolved.records].sort((a, b) => (a.channelNumber ?? 0) - (b.channelNumber ?? 0)).map((record) => record.channelNumber ?? 0)
        setFavourites((current) => favouritesAfterAppend(current, favourites, fileNumbers, placed.map((record) => record.channelNumber ?? 0)))
        const first = placed[0]?.channelNumber
        const last = placed[placed.length - 1]?.channelNumber
        const span = typeof first === 'number' && typeof last === 'number' ? (first === last ? padChannel(first) : `${padChannel(first)}–${padChannel(last)}`) : `${placed.length}`
        return `ADDED ${placed.length} ${placed.length === 1 ? 'CHANNEL' : 'CHANNELS'} AS A NEW LIST · ${span}`
      }
      const next = restoreChannelRange(await loadStoredSources(), resolved.records, range)
      await saveStoredSources(next)
      commitUsers(usersAfterRangeRestore(usersRef.current, userNetwork))
      installSources(next)
      void refreshRestored(records, resolved.records, run, onProgress).catch(() => {
        if (run === restoreRun.current) onProgress?.('SOURCES COULD NOT BE UPDATED')
      })
      const central = await restoreCentralCuration(checked.value.central ?? { format: CENTRAL_CURATION_FORMAT, overrides: [] }, range)
      setFavourites((current) => favouritesAfterRangeRestore(current, favourites, range))
      const count = resolved.records.length
      return `RESTORED ${padChannel(range.first)}–${padChannel(range.last)} · ${count} USER ${count === 1 ? 'CHANNEL' : 'CHANNELS'}${central}`
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [installSources, refreshRestored],
  )
  return {
    setSourceOverride,
    applyImport,
    installSources,
    previewSource,
    addChannel,
    createBookmarkChannel,
    addChannels,
    addCombinedChannel,
    createNetworkUser,
    loadTestChannels,
    removeStarterNetwork,
    removeUserChannels,
    networkCustomised,
    startNewNetwork,
    createEmptyChannel,
    renameNetworkUser,
    deleteNetworkUser,
    exportUserNetwork,
    exportTvn,
    exportRange,
    exportPicked,
    scopeOf,
    importUserNetwork,
    importTvn,
    importTvnRange,
  }
}
