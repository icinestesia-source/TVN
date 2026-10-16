import { SLEEP_CHOICES } from '../state/sleep.ts'
import { SURF_LIMIT_MAX, SURF_LIMIT_MIN, type SurfRange } from '../state/surf.ts'
import { TRANSITION_IDS, transitionSettingsErrors, type TransitionId, type TransitionSettings } from '../state/transitions.ts'
import { CORNERS, SHORTCUT_IDS, type ShortcutAssignment } from '../view/info-shortcuts.ts'
import { isOwnNumber, LOW_USER_FIRST, USER_NUMBER_LIMIT, USER_NUMBER_START } from '../data/network.ts'
import { currentNetworkBase } from '../data/user-overlay.ts'
import { tvnChannelSettingsErrors, type TvnChannelSettings } from '../tvn/tvn-channel.ts'
import { buildCentralCuration, checkCentralCuration, type CentralCuration } from './central-curation.ts'
import type { StoredSource } from './channels-import.ts'
import type { CuratedEdit } from './curated-edits.ts'
import { buildGuidesExport, checkGuides, EMPTY_LIBRARY, type GuideLibrary, type GuidesExport } from './viewing-guides.ts'
import { curatedChannelManifest, userChannelManifest, type EditorialManifest } from './editorial-manifest.ts'
import type { OriginalSource } from './original-sources.ts'
import {
  buildUserNetworkExport,
  secretsIn,
  validateUserNetworkExport,
  type ExportUser,
  type UserNetworkExport,
} from './user-network-export.ts'
import { inRange, readUserNetworkFile, type ChannelRange, type ReadResult } from './user-network-restore.ts'
import type { UploaderOf } from './user-network.ts'

/**
 * COMPLETE TVN EXPORT (OPTIONS → Your TVN): everything portable about one viewer's TVN in a single file.
 * The User Network document inside it is the very tvn-user-network-v1 file the specialist export writes
 * (users, channels, owners, sources, playlists, filters, modes, running orders, editorial notes), so either
 * can be read by the other's restore. Beside it: the viewer's 001–999 overrides (central-curation.ts),
 * the viewer's saved Guides (viewing-guides.ts), Favourites, the settings that travel between browsers,
 * and each curated or user channel's editorial manifest for reading (a restore ignores those and rebuilds
 * them).
 *
 * Never in it: keys or credentials, caches, the player's state, the refusal cache, Guide rows, a Guide's
 * playback position, 000 TVN's choices and history, 1000 Local Media and its files, startup
 * state, the last channel watched or any other history. A restore reads the whole file before anything
 * changes; one fault anywhere refuses all of it.
 */
export const TVN_EXPORT_FORMAT = 'tvn-export-v1'
export const TVN_EXPORT_VERSION = 1

export interface PortableSettings {
  volume: number
  muted: boolean
  subtitles: boolean
  sleepMinutes: number
  guideSplit: number
  infoShortcuts: ShortcutAssignment
  surfRange: SurfRange
  transition: TransitionId
  /** The transition's look (speed, colour, grain, title card). Files from before it restore the defaults. */
  transitionStyle: TransitionSettings
  /** 000 TVN's two settings; never its choices or history. Files from before them leave this browser's as they are. */
  tvnChannel?: TvnChannelSettings
}

export interface TvnExport {
  format: typeof TVN_EXPORT_FORMAT
  version: typeof TVN_EXPORT_VERSION
  exportedAt: string
  /** The TVN that wrote the file, whose shipped catalogue the 001–999 overrides are read against. Absent in older files. */
  app?: ExportApp
  userNetwork: UserNetworkExport
  favourites: number[]
  /** Any setting left out is left as it is on restore. */
  settings: Partial<PortableSettings>
  /**
   * The viewer's 001–999 overrides, never the shipped catalogue. Absent in files from before them: a
   * restore then leaves this browser's overrides as they are.
   */
  central?: CentralCuration
  /** The viewer's Guides (viewing sequences), never a playback position. Absent in older files: a restore leaves Guides alone. */
  guides?: GuidesExport
  /** For reading only. */
  manifests: EditorialManifest[]
  /**
   * A range export: only the channels numbered first–last, with their sources, running orders, editorial
   * notes, overrides and Favourites; no settings and no Guides. Its restore changes only those numbers.
   * `picked`, when present, is a selection packed into a new list with no gaps: restore adds that list
   * after the channels already there, and leaves those channels as they are.
   */
  range?: ChannelRange
  picked?: number[]
}

export interface ExportApp {
  commit: string
  build: string
}

export interface TvnExportInput {
  stored: readonly StoredSource[]
  users: readonly ExportUser[]
  favourites: readonly number[]
  settings: PortableSettings
  now: Date
  app?: ExportApp
  uploaderOf?: UploaderOf
  curated?: readonly CuratedEdit[]
  /** A curated channel's shipped programmes, for its manifest. */
  shippedOf?: (number: number) => readonly { id: string; durationSeconds: number; year?: number }[]
  guides?: GuideLibrary
  /** A curated channel's original sources as TVN ships them now, for its manifest's provenance. */
  originalsOf?: (number: number) => readonly OriginalSource[]
}

export function buildTvnExport({ stored, users, favourites, settings, now, app, uploaderOf, curated = [], shippedOf = () => [], guides = EMPTY_LIBRARY, originalsOf = () => [] }: TvnExportInput): TvnExport {
  const userNetwork = buildUserNetworkExport(stored, now, uploaderOf, users)
  const central = buildCentralCuration(curated, uploaderOf)
  const numbers = new Set(userNetwork.channels.map((channel) => channel.number))
  const manifests = [
    ...[...curated].sort((a, b) => a.channelNumber - b.channelNumber).map((edit) => curatedChannelManifest(edit.channelNumber, edit, shippedOf(edit.channelNumber), originalsOf(edit.channelNumber))),
    ...stored
      .filter((record) => record.channelNumber !== null && numbers.has(record.channelNumber) && !record.emptySlot)
      .sort((a, b) => (a.channelNumber ?? 0) - (b.channelNumber ?? 0))
      .map(userChannelManifest),
  ]
  return {
    format: TVN_EXPORT_FORMAT,
    version: TVN_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    ...(app ? { app: { commit: app.commit, build: app.build } } : {}),
    userNetwork,
    favourites: [...favourites],
    settings: {
      ...settings,
      infoShortcuts: { ...settings.infoShortcuts },
      surfRange: { ...settings.surfRange },
      transitionStyle: { ...settings.transitionStyle, card: { ...settings.transitionStyle.card } },
      ...(settings.tvnChannel ? { tvnChannel: { autoNext: settings.tvnChannel.autoNext, includeUser: settings.tvnChannel.includeUser } } : {}),
    },
    central,
    guides: buildGuidesExport(guides),
    manifests,
  }
}

/** The complete export cut down to the channels a test keeps. */
function exportSlice(input: Omit<TvnExportInput, 'settings' | 'guides'>, keep: (number: number) => boolean, range: ChannelRange, picked?: number[]): TvnExport {
  const { stored, users, favourites, now, app, uploaderOf, curated = [], shippedOf = () => [], originalsOf = () => [] } = input
  const network = buildUserNetworkExport(stored, now, uploaderOf, users)
  const channels = network.channels.filter((channel) => keep(channel.number))
  const numbers = new Set(channels.map((channel) => channel.number))
  const edits = curated.filter((edit) => keep(edit.channelNumber))
  return {
    format: TVN_EXPORT_FORMAT,
    version: TVN_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    ...(app ? { app: { commit: app.commit, build: app.build } } : {}),
    userNetwork: { ...network, channels },
    favourites: favourites.filter((number) => keep(number)),
    settings: {},
    central: buildCentralCuration(edits, uploaderOf),
    manifests: [
      ...[...edits].sort((a, b) => a.channelNumber - b.channelNumber).map((edit) => curatedChannelManifest(edit.channelNumber, edit, shippedOf(edit.channelNumber), originalsOf(edit.channelNumber))),
      ...stored
        .filter((record) => record.channelNumber !== null && numbers.has(record.channelNumber) && !record.emptySlot)
        .sort((a, b) => (a.channelNumber ?? 0) - (b.channelNumber ?? 0))
        .map(userChannelManifest),
    ],
    range,
    ...(picked ? { picked } : {}),
  }
}

/** The complete export cut down to the channels numbered first–last (either way round). */
export function buildRangeExport(input: Omit<TvnExportInput, 'settings' | 'guides'>, from: number, to: number): TvnExport {
  const range = { first: Math.min(from, to), last: Math.max(from, to) }
  return exportSlice(input, (number) => inRange(number, range), range)
}

/**
 * The channels the viewer ticked, in number order, renumbered into one new list with nothing missing between
 * them. 1001 and 1005 become 1001 and 1002. Restoring adds that list on the end; it does not punch holes
 * where the channels that were not ticked used to be.
 */
export function buildPickedExport(input: Omit<TvnExportInput, 'settings' | 'guides'>, numbers: readonly number[]): TvnExport {
  const wanted = [...new Set(numbers)].filter((number) => Number.isInteger(number)).sort((a, b) => a - b)
  const start = currentNetworkBase() === 'new' ? LOW_USER_FIRST : USER_NUMBER_START
  const byNumber = new Map(input.stored.filter((record) => record.channelNumber !== null).map((record) => [record.channelNumber, record]))
  const chosen = wanted.filter((number) => byNumber.has(number))
  if (chosen.length === 0) throw new Error('Choose a channel to export')
  const packed = chosen.map((number, index) => ({ ...byNumber.get(number)!, channelNumber: start + index }))
  const listing = packed.map((record) => record.channelNumber!)
  const moved = new Map(chosen.map((number, index) => [number, listing[index]]))
  return exportSlice(
    { ...input, stored: packed, favourites: input.favourites.map((number) => moved.get(number)).filter((number): number is number => number !== undefined), curated: [] },
    (number) => listing.includes(number),
    { first: listing[0], last: listing[listing.length - 1] },
    listing,
  )
}

/** `TVN_Selection_4_YYYY-MM-DD.json`, or one channel's number when only that one was ticked. */
export function pickedExportFilename(now: Date, numbers: readonly number[]): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const listed = [...numbers].sort((a, b) => a - b)
  const tag = listed.length === 1 ? String(listed[0]).padStart(4, '0') : String(listed.length)
  return `TVN_Selection_${tag}_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`
}

/** `TVN_Channels_0950-0970_YYYY-MM-DD.json`. */
export function rangeExportFilename(now: Date, range: ChannelRange): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const number = (value: number) => String(value).padStart(4, '0')
  return `TVN_Channels_${number(range.first)}-${number(range.last)}_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`
}

/** `TVN_Export_YYYY-MM-DD.json`, by the viewer's own calendar. */
export function tvnExportFilename(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `TVN_Export_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`
}

export function serialiseTvnExport(document: TvnExport): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isInt = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

/** A present setting must already be valid: nothing is clamped or guessed. */
function checkSettings(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push('settings is not an object')
    return
  }
  const at = (name: string) => `settings.${name}`
  if (value.volume !== undefined && !isInt(value.volume, 0, 100)) errors.push(`${at('volume')} is not 0–100`)
  for (const name of ['muted', 'subtitles'] as const) {
    if (value[name] !== undefined && typeof value[name] !== 'boolean') errors.push(`${at(name)} is not true or false`)
  }
  if (value.sleepMinutes !== undefined && !(typeof value.sleepMinutes === 'number' && SLEEP_CHOICES.includes(value.sleepMinutes))) {
    errors.push(`${at('sleepMinutes')} is not one of ${SLEEP_CHOICES.join(', ')}`)
  }
  if (value.guideSplit !== undefined && !(typeof value.guideSplit === 'number' && value.guideSplit > 0 && value.guideSplit < 1)) {
    errors.push(`${at('guideSplit')} is not between 0 and 1`)
  }
  if (value.infoShortcuts !== undefined) {
    const shortcuts = value.infoShortcuts
    if (!isRecord(shortcuts)) errors.push(`${at('infoShortcuts')} is not an object`)
    else {
      for (const corner of CORNERS) {
        if (!(SHORTCUT_IDS as readonly unknown[]).includes(shortcuts[corner])) errors.push(`${at('infoShortcuts')}.${corner} is not a shortcut`)
      }
      if (new Set(CORNERS.map((corner) => shortcuts[corner])).size !== CORNERS.length) errors.push(`${at('infoShortcuts')} repeats a shortcut`)
    }
  }
  if (value.surfRange !== undefined) {
    const range = value.surfRange
    if (
      !isRecord(range) ||
      !isInt(range.minSeconds, SURF_LIMIT_MIN, SURF_LIMIT_MAX) ||
      !isInt(range.maxSeconds, SURF_LIMIT_MIN, SURF_LIMIT_MAX) ||
      range.minSeconds > range.maxSeconds
    ) {
      errors.push(`${at('surfRange')} is not ${SURF_LIMIT_MIN}–${SURF_LIMIT_MAX} seconds, minimum first`)
    }
  }
  if (value.transition !== undefined && !(TRANSITION_IDS as readonly unknown[]).includes(value.transition)) {
    errors.push(`${at('transition')} is not ${TRANSITION_IDS.join(' or ')}`)
  }
  if (value.transitionStyle !== undefined) errors.push(...transitionSettingsErrors(value.transitionStyle, at('transitionStyle')))
  if (value.tvnChannel !== undefined) errors.push(...tvnChannelSettingsErrors(value.tvnChannel, at('tvnChannel')))
}

/** A range file holds nothing outside its own numbers, so its restore can never reach past them. */
function checkRange(data: Record<string, unknown>, errors: string[]): void {
  const range = data.range
  if (!isRecord(range) || !isInt(range.first, 1, USER_NUMBER_LIMIT - 1) || !isInt(range.last, 1, USER_NUMBER_LIMIT - 1) || range.first > range.last) {
    errors.push('range is not first–last channel numbers, lowest first')
    return
  }
  const bounds = { first: range.first, last: range.last }
  const numbers = (list: unknown, of: (item: Record<string, unknown>) => unknown): unknown[] => (Array.isArray(list) ? list.map((item) => (isRecord(item) ? of(item) : item)) : [])
  const network = isRecord(data.userNetwork) ? data.userNetwork.channels : undefined
  const central = isRecord(data.central) ? data.central.overrides : undefined
  const outside = [
    ...numbers(network, (channel) => channel.number),
    ...numbers(central, (override) => override.number),
    ...(Array.isArray(data.favourites) ? data.favourites : []),
  ].filter((number) => typeof number === 'number' && !inRange(number, bounds))
  if (outside.length) errors.push(`range ${bounds.first}–${bounds.last} does not hold channel ${String(outside[0])}`)
  if (data.picked === undefined) return
  if (!Array.isArray(data.picked) || data.picked.some((number) => !isInt(number, bounds.first, bounds.last)) || new Set(data.picked).size !== data.picked.length) {
    errors.push('picked is not the channel numbers chosen inside the range')
    return
  }
  const chosen = new Set(data.picked)
  const stray = [...numbers(network, (channel) => channel.number), ...numbers(central, (override) => override.number)].find((number) => typeof number === 'number' && !chosen.has(number))
  if (stray !== undefined) errors.push(`picked does not include channel ${String(stray)}`)
}

export function validateTvnExport(data: unknown): { ok: true; value: TvnExport } | { ok: false; errors: string[] } {
  if (!isRecord(data)) return { ok: false, errors: ['Not a TVN export'] }
  const errors: string[] = []
  secretsIn(data, 'file', errors)
  if (data.format !== TVN_EXPORT_FORMAT) errors.push(`Unknown format ${JSON.stringify(data.format)}`)
  if (data.version !== TVN_EXPORT_VERSION) errors.push(`Unsupported version ${JSON.stringify(data.version)}`)
  if (typeof data.exportedAt !== 'string' || Number.isNaN(Date.parse(data.exportedAt))) errors.push('exportedAt is not a date')
  if (data.app !== undefined && !(isRecord(data.app) && typeof data.app.commit === 'string' && typeof data.app.build === 'string')) errors.push('app is not a TVN build')
  const network = validateUserNetworkExport(data.userNetwork)
  if (!network.ok) errors.push(...network.errors.filter((error) => !error.includes('is a secret field')).map((error) => `userNetwork: ${error}`))
  if (!Array.isArray(data.favourites)) errors.push('favourites is not a list')
  else {
    data.favourites.forEach((number, index) => {
      if (!isInt(number, 0, USER_NUMBER_LIMIT - 1)) errors.push(`favourites[${index}] is not a channel number`)
    })
    if (new Set(data.favourites).size !== data.favourites.length) errors.push('favourites repeats a channel')
  }
  checkSettings(data.settings, errors)
  if (data.central !== undefined) checkCentralCuration(data.central, 'central', errors)
  if (data.guides !== undefined) checkGuides(data.guides, 'guides', errors)
  if (data.manifests !== undefined && !Array.isArray(data.manifests)) errors.push('manifests is not a list')
  if (data.range !== undefined) checkRange(data, errors)
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: data as unknown as TvnExport }
}

export type TvnExportRead =
  | { ok: true; value: TvnExport; channels: number; users: number; favourites: number; settings: number; overrides: number; guides: number }
  | { ok: false; errors: string[] }

/** Parse and validate the text of a chosen file. Reads only. */
export function readTvnExportFile(text: string): TvnExportRead {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, errors: ['Not a JSON file'] }
  }
  return readTvnExportData(data)
}

/** RESTORE takes either file: a complete export, or a User Network file on its own. Reads only. */
export function readRestoreFile(text: string): ({ kind: 'complete' } & TvnExportRead) | ({ kind: 'network' } & ReadResult) {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { kind: 'network', ok: false, errors: ['Not a JSON file'] }
  }
  if (isRecord(data) && data.format === TVN_EXPORT_FORMAT) {
    const channels = isRecord(data.userNetwork) && Array.isArray(data.userNetwork.channels) ? data.userNetwork.channels : []
    const low = channels.find((channel) => isRecord(channel) && typeof channel.number === 'number' && channel.number < USER_NUMBER_START && !isOwnNumber(channel.number))
    if (low && isRecord(low)) {
      return {
        kind: 'complete',
        ok: false,
        errors: [`Its own channels from ${String(low.number)} come from a NEW USER network, where 001–990 are yours: start NEW in this browser first, then restore`],
      }
    }
    return { kind: 'complete', ...readTvnExportData(data) }
  }
  return { kind: 'network', ...readUserNetworkFile(text) }
}

function readTvnExportData(data: unknown): TvnExportRead {
  const checked = validateTvnExport(data)
  if (!checked.ok) return checked
  const { userNetwork, favourites, settings } = checked.value
  return {
    ok: true,
    value: checked.value,
    channels: userNetwork.channels.length,
    users: userNetwork.users?.length ?? 0,
    favourites: favourites.length,
    settings: Object.keys(settings).length,
    overrides: checked.value.central?.overrides.length ?? 0,
    guides: checked.value.guides?.saved.length ?? 0,
  }
}
