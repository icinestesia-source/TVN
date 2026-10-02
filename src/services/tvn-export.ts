import { SLEEP_CHOICES } from '../state/sleep.ts'
import { SURF_LIMIT_MAX, SURF_LIMIT_MIN, type SurfRange } from '../state/surf.ts'
import { TRANSITION_IDS, transitionSettingsErrors, type TransitionId, type TransitionSettings } from '../state/transitions.ts'
import { CORNERS, SHORTCUT_IDS, type ShortcutAssignment } from '../view/info-shortcuts.ts'
import { USER_NUMBER_LIMIT } from '../data/network.ts'
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
import { readUserNetworkFile, type ReadResult } from './user-network-restore.ts'
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
}

export interface TvnExportInput {
  stored: readonly StoredSource[]
  users: readonly ExportUser[]
  favourites: readonly number[]
  settings: PortableSettings
  now: Date
  uploaderOf?: UploaderOf
  curated?: readonly CuratedEdit[]
  /** A curated channel's shipped programmes, for its manifest. */
  shippedOf?: (number: number) => readonly { id: string; durationSeconds: number; year?: number }[]
  guides?: GuideLibrary
  /** A curated channel's original sources as TVN ships them now, for its manifest's provenance. */
  originalsOf?: (number: number) => readonly OriginalSource[]
}

export function buildTvnExport({ stored, users, favourites, settings, now, uploaderOf, curated = [], shippedOf = () => [], guides = EMPTY_LIBRARY, originalsOf = () => [] }: TvnExportInput): TvnExport {
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

export function validateTvnExport(data: unknown): { ok: true; value: TvnExport } | { ok: false; errors: string[] } {
  if (!isRecord(data)) return { ok: false, errors: ['Not a TVN export'] }
  const errors: string[] = []
  secretsIn(data, 'file', errors)
  if (data.format !== TVN_EXPORT_FORMAT) errors.push(`Unknown format ${JSON.stringify(data.format)}`)
  if (data.version !== TVN_EXPORT_VERSION) errors.push(`Unsupported version ${JSON.stringify(data.version)}`)
  if (typeof data.exportedAt !== 'string' || Number.isNaN(Date.parse(data.exportedAt))) errors.push('exportedAt is not a date')
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
  if (isRecord(data) && data.format === TVN_EXPORT_FORMAT) return { kind: 'complete', ...readTvnExportData(data) }
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
