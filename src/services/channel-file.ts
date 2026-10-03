import { USER_NUMBER_LIMIT, USER_NUMBER_START } from '../data/network.ts'
import { TVN_OWNER } from '../data/user-network/users.ts'
import { sourcesOf } from './channel-editor.ts'
import { allocateUserNumber, firstEmptySlot, type StoredSource } from './channels-import.ts'
import { userChannelManifest, type ManifestCurrent } from './editorial-manifest.ts'
import type { UploaderOf } from './user-network.ts'
import { checkChannel, exportChannel, secretsIn, USER_NETWORK_FORMAT, USER_NETWORK_VERSION, type ExportChannel } from './user-network-export.ts'
import { recordsFromExport } from './user-network-restore.ts'

/**
 * tvn-channel-v1: one user channel as a portable file (EXPORT CHANNEL in Edit Channel). It carries the
 * channel's name, sources, filters, modes, editorial notes and running order: the same channel shape as a
 * tvn-user-network-v1 file, without an owner. Never keys or credentials, viewing history, other users or
 * other channels. `facts` is a snapshot for reading; IMPORT rebuilds from `channel` and reads it again.
 */
export const CHANNEL_FILE_FORMAT = 'tvn-channel-v1'
export const CHANNEL_FILE_VERSION = 1

export interface ChannelFile {
  format: typeof CHANNEL_FILE_FORMAT
  version: typeof CHANNEL_FILE_VERSION
  exportedAt: string
  channel: Omit<ExportChannel, 'owner'>
  facts?: ManifestCurrent
}

const userNumber = (number: number | null): number is number => number !== null && number >= USER_NUMBER_START && number < USER_NUMBER_LIMIT

/** The file for one stored user channel. Reads only. A TVN channel (001–999) has no such file. */
export function buildChannelFile(record: StoredSource, now: Date, uploaderOf: UploaderOf = () => null): ChannelFile {
  if (!userNumber(record.channelNumber)) throw new Error('Only User Network channels can be exported')
  const { owner: _owner, id: _id, ...channel } = exportChannel(record, uploaderOf, [])
  return { format: CHANNEL_FILE_FORMAT, version: CHANNEL_FILE_VERSION, exportedAt: now.toISOString(), channel, facts: userChannelManifest(record).current }
}

const slug = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'Channel'

/** What a channel's EXPORT writes: the channel file, its manifest as JSON, or the manifest as readable text. */
export type ChannelExportKind = 'json' | 'manifest' | 'md'

export function channelFilename(record: Pick<StoredSource, 'channelNumber' | 'name'>, extension: 'json' | 'md' | 'manifest.json' = 'json'): string {
  return `TVN_Channel_${record.channelNumber}_${slug(record.name)}.${extension}`
}

export function serialiseChannelFile(file: ChannelFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Check a tvn-channel-v1 document before anything is built from it; a file with any problem is refused whole. */
export function validateChannelFile(data: unknown): { ok: true; value: ChannelFile } | { ok: false; errors: string[] } {
  if (!isRecord(data)) return { ok: false, errors: ['Not a TVN channel file'] }
  const errors: string[] = []
  secretsIn(data, 'file', errors)
  if (data.format !== CHANNEL_FILE_FORMAT) errors.push(`Unknown format ${JSON.stringify(data.format)}`)
  if (data.version !== CHANNEL_FILE_VERSION) errors.push(`Unsupported version ${JSON.stringify(data.version)}`)
  if (typeof data.exportedAt !== 'string' || Number.isNaN(Date.parse(data.exportedAt))) errors.push('exportedAt is not a date')
  checkChannel(data.channel, 'channel', errors)
  if (isRecord(data.channel) && data.channel.owner !== undefined) errors.push('channel.owner belongs to a User Network file, not a channel file')
  if (data.facts !== undefined && !isRecord(data.facts)) errors.push('facts is not a set of facts')
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: data as unknown as ChannelFile }
}

export function readChannelFile(text: string): { ok: true; value: ChannelFile } | { ok: false; errors: string[] } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, errors: ['Not a JSON file'] }
  }
  return validateChannelFile(data)
}

/**
 * The stored list with the file's channel added: on the lowest empty user slot, or else the lowest free
 * user number, for `owner`. Nothing already in the list is replaced; a channel whose id is already taken
 * gets its own. YouTube sources come back as addresses to read again (see resolveRestored).
 */
export function addChannelFromFile(
  existing: readonly StoredSource[],
  file: ChannelFile,
  owner: string,
  now: number,
): { sources: StoredSource[]; record: StoredSource; number: number } {
  const slot = firstEmptySlot(existing)
  const taken = new Set(existing.flatMap((record) => (record.channelNumber === null ? [] : [record.channelNumber])))
  const number = slot?.channelNumber ?? allocateUserNumber(taken)
  if (number === null) throw new Error('The User Network has no free channel numbers')
  const [built] = recordsFromExport(
    {
      format: USER_NETWORK_FORMAT,
      version: USER_NETWORK_VERSION,
      exportedAt: file.exportedAt,
      numbering: { first: USER_NUMBER_START, limit: USER_NUMBER_LIMIT },
      channels: [{ ...file.channel, number }],
    },
    now,
  )
  const ids = new Set(existing.map((record) => record.id))
  let record: StoredSource = { ...built, ...(owner !== TVN_OWNER ? { owner } : {}) }
  if (ids.has(built.id)) {
    // The same channel is already here: the copy keeps its sources explicitly under an id of its own, so neither replaces the other.
    let id = `user:${number}`
    for (let suffix = 2; ids.has(id); suffix += 1) id = `user:${number}-${suffix}`
    record = { ...record, id, channelSources: sourcesOf(built), listName: built.listName ?? built.name }
  }
  const sources = slot ? existing.map((item) => (item === slot ? record : item)) : [...existing, record]
  return { sources, record, number }
}
