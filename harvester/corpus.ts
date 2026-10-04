import { shippedChannel, shippedProgrammes } from '../src/data/catalogue.ts'
import { overridesFromExport, type CentralOverride } from '../src/services/central-curation.ts'
import { curatedChannelManifest, userChannelManifest } from '../src/services/editorial-manifest.ts'
import { validateTvnExport, type TvnExport } from '../src/services/tvn-export.ts'
import type { ExportChannel, ExportSource, ExportVideo, UserNetworkExport } from '../src/services/user-network-export.ts'
import { recordsFromExport } from '../src/services/user-network-restore.ts'
import type { ImportedVideo, StoredSource } from '../src/services/channels-import.ts'
import { originalsOf } from './baseline.ts'
import { getMeta, SCHEMA_VERSION, type Db } from './db.ts'

interface ChannelRow {
  id: number
  scope: 'user' | 'central'
  number: number
  body: string
  layer: 'master' | 'shipped'
}

interface SourceRow {
  id: number
  channel_id: number
  body: string
  has_videos: number
  provenance: string
}

/**
 * Which of a channel's sources a view includes. `export`: what the Complete Export carries (a 001–999 override
 * exactly as the master had it, a user channel with its Source Desk additions). `effective`: everything,
 * shipped originals and candidate enrichment included, as the Source Desk and health see the channel.
 */
export type ChannelView = 'export' | 'effective'

/** A source's programmes in its own order, optionally only those of some provenances. */
export function programmesOf(db: Db, sourceId: number, provenances?: readonly string[]): ExportVideo[] {
  const rows = provenances
    ? (db.prepare(`SELECT body FROM programmes WHERE source_id = ? AND provenance IN (${provenances.map(() => '?').join(', ')}) ORDER BY ord`).all(sourceId, ...provenances) as { body: string }[])
    : (db.prepare('SELECT body FROM programmes WHERE source_id = ? ORDER BY ord').all(sourceId) as { body: string }[])
  return rows.map((row) => JSON.parse(row.body) as ExportVideo)
}

function sourcesOf(db: Db, channel: ChannelRow, view: ChannelView): ExportSource[] {
  const rows = db.prepare('SELECT id, channel_id, body, has_videos, provenance FROM sources WHERE channel_id = ? ORDER BY position').all(channel.id) as unknown as SourceRow[]
  const kept = view === 'effective' ? rows : rows.filter((row) => row.provenance === 'master' || (channel.scope === 'user' && row.provenance === 'desk'))
  return kept.map((row) => {
    const videos = programmesOf(db, row.id)
    const body = JSON.parse(row.body) as ExportSource
    return row.has_videos || videos.length > 0 ? { ...body, videos } : body
  })
}

/** One channel as the export carries it (or, `effective`, with every layer), with its pool as the database holds it now. */
export function channelExport(db: Db, channelId: number, view: ChannelView = 'export'): ExportChannel | CentralOverride {
  const row = db.prepare('SELECT id, scope, number, body, layer FROM channels WHERE id = ?').get(channelId) as unknown as ChannelRow
  return { ...(JSON.parse(row.body) as object), sources: sourcesOf(db, row, view) } as ExportChannel | CentralOverride
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

export const CENTRAL_ENRICHMENT_FORMAT = 'tvn-harvester-central-enrichment-v1'

export interface EnrichmentSource extends ExportSource {
  provenance: 'shipped' | 'desk'
}

/**
 * Candidate enrichment of the 001–999 network, kept apart from the overrides so that restoring the corpus in
 * TVN changes no central channel: Source Desk sources with everything they hold, and shipped originals with
 * only what Harvester found beyond TVN's own programmes. Publish Corpus decides what becomes shipped.
 */
export interface CentralEnrichment {
  format: typeof CENTRAL_ENRICHMENT_FORMAT
  baseline: { appCommit: string; appBuild: string | null; catalogueSha256: string } | null
  channels: { stableId: string | null; number: number; name: string; sources: EnrichmentSource[] }[]
}

export function centralEnrichment(db: Db): CentralEnrichment {
  const baseline = db.prepare('SELECT app_commit, app_build, catalogue_sha256 FROM baseline WHERE id = 1').get() as { app_commit: string; app_build: string | null; catalogue_sha256: string } | undefined
  const channels = db
    .prepare(
      `SELECT DISTINCT c.id, c.stable_id, c.number, c.name FROM channels c JOIN sources s ON s.channel_id = c.id
       WHERE c.scope = 'central' AND (s.provenance = 'desk' OR (s.provenance = 'shipped' AND EXISTS (SELECT 1 FROM programmes p WHERE p.source_id = s.id AND p.provenance IN ('auto', 'desk'))))
       ORDER BY c.number`,
    )
    .all() as { id: number; stable_id: string | null; number: number; name: string }[]
  const sources = db.prepare("SELECT id, body, provenance FROM sources WHERE channel_id = ? AND provenance IN ('shipped', 'desk') ORDER BY position")
  return {
    format: CENTRAL_ENRICHMENT_FORMAT,
    baseline: baseline ? { appCommit: baseline.app_commit, appBuild: baseline.app_build, catalogueSha256: baseline.catalogue_sha256 } : null,
    channels: channels.map((channel) => ({
      stableId: channel.stable_id,
      number: channel.number,
      name: channel.name,
      sources: (sources.all(channel.id) as { id: number; body: string; provenance: 'shipped' | 'desk' }[]).flatMap((row) => {
        const videos = programmesOf(db, row.id, row.provenance === 'desk' ? undefined : ['auto', 'desk'])
        return row.provenance === 'desk' || videos.length > 0 ? [{ ...(JSON.parse(row.body) as ExportSource), provenance: row.provenance, videos }] : []
      }),
    })),
  }
}

/**
 * The working corpus as a Complete Export: the master's channels, settings, favourites, users and Guides,
 * every exported source with its pool as harvested, manifests written by TVN's own code, and the central
 * enrichment beside them. A `harvest` stamp says where it came from; TVN's restore reads past both.
 */
export function assembleCorpus(db: Db, now: Date, runId: number | null = null): TvnExport & { harvest: HarvestStamp; centralEnrichment?: CentralEnrichment } {
  const rest = masterRest(db)
  const channels = db.prepare("SELECT id, scope, number, body, layer FROM channels WHERE layer = 'master' ORDER BY scope, position").all() as unknown as ChannelRow[]
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
  const enrichment = centralEnrichment(db)
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
    ...(enrichment.channels.length > 0 ? { centralEnrichment: enrichment } : {}),
  } as TvnExport & { harvest: HarvestStamp; centralEnrichment?: CentralEnrichment }
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
export function checkedCorpus(db: Db, now: Date, runId: number | null = null): ReturnType<typeof assembleCorpus> {
  const doc = assembleCorpus(db, now, runId)
  const checked = validateTvnExport(JSON.parse(JSON.stringify(doc)))
  if (!checked.ok) throw new Error(`The harvested corpus would not restore: ${checked.errors.slice(0, 5).join('; ')}`)
  return doc
}
