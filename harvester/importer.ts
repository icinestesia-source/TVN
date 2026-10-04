import { readRestoreFile } from '../src/services/tvn-export.ts'
import type { TvnExport } from '../src/services/tvn-export.ts'
import type { ExportSource, ExportVideo } from '../src/services/user-network-export.ts'
import type { CentralOverride } from '../src/services/central-curation.ts'
import { setMeta, transaction, type Db } from './db.ts'

/** How Harvester can refresh a source. `none`: TVN's own programming, or an imported list with no known uploader. */
export type Reader = 'youtube' | 'collection' | 'podcast' | 'website' | 'stream' | 'none'

export function readerOf(source: Pick<ExportSource, 'sourceType' | 'uploaderChannelId'>): Reader {
  switch (source.sourceType) {
    case 'youtube-channel':
    case 'youtube-playlist':
      return 'youtube'
    case 'collection':
      return source.uploaderChannelId ? 'collection' : 'none'
    case 'podcast':
      return 'podcast'
    case 'website':
      return 'website'
    case 'audio':
    case 'audio-hls':
    case 'video':
    case 'video-hls':
      return 'stream'
    default:
      return 'none'
  }
}

export interface MasterFacts {
  filename: string
  storedPath: string
  sha256: string
  bytes: number
  importedAt: Date
}

export interface ImportCounts {
  channels: number
  central: number
  sources: number
  programmes: number
  dated: number
}

/** The export's own channel key: its stable id, or its number where the browser had none to give. */
export const userChannelKey = (channel: { id?: string; number: number }) => channel.id ?? `user:${channel.number}`
export const centralChannelKey = (number: number) => `central:${String(number).padStart(3, '0')}`

/** Parse and validate a Complete Export with TVN's own reader. Anything it would refuse, Harvester refuses. */
export function readMaster(text: string): TvnExport {
  const read = readRestoreFile(text)
  if (read.kind !== 'complete') throw new Error('That file is not a TVN Complete Export')
  if (!read.ok) throw new Error(`That export is not valid: ${read.errors.slice(0, 5).join('; ')}`)
  return read.value
}

function insertChannel(db: Db, row: { key: string; scope: 'user' | 'central'; number: number; name: string; enabled: boolean; position: number; body: object }, sources: readonly ExportSource[]): { sources: number; programmes: number; dated: number } {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO channels (key, scope, number, name, enabled, position, body) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(row.key, row.scope, row.number, row.name, row.enabled ? 1 : 0, row.position, JSON.stringify(row.body))
  const channelId = Number(lastInsertRowid)
  const addSource = db.prepare(
    'INSERT INTO sources (channel_id, position, key, source_type, url, provider_id, label, enabled, reader, body, has_videos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const addProgramme = db.prepare(
    "INSERT OR IGNORE INTO programmes (source_id, video_id, ord, body, published, duration_sec, pending, origin) VALUES (?, ?, ?, ?, ?, ?, ?, 'master')",
  )
  let programmes = 0
  let dated = 0
  sources.forEach((source, position) => {
    const { videos, ...body } = source
    const inserted = addSource.run(
      channelId,
      position,
      `${row.key}#${position}`,
      source.sourceType,
      source.url,
      source.providerId ?? null,
      source.label,
      source.enabled ? 1 : 0,
      readerOf(source),
      JSON.stringify(body),
      videos ? 1 : 0,
    )
    const sourceId = Number(inserted.lastInsertRowid)
    ;(videos ?? []).forEach((video: ExportVideo, index) => {
      const added = addProgramme.run(sourceId, video.id, index, JSON.stringify(video), video.published ?? null, video.durationSec, video.pending ? 1 : 0)
      if (added.changes > 0) {
        programmes += 1
        if (video.published) dated += 1
      }
    })
  })
  return { sources: sources.length, programmes, dated }
}

/**
 * Read the master into an empty working database: every channel, source and programme, with every
 * editorial field kept exactly as exported, and everything else in the file kept to export it again.
 */
export function importMaster(db: Db, text: string, facts: MasterFacts, workspaceId: string): ImportCounts {
  const doc = readMaster(text)
  const counts: ImportCounts = { channels: 0, central: 0, sources: 0, programmes: 0, dated: 0 }
  transaction(db, () => {
    const add = (made: { sources: number; programmes: number; dated: number }) => {
      counts.sources += made.sources
      counts.programmes += made.programmes
      counts.dated += made.dated
    }
    ;(doc.central?.overrides ?? []).forEach((override: CentralOverride, position) => {
      const { sources, ...body } = override
      add(insertChannel(db, { key: centralChannelKey(override.number), scope: 'central', number: override.number, name: override.name, enabled: true, position, body }, sources))
      counts.central += 1
    })
    doc.userNetwork.channels.forEach((channel, position) => {
      const { sources, ...body } = channel
      add(insertChannel(db, { key: userChannelKey(channel), scope: 'user', number: channel.number, name: channel.name, enabled: channel.enabled, position, body }, sources))
      counts.channels += 1
    })
    const { userNetwork, central, manifests: _manifests, ...top } = doc
    const rest = {
      ...top,
      userNetwork: { ...userNetwork, channels: undefined },
      ...(central ? { central: { ...central, overrides: undefined } } : {}),
    }
    db.prepare(
      'INSERT INTO master (id, filename, stored_path, imported_at, format, version, exported_at, app_commit, app_build, sha256, bytes, channels, central, sources, programmes, dated, rest) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      facts.filename,
      facts.storedPath,
      facts.importedAt.toISOString(),
      doc.format,
      doc.version,
      doc.exportedAt,
      doc.app?.commit ?? null,
      doc.app?.build ?? null,
      facts.sha256,
      facts.bytes,
      counts.channels,
      counts.central,
      counts.sources,
      counts.programmes,
      counts.dated,
      JSON.stringify(rest),
    )
    setMeta(db, 'workspace_id', workspaceId)
    setMeta(db, 'created_at', facts.importedAt.toISOString())
    setMeta(db, 'master_sha256', facts.sha256)
    setMeta(db, 'app_commit', doc.app?.commit ?? '')
    setMeta(db, 'app_build', doc.app?.build ?? '')
  })
  return counts
}
