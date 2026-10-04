import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateTvnExport } from '../src/services/tvn-export.ts'
import { importBaseline, type BaselineCatalogue } from './baseline.ts'
import { assembleCorpus, centralEnrichment } from './corpus.ts'
import { withOverrides } from './config.ts'
import {
  addPending,
  currentChannel,
  deskProgress,
  deskStateOf,
  deskView,
  detectSource,
  extractUrls,
  goToNumber,
  markNeedsMore,
  next,
  pendingOf,
  previous,
  removePending,
  skip,
} from './desk.ts'
import { Harvester, type EngineDeps } from './engine.ts'
import { computeHealth } from './health.ts'
import { additionsDocument } from './outputs.ts'
import { ReadFailure, Stopped, type ReadResult } from './provider.ts'
import { createWorkspace, openWorkspace, type Workspace } from './workspace.ts'

const UC = (n: number) => `UC${String(n).padStart(22, 'x')}`
const video = (id: string, extra: Record<string, unknown> = {}) => ({ id: id.padEnd(11, '_'), title: `Programme ${id}`, durationSec: 1800, ...extra })
const NOW = new Date('2026-10-05T09:00:00Z')

function masterDoc(): Record<string, unknown> {
  const at = '2026-10-04T12:00:00.000Z'
  return {
    format: 'tvn-export-v1',
    version: 1,
    exportedAt: at,
    app: { commit: 'abc1234', build: 'build1' },
    userNetwork: {
      format: 'tvn-user-network-v1',
      version: 1,
      exportedAt: at,
      numbering: { first: 1001, limit: 100000 },
      users: [],
      channels: [
        {
          id: `yt:${UC(1)}`,
          number: 1001,
          owner: 'tvn',
          name: 'First',
          state: 'populated',
          enabled: true,
          edited: true,
          sources: [{ sourceType: 'youtube-channel', url: `https://www.youtube.com/channel/${UC(1)}`, providerId: UC(1), label: 'First source', enabled: true, videos: [video('a1', { published: '2020-01-02' }), video('a2')] }],
        },
        {
          id: `yt:${UC(2)}`,
          number: 1002,
          owner: 'tvn',
          name: 'Second',
          state: 'populated',
          enabled: true,
          edited: true,
          sources: [
            { sourceType: 'youtube-channel', url: `https://www.youtube.com/channel/${UC(2)}`, providerId: UC(2), label: 'Off', enabled: false, videos: [video('off1')] },
            { sourceType: 'collection', url: '', providerId: 'My list', label: 'My list', enabled: true, videos: [video('list1')] },
          ],
        },
      ],
    },
    favourites: [],
    settings: {},
    central: {
      format: 'tvn-central-overrides-v1',
      overrides: [
        {
          number: 510,
          name: 'Chill',
          sources: [
            { sourceType: 'tvn', url: '', label: 'TVN programming', enabled: true },
            { sourceType: 'youtube-channel', url: `https://www.youtube.com/channel/${UC(9)}`, providerId: UC(9), label: 'Chill source', enabled: true, videos: [video('c1'), video('c2')] },
          ],
          originals: [{ ref: 'src_off', enabled: false, name: 'Switched-off original', programmes: 1 }],
          savedAt: at,
        },
      ],
    },
    manifests: [],
  }
}

/** A tiny shipped network: a channel with a readable original shared with 510, one with only TVN's own programmes, and 510. */
function catalogue(): BaselineCatalogue {
  const original = (ref: string, name: string, url: string, ids: string[]) => ({ ref, name, provider: 'youtube', url, registered: true, videos: ids.map((id) => ({ id: id.padEnd(11, '_'), title: `Original ${id}`, durationSec: 600 })) })
  return {
    appCommit: 'abc1234',
    appBuild: 'build1',
    checkedHead: 'abc1234',
    sha256: 'f'.repeat(64),
    channels: [
      { number: 1, id: 'ch-001', name: 'Arts', description: 'Arts and craft programming.', enabled: true, category: 'Arts', originals: [original('src_kexp', 'KEXP', 'https://www.youtube.com/@kexp', ['k1', 'k2'])], programmes: [] },
      { number: 2, id: 'ch-002', name: 'Archive', description: 'TVN archive programmes.', enabled: true, originals: [], programmes: [video('t1'), video('t2')] },
      { number: 3, id: 'ch-003', name: 'Empty', description: 'Nothing yet.', enabled: true, originals: [], programmes: [] },
      {
        number: 510,
        id: 'ch-510',
        name: 'Chill',
        description: 'Relaxed music.',
        enabled: true,
        originals: [original('src_kexp', 'KEXP', 'https://www.youtube.com/@kexp', ['k1', 'k2']), original('src_off', 'Switched-off original', 'https://www.youtube.com/@offorig', ['o1'])],
        programmes: [],
      },
    ],
  }
}

const dirs: string[] = []
const open: Workspace[] = []

function newWorkspace(withBaseline = true): Workspace {
  const base = mkdtempSync(join(tmpdir(), 'tvn-harvester-p2-'))
  dirs.push(base)
  const masterPath = join(base, 'TVN_Export_test.json')
  writeFileSync(masterPath, `${JSON.stringify(masterDoc(), null, 2)}\n`)
  const { workspace } = createWorkspace(join(base, 'ws'), masterPath, new Date('2026-10-04T13:00:00Z'))
  workspace.config = withOverrides({ pacing: { betweenSourcesMs: 0 }, backoffMs: [1, 1], snapshotMinutes: 1000, outputsEvery: 1000 })
  if (withBaseline) importBaseline(workspace.db, catalogue(), NOW)
  computeHealth(workspace.db, workspace.config.health, NOW)
  open.push(workspace)
  return workspace
}

afterEach(() => {
  for (const workspace of open.splice(0)) {
    try {
      workspace.db.close()
    } catch {
      // already closed
    }
  }
})

const ok = (ids: string[], extra: Partial<ReadResult> = {}): ReadResult => ({ programmes: ids.map((id) => ({ id: id.padEnd(11, '_'), title: `Programme ${id}`, durationSec: 1200 })), refused: 0, requests: 1, ...extra })

const deps = (extra: Partial<EngineDeps> = {}): EngineDeps => ({ baseline: false, now: () => NOW, ...extra })

const channelId = (workspace: Workspace, number: number) => (workspace.db.prepare('SELECT id FROM channels WHERE number = ?').get(number) as { id: number }).id

describe('Phase 2 central baseline', () => {
  it('layers the shipped network under the master without changing what the export carries', () => {
    const workspace = newWorkspace(false)
    const before = JSON.stringify({ ...assembleCorpus(workspace.db, NOW), harvest: null })
    const counts = importBaseline(workspace.db, catalogue(), NOW)
    expect(counts).toMatchObject({ channels: 4, added: 3, sources: 4, programmes: 7 })
    const rows = workspace.db.prepare("SELECT number, layer, stable_id FROM channels WHERE scope = 'central' ORDER BY number").all() as { number: number; layer: string; stable_id: string }[]
    expect(rows).toEqual([
      { number: 1, layer: 'shipped', stable_id: 'ch-001' },
      { number: 2, layer: 'shipped', stable_id: 'ch-002' },
      { number: 3, layer: 'shipped', stable_id: 'ch-003' },
      { number: 510, layer: 'master', stable_id: 'ch-510' },
    ])
    // The override's own decision is kept: the original it switched off stays off.
    const originals = workspace.db.prepare("SELECT provider_id, enabled, provenance FROM sources WHERE channel_id = ? AND provenance = 'shipped' ORDER BY position").all(channelId(workspace, 510))
    expect(originals).toEqual([
      { provider_id: 'src_kexp', enabled: 1, provenance: 'shipped' },
      { provider_id: 'src_off', enabled: 0, provenance: 'shipped' },
    ])
    expect(JSON.stringify({ ...assembleCorpus(workspace.db, NOW), harvest: null })).toBe(before)
    expect(() => importBaseline(workspace.db, catalogue(), NOW)).toThrow(/already/)
  })

  it('classifies central gaps and counts the effective channel with TVN exclusions', () => {
    const workspace = newWorkspace()
    const health = computeHealth(workspace.db, workspace.config.health, NOW)
    const of = (number: number) => health.find((item) => item.number === number && item.scope === 'central')
    expect(of(1)).toMatchObject({ layer: 'shipped', stableId: 'ch-001', sourcesRefreshable: 1, shipped: 2, available: 2, gap: 'NEEDS SOURCE DESK' })
    expect(of(2)).toMatchObject({ gap: 'SHIPPED POOL ONLY', shipped: 2 })
    expect(of(3)).toMatchObject({ gap: 'NO REFRESHABLE SOURCE', available: 0, class: 'EMPTY' })
    expect(of(510)).toMatchObject({ layer: 'master', sourcesEnabled: 3, shipped: 2, fromMaster: 2 })
  })
})

describe('Phase 2 Source Desk navigation', () => {
  it('starts at 001, walks with NEXT/PREVIOUS/GO TO/SKIP/NEEDS MORE, and keeps its place across reopening', () => {
    const workspace = newWorkspace()
    const db = workspace.db
    expect(currentChannel(db).number).toBe(1)
    expect(next(db, NOW).number).toBe(2)
    expect(deskStateOf(db, channelId(workspace, 1))).toBe('REVIEWED')
    expect(previous(db).number).toBe(1)
    expect(previous(db).number).toBe(1)
    goToNumber(db, 510)
    expect(currentChannel(db).number).toBe(510)
    expect(skip(db, NOW).number).toBe(1001)
    expect(deskStateOf(db, channelId(workspace, 510))).toBe('SKIPPED')
    expect(deskView(db, channelId(workspace, 510)).sources.length).toBe(4)
    markNeedsMore(db, NOW, 'more music')
    expect(deskStateOf(db, channelId(workspace, 1001))).toBe('NEEDS MORE')
    expect(() => goToNumber(db, 777)).toThrow(/no channel 777/)
    expect(deskProgress(db)).toMatchObject({ reviewed: 3, skipped: 1, needsMore: 1, channel: { number: 1001, centralTotal: 4 } })
    const dir = workspace.dir
    db.close()
    const again = openWorkspace(dir)
    open.push(again)
    expect(currentChannel(again.db).number).toBe(1001)
    expect(deskStateOf(again.db, channelId(again, 510))).toBe('SKIPPED')
    expect(deskView(again.db, channelId(again, 1)).channel).toMatchObject({ description: 'Arts and craft programming.', layer: 'shipped', stableId: 'ch-001' })
  })
})

describe('Phase 2 Source Desk input', () => {
  it('detects every supported kind with TVN detection and never throws', () => {
    const cases: [string, string, string | null][] = [
      ['https://www.youtube.com/@Example', 'YouTube channel', 'youtube-channel'],
      ['https://www.youtube.com/playlist?list=PL1234567890abcdef', 'YouTube playlist', 'youtube-playlist'],
      ['https://youtu.be/abcdefghijk', 'YouTube video (its channel)', 'youtube-channel'],
      ['https://www.youtube.com/watch?v=abcdefghijk&list=RDabcdefghijk', 'YouTube Mix (as TVN reads it)', 'youtube-playlist'],
      ['https://example.com/feed.xml', 'RSS / podcast', 'podcast'],
      ['https://example.com/', 'Website (its feed or archive)', 'podcast'],
      ['https://x.com/someone/status/1234567890123', 'X post', 'website'],
      ['https://vimeo.com/user/abc', 'Vimeo', 'podcast'],
      ['https://odysee.com/@chan', 'Odysee', 'podcast'],
      ['https://www.bitchute.com/channel/abc/', 'BitChute', 'podcast'],
      ['https://example.com/live/stream.m3u8', 'HLS live video', 'video-hls'],
      ['https://example.com/films/one.mp4', 'Direct media / live video', 'video'],
      ['not a url at all', 'UNKNOWN', null],
      ['ftp://example.com/file', 'UNKNOWN', null],
    ]
    for (const [url, label, sourceType] of cases) {
      const found = detectSource(url)
      expect([url, found.typeLabel, found.sourceType]).toEqual([url, label, sourceType])
      expect(found.ready).toBe(sourceType !== null)
    }
    expect(extractUrls('https://a.example.com/feed.xml\nhttps://www.youtube.com/@one https://www.youtube.com/@two,\n\n<https://b.example.org/x>')).toEqual([
      'https://a.example.com/feed.xml',
      'https://www.youtube.com/@one',
      'https://www.youtube.com/@two',
      'https://b.example.org/x',
    ])
  })

  it('takes a multi-URL paste, refuses duplicates on the channel, keeps disabled ones off, and notes sharing', () => {
    const workspace = newWorkspace()
    const db = workspace.db
    const first = channelId(workspace, 1001)
    const rows = addPending(db, first, `https://www.youtube.com/channel/${UC(1)}\nhttps://www.youtube.com/@newsource https://www.youtube.com/@NewSource\nhttps://www.youtube.com/channel/${UC(2)}`, NOW)
    expect(rows.map((row) => [row.status, row.note && row.note.replace(/·.*$/, '·')])).toEqual([
      ['ALREADY ADDED', null],
      ['READY', null],
      ['READY', 'ALSO USED BY 1002 ·'],
    ])
    expect(addPending(db, first, 'garbage', NOW)[0]).toMatchObject({ status: 'UNKNOWN — REVIEW', typeLabel: 'UNKNOWN' })
    const second = channelId(workspace, 1002)
    expect(addPending(db, second, `https://youtube.com/channel/${UC(2)}?utm_source=x`, NOW)[0].status).toBe('EXISTING SOURCE — DISABLED')
    // The same shipped original serves 001 and 510.
    expect(addPending(db, channelId(workspace, 3), 'https://www.youtube.com/@KEXP', NOW)[0].note).toMatch(/ALSO USED BY 001 · Arts, 510 · Chill/)
    const ready = pendingOf(db, first).find((row) => row.status === 'READY') as { id: number }
    removePending(db, first, ready.id)
    expect(pendingOf(db, first).map((row) => row.status)).toEqual(['ALREADY ADDED', 'READY', 'UNKNOWN — REVIEW'])
    // Pasting an address already waiting adds nothing.
    expect(addPending(db, first, 'https://www.youtube.com/channel/' + UC(2), NOW)).toEqual([])
  })
})

describe('Phase 2 SCAN SOURCES', () => {
  it('adds a pasted source, enumerates it deep batch by batch, holds new programmes, and records provenance', async () => {
    const workspace = newWorkspace()
    const db = workspace.db
    const arts = channelId(workspace, 1)
    addPending(db, arts, 'https://www.youtube.com/@crafts', NOW)
    const depths: string[] = []
    const harvester = new Harvester(workspace, deps({
      read: async (source, depth) => {
        depths.push(depth)
        if (source.url !== 'https://www.youtube.com/@crafts') throw new ReadFailure('NOT FOUND', 'no')
        return ok(['n1', 'n2', 'NASA rocket launch'], { next: 'cursor-1', listed: 7, identity: { sourceType: 'youtube-channel', url: `https://www.youtube.com/channel/${UC(30)}`, providerId: UC(30), label: 'Crafts' } })
      },
      readBatch: async (cursor) => (cursor === 'cursor-1' ? ok(['n4', 'n5'], { next: 'cursor-2', listed: 7 }) : ok(['n6', 'n7'], { listed: 7 })),
    }))
    await harvester.scanDesk(arts)
    expect(depths).toEqual(['deep'])
    const source = db.prepare("SELECT id, provenance, provider_id, label, complete, continuation, status FROM sources WHERE channel_id = ? AND provenance = 'desk'").get(arts) as Record<string, unknown>
    expect(source).toMatchObject({ provenance: 'desk', provider_id: UC(30), label: 'Crafts', complete: 1, continuation: null, status: 'NEW CONTENT' })
    const rows = db.prepare('SELECT video_id, pending, provenance FROM programmes WHERE source_id = ? ORDER BY ord').all(source.id as number) as { video_id: string; pending: number; provenance: string }[]
    expect(rows.map((row) => row.video_id.replace(/_+$/, ''))).toEqual(['n1', 'n2', 'NASA rocket launch', 'n4', 'n5', 'n6', 'n7'])
    expect(rows.every((row) => row.pending === 1 && row.provenance === 'desk')).toBe(true)
    const [pending] = pendingOf(db, arts)
    // The NASA programme is in the pool; TVN's default exclusions keep it out of 001–999 eligibility.
    expect(pending).toMatchObject({ status: 'ADDED', result: { label: 'Crafts', programmes: 7, eligible: 6, listed: 7, complete: true } })
    expect(deskStateOf(db, arts)).toBe('ENRICHED')
    expect(deskProgress(db)).toMatchObject({ enriched: 1, newSources: 1, newProgrammes: 7 })
    expect(harvester.compare).toMatchObject({ kind: 'desk', before: { sourcesEnabled: 1, available: 2 }, after: { sourcesEnabled: 2, available: 9 } })
    const run = harvester.lastRun('desk')
    expect(run).toMatchObject({ kind: 'desk', status: 'completed', range_from: 1, range_to: 1 })
    const additions = additionsDocument(db, run?.id as number, NOW) as { channels: { number: number; stableId: string; sources: { provenance: string; sourceAdded?: { provenance: string; providerId: string }[]; added?: { provenance: string }[] }[] }[] }
    const added = additions.channels[0]
    expect(added).toMatchObject({ number: 1, stableId: 'ch-001' })
    expect(added.sources[0]).toMatchObject({ provenance: 'desk', sourceAdded: [{ provenance: 'desk', providerId: UC(30) }] })
    expect(added.sources[0].added?.length).toBe(7)
    expect(added.sources[0].added?.every((item) => item.provenance === 'desk')).toBe(true)
    // Central enrichment is a candidate beside the export, never inside the overrides.
    const corpus = assembleCorpus(db, NOW)
    expect(JSON.stringify(corpus.central)).not.toContain(UC(30))
    expect(corpus.centralEnrichment?.channels.map((channel) => [channel.number, channel.stableId, channel.sources.map((item) => item.provenance)])).toEqual([[1, 'ch-001', ['desk']]])
    expect(validateTvnExport(JSON.parse(JSON.stringify(corpus))).ok).toBe(true)
  })

  it('applies TVN default exclusions to 001–999 eligibility, and a duplicate the provider names is reported, not added', async () => {
    const workspace = newWorkspace()
    const db = workspace.db
    const arts = channelId(workspace, 1)
    addPending(db, arts, 'https://www.youtube.com/@space\nhttps://www.youtube.com/@kexpmusic', NOW)
    const harvester = new Harvester(workspace, deps({
      read: async (source) =>
        source.url.endsWith('@space')
          ? { programmes: [{ id: 's1'.padEnd(11, '_'), title: 'NASA astronauts live', durationSec: 1200 }, { id: 's2'.padEnd(11, '_'), title: 'Pottery', durationSec: 1200 }], refused: 2, requests: 1, identity: { sourceType: 'youtube-channel', url: `https://www.youtube.com/channel/${UC(31)}`, providerId: UC(31), label: 'Mixed' } }
          : ok(['k9'], { identity: { sourceType: 'youtube-channel', url: 'https://www.youtube.com/@kexp', label: 'KEXP' } }),
    }))
    await harvester.scanDesk(arts)
    const [space, kexp] = pendingOf(db, arts)
    expect(space).toMatchObject({ status: 'ADDED', result: { programmes: 2, eligible: 1, refused: 2 } })
    expect(kexp.status).toBe('ALREADY ADDED')
    expect((db.prepare("SELECT COUNT(*) AS n FROM sources WHERE channel_id = ? AND provenance = 'desk'").get(arts) as { n: number }).n).toBe(1)
    expect(computeHealth(db, workspace.config.health, NOW, [arts])[0]).toMatchObject({ editorialExcluded: 1 })
  })

  it('STOP mid-enumeration leaves the source PARTIAL with what was loaded, and the next SCAN carries it on', async () => {
    const workspace = newWorkspace()
    const db = workspace.db
    const arts = channelId(workspace, 1)
    addPending(db, arts, 'https://www.youtube.com/@big', NOW)
    let harvester: Harvester
    let calls = 0
    harvester = new Harvester(workspace, deps({
      read: async () => ok(['b1', 'b2'], { next: 'page-2', listed: 6, identity: { sourceType: 'youtube-channel', url: `https://www.youtube.com/channel/${UC(40)}`, providerId: UC(40), label: 'Big' } }),
      readBatch: (cursor, signal) => {
        calls += 1
        if (cursor === 'page-2') return Promise.resolve(ok(['b3', 'b4'], { next: 'page-3', listed: 6 }))
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new Stopped()), { once: true })
          setTimeout(() => harvester.stop(), 5)
        })
      },
    }))
    await harvester.scanDesk(arts)
    const partial = db.prepare("SELECT id, status, continuation, complete, body FROM sources WHERE provenance = 'desk'").get() as { id: number; status: string; continuation: string; complete: number; body: string }
    expect(partial).toMatchObject({ status: 'PARTIAL', continuation: 'page-3', complete: 0 })
    expect(JSON.parse(partial.body)).toMatchObject({ listed: 6, deep: true, complete: false })
    expect((db.prepare('SELECT COUNT(*) AS n FROM programmes WHERE source_id = ?').get(partial.id) as { n: number }).n).toBe(4)
    expect(pendingOf(db, arts)[0]).toMatchObject({ status: 'PARTIAL', result: { programmes: 4, complete: false } })
    expect(harvester.lastRun('desk')?.status).toBe('stopped')
    expect(deskView(db, arts).sources.find((item) => item.id === partial.id)).toMatchObject({ partial: true })

    const cursors: string[] = []
    const again = new Harvester(workspace, deps({
      read: async () => {
        throw new Error('a carried-on source starts from its cursor, not a fresh read')
      },
      readBatch: async (cursor) => {
        cursors.push(cursor)
        return ok(['b5', 'b6'], { listed: 6 })
      },
    }))
    await again.scanDesk(arts)
    expect(cursors).toEqual(['page-3'])
    const done = db.prepare('SELECT status, continuation, complete FROM sources WHERE id = ?').get(partial.id)
    expect(done).toEqual({ status: 'NEW CONTENT', continuation: null, complete: 1 })
    expect((db.prepare('SELECT COUNT(*) AS n FROM programmes WHERE source_id = ?').get(partial.id) as { n: number }).n).toBe(6)
    expect(pendingOf(db, arts)[0]).toMatchObject({ status: 'ADDED', result: { programmes: 6, complete: true } })
    expect(calls).toBe(2)
  })

  it('enumerates a large source past the old 60 with bounded paging', async () => {
    const workspace = newWorkspace()
    const db = workspace.db
    const user = channelId(workspace, 1002)
    addPending(db, user, 'https://www.youtube.com/playlist?list=PL1234567890abcdef', NOW)
    const page = (n: number) => Array.from({ length: 100 }, (_, i) => `p${n}-${i}`)
    const harvester = new Harvester(workspace, deps({
      read: async () => ok(page(0), { next: 'c1', listed: 5200, identity: { sourceType: 'youtube-playlist', url: 'https://www.youtube.com/playlist?list=PL1234567890abcdef', providerId: 'PL1234567890abcdef', label: 'Long list' } }),
      readBatch: async (cursor) => {
        const n = Number(cursor.slice(1))
        return ok(page(n), n < 51 ? { next: `c${n + 1}`, listed: 5200 } : { listed: 5200 })
      },
    }))
    await harvester.scanDesk(user)
    const source = db.prepare("SELECT id, complete FROM sources WHERE provenance = 'desk'").get() as { id: number; complete: number }
    expect((db.prepare('SELECT COUNT(*) AS n FROM programmes WHERE source_id = ?').get(source.id) as { n: number }).n).toBe(5200)
    expect(source.complete).toBe(1)
    // A user channel's desk source is a real source in the export.
    const corpus = assembleCorpus(db, NOW)
    const exported = corpus.userNetwork.channels.find((channel) => channel.number === 1002)
    expect(exported?.sources.at(-1)).toMatchObject({ providerId: 'PL1234567890abcdef', deep: true, complete: true })
    expect(exported?.sources.at(-1)?.videos?.length).toBe(5200)
    expect(centralEnrichment(db).channels).toEqual([])
  })
})

describe('Phase 2 AUTO', () => {
  it('runs a channel range, shares a shipped original read across channels, and RESUME carries the range on', async () => {
    const workspace = newWorkspace()
    const db = workspace.db
    const seen: string[] = []
    let block = true
    let harvester: Harvester
    const read: EngineDeps['read'] = (source, _depth, _known, signal) => {
      seen.push(source.url)
      if (source.url.includes(UC(9)) && block) {
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new Stopped()), { once: true })
          setTimeout(() => harvester.stop(), 5)
        })
      }
      if (source.url === 'https://www.youtube.com/@kexp') return Promise.resolve(ok(['k1', 'k3']))
      return Promise.resolve(ok([]))
    }
    block = false
    harvester = new Harvester(workspace, deps({ read }))
    await harvester.start({ from: 1, to: 510 })
    // KEXP is read once for 001 and merged into 510 from the same read.
    expect(seen.filter((url) => url === 'https://www.youtube.com/@kexp')).toHaveLength(1)
    const k3 = db.prepare('SELECT c.number, p.provenance, p.pending FROM programmes p JOIN sources s ON s.id = p.source_id JOIN channels c ON c.id = s.channel_id WHERE p.video_id = ? ORDER BY c.number').all('k3'.padEnd(11, '_'))
    expect(k3).toEqual([{ number: 1, provenance: 'auto', pending: 1 }, { number: 510, provenance: 'auto', pending: 1 }])
    // Shipped originals that gained programmes are central enrichment candidates; the override itself is unchanged.
    expect(centralEnrichment(db).channels.map((channel) => [channel.number, channel.sources.map((item) => item.videos?.map((v) => v.id.replace(/_+$/, '')))])).toEqual([[1, [['k3']]], [510, [['k3']]]])
    expect(JSON.stringify(assembleCorpus(db, NOW).central)).not.toContain('k3')

    workspace.config = { ...workspace.config, staleHours: 0 }
    block = true
    seen.length = 0
    await harvester.start({ from: 1, to: 510 })
    const run = harvester.lastRun()
    expect(run).toMatchObject({ kind: 'auto', status: 'stopped', range_from: 1, range_to: 510 })
    const queued = db.prepare('SELECT DISTINCT c.number FROM run_queue q JOIN channels c ON c.id = q.channel_id WHERE q.run_id = ? ORDER BY c.number').all(run?.id as number) as { number: number }[]
    expect(queued.map((row) => row.number)).toEqual([1, 2, 3, 510])
    expect(seen).toEqual(['https://www.youtube.com/@kexp', `https://www.youtube.com/channel/${UC(9)}`])
    expect(harvester.unfinishedRun()?.id).toBe(run?.id)

    block = false
    seen.length = 0
    const resumed = new Harvester(workspace, deps({ read }))
    await resumed.resume()
    expect(resumed.lastRun()).toMatchObject({ id: run?.id, status: 'completed', range_from: 1, range_to: 510 })
    // From where it stopped (510's own source, then its KEXP), never back to 001.
    expect(seen).toEqual([`https://www.youtube.com/channel/${UC(9)}`, 'https://www.youtube.com/@kexp'])

    seen.length = 0
    await resumed.start({ from: 1 })
    const fresh = resumed.lastRun()
    expect(fresh).toMatchObject({ kind: 'auto', range_from: 1, range_to: null })
    expect(fresh?.id).toBeGreaterThan(run?.id as number)
  })

  it('AUTO REFRESH CHANNEL reads one channel now, due or not, without touching RESUME', async () => {
    const workspace = newWorkspace()
    const seen: string[] = []
    const read: EngineDeps['read'] = async (source) => {
      seen.push(source.url)
      return ok(['f9'])
    }
    const harvester = new Harvester(workspace, deps({ read }))
    await harvester.refreshChannel(channelId(workspace, 1001))
    await harvester.refreshChannel(channelId(workspace, 1001))
    expect(seen).toEqual([`https://www.youtube.com/channel/${UC(1)}`, `https://www.youtube.com/channel/${UC(1)}`])
    expect(harvester.lastRun('channel')).toMatchObject({ kind: 'channel', status: 'completed', range_from: 1001 })
    expect(harvester.unfinishedRun()).toBeNull()
    expect(harvester.compare).toMatchObject({ kind: 'channel', before: { available: 3 }, after: { available: 3 } })
    expect(() => harvester.resume()).toThrow(/no stopped run/)
  })

  it('a shipped original whose publisher page is gone keeps its programmes available', async () => {
    const workspace = newWorkspace()
    const read: EngineDeps['read'] = async () => {
      throw new ReadFailure('NOT FOUND', 'YouTube has no channel at that link')
    }
    const harvester = new Harvester(workspace, deps({ read }))
    for (let n = 0; n < 3; n += 1) await harvester.refreshChannel(channelId(workspace, 1))
    const rows = workspace.db.prepare("SELECT p.playability FROM programmes p JOIN sources s ON s.id = p.source_id WHERE s.channel_id = ? AND s.provenance = 'shipped'").all(channelId(workspace, 1)) as { playability: string }[]
    expect(rows.map((row) => row.playability)).toEqual(['unknown', 'unknown'])
    expect(workspace.db.prepare('SELECT status, not_found_runs FROM sources WHERE channel_id = ?').get(channelId(workspace, 1))).toEqual({ status: 'NOT FOUND', not_found_runs: 3 })
  })
})
