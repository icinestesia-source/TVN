import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readRestoreFile, validateTvnExport } from '../src/services/tvn-export.ts'
import { recordsFromExport } from '../src/services/user-network-restore.ts'
import { overridesFromExport } from '../src/services/central-curation.ts'
import { DEFAULT_CONFIG, withOverrides } from './config.ts'
import { assembleCorpus } from './corpus.ts'
import { MIGRATIONS, openDb, schemaVersionOf } from './db.ts'
import { Harvester, type EngineDeps } from './engine.ts'
import { writeAtomic, sha256File } from './files.ts'
import { classify, computeHealth } from './health.ts'
import { mergeFresh } from './merge.ts'
import { additionsDocument, exportCorpus, healthCsv, snapshotDb } from './outputs.ts'
import { Pacer, ReadFailure, readSource, Stopped, type ReadResult } from './provider.ts'
import { createWorkspace, masterIntact, openWorkspace, type Workspace } from './workspace.ts'

const UC = (n: number) => `UC${String(n).padStart(22, 'x')}`
const video = (id: string, extra: Record<string, unknown> = {}) => ({ id: id.padEnd(11, '_'), title: `Programme ${id}`, durationSec: 1800, ...extra })

/** A small Complete Export with every kind of thing Harvester must carry: an override, filters, a running order, a held programme, a disabled source, a list with no uploader and a podcast. */
function masterDoc(): Record<string, unknown> {
  const now = '2026-10-04T12:00:00.000Z'
  return {
    format: 'tvn-export-v1',
    version: 1,
    exportedAt: now,
    app: { commit: 'abc1234', build: 'build1' },
    userNetwork: {
      format: 'tvn-user-network-v1',
      version: 1,
      exportedAt: now,
      numbering: { first: 1001, limit: 100000 },
      users: [],
      channels: [
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
            { sourceType: 'collection', url: '', providerId: 'My list', label: 'My list', enabled: true, videos: [video('list1'), video('list2')] },
          ],
        },
        {
          id: `yt:${UC(1)}`,
          number: 1001,
          owner: 'tvn',
          name: 'First',
          state: 'populated',
          enabled: true,
          edited: true,
          runningOrder: ['a1_________', 'a2_________', 'a3_________'],
          scheduleSize: 2,
          orderKind: 'manual',
          sources: [
            {
              sourceType: 'youtube-channel',
              url: `https://www.youtube.com/channel/${UC(1)}`,
              providerId: UC(1),
              label: 'First source',
              enabled: true,
              listed: 40,
              mode: 'all',
              filter: { exclude: { terms: ['trailer'] } },
              videos: [video('a1', { published: '2020-01-02' }), video('a2'), video('a3', { pending: true })],
            },
          ],
        },
        {
          id: 'podcast:one',
          number: 1003,
          owner: 'tvn',
          name: 'Pod',
          state: 'populated',
          enabled: true,
          edited: true,
          sources: [{ sourceType: 'podcast', url: 'https://example.com/feed.xml', label: 'Pod', enabled: true, videos: [{ id: 'ep-1', title: 'Episode 1', durationSec: 3600, published: '2025-05-05' }] }],
        },
      ],
    },
    favourites: [1001],
    settings: {},
    central: {
      format: 'tvn-central-overrides-v1',
      overrides: [
        {
          number: 510,
          name: 'Chill',
          sources: [
            { sourceType: 'tvn', url: '', label: 'TVN programming', enabled: false },
            { sourceType: 'youtube-channel', url: `https://www.youtube.com/channel/${UC(9)}`, providerId: UC(9), label: 'Chill source', enabled: true, videos: [video('c1'), video('c2')] },
          ],
          excluded: ['c2_________'],
          savedAt: now,
        },
      ],
    },
    manifests: [],
  }
}

const dirs: string[] = []
const open: Workspace[] = []
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tvn-harvester-test-'))
  dirs.push(dir)
  return dir
}

function newWorkspace(doc: Record<string, unknown> = masterDoc()): { workspace: Workspace; masterPath: string } {
  const base = scratch()
  const masterPath = join(base, 'TVN_Export_test.json')
  writeFileSync(masterPath, `${JSON.stringify(doc, null, 2)}\n`)
  const { workspace } = createWorkspace(join(base, 'ws'), masterPath, new Date('2026-10-04T13:00:00Z'))
  workspace.config = withOverrides({ pacing: { betweenSourcesMs: 0 }, backoffMs: [1, 1], snapshotMinutes: 1000, outputsEvery: 1000 })
  open.push(workspace)
  return { workspace, masterPath }
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

const ok = (programmes: { id: string; title?: string; durationSec?: number; published?: string }[], extra: Partial<ReadResult> = {}): ReadResult => ({
  programmes: programmes.map((item) => ({ title: `Programme ${item.id}`, durationSec: 1200, ...item })),
  refused: 0,
  requests: 1,
  ...extra,
})

/** A reader keyed by source URL; anything else is a temporary failure. */
function fakeReader(answers: Record<string, () => Promise<ReadResult> | ReadResult>, seen: string[] = []): EngineDeps['read'] {
  return async (source) => {
    seen.push(source.url)
    const answer = answers[source.url]
    if (!answer) throw new ReadFailure('TEMPORARY FAILURE', 'no answer')
    return answer()
  }
}

const programmeRows = (workspace: Workspace, providerId: string) =>
  workspace.db.prepare('SELECT p.video_id, p.body, p.pending, p.origin, p.published FROM programmes p JOIN sources s ON s.id = p.source_id WHERE s.provider_id = ? ORDER BY p.ord').all(providerId) as {
    video_id: string
    body: string
    pending: number
    origin: string
    published: string | null
  }[]

describe('Harvester import', () => {
  it('copies the master untouched, records it, and imports every channel, source and programme', () => {
    const { workspace, masterPath } = newWorkspace()
    const before = sha256File(masterPath)
    const master = workspace.db.prepare('SELECT * FROM master').get() as Record<string, unknown>
    expect(master).toMatchObject({ filename: 'TVN_Export_test.json', format: 'tvn-export-v1', version: 1, app_commit: 'abc1234', app_build: 'build1', channels: 3, central: 1, sources: 6, programmes: 9, dated: 2, sha256: before })
    expect(statSync(master.stored_path as string).mode & 0o222).toBe(0)
    expect(masterIntact(workspace.db).ok).toBe(true)
    for (const folder of ['master', 'checkpoints', 'additions', 'exports', 'reports', 'logs']) expect(existsSync(join(workspace.dir, folder))).toBe(true)
    const meta = Object.fromEntries((workspace.db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[]).map((row) => [row.key, row.value]))
    expect(meta).toMatchObject({ schema_version: '2', master_sha256: before, app_commit: 'abc1234', app_build: 'build1' })
    expect(meta.workspace_id).toMatch(/^[0-9a-f-]{36}$/)
    const readers = workspace.db.prepare('SELECT key, reader, enabled FROM sources ORDER BY key').all()
    expect(readers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'central:510#0', reader: 'none' }),
        expect.objectContaining({ key: 'central:510#1', reader: 'youtube' }),
        expect.objectContaining({ key: `yt:${UC(2)}#1`, reader: 'none' }),
        expect.objectContaining({ key: 'podcast:one#0', reader: 'podcast' }),
      ]),
    )
    expect(() => createWorkspace(workspace.dir, masterPath)).toThrow(/already a Harvester workspace/)
  })

  it('refuses a file TVN would not restore', () => {
    const base = scratch()
    const bad = join(base, 'bad.json')
    writeFileSync(bad, JSON.stringify({ format: 'tvn-export-v1', version: 9 }))
    expect(() => createWorkspace(join(base, 'ws'), bad)).toThrow(/not valid/)
  })

  it('persists across reopening', () => {
    const { workspace } = newWorkspace()
    const dir = workspace.dir
    workspace.db.close()
    const again = openWorkspace(dir)
    open.push(again)
    expect((again.db.prepare('SELECT COUNT(*) AS n FROM programmes').get() as { n: number }).n).toBe(9)
  })
})

describe('Harvester export', () => {
  it('reproduces the master exactly when nothing has been harvested, and TVN reads it back', () => {
    const doc = masterDoc()
    const { workspace } = newWorkspace(doc)
    const out = JSON.parse(JSON.stringify(assembleCorpus(workspace.db, new Date('2026-10-05T00:00:00Z')))) as Record<string, unknown>
    for (const key of ['format', 'version', 'app', 'favourites', 'settings', 'central'] as const) expect(out[key]).toEqual(doc[key])
    expect({ ...(out.userNetwork as object), exportedAt: 0 }).toEqual({ ...(doc.userNetwork as object), exportedAt: 0 })
    expect(out.harvest).toMatchObject({ schemaVersion: 2, runId: null })
    expect(validateTvnExport(out).ok).toBe(true)
  })
})

describe('Harvester merge', () => {
  const held = [
    { id: 'k1', title: 'Known one', durationSec: 100, published: '2001-01-01' },
    { id: 'k2', title: 'Known two', durationSec: 200 },
  ]

  it('adds new programmes held back, keeps every held one, and never overwrites a known date', () => {
    const result = mergeFresh(held, [
      { id: 'n1', title: 'New', durationSec: 50, published: '2026-01-01' },
      { id: 'k1', title: 'Renamed', durationSec: 999, published: '2010-10-10' },
      { id: 'k2', title: 'Known two', durationSec: 200, published: '2002-02-02', creator: { name: 'Maker' } },
      { id: 'n1', title: 'Again', durationSec: 50 },
    ], { hold: true, limit: 100 })
    expect(result.added).toEqual([{ id: 'n1', title: 'New', durationSec: 50, published: '2026-01-01', pending: true }])
    expect(result.enriched).toEqual([{ id: 'k2', fields: { published: '2002-02-02', creator: { name: 'Maker' } } }])
    expect(result.seen).toEqual(['k1', 'k2'])
  })

  it('takes only a provider calendar day, and stops at the bound', () => {
    const result = mergeFresh(held, [
      { id: 'k2', title: 'x', durationSec: 200, published: '3 years ago' },
      { id: 'n1', title: 'a', durationSec: 10 },
      { id: 'n2', title: 'b', durationSec: 10 },
      { id: 'n3', title: 'c', durationSec: 0 },
    ], { hold: false, limit: 3 })
    expect(result.enriched).toEqual([])
    expect(result.added.map((item) => item.id)).toEqual(['n1'])
    expect(result.added[0].pending).toBeUndefined()
    expect(result.overflow).toBe(1)
  })

  it('never keeps a signed or expiring link', () => {
    const result = mergeFresh([], [{ id: 'n1', title: 'a', durationSec: 10, image: 'https://cdn.example/a.jpg?Expires=1&Signature=x', page: 'https://example.com/ep/1' }], { hold: true, limit: 10 })
    expect(result.added[0]).toMatchObject({ page: 'https://example.com/ep/1' })
    expect(result.added[0].image).toBeUndefined()
  })
})

describe('Harvester AUTO', () => {
  const first = `https://www.youtube.com/channel/${UC(1)}`
  const chill = `https://www.youtube.com/channel/${UC(9)}`
  const pod = 'https://example.com/feed.xml'

  it('walks channels by number, merges additively and keeps every editorial field', async () => {
    const { workspace } = newWorkspace()
    const seen: string[] = []
    const harvester = new Harvester(workspace, {
      read: fakeReader(
        {
          [chill]: () => ok([{ id: 'c3_________' }, { id: 'c1_________', published: '2019-09-09' }]),
          [first]: () => ok([{ id: 'a4_________', published: '2026-09-01' }, { id: 'a2_________', published: '2021-03-03' }, { id: 'a1_________', published: '1999-09-09' }], { listed: 41 }),
          [pod]: () => ok([{ id: 'ep-2', durationSec: 1000 }]),
        },
        seen,
      ),
    })
    await harvester.start()
    expect(seen).toEqual([chill, first, pod])
    const run = harvester.lastRun()
    expect(run).toMatchObject({ id: 1, mode: 'audit', status: 'completed' })
    const pool = programmeRows(workspace, UC(1))
    expect(pool.map((row) => row.video_id)).toEqual(['a4_________', 'a1_________', 'a2_________', 'a3_________'])
    expect(pool.find((row) => row.video_id === 'a1_________')?.published).toBe('2020-01-02')
    expect(pool.find((row) => row.video_id === 'a2_________')?.published).toBe('2021-03-03')
    expect(pool[0]).toMatchObject({ origin: 'harvest', pending: 1 })
    const corpus = JSON.parse(JSON.stringify(assembleCorpus(workspace.db, new Date()))) as { userNetwork: { channels: Record<string, unknown>[] }; central: { overrides: Record<string, unknown>[] } }
    const channel = corpus.userNetwork.channels.find((item) => item.number === 1001) as Record<string, unknown> & { sources: Record<string, unknown>[] }
    expect(channel).toMatchObject({ runningOrder: ['a1_________', 'a2_________', 'a3_________'], scheduleSize: 2, orderKind: 'manual', enabled: true })
    expect(channel.sources[0]).toMatchObject({ mode: 'all', filter: { exclude: { terms: ['trailer'] } }, enabled: true, listed: 41 })
    const second = corpus.userNetwork.channels.find((item) => item.number === 1002) as { sources: { enabled: boolean }[] }
    expect(second.sources[0].enabled).toBe(false)
    expect(corpus.central.overrides[0]).toMatchObject({ excluded: ['c2_________'] })
    const states = workspace.db.prepare('SELECT key, status FROM sources ORDER BY key').all() as { key: string; status: string }[]
    expect(Object.fromEntries(states.map((row) => [row.key, row.status]))).toMatchObject({ 'central:510#0': 'DISABLED', 'central:510#1': 'NEW CONTENT', [`yt:${UC(2)}#0`]: 'DISABLED', [`yt:${UC(2)}#1`]: 'UNSUPPORTED' })
  })

  it('keeps the pool when a read fails, records REFRESH FAILED, and retries only temporary failures', async () => {
    const { workspace } = newWorkspace()
    let tries = 0
    const harvester = new Harvester(workspace, {
      read: fakeReader({
        [chill]: () => {
          tries += 1
          throw new ReadFailure('TEMPORARY FAILURE', 'YouTube did not answer')
        },
        [first]: () => {
          throw new ReadFailure('NOT FOUND', 'gone')
        },
        [pod]: () => ok([]),
      }),
    })
    await harvester.start()
    expect(tries).toBe(DEFAULT_CONFIG.retries + 1)
    expect(programmeRows(workspace, UC(9)).map((row) => row.video_id)).toEqual(['c1_________', 'c2_________'])
    expect(programmeRows(workspace, UC(1))).toHaveLength(3)
    const failed = workspace.db.prepare("SELECT outcome FROM run_queue WHERE state = 'failed' ORDER BY seq").all() as { outcome: string }[]
    expect(failed.map((row) => row.outcome)).toEqual(['TEMPORARY FAILURE', 'NOT FOUND'])
    expect(harvester.log.some((line) => /REFRESH FAILED \(TEMPORARY FAILURE\).*pool of 2 is kept/.test(line.message))).toBe(true)
    // A second NOT FOUND in a row marks its programmes unavailable; nothing is deleted.
    await harvester.start()
    expect(programmeRows(workspace, UC(1))).toHaveLength(3)
    const unavailable = workspace.db.prepare("SELECT COUNT(*) AS n FROM programmes WHERE playability = 'unavailable'").get() as { n: number }
    expect(unavailable.n).toBe(3)
  })

  it('STOP takes priority over a retry wait, and RESUME carries the same run on after reopening', async () => {
    const { workspace } = newWorkspace()
    workspace.config = { ...workspace.config, backoffMs: [60_000] }
    let harvester = new Harvester(workspace, {
      read: fakeReader({
        [chill]: () => ok([{ id: 'c3_________' }]),
        [first]: () => {
          throw new ReadFailure('TEMPORARY FAILURE', 'busy')
        },
      }),
    })
    const started = Date.now()
    const done = harvester.start()
    while (!harvester.log.some((line) => /trying again/.test(line.message))) await new Promise((resolve) => setTimeout(resolve, 5))
    harvester.stop()
    await done
    expect(Date.now() - started).toBeLessThan(5000)
    expect(harvester.lastRun()).toMatchObject({ id: 1, status: 'stopped' })
    const queue = () => workspace.db.prepare('SELECT state FROM run_queue WHERE run_id = 1 AND source_id IS NOT NULL ORDER BY seq').all().map((row) => (row as { state: string }).state)
    expect(queue()).toEqual(['skipped', 'done', 'pending', 'skipped', 'skipped', 'pending'])
    expect(readdirSync(workspace.path('checkpoints')).filter((name) => name.endsWith('.db'))).toHaveLength(1)
    expect(existsSync(workspace.path('additions', 'RUN_1_additions.json'))).toBe(true)
    expect(readFileSync(workspace.path('reports', 'channel_health.csv'), 'utf8')).toMatch(/^number,name,scope,layer,class,gap/)

    const dir = workspace.dir
    workspace.db.close()
    const reopened = openWorkspace(dir)
    reopened.config = { ...reopened.config, pacing: { ...reopened.config.pacing, betweenSourcesMs: 0 } }
    open.push(reopened)
    const seen: string[] = []
    harvester = new Harvester(reopened, { read: fakeReader({ [first]: () => ok([{ id: 'a9_________' }]), [pod]: () => ok([]) }, seen) })
    expect(harvester.unfinishedRun()).toMatchObject({ id: 1 })
    expect((reopened.db.prepare("SELECT COUNT(*) AS n FROM programmes WHERE video_id = 'c3_________'").get() as { n: number }).n).toBe(1)
    await harvester.resume()
    expect(seen).toEqual([first, pod])
    expect(harvester.lastRun()).toMatchObject({ id: 1, status: 'completed' })
    expect(harvester.unfinishedRun()).toBeNull()
  })

  it('marks a run left running by a vanished process as interrupted, and a new run refreshes only what is due', async () => {
    const { workspace } = newWorkspace()
    const read = fakeReader({ [chill]: () => ok([]), [first]: () => ok([]), [pod]: () => ok([]) })
    await new Harvester(workspace, { read }).start()
    workspace.db.prepare("UPDATE sources SET failures = 1, status = 'TEMPORARY FAILURE' WHERE provider_id = ?").run(UC(1))
    workspace.db.prepare("INSERT INTO runs (mode, status, started_at) VALUES ('incremental', 'running', '2026-10-04T00:00:00Z')").run()
    workspace.db.prepare("INSERT INTO run_queue (run_id, seq, channel_id, source_id, state) VALUES (2, 0, 1, 2, 'pending')").run()
    writeFileSync(join(workspace.dir, 'harvester.lock'), '999999')
    const seen: string[] = []
    const harvester = new Harvester(workspace, { read: fakeReader({ [first]: () => ok([]) }, seen) })
    expect(harvester.unfinishedRun()).toMatchObject({ id: 2, status: 'interrupted' })
    await harvester.start()
    expect(seen).toEqual([first])
    expect(harvester.lastRun()).toMatchObject({ id: 3, mode: 'incremental', status: 'completed' })
    expect(workspace.db.prepare('SELECT status FROM runs WHERE id = 2').get()).toMatchObject({ status: 'stopped' })
  })

  it('writes additions holding only the run’s changes, each attributable to its channel and source', async () => {
    const { workspace } = newWorkspace()
    await new Harvester(workspace, {
      read: fakeReader({ [chill]: () => ok([{ id: 'c1_________' }]), [first]: () => ok([{ id: 'a5_________', published: '2026-02-02' }, { id: 'a2_________', published: '2011-01-01' }]), [pod]: () => ok([]) }),
    }).start()
    const doc = additionsDocument(workspace.db, 1, new Date()) as { format: string; run: { id: number; totals: { added: number; datesAdded: number } }; channels: { number: number; sources: { key: string; added?: { id: string }[]; dates?: { id: string; published: string }[] }[] }[] }
    expect(doc.format).toBe('tvn-harvester-additions-v1')
    expect(doc.run).toMatchObject({ id: 1, totals: { added: 1, datesAdded: 1 } })
    expect(doc.channels).toHaveLength(1)
    expect(doc.channels[0]).toMatchObject({ number: 1001, sources: [{ key: `yt:${UC(1)}#0`, added: [{ id: 'a5_________' }], dates: [{ id: 'a2_________', published: '2011-01-01' }] }] })
    expect(JSON.stringify(doc)).not.toContain('a1_________')
  })

  it('exports a corpus TVN restores, with the master unchanged byte for byte', async () => {
    const { workspace, masterPath } = newWorkspace()
    const before = readFileSync(masterPath)
    await new Harvester(workspace, { read: fakeReader({ [chill]: () => ok([]), [first]: () => ok([{ id: 'a6_________' }]), [pod]: () => ok([]) }) }).start()
    const made = exportCorpus(workspace, new Date('2026-10-04T15:30:00'))
    expect(made.path).toMatch(/exports\/TVN_Master_Corpus_Harvested_2026-10-04\.json$/)
    expect(readdirSync(workspace.path('exports')).some((name) => name.endsWith('.tmp'))).toBe(false)
    const read = readRestoreFile(readFileSync(made.path, 'utf8'))
    expect(read.kind === 'complete' && read.ok).toBe(true)
    if (read.kind !== 'complete' || !read.ok) return
    const records = recordsFromExport(read.value.userNetwork, Date.now())
    const restored = records.find((record) => record.channelNumber === 1001)
    expect(restored?.channelSources?.[0].videos?.map((item) => item.id)).toEqual(['a6_________', 'a1_________', 'a2_________', 'a3_________'])
    expect(restored?.channelSources?.[0].videos?.[0].pending).toBe(true)
    expect(overridesFromExport(read.value.central as NonNullable<typeof read.value.central>)).toHaveLength(1)
    expect(readFileSync(masterPath).equals(before)).toBe(true)
    expect(masterIntact(workspace.db).ok).toBe(true)
    expect(snapshotDb(workspace, null, 'manual')).toMatch(/checkpoints\/harvester_\d{4}-\d{2}-\d{2}_\d{4}(_\d+)?\.db$/)
  })
})

describe('Harvester health', () => {
  const t = DEFAULT_CONFIG.health

  it('classes channels by playable programmes and hours, against central thresholds', () => {
    expect(classify({ playable: 0, hours: 0 }, 0, 0, t)).toBe('EMPTY')
    expect(classify({ playable: 0, hours: 0 }, 1, 1, t)).toBe('BROKEN SOURCE')
    expect(classify({ playable: 100, hours: 50 }, 0.6, 1, t)).toBe('BROKEN SOURCE')
    expect(classify({ playable: 100, hours: 50 }, 0.2, 1, t)).toBe('HEALTHY')
    expect(classify({ playable: 200, hours: 3 }, 0, 0, t)).toBe('THIN')
    expect(classify({ playable: 30, hours: 30 }, 0, 0, t)).toBe('FAIR')
    expect(classify({ playable: 30, hours: 30 }, 0, 0, { ...t, fairProgrammes: 20 })).toBe('HEALTHY')
    expect(withOverrides({ health: { thinHours: 2, bogus: 1 }, pacing: { gapMs: 'x' } }).health.thinHours).toBe(2)
  })

  it('measures each channel from the working corpus', () => {
    const { workspace } = newWorkspace()
    const health = computeHealth(workspace.db, t)
    const first = health.find((item) => item.number === 1001)
    expect(first).toMatchObject({ sourcesConfigured: 1, sourcesEnabled: 1, available: 3, eligible: 3, held: 1, knownDates: 1, unknownDates: 2, scheduled: 2, class: 'THIN' })
    expect(health.find((item) => item.number === 510)).toMatchObject({ available: 2, eligible: 1, excluded: 1 })
    expect(health.find((item) => item.number === 1003)).toMatchObject({ playable: 1, hours: 1 })
    expect(health.map((item) => item.number)).toEqual([510, 1001, 1002, 1003])
    expect(healthCsv(health).split('\n')[0]).toContain('knownDatePct')
  })
})

describe('Harvester foundations', () => {
  it('writes atomically and leaves the target alone when a write cannot finish', () => {
    const dir = scratch()
    const target = join(dir, 'out.json')
    writeAtomic(target, 'one')
    writeAtomic(target, 'two')
    expect(readFileSync(target, 'utf8')).toBe('two')
    expect(readdirSync(dir)).toEqual(['out.json'])
    const blocked = join(dir, 'blocked')
    mkdirSync(join(blocked, 'x.json'), { recursive: true })
    expect(() => writeAtomic(join(blocked, 'x.json'), 'data')).toThrow()
    expect(readdirSync(blocked)).toEqual(['x.json'])
    chmodSync(dir, 0o755)
  })

  it('brings an older schema forward and refuses a newer one', () => {
    const path = join(scratch(), 'h.db')
    openDb(path).close()
    const next = [...MIGRATIONS, { version: 3, sql: 'ALTER TABLE desk ADD COLUMN owner TEXT;' }]
    const db = openDb(path, next)
    expect(schemaVersionOf(db)).toBe(3)
    db.close()
    expect(() => openDb(path)).toThrow(/newer Harvester/)
  })

  it('paces requests per provider and STOP cancels waiting ones', async () => {
    const controller = new AbortController()
    const starts: number[] = []
    const pacer = new Pacer({ ...DEFAULT_CONFIG.pacing, gapMs: 40, concurrency: 4 }, controller.signal, async () => {
      starts.push(Date.now())
      return new Response('ok')
    })
    await Promise.all([1, 2, 3].map(() => pacer.fetch('https://www.youtube.com/oembed')))
    expect(starts[2] - starts[0]).toBeGreaterThanOrEqual(75)
    const late = pacer.fetch('https://www.youtube.com/x')
    controller.abort()
    await expect(late).rejects.toBeInstanceOf(Stopped)
  })

  it('tells a missing YouTube source from a passing failure through TVN’s own reader', async () => {
    const controller = new AbortController()
    const source = { reader: 'youtube' as const, sourceType: 'youtube-channel', url: '', providerId: UC(3), uploaderChannelId: null }
    const answer = (status: number) => new Pacer({ ...DEFAULT_CONFIG.pacing, gapMs: 0 }, controller.signal, async () => new Response('', { status }))
    await expect(readSource(source, 'incremental', new Set(), answer(404), 0, controller.signal)).rejects.toMatchObject({ outcome: 'NOT FOUND' })
    await expect(readSource(source, 'incremental', new Set(), answer(503), 0, controller.signal)).rejects.toMatchObject({ outcome: 'TEMPORARY FAILURE' })
  })
})
