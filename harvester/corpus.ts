import { shippedChannel, shippedProgrammes } from '../src/data/catalogue.ts'
import { overridesFromExport, type CentralOverride } from '../src/services/central-curation.ts'
import { curatedChannelManifest, userChannelManifest } from '../src/services/editorial-manifest.ts'
import { validateTvnExport, type TvnExport } from '../src/services/tvn-export.ts'
import type { ExportChannel, ExportSource, ExportVideo, UserNetworkExport } from '../src/services/user-network-export.ts'
import { recordsFromExport } from '../src/services/user-network-restore.ts'
import { channelOriginals } from '../src/view/channel-provenance.ts'
import { readRegister, type SourceRegister } from '../src/credits/provenance.ts'
import { defaultNetworkItems } from '../src/data/network/catalog.ts'
import { setMediaLibrary } from '../src/director/library.ts'
import { expandPlayableCatalogue } from '../src/library/playable-catalogue.ts'
import { programmeForDirector } from '../src/library/source-editorial.ts'
import type { ImportedVideo, StoredSource } from '../src/services/channels-import.ts'
import { readFileSync } from 'node:fs'
import { getMeta, SCHEMA_VERSION, type Db } from './db.ts'

interface ChannelRow {
  id: number
  scope: 'user' | 'central'
  number: number
  body: string
}

interface SourceRow {
  id: number
  channel_id: number
  body: string
  has_videos: number
}

/** A source's programmes in its own order. */
export function programmesOf(db: Db, sourceId: number): ExportVideo[] {
  return (db.prepare('SELECT body FROM programmes WHERE source_id = ? ORDER BY ord').all(sourceId) as { body: string }[]).map((row) => JSON.parse(row.body) as ExportVideo)
}

function sourcesOf(db: Db, channelId: number): ExportSource[] {
  const rows = db.prepare('SELECT id, channel_id, body, has_videos FROM sources WHERE channel_id = ? ORDER BY position').all(channelId) as unknown as SourceRow[]
  return rows.map((row) => {
    const videos = programmesOf(db, row.id)
    const body = JSON.parse(row.body) as ExportSource
    return row.has_videos || videos.length > 0 ? { ...body, videos } : body
  })
}

/** One channel exactly as the export carries it, with its pool as the database holds it now. */
export function channelExport(db: Db, channelId: number): ExportChannel | CentralOverride {
  const row = db.prepare('SELECT id, scope, number, body FROM channels WHERE id = ?').get(channelId) as unknown as ChannelRow
  return { ...(JSON.parse(row.body) as object), sources: sourcesOf(db, row.id) } as ExportChannel | CentralOverride
}

/** What the master carried outside its channels, as imported. */
export function masterRest(db: Db): Record<string, unknown> {
  const row = db.prepare('SELECT rest FROM master WHERE id = 1').get() as { rest: string } | undefined
  if (!row) throw new Error('This workspace has no master imported')
  return JSON.parse(row.rest) as Record<string, unknown>
}

export interface HarvestStamp {
  workspaceId: string
  schemaVersion: number
  masterSha256: string
  runId: number | null
  harvestedAt: string
}

/**
 * The working corpus as a Complete Export: the master's channels, settings, favourites, users and Guides,
 * every source with its pool as harvested, and manifests written by TVN's own code. A `harvest` stamp says
 * where it came from; TVN's restore reads past it.
 */
export function assembleCorpus(db: Db, now: Date, runId: number | null = null): TvnExport & { harvest: HarvestStamp } {
  const rest = masterRest(db)
  const channels = db.prepare('SELECT id, scope, number, body FROM channels ORDER BY scope, position').all() as unknown as ChannelRow[]
  const central = channels.filter((row) => row.scope === 'central').map((row) => channelExport(db, row.id) as CentralOverride)
  const user = channels.filter((row) => row.scope === 'user').map((row) => channelExport(db, row.id) as ExportChannel)
  const network = rest.userNetwork as Omit<UserNetworkExport, 'channels'>
  const userNetwork: UserNetworkExport = { ...network, exportedAt: now.toISOString(), channels: user }
  const centralDoc = rest.central ? { ...(rest.central as { format: 'tvn-central-overrides-v1' }), overrides: central } : undefined
  const harvest: HarvestStamp = {
    workspaceId: getMeta(db, 'workspace_id') ?? '',
    schemaVersion: SCHEMA_VERSION,
    masterSha256: getMeta(db, 'master_sha256') ?? '',
    runId,
    harvestedAt: now.toISOString(),
  }
  const { format, version, app, favourites, settings, guides, userNetwork: _network, central: _central, exportedAt: _exportedAt, ...others } = rest as unknown as TvnExport & Record<string, unknown>
  return {
    ...others,
    format,
    version,
    exportedAt: now.toISOString(),
    ...(app ? { app } : {}),
    harvest,
    userNetwork,
    favourites,
    settings,
    ...(centralDoc ? { central: centralDoc } : {}),
    ...(guides ? { guides } : {}),
    manifests: manifestsOf(userNetwork, centralDoc?.overrides ?? [], now),
  } as TvnExport & { harvest: HarvestStamp }
}

/**
 * User channels as TVN's restore makes them. A restore reads every podcast again; the corpus holds the pool
 * already, so it is laid back in for counting.
 */
export function userRecords(userNetwork: UserNetworkExport, now: Date): StoredSource[] {
  return recordsFromExport(userNetwork, now.getTime()).map((record, index) => {
    const exported = userNetwork.channels[index]?.sources ?? []
    const sources = record.channelSources?.map((source, at) =>
      source.kind === 'podcast' && (source.videos?.length ?? 0) === 0 && exported[at]?.videos ? { ...source, videos: exported[at].videos as ImportedVideo[] } : source,
    )
    return sources ? { ...record, channelSources: sources } : record
  })
}

let shippedRegister: SourceRegister | null = null

/** TVN's shipped library and source register, as the viewer loads them, for a 001–999 channel's original sources. */
function originalsOf(number: number) {
  if (!shippedRegister) {
    const shipped = (name: string) => JSON.parse(readFileSync(new URL(`../public/independent/${name}`, import.meta.url), 'utf8')) as unknown
    setMediaLibrary([...defaultNetworkItems(), ...expandPlayableCatalogue(shipped('playable.json')).map(programmeForDirector)])
    shippedRegister = readRegister(shipped('sources.json'))
  }
  return channelOriginals(number, shippedRegister)
}

/** Manifests exactly as TVN's Export All writes them, against the shipped catalogue this checkout carries. */
export function manifestsOf(userNetwork: UserNetworkExport, overrides: readonly CentralOverride[], now: Date): TvnExport['manifests'] {
  const curated = overridesFromExport({ format: 'tvn-central-overrides-v1', overrides: [...overrides] })
  const stored = userRecords(userNetwork, now)
  const numbers = new Set(userNetwork.channels.map((channel) => channel.number))
  return [
    ...[...curated]
      .sort((a, b) => a.channelNumber - b.channelNumber)
      .map((edit) => {
        const shipped = shippedChannel(edit.channelNumber)
        return curatedChannelManifest(edit.channelNumber, edit, shipped ? shippedProgrammes(shipped.id) : [], originalsOf(edit.channelNumber))
      }),
    ...stored
      .filter((record) => record.channelNumber !== null && numbers.has(record.channelNumber) && !record.emptySlot)
      .sort((a, b) => (a.channelNumber ?? 0) - (b.channelNumber ?? 0))
      .map(userChannelManifest),
  ]
}

/** The corpus, checked by TVN's own validator before anything is written. */
export function checkedCorpus(db: Db, now: Date, runId: number | null = null): TvnExport & { harvest: HarvestStamp } {
  const doc = assembleCorpus(db, now, runId)
  const checked = validateTvnExport(JSON.parse(JSON.stringify(doc)))
  if (!checked.ok) throw new Error(`The harvested corpus would not restore: ${checked.errors.slice(0, 5).join('; ')}`)
  return doc
}
