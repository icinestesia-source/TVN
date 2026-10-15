import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { loadUserLibraryMode, setUserLibraryMode } from '../../library/mode.ts'
import { loadYouTubeApi } from '../../player/load-api.ts'
import { STARTUP_STEPS, installCurated, keepPools } from './shared.ts'
import {
  fetchShippedCatalogue,
  hydrateLibrary,
  librarySnapshot,
  loadShippedIndependentCatalogue,
  republishLibrary,
  saveDeferredLibrary,
} from '../../library/store.ts'
import { offerSavedPools, readSavedPools } from '../../library/pool-cache.ts'
import { endScheduleBootstrap, hydrateDirector } from '../../director/cache.ts'
import { bootstrapUserNetwork } from '../../data/user-network/bootstrap.ts'
import { loadRegister } from '../../credits/load.ts'
import { loadOverrides } from '../../services/overrides.ts'
import { installCentralEdits } from '../../data/central-edits.ts'
import { channelsFromSources, migrateLegacyUserNumbers } from '../../services/channels-import.ts'
import { saveStoredSources } from '../../services/user-db.ts'
import { liveFavourites } from '../../services/network-order.ts'
import { refusedVideos } from '../../services/embed-refusals.ts'
import { uploaderArchive } from '../../services/user-archive.ts'
import { installUserCatalogue } from '../../data/user-overlay.ts'
import { independentNetworkLoaded, resolveStartupTuning, runStartup, type StartupPhase } from '../startup.ts'
import { currentEntryMode } from '../entry.ts'
import { channelByNumber } from '../../data/catalogue.ts'
import { BUILD_INFO } from '../../build-info.ts'
import { EMPTY_HISTORY, visit, type ViewingHistory } from '../history.ts'
import { primeDirector } from '../../director/director.ts'
import { afterPaint } from '../after-paint.ts'
import type { StartupRestore } from '../startup-channel.ts'
import type { UserPreferences } from '../../types/preferences.ts'
import type { Tuned } from '../tuning.ts'

export interface StartupLoadDeps {
  setStartupProgress: Dispatch<SetStateAction<number>>
  starterDue: boolean
  favouritesSeeded: boolean
  setFavourites: Dispatch<SetStateAction<number[]>>
  userIds: () => Set<string>
  phaseRef: RefObject<StartupPhase>
  setStartupPhase: Dispatch<SetStateAction<StartupPhase>>
  startup: StartupRestore
  stored: UserPreferences
  commitChannel: (next: Tuned, record?: boolean) => void
  historyRef: RefObject<ViewingHistory>
  setHistory: Dispatch<SetStateAction<ViewingHistory>>
  tilesRef: RefObject<number[]>
  setTiles: Dispatch<SetStateAction<number[]>>
  catalogueReadyRef: RefObject<boolean>
  bootRef: RefObject<() => void>
  startupPhase: StartupPhase
}

/** The start: the saved schedules, library and User Network read in order, the shipped catalogue downloading alongside, then the first channel. */
export function useStartupLoad({
  setStartupProgress,
  starterDue,
  favouritesSeeded,
  setFavourites,
  userIds,
  phaseRef,
  setStartupPhase,
  startup,
  stored,
  commitChannel,
  historyRef,
  setHistory,
  tilesRef,
  setTiles,
  catalogueReadyRef,
  bootRef,
  startupPhase,
}: StartupLoadDeps) {
  useEffect(() => {
    let cancel = false
    setUserLibraryMode(loadUserLibraryMode())
    // The player API has nothing to wait for; fetching it alongside the catalogue keeps it off the ready path.
    void loadYouTubeApi().catch(() => undefined)
    const load = async () => {
      const reached = (step: number) => {
        if (!cancel) setStartupProgress(STARTUP_STEPS[step])
      }
      try {
        // The shipped catalogue and the curated edits download while the saved schedules and library are read.
        const shipped = fetchShippedCatalogue()
        const centralEdits = import('../../data/central-edits.json').then((module) => module.default as unknown, () => null)
        const savedPools = readSavedPools().catch(() => null)
        await hydrateDirector().catch(() => undefined)
        reached(0)
        offerSavedPools(await savedPools)
        await hydrateLibrary()
        reached(1)
        await loadShippedIndependentCatalogue(shipped).catch(() => 0)
        reached(2)
        const network = await bootstrapUserNetwork().catch(() => null)
        reached(3)
        void loadRegister()
        if (cancel) return false
        republishLibrary()
        loadOverrides()
        installCentralEdits(await centralEdits)
        installCurated()
        if (network) {
          const migrated = migrateLegacyUserNumbers(network.sources)
          if (migrated.migrated > 0) await saveStoredSources(migrated.sources)
          // A Favourite left behind by a channel deleted before deletion cleaned up after itself goes now. Not on
          // a first visit, whose starter Favourites wait for the starter channels.
          if (!starterDue && !favouritesSeeded) setFavourites((current) => liveFavourites(current, migrated.sources))
          const built = channelsFromSources(migrated.sources, { refused: refusedVideos(), archive: uploaderArchive, users: userIds() })
          installUserCatalogue(built.channels, built.programmes, built.subChannels)
        }
        return independentNetworkLoaded(librarySnapshot().media)
      } finally {
        endScheduleBootstrap()
      }
    }
    const fail = () => {
      phaseRef.current = 'failed'
      setStartupPhase('failed')
    }
    const stop = runStartup(load, (phase) => {
      if (cancel) return
      if (phase === 'failed') return fail()
      const tuning = resolveStartupTuning(startup, stored, currentEntryMode())
      const start = tuning ? channelByNumber(tuning.channelNumber) : undefined
      if (!tuning || !start) {
        console.error(`TVN could not start (commit ${BUILD_INFO.commit}): no channel to start on`)
        return fail()
      }
      commitChannel(tuning, false)
      historyRef.current = visit(EMPTY_HISTORY, tuning.channelNumber)
      setHistory(historyRef.current)
      if (stored.multiviewMode !== '1') {
        const live = stored.multiviewChannels.filter((number) => channelByNumber(number))
        if (live.length > 0) {
          tilesRef.current = live
          setTiles(live)
        }
      }
      primeDirector(start, Date.now())
      setStartupProgress(100)
      catalogueReadyRef.current = true
      phaseRef.current = 'ready'
      setStartupPhase('ready')
      bootRef.current()
    }, undefined, (reason) => console.error(`TVN could not start (commit ${BUILD_INFO.commit}): ${reason}`))
    return () => {
      cancel = true
      stop()
    }
  }, [startup, stored, starterDue, favouritesSeeded])

  // The library save the start left for later waits until the set has painted, and behind a starter install,
  // whose own library write already covers it.
  useEffect(() => {
    if (startupPhase !== 'ready' || starterDue) return
    return afterPaint(() => void saveDeferredLibrary().catch(() => undefined).then(keepPools))
  }, [startupPhase, starterDue])

}
