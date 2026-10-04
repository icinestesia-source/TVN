import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { readRegister, type SourceRegister } from '../src/credits/provenance.ts'
import { channels as shippedChannels, shippedProgrammes } from '../src/data/catalogue.ts'
import { defaultNetworkItems } from '../src/data/network/catalog.ts'
import { setMediaLibrary } from '../src/director/library.ts'
import { expandPlayableCatalogue } from '../src/library/playable-catalogue.ts'
import { programmeForDirector } from '../src/library/source-editorial.ts'
import type { OriginalOverride, OriginalSource } from '../src/services/original-sources.ts'
import type { ExportSource, ExportVideo } from '../src/services/user-network-export.ts'
import { channelOriginals } from '../src/view/channel-provenance.ts'
import { transaction, type Db } from './db.ts'
import { sha256 } from './files.ts'
import { centralChannelKey, type Reader } from './importer.ts'

const REPO = fileURLToPath(new URL('..', import.meta.url))

/** Everything the shipped 001–999 network is read from. A baseline is only taken when these match the master's build. */
export const CATALOGUE_PATHS = [
  'src/data',
  'public/independent',
  'src/library',
  'src/credits',
  'src/director/library.ts',
  'src/services/original-sources.ts',
  'src/view/channel-provenance.ts',
]

let register: SourceRegister | null = null

/** TVN's shipped library and source register, loaded as the viewer loads them at start. */
export function shippedRegister(): SourceRegister {
  if (!register) {
    const shipped = (name: string) => JSON.parse(readFileSync(new URL(`../public/independent/${name}`, import.meta.url), 'utf8')) as unknown
    setMediaLibrary([...defaultNetworkItems(), ...expandPlayableCatalogue(shipped('playable.json')).map(programmeForDirector)])
    register = readRegister(shipped('sources.json'))
  }
  return register
}

export const originalsOf = (number: number): OriginalSource[] => channelOriginals(number, shippedRegister())

export interface BaselineChannel {
  number: number
  /** The catalogue's own id: the channel's identity whatever its number becomes. */
  id: string
  name: string
  description: string
  enabled: boolean
  category?: string
  originals: OriginalSource[]
  /** Real programmes the catalogue carries directly (YouTube ids); demonstration placeholders are left out. */
  programmes: ExportVideo[]
}

export interface BaselineCatalogue {
  appCommit: string
  appBuild: string | null
  checkedHead: string | null
  sha256: string
  channels: BaselineChannel[]
}

function git(args: string[]): string {
  return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

/**
 * The shipped network exactly as the build that wrote the master shipped it. The checkout's catalogue files
 * must be identical to that commit's (committed and in the working tree); otherwise nothing is read.
 */
export function shippedCatalogue(appCommit: string, appBuild: string | null): BaselineCatalogue {
  let head: string
  try {
    git(['cat-file', '-e', `${appCommit}^{commit}`])
    head = git(['rev-parse', '--short', 'HEAD'])
  } catch {
    throw new Error(`The master was written by TVN ${appCommit}, which this checkout does not have: the shipped baseline cannot be confirmed`)
  }
  try {
    execFileSync('git', ['-C', REPO, 'diff', '--quiet', appCommit, '--', ...CATALOGUE_PATHS], { stdio: 'ignore' })
  } catch {
    throw new Error(`The shipped catalogue in this checkout differs from TVN ${appCommit}, the build that wrote the master: check out ${appCommit}'s catalogue to read the baseline`)
  }
  const fingerprint = sha256(['public/independent/playable.json', 'public/independent/sources.json'].map((path) => readFileSync(`${REPO}${path}`, 'utf8')).join('\n') + JSON.stringify(shippedChannels.map((channel) => [channel.id, channel.number, channel.name])))
  return {
    appCommit,
    appBuild,
    checkedHead: head,
    sha256: fingerprint,
    channels: shippedChannels.map((channel) => ({
      number: channel.number,
      id: channel.id,
      name: channel.name,
      description: channel.description ?? '',
      enabled: channel.enabled !== false,
      ...(channel.category ? { category: channel.category } : {}),
      originals: originalsOf(channel.number),
      programmes: shippedProgrammes(channel.id).flatMap((programme) =>
        programme.videoId ? [{ id: programme.videoId, title: programme.title, durationSec: programme.durationSeconds, ...(programme.publishedAt ? { published: programme.publishedAt.slice(0, 10) } : {}) }] : [],
      ),
    })),
  }
}

/** A shipped original can be read again when its publisher page is a YouTube channel or playlist. */
export function originalReader(url: string | undefined): Reader {
  return url && /^https:\/\/(?:www\.)?youtube\.com\/(?:@[\w.-]+|channel\/UC[\w-]{22}|c\/[\w.-]+|user\/[\w.-]+|playlist\?list=(?:PL|OL|UU|FL)[\w-]+)\/?$/i.test(url) ? 'youtube' : 'none'
}

export interface BaselineCounts {
  appCommit: string
  channels: number
  added: number
  sources: number
  programmes: number
}

/**
 * Read the shipped 001–999 network into the working database as its baseline layer. A channel the master
 * already overrides keeps its row and gains its shipped original sources (enabled as the override decided);
 * every other shipped channel is added as `shipped`. Nothing is written to TVN's own files. Taken once.
 */
export function importBaseline(db: Db, catalogue: BaselineCatalogue, now: Date = new Date()): BaselineCounts {
  const existing = db.prepare('SELECT 1 FROM baseline WHERE id = 1').get()
  if (existing) throw new Error('This workspace already has its shipped baseline')
  const counts: BaselineCounts = { appCommit: catalogue.appCommit, channels: 0, added: 0, sources: 0, programmes: 0 }
  transaction(db, () => {
    const findChannel = db.prepare("SELECT id, body FROM channels WHERE scope = 'central' AND number = ?")
    const addChannel = db.prepare("INSERT INTO channels (key, scope, number, name, enabled, position, body, layer, stable_id) VALUES (?, 'central', ?, ?, ?, ?, ?, 'shipped', ?)")
    const setIdentity = db.prepare('UPDATE channels SET stable_id = ? WHERE id = ?')
    const nextPosition = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS position FROM sources WHERE channel_id = ?')
    const addSource = db.prepare(
      "INSERT INTO sources (channel_id, position, key, source_type, url, provider_id, label, enabled, reader, body, has_videos, provenance, audited_run, added_at) VALUES (?, ?, ?, 'collection', ?, ?, ?, ?, ?, ?, 1, 'shipped', 0, ?)",
    )
    const addProgramme = db.prepare("INSERT OR IGNORE INTO programmes (source_id, video_id, ord, body, published, duration_sec, origin, provenance) VALUES (?, ?, ?, ?, ?, ?, 'master', 'shipped')")
    let order = (db.prepare("SELECT COALESCE(MAX(position) + 1, 0) AS position FROM channels WHERE scope = 'central'").get() as { position: number }).position
    for (const channel of catalogue.channels) {
      counts.channels += 1
      const key = centralChannelKey(channel.number)
      const found = findChannel.get(channel.number) as { id: number; body: string } | undefined
      let channelId: number
      let tvnOn = true
      let decisions: OriginalOverride[] = []
      if (found) {
        channelId = found.id
        setIdentity.run(channel.id, channelId)
        const override = JSON.parse(found.body) as { originals?: OriginalOverride[] }
        decisions = override.originals ?? []
        const tvn = db.prepare("SELECT enabled FROM sources WHERE channel_id = ? AND source_type = 'tvn'").get(channelId) as { enabled: number } | undefined
        tvnOn = tvn ? tvn.enabled === 1 : true
      } else {
        const body = { number: channel.number, name: channel.name, description: channel.description, ...(channel.category ? { category: channel.category } : {}) }
        channelId = Number(addChannel.run(key, channel.number, channel.name, channel.enabled ? 1 : 0, order++, JSON.stringify(body), channel.id).lastInsertRowid)
        counts.added += 1
      }
      const groups: { ref: string; name: string; url: string; videos: ExportVideo[] }[] = [
        ...channel.originals.map((source) => ({ ref: source.ref, name: source.name, url: source.url ?? '', videos: source.videos as ExportVideo[] })),
        ...(channel.programmes.length > 0 ? [{ ref: 'tvn-catalogue', name: 'TVN catalogue', url: '', videos: channel.programmes }] : []),
      ]
      for (const group of groups) {
        const decision = decisions.find((item) => item.ref === group.ref)
        const enabled = tvnOn && (decision?.enabled ?? true)
        const reader = originalReader(group.url)
        const body: ExportSource = { sourceType: 'collection', url: group.url, providerId: group.ref, label: group.name, enabled, ...(decision?.filter ? { filter: decision.filter } : {}) }
        const position = (nextPosition.get(channelId) as { position: number }).position
        const sourceId = Number(addSource.run(channelId, position, `${key}#o:${group.ref}`, group.url, group.ref, group.name, enabled ? 1 : 0, reader, JSON.stringify(body), now.toISOString()).lastInsertRowid)
        counts.sources += 1
        group.videos.forEach((video, index) => {
          if (addProgramme.run(sourceId, video.id, index, JSON.stringify(video), video.published ?? null, video.durationSec).changes > 0) counts.programmes += 1
        })
      }
    }
    db.prepare('INSERT INTO baseline (id, app_commit, app_build, checked_head, catalogue_sha256, imported_at, channels, sources, programmes) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      catalogue.appCommit,
      catalogue.appBuild,
      catalogue.checkedHead,
      catalogue.sha256,
      now.toISOString(),
      counts.channels,
      counts.sources,
      counts.programmes,
    )
  })
  return counts
}

export function hasBaseline(db: Db): boolean {
  return Boolean(db.prepare('SELECT 1 FROM baseline WHERE id = 1').get())
}

/** Take the shipped baseline if this workspace has none yet, against the build named in the master. */
export function ensureBaseline(db: Db): BaselineCounts | null {
  if (hasBaseline(db)) return null
  const master = db.prepare('SELECT app_commit, app_build FROM master WHERE id = 1').get() as { app_commit: string | null; app_build: string | null }
  if (!master.app_commit) throw new Error('The master names no TVN build, so the shipped baseline cannot be matched to it')
  return importBaseline(db, shippedCatalogue(master.app_commit, master.app_build))
}
