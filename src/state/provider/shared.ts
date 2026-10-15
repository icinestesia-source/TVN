import type { ScheduleAction, TvCommand } from '../../types/input.ts'
import type { SourceMode } from '../../services/channel-curation.ts'
import { lookUpChannel } from '../../services/add-channel.ts'
import { type FoundFeed, lookUpFeed } from '../../services/podcast-source.ts'
import { sourceArchive } from '../../services/user-archive.ts'
import type { Channel } from '../../types/channel.ts'
import { channels, shippedChannel, shippedProgrammes } from '../../data/catalogue.ts'
import type { SourceRegister } from '../../credits/provenance.ts'
import type { OriginalSource } from '../../services/original-sources.ts'
import { channelOriginals } from '../../view/channel-provenance.ts'
import {
  buildCuratedEdit,
  type CuratedEdit,
  followMovedChannels,
  loadCuratedEdits,
  madeForAnother,
  replaceCuratedEdits,
  shippedBaseline,
} from '../../services/curated-edits.ts'
import type { Programme } from '../../types/programme.ts'
import { withCentralEdits } from '../../data/central-edits.ts'
import { refusedVideos } from '../../services/embed-refusals.ts'
import { installCuratedEdits } from '../../data/user-overlay.ts'
import { keepCalculatedPools } from '../../library/pool-cache.ts'
import type { ChannelSource } from '../../services/channel-sources.ts'
import { probeStream } from '../../player/stream.ts'
import { uploaderIdFor } from '../../services/user-archive.ts'
import type { StoredSource } from '../../services/channels-import.ts'
import type { MediaHandle } from '../../session/remembered-media.ts'

export const INFO_MS = 6000
/** ADD CHANNELS reads this many playlists at once, then saves them as channels before reading more. */
export const ADD_MANY_AT_ONCE = 6
export const VOLUME_MS = 1200
/** How long after the press that released held sound a MUTE from that same press still means sound on. */
export const SOUND_RELEASE_MS = 1500
/** One press of = or - on the Guide: a quarter more, or less, time per screen. */
export const GUIDE_KEY_ZOOM = 1.25
export const SCHEDULE_WORKING: Record<ScheduleAction, string> = { random: 'REFRESHING…', reload: 'RELOADING…', latest: 'LATEST…', az: 'A–Z…' }
export const NUMERIC_MS = 1600
// A refused or failed first programme is usually replaced within a second or two (the refusal fallback).
export const STARTUP_RETRY_MS = 4000
export const STARTER_AFTER_PICTURE_MS = 1500
/** Loading shown after director cache, library, shipped network and user network; 100 once tuned. */
export const STARTUP_STEPS = [10, 30, 75, 90] as const

/** RESTORE and channel-file IMPORT read YouTube sources at their own modes and add TVN's shipped back catalogue to ARCHIVE and ALL. */
export const restoreDeps = {
  resolveYouTube: (url: string, options?: { mode?: SourceMode }) => lookUpChannel(url, fetch, { ...options }),
  resolveFeed: (url: string, options?: { mode?: SourceMode; as?: 'website' }) => lookUpFeed(url, fetch, { ...options }),
  archiveOf: sourceArchive,
}

/** What ADD reads at an address: its feed, archive, video or stream; a page with none of those is offered as a website programme. */
export async function readerFeed(link: string, onProgress?: (text: string) => void): Promise<FoundFeed> {
  try {
    return await lookUpFeed(link, fetch, { fresh: true, mode: 'all', onProgress })
  } catch (error) {
    if (!/^https:\/\//i.test(link.trim())) throw error
    try {
      return await lookUpFeed(link, fetch, { fresh: true, as: 'website' })
    } catch (page) {
      // The page's own refusal to be shown is the clearer answer; otherwise the reader's stands.
      throw page instanceof Error && /CANNOT BE EMBEDDED/i.test(page.message) ? page : error
    }
  }
}

export const shippedIds = (shipped: Channel) => shippedProgrammes(shipped.id).map((programme) => programme.id)

/** A TVN channel's original sources, from the library as published now (names are added where shown). */
export const originalsOf = (number: number, register?: SourceRegister): OriginalSource[] => channelOriginals(number, register)
export const poolIdsOf = (number: number) => originalsOf(number).flatMap((source) => source.videos.map((video) => video.id))
/** Only an override that keeps TVN's programming on and decides about its original sources, or arranges TVN's programmes, reads them. */
export const readsOriginals = (edit: CuratedEdit) =>
  edit.sources.some((source) => source.kind === 'tvn' && source.enabled) &&
  Boolean(edit.originals?.length || edit.order?.length || edit.excluded?.length || edit.sources.some((source) => source.kind !== 'tvn' && source.enabled))

/** Lay the viewer's saved changes to curated channels over the shipped ones, in this browser only. */
export function installCurated() {
  const built: Channel[] = []
  const programmes = new Map<string, Programme[]>()
  const { edits, moved } = followMovedChannels(loadCuratedEdits(), channels, (shipped) => shippedBaseline(shipped, shippedIds(shipped)))
  if (moved.length) replaceCuratedEdits(Object.values(edits))
  for (const edit of Object.values(withCentralEdits(edits))) {
    const shipped = shippedChannel(edit.channelNumber)
    if (!shipped || madeForAnother(edit, shipped)) continue
    const made = buildCuratedEdit(shipped, edit, refusedVideos(), shippedProgrammes(shipped.id), readsOriginals(edit) ? originalsOf(shipped.number) : [])
    built.push(made.channel)
    if (made.programmes) programmes.set(shipped.id, made.programmes)
  }
  installCuratedEdits(built, programmes)
}

/** What still works while a channel is edited over the picture; anything else could change the channel. */
export const SCREEN_EDIT_COMMANDS: ReadonlySet<TvCommand['type']> = new Set([
  'cancel',
  'guide',
  'guide-tool',
  'mute',
  'volume-up',
  'volume-down',
  'play-pause',
  'fullscreen',
  'debug',
  'bookmark',
  'favourite',
])

/** The viewer's own files on screen: what the local-media channels can be asked to do. */
export interface SessionControls {
  play: (programmeId: string) => void
  import: (files: readonly File[], number: number, handles?: readonly MediaHandle[], onNote?: (note: string) => void) => Promise<string>
  reload: () => Promise<string>
  remove: (programmeId: string) => void
  clear: (number: number) => void
}

/** The channel pools worked out this visit, kept for the next once the set is on screen. */
export const keepPools = () => void keepCalculatedPools().catch(() => undefined)

/** What a RESCAN reads with: every source fresh, at its own mode. */
export const rescanDeps = () => ({
  resolveYouTube: (url: string, options?: { mode?: SourceMode }) => lookUpChannel(url, fetch, { fresh: true, ...options }),
  resolveFeed: (url: string, options?: { mode?: SourceMode; as?: 'website' }) => lookUpFeed(url, fetch, { fresh: true, ...options }),
  probeStream: (source: ChannelSource) => probeStream(source),
  uploaderOf: uploaderIdFor,
  archiveOf: sourceArchive,
})

/** The channel numbers a change to the User Network leaves empty. */
export const goneNumbers = (before: readonly StoredSource[], after: readonly StoredSource[]) => {
  const kept = new Set(after.map((source) => source.channelNumber))
  return new Set(before.flatMap((source) => (source.channelNumber !== null && !kept.has(source.channelNumber) ? [source.channelNumber] : [])))
}
