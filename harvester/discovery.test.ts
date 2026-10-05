import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { importBaseline, type BaselineCatalogue } from './baseline.ts'
import { withOverrides } from './config.ts'
import { currentChannel, deskView, enrichmentOf, ensureBefore, goToNumber, pendingOf, sessionReport } from './desk.ts'
import {
  approveCandidates,
  autoApprovable,
  discover,
  discoveryContext,
  discoveryQueries,
  discoveryView,
  parseYouTubeResults,
  rejectCandidates,
  suitableIds,
  type DiscoveryDeps,
  type Found,
} from './discovery.ts'
import { Harvester, type EngineDeps } from './engine.ts'
import { computeHealth, deskStanding, diversityOf, type ChannelHealth } from './health.ts'
import { JobQueue } from './jobs.ts'
import { ReadFailure, Stopped, type ReadResult } from './provider.ts'
import { Operator } from './server.ts'
import { createWorkspace, lockWorkspace, LOCK_FILE, openWorkspace, unlockWorkspace, workspaceOwner, WorkspaceInUse, type Workspace } from './workspace.ts'

const UC = (n: number) => `UC${String(n).padStart(22, 'x')}`
const NOW = new Date('2026-10-05T09:00:00Z')
const video = (id: string, extra: Record<string, unknown> = {}) => ({ id: id.padEnd(11, '_'), title: `Programme ${id}`, durationSec: 1800, ...extra })

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
          name: 'Pottery Corner',
          state: 'populated',
          enabled: true,
          edited: true,
          sources: [{ sourceType: 'youtube-channel', url: `https://www.youtube.com/channel/${UC(1)}`, providerId: UC(1), label: 'Wheel Thrown', enabled: true, videos: [video('a1', { published: '2020-01-02' })] }],
        },
      ],
    },
    favourites: [],
    settings: {},
    central: { format: 'tvn-central-overrides-v1', overrides: [] },
    manifests: [],
  }
}

function catalogue(): BaselineCatalogue {
  const original = (ref: string, name: string, url: string, titles: string[]) => ({ ref, name, provider: 'youtube', url, registered: true, videos: titles.map((title, i) => ({ id: `${ref}${i}`.padEnd(11, '_'), title, durationSec: 600 })) })
  return {
    appCommit: 'abc1234',
    appBuild: 'build1',
    checkedHead: 'abc1234',
    sha256: 'f'.repeat(64),
    channels: [
      { number: 1, id: 'ch-001', name: 'One', description: 'Opening programmes.', enabled: true, originals: [], programmes: [] },
      {
        number: 2,
        id: 'ch-002',
        name: 'Crafts',
        description: 'Pottery, weaving and craft workshops.',
        enabled: true,
        category: 'Arts',
        originals: [original('src_wheel', 'The Wheel', 'https://www.youtube.com/@thewheel', ['Pottery wheel basics', 'Pottery glaze firing', 'Weaving loom warp', 'Weaving loom colour'])],
        programmes: [],
      },
      { number: 3, id: 'ch-003', name: 'Three', description: 'Nothing yet.', enabled: true, originals: [], programmes: [] },
    ],
  }
}

const open: Workspace[] = []
const operators: Operator[] = []

function newWorkspace(): Workspace {
  const base = mkdtempSync(join(tmpdir(), 'tvn-harvester-2b-'))
  const masterPath = join(base, 'TVN_Export_test.json')
  writeFileSync(masterPath, `${JSON.stringify(masterDoc(), null, 2)}\n`)
  const { workspace } = createWorkspace(join(base, 'ws'), masterPath, new Date('2026-10-04T13:00:00Z'))
  workspace.config = withOverrides({ pacing: { betweenSourcesMs: 0 }, backoffMs: [1, 1], snapshotMinutes: 1000, outputsEvery: 1000 })
  importBaseline(workspace.db, catalogue(), NOW)
  computeHealth(workspace.db, workspace.config.health, NOW)
  open.push(workspace)
  return workspace
}

afterEach(() => {
  for (const operator of operators.splice(0)) operator.close()
  for (const workspace of open.splice(0)) {
    try {
      workspace.db.close()
    } catch {
      // already closed
    }
  }
})

const channelId = (workspace: Workspace, number: number) => (workspace.db.prepare("SELECT id FROM channels WHERE number = ? AND scope = 'central'").get(number) as { id: number } | undefined)?.id ?? (workspace.db.prepare('SELECT id FROM channels WHERE number = ?').get(number) as { id: number }).id

const found = (extra: Partial<Found> & Pick<Found, 'url' | 'label'>): Found => ({
  provider: 'youtube-channels',
  sourceType: 'youtube-channel',
  providerId: null,
  handle: null,
  owner: null,
  description: '',
  listed: null,
  audience: null,
  sampleTitles: [],
  genre: null,
  query: '',
  ...extra,
})

/** What a search finds for the Crafts channel, whatever the query: new, shared, already here, off-subject and dead sources. */
function craftResults(): Found[] {
  return [
    found({ url: `https://www.youtube.com/channel/${UC(50)}`, providerId: UC(50), label: 'Studio Pottery Craft', description: 'Pottery and weaving craft workshops from a working studio', listed: 240 }),
    found({ url: `https://www.youtube.com/channel/${UC(51)}`, providerId: UC(51), handle: '@thewheel', label: 'The Wheel' }),
    found({ url: `https://www.youtube.com/channel/${UC(1)}`, providerId: UC(1), label: 'Wheel Thrown', description: 'pottery throwing' }),
    found({ url: `https://www.youtube.com/channel/${UC(52)}`, providerId: UC(52), label: 'NASA Space Science', description: 'astronomy updates' }),
    found({ url: `https://www.youtube.com/channel/${UC(53)}`, providerId: UC(53), label: 'Gone Pottery', description: 'pottery' }),
    found({ url: 'https://www.youtube.com/playlist?list=PL1234567890craft', providerId: 'PL1234567890craft', provider: 'youtube-playlists', sourceType: 'youtube-playlist', label: 'Weaving Loom Lessons Craft', owner: 'Loom House', listed: 40 }),
    found({ url: `https://www.youtube.com/channel/${UC(54)}`, providerId: UC(54), label: 'Random Vlogs', description: 'daily life' }),
    found({ url: 'https://www.youtube.com/playlist?list=PL1234567890wheel', providerId: 'PL1234567890wheel', provider: 'youtube-playlists', sourceType: 'youtube-playlist', label: 'Wheel Favourites', owner: 'The Wheel', listed: 12 }),
  ]
}

function fakeDiscovery(results: () => Found[] = craftResults): DiscoveryDeps & { searches: string[]; previews: string[] } {
  const searches: string[] = []
  const previews: string[] = []
  return {
    searches,
    previews,
    search: async (query, provider) => {
      searches.push(`${provider}:${query}`)
      return results().filter((item) => item.provider === provider).map((item) => ({ ...item, query }))
    },
    preview: async (item) => {
      previews.push(item.label)
      if (item.label === 'Gone Pottery') return { failure: 'DEAD', message: 'YouTube has no channel at that link' }
      if (item.label === 'Random Vlogs') return { programmes: [video('rv1', { title: 'My morning' }), video('rv2', { title: 'Shopping haul' })], refused: 0 }
      return {
        programmes: [video(`${item.label}1`, { title: 'Pottery glaze workshop', published: '2019-03-01' }), video(`${item.label}2`, { title: 'Weaving loom basics', published: '2024-06-01' }), video(`${item.label}3`, { title: 'Live pottery stream' })],
        listed: item.listed ?? 3,
        refused: 1,
      }
    },
  }
}

const ok = (ids: string[], extra: Partial<ReadResult> = {}, title = (id: string) => `Pottery ${id}`): ReadResult => ({ programmes: ids.map((id) => ({ id: id.padEnd(11, '_'), title: title(id), durationSec: 1200 })), refused: 0, requests: 1, ...extra })
const deps = (extra: Partial<EngineDeps> = {}): EngineDeps => ({ baseline: false, now: () => NOW, ...extra })

describe('Phase 2B discovery search', () => {
  it('reads channels and playlists from a public results page, named fields only', () => {
    const data = {
      contents: {
        sectionListRenderer: {
          contents: [
            {
              itemSectionRenderer: {
                contents: [
                  {
                    channelRenderer: {
                      channelId: UC(60),
                      title: { simpleText: 'Studio Pottery' },
                      descriptionSnippet: { runs: [{ text: 'Pottery ' }, { text: 'and glaze' }] },
                      subscriberCountText: { simpleText: '@studiopottery' },
                      videoCountText: { simpleText: '12.5K subscribers' },
                      navigationEndpoint: { browseEndpoint: { canonicalBaseUrl: '/@studiopottery' } },
                      thumbnail: { thumbnails: [{ url: 'https://rr1---sn.googlevideo.com/initplayback?signature=abc' }] },
                    },
                  },
                  {
                    lockupViewModel: {
                      contentId: 'PLabcdefghij123',
                      contentImage: { collectionThumbnailViewModel: { primaryThumbnail: { thumbnailViewModel: { overlays: [{ thumbnailOverlayBadgeViewModel: { thumbnailBadges: [{ thumbnailBadgeViewModel: { text: '560 videos' } }] } }] } } } },
                      metadata: {
                        lockupMetadataViewModel: {
                          title: { content: 'Weaving masterclass' },
                          metadata: {
                            contentMetadataViewModel: {
                              metadataRows: [{ metadataParts: [{ text: { content: 'Loom House' } }] }, { metadataParts: [{ text: { content: 'Warp and weft · 12:31' } }] }],
                            },
                          },
                        },
                      },
                    },
                  },
                  { videoRenderer: { videoId: 'abcdefghijk', title: { runs: [{ text: 'A single video' }] } } },
                ],
              },
            },
          ],
        },
      },
    }
    const results = parseYouTubeResults(data, 'pottery')
    expect(results).toEqual([
      expect.objectContaining({ sourceType: 'youtube-channel', providerId: UC(60), handle: '@studiopottery', label: 'Studio Pottery', description: 'Pottery and glaze', audience: '12.5K subscribers', query: 'pottery' }),
      expect.objectContaining({ sourceType: 'youtube-playlist', providerId: 'PLabcdefghij123', label: 'Weaving masterclass', owner: 'Loom House', listed: 560, sampleTitles: ['Warp and weft'] }),
    ])
    expect(JSON.stringify(results)).not.toMatch(/googlevideo|signature/)
  })

  it('builds queries from what the channel is meant to contain, never "Channel 002"', () => {
    const workspace = newWorkspace()
    const context = discoveryContext(workspace.db, channelId(workspace, 2))
    const queries = discoveryQueries(context, '', 5).map((query) => query.text)
    expect(queries[0]).toBe('Pottery weaving craft workshops')
    expect(queries).toContain('Crafts Arts')
    expect(queries.some((query) => /pottery|weaving|loom/i.test(query))).toBe(true)
    expect(queries.every((query) => !/^channel\b|^\d+$/i.test(query))).toBe(true)
    // Number-word names say nothing about a channel.
    expect(discoveryQueries(discoveryContext(workspace.db, channelId(workspace, 3)), '', 5).map((query) => query.text)).not.toContain('Three')
    expect(discoveryQueries(context, 'stoneware', 5)[0]).toEqual({ text: 'stoneware', why: 'operator terms' })
  })
})

describe('Phase 2B DISCOVER SOURCES', () => {
  it('pre-filters duplicates, already-here, dead and excluded subjects, shows shared sources, previews and judges', async () => {
    const workspace = newWorkspace()
    const db = workspace.db
    const crafts = channelId(workspace, 2)
    const fake = fakeDiscovery()
    const summary = await discover(db, crafts, workspace.config.discovery, fake, { now: NOW })
    expect(summary.cached).toBe(false)
    // A playlist the channel's own source publishes is part of that source, not a new one.
    expect(summary.counts.dropped).toMatchObject({ 'ALREADY ON THIS CHANNEL': 1, 'EXCLUDED SUBJECT': 1, 'DEAD OR NOT FOUND': 1, 'PART OF A SOURCE ALREADY HERE': 1 })
    // Each source found by several queries is one candidate.
    const view = discoveryView(db, crafts)
    const labels = view.candidates.map((item) => item.label)
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels).toEqual(expect.arrayContaining(['Studio Pottery Craft', 'Wheel Thrown', 'Weaving Loom Lessons Craft', 'Random Vlogs']))
    expect(labels).not.toContain('The Wheel')
    expect(labels).not.toContain('NASA Space Science')
    const studio = view.candidates.find((item) => item.label === 'Studio Pottery Craft')
    expect(studio).toMatchObject({ relevance: 'HIGH', usedBy: null, preview: { read: 3, eligible: 3, dated: 2, oldest: '2019-03-01', newest: '2024-06-01', refused: 1 } })
    // Shared, not rejected: where else it serves is shown.
    expect(view.candidates.find((item) => item.label === 'Wheel Thrown')?.usedBy).toBe('ALREADY USED BY 1001 · Pottery Corner')
    expect(view.candidates.find((item) => item.label === 'Random Vlogs')?.relevance).toBe('LOW')
    expect(view.candidates[0].relevance).toBe('HIGH')
    expect(suitableIds(view)).not.toContain(view.candidates.find((item) => item.label === 'Random Vlogs')?.id)
    expect(view.dropped.find((item) => item.label === 'NASA Space Science')?.dropReason).toMatch(/EXCLUDED SUBJECT: nasa/)

    // A repeat within the cache window is the cached search; SEARCH AGAIN asks the providers again.
    const searched = fake.searches.length
    expect((await discover(db, crafts, workspace.config.discovery, fake, { now: NOW })).cached).toBe(true)
    expect(fake.searches.length).toBe(searched)
    const again = await discover(db, crafts, workspace.config.discovery, fake, { now: NOW, force: true, extra: 'stoneware' })
    expect(again.cached).toBe(false)
    expect(fake.searches.at(-1)).not.toBeUndefined()
    expect(fake.searches.some((query) => query.endsWith(':stoneware'))).toBe(true)
  })

  it('asks a failed search once more, keeps each search short, and offers a compact shortlist', async () => {
    const workspace = newWorkspace()
    const db = workspace.db
    const crafts = channelId(workspace, 2)
    const fake = fakeDiscovery()
    const failing = new Set<string>()
    const search = fake.search
    fake.search = async (query, provider) => {
      if (!failing.has(`${provider}:${query}`)) {
        failing.add(`${provider}:${query}`)
        throw new Error('YouTube search page could not be read')
      }
      return search(query, provider)
    }
    const settings = { ...workspace.config.discovery, shortlist: 2, perSearch: 4 }
    const summary = await discover(db, crafts, settings, fake, { now: NOW })
    expect(summary.counts.failures).toBe(0)
    expect(summary.counts.shown).toBe(2)
    expect(summary.counts.dropped['BELOW THE SHORTLIST']).toBeGreaterThan(0)
    // Only the first four of each search were kept: the vlogs (seventh) never appear.
    expect(discoveryView(db, crafts).dropped.map((item) => item.label)).not.toContain('Random Vlogs')
  })

  it('remembers rejections for the channel until its context changes, unless the operator includes them', async () => {
    const workspace = newWorkspace()
    const db = workspace.db
    const crafts = channelId(workspace, 2)
    const fake = fakeDiscovery()
    await discover(db, crafts, workspace.config.discovery, fake, { now: NOW })
    const vlogs = discoveryView(db, crafts).candidates.find((item) => item.label === 'Random Vlogs')
    expect(rejectCandidates(db, crafts, [vlogs?.id as number], NOW)).toBe(1)
    const hidden = await discover(db, crafts, workspace.config.discovery, fake, { now: NOW, force: true })
    expect(hidden.counts.hiddenRejected).toBe(1)
    expect(discoveryView(db, crafts).candidates.map((item) => item.label)).not.toContain('Random Vlogs')
    await discover(db, crafts, workspace.config.discovery, fake, { now: NOW, force: true, includeRejected: true })
    expect(discoveryView(db, crafts).candidates.map((item) => item.label)).toContain('Random Vlogs')
    // A new description is a new editorial context: the old rejection no longer hides it.
    db.prepare('UPDATE channels SET name = ? WHERE id = ?').run('Crafts & Making', crafts)
    await discover(db, crafts, workspace.config.discovery, fake, { now: NOW, force: true })
    expect(discoveryView(db, crafts).candidates.map((item) => item.label)).toContain('Random Vlogs')
  })

  it('approves into the desk, harvests deep with channel rules and discovery provenance, and updates health', async () => {
    const workspace = newWorkspace()
    const db = workspace.db
    const crafts = channelId(workspace, 2)
    // The channel's rule: no live streams.
    const shipped = db.prepare("SELECT id, body FROM sources WHERE channel_id = ? AND provenance = 'shipped'").get(crafts) as { id: number; body: string }
    db.prepare('UPDATE sources SET body = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(shipped.body), filter: { exclude: { terms: ['live'] } } }), shipped.id)
    computeHealth(db, workspace.config.health, NOW)
    ensureBefore(db, crafts, NOW)
    await discover(db, crafts, workspace.config.discovery, fakeDiscovery(), { now: NOW })
    const studio = discoveryView(db, crafts).candidates.find((item) => item.label === 'Studio Pottery Craft')
    expect(approveCandidates(db, crafts, [studio?.id as number], 'operator', NOW)).toBe(1)
    expect(pendingOf(db, crafts)[0]).toMatchObject({ status: 'READY', typeLabel: 'YouTube channel · discovered' })
    expect(discoveryView(db, crafts).decided[0]).toMatchObject({ status: 'APPROVED', decidedBy: 'operator', decidedAt: NOW.toISOString() })
    // Approval is required: nothing is a source until the harvest reads it.
    expect((db.prepare('SELECT COUNT(*) AS n FROM sources WHERE discovery_id IS NOT NULL').get() as { n: number }).n).toBe(0)

    const depths: string[] = []
    const harvester = new Harvester(workspace, deps({
      read: async (_source, depth) => {
        depths.push(depth)
        return ok(['s1', 's2', 's3'], { next: 'c1', listed: 5, identity: { sourceType: 'youtube-channel', url: `https://www.youtube.com/channel/${UC(50)}`, providerId: UC(50), label: 'Studio Pottery Craft' } }, (id) => (id === 's3' ? 'Live from the kiln' : `Pottery ${id}`))
      },
      readBatch: async () => ok(['s4', 's5'], { listed: 5 }),
    }))
    await harvester.scanDesk(crafts)
    expect(depths).toEqual(['deep'])
    const source = db.prepare('SELECT id, provenance, discovery_id, body FROM sources WHERE discovery_id IS NOT NULL').get() as { id: number; provenance: string; discovery_id: number; body: string }
    expect(source).toMatchObject({ provenance: 'desk', discovery_id: studio?.id })
    expect(JSON.parse(source.body)).toMatchObject({ deep: true, complete: true, filter: { exclude: { terms: ['live'] } } })
    const journal = JSON.parse((db.prepare("SELECT detail FROM changes WHERE kind = 'source' AND source_id = ?").get(source.id) as { detail: string }).detail)
    expect(journal.discovered).toMatchObject({ by: 'harvester', candidateId: studio?.id, canonical: `youtube:channel:${UC(50)}`, relevance: 'HIGH', approvedBy: 'operator', approvedAt: NOW.toISOString() })
    expect(journal.discovered.query).toBeTruthy()
    expect(journal.discovered.context.key).toMatch(/^[0-9a-f]{16}$/)
    // Discovered versus eligible: the channel's rule keeps the live programme off.
    expect(discoveryView(db, crafts).decided[0]).toMatchObject({ status: 'ADDED', result: { programmes: 5, eligible: 4, complete: true } })
    // New programmes are held: available and eligible grow, the saved schedule does not.
    const held = db.prepare('SELECT COUNT(*) AS n FROM programmes WHERE source_id = ? AND pending = 1').get(source.id) as { n: number }
    expect(held.n).toBe(5)
    const enrichment = enrichmentOf(db, crafts, workspace.config.discovery.strongHours)
    expect(enrichment.before).toMatchObject({ sources: 1, available: 4 })
    expect(enrichment.after).toMatchObject({ sources: 2, available: 9 })
    expect(enrichment.gain).toMatchObject({ sources: 1, available: 5, eligible: 4 })
    expect(deskView(db, crafts).sources.find((item) => item.id === source.id)?.provenance).toBe('discovered')
    // The same source is not offered again on this channel.
    await discover(db, crafts, workspace.config.discovery, fakeDiscovery(), { now: NOW, force: true })
    expect(discoveryView(db, crafts).candidates.map((item) => item.label)).not.toContain('Studio Pottery Craft')
  })

  it('a discovered source stopped mid-harvest is PARTIAL and the next harvest carries it on', async () => {
    const workspace = newWorkspace()
    const db = workspace.db
    const crafts = channelId(workspace, 2)
    await discover(db, crafts, workspace.config.discovery, fakeDiscovery(), { now: NOW })
    const studio = discoveryView(db, crafts).candidates.find((item) => item.label === 'Studio Pottery Craft')
    approveCandidates(db, crafts, [studio?.id as number], 'operator', NOW)
    let harvester: Harvester
    harvester = new Harvester(workspace, deps({
      read: async () => ok(['p1', 'p2'], { next: 'page-2', identity: { sourceType: 'youtube-channel', url: `https://www.youtube.com/channel/${UC(50)}`, providerId: UC(50), label: 'Studio Pottery Craft' } }),
      readBatch: (_cursor, signal) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new Stopped()), { once: true })
          setTimeout(() => harvester.stop(), 5)
        }),
    }))
    await harvester.scanDesk(crafts)
    expect(discoveryView(db, crafts).decided[0]).toMatchObject({ status: 'PARTIAL', result: { programmes: 2, complete: false } })
    const again = new Harvester(workspace, deps({ readBatch: async () => ok(['p3']) }))
    await again.scanDesk(crafts)
    expect(discoveryView(db, crafts).decided[0]).toMatchObject({ status: 'ADDED', result: { programmes: 3, complete: true } })
  })

  it('AUTO-ADD HIGH CONFIDENCE takes only strict HIGH candidates', async () => {
    const workspace = newWorkspace()
    const db = workspace.db
    const crafts = channelId(workspace, 2)
    await discover(db, crafts, workspace.config.discovery, fakeDiscovery(), { now: NOW })
    const settings = workspace.config.discovery
    const auto = discoveryView(db, crafts).candidates.filter((item) => autoApprovable(item, settings))
    // Off by default; when on, only previewed HIGH candidates with no warning that clear the score, sample and volume bars.
    expect(discoveryView(db, crafts).candidates.length).toBeGreaterThan(0)
    expect(auto.every((item) => item.relevance === 'HIGH' && item.preview !== null && item.flags.length === 0)).toBe(true)
    expect(auto.map((item) => item.label)).not.toContain('Random Vlogs')
    expect(auto.map((item) => item.label)).not.toContain('Weaving Loom Lessons Craft')
  })
})

describe('Phase 2B contribution and standing', () => {
  it('tells programmes from refreshed existing sources apart from new discovered sources', async () => {
    const workspace = newWorkspace()
    const db = workspace.db
    const crafts = channelId(workspace, 2)
    const since = new Date(NOW.getTime() - 1000).toISOString()
    const refresher = new Harvester(workspace, deps({ read: async () => ok(['src_wheel0', 'fresh1', 'fresh2'], { refused: 73 }) }))
    await refresher.refreshChannel(crafts)
    await discover(db, crafts, workspace.config.discovery, fakeDiscovery(), { now: NOW })
    const studio = discoveryView(db, crafts).candidates.find((item) => item.label === 'Studio Pottery Craft')
    approveCandidates(db, crafts, [studio?.id as number], 'operator', NOW)
    const harvester = new Harvester(workspace, deps({ read: async () => ok(['d1', 'd2', 'd3', 'd4'], { identity: { sourceType: 'youtube-channel', url: `https://www.youtube.com/channel/${UC(50)}`, providerId: UC(50), label: 'Studio Pottery Craft' } }) }))
    await harvester.scanDesk(crafts)
    const report = sessionReport(db, since)
    expect(report.newProgrammes).toEqual({ fromExisting: 2, fromDiscovered: 4, fromPasted: 0 })
    expect(report.discovery).toMatchObject({ searches: 1, approved: 1 })
    expect(report.existingSourcesRefreshed).toBe(1)
    // 73 refusals are programmes TVN cannot embed, not a broken source.
    expect(report.embedRefusals).toBe(73)
    const health = computeHealth(db, workspace.config.health, NOW, [crafts])[0]
    expect(health.brokenSources).toBe(0)
    expect(health.deadRefused).toBeGreaterThanOrEqual(73)
  })

  it('flags low source diversity gently and calls a channel STRONG or WEAK', () => {
    const base = { class: 'HEALTHY', gap: null, hours: 200, brokenSources: 0, eligible: 500, creators: 12, topCreatorShare: 30 } as unknown as ChannelHealth
    expect(diversityOf(base)).toBe('GOOD')
    expect(deskStanding(base, 100)).toBe('STRONG')
    expect(diversityOf({ ...base, topCreatorShare: 91 })).toBe('LOW')
    expect(deskStanding({ ...base, topCreatorShare: 91 }, 100)).toBe('OK')
    expect(diversityOf({ ...base, topCreatorShare: 60 })).toBe('MODERATE')
    expect(deskStanding({ ...base, class: 'THIN' } as ChannelHealth, 100)).toBe('WEAK')
    expect(deskStanding({ ...base, gap: 'NO REFRESHABLE SOURCE' } as ChannelHealth, 100)).toBe('WEAK')
    expect(deskStanding(null, 100)).toBeNull()
  })
})

describe('Phase 2B one writer and the job queue', () => {
  it('refuses a second writer, allows read-only inspection, and ignores a stale lock', () => {
    const workspace = newWorkspace()
    const dir = workspace.dir
    // A live process that is not this one owns it.
    writeFileSync(join(dir, LOCK_FILE), `${JSON.stringify({ pid: process.ppid, role: 'serve', port: 5190, since: NOW.toISOString() })}\n`)
    expect(workspaceOwner(dir)).toMatchObject({ role: 'serve', port: 5190 })
    expect(() => lockWorkspace(dir, 'cli')).toThrow(WorkspaceInUse)
    expect(() => lockWorkspace(dir, 'cli')).toThrow(/WORKSPACE ALREADY IN USE/)
    const reader = openWorkspace(dir, { readOnly: true })
    open.push(reader)
    expect(currentChannel(reader.db).number).toBe(1)
    expect(() => reader.db.prepare("UPDATE meta SET value = 'x' WHERE key = 'desk_current'").run()).toThrow()
    // A lock left by a process that has gone is not an owner.
    writeFileSync(join(dir, LOCK_FILE), `${JSON.stringify({ pid: 2 ** 22 + 12345, role: 'cli', since: NOW.toISOString() })}\n`)
    expect(workspaceOwner(dir)).toBeNull()
    expect(lockWorkspace(dir, 'cli')).toMatchObject({ pid: process.pid, role: 'cli' })
    unlockWorkspace(dir)
    expect(workspaceOwner(dir)).toBeNull()
  })

  it('runs engine jobs one at a time, discovery beside them, marks leftovers interrupted, and STOP withdraws the rest', async () => {
    const workspace = newWorkspace()
    const db = workspace.db
    const order: string[] = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const queue = new JobQueue(db, {
      run: async (job) => {
        order.push(`start ${job.kind}`)
        if (job.kind === 'refresh') await gate
        order.push(`end ${job.kind}`)
        return 'ok'
      },
      stopEngine: () => undefined,
    }, () => undefined, () => NOW)
    queue.submit('refresh', {}, { channelId: 1 })
    queue.submit('harvest', {}, { channelId: 1 })
    // The same job waiting is not queued twice.
    queue.submit('harvest', {}, { channelId: 1 })
    queue.submit('discover', {}, { channelId: 2 })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(order).toEqual(['start refresh', 'start discover', 'end discover'])
    expect(queue.list().filter((job) => job.state === 'queued').map((job) => job.kind)).toEqual(['harvest'])
    release()
    await queue.idle()
    expect(order).toEqual(['start refresh', 'start discover', 'end discover', 'end refresh', 'start harvest', 'end harvest'])

    queue.submit('report')
    queue.submit('export')
    db.prepare("UPDATE jobs SET state = 'running' WHERE kind = 'report'").run()
    const restarted = new JobQueue(db, { run: async () => 'ok', stopEngine: () => undefined }, () => undefined, () => NOW)
    expect(restarted.list().find((job) => job.kind === 'report')?.state).toBe('interrupted')
    restarted.submit('report')
    restarted.submit('export')
    restarted.stopAll()
    await restarted.idle()
    expect(restarted.list().filter((job) => job.state === 'queued')).toEqual([])
  })

  it('the operator window shows every job, harvests approved sources in the background, and keeps the desk moving', async () => {
    const workspace = newWorkspace()
    const dir = workspace.dir
    workspace.db.close()
    open.splice(open.indexOf(workspace), 1)
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const operator = new Operator({
      now: () => NOW,
      engine: deps({
        read: async (source) => {
          if (source.url.includes(UC(50))) await gate
          return ok(['o1', 'o2'], { identity: { sourceType: 'youtube-channel', url: `https://www.youtube.com/channel/${UC(50)}`, providerId: UC(50), label: 'Studio Pottery Craft' } })
        },
      }),
      discovery: () => fakeDiscovery(),
    }, 5199)
    operators.push(operator)
    operator.open(dir)
    expect(JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8'))).toMatchObject({ pid: process.pid, role: 'serve', port: 5199 })
    const live = operator.workspace as Workspace
    live.config = withOverrides({ pacing: { betweenSourcesMs: 0 }, snapshotMinutes: 1000, outputsEvery: 1000 })
    const db = live.db
    goToNumber(db, 2)
    const state = () => operator.state() as { jobs: { kind: string; state: string; origin: string; channelId: number | null }[]; desk: { discovery: { candidates: { id: number; label: string }[] }; assist: boolean; autoAdd: boolean; enrichment: { before: unknown } } }
    expect(state().desk).toMatchObject({ assist: false, autoAdd: false })
    expect(state().desk.enrichment.before).not.toBeNull()
    operator.desk('discover', {})
    await (operator.queue as JobQueue).idle()
    const studio = state().desk.discovery.candidates.find((item) => item.label === 'Studio Pottery Craft') as { id: number }
    operator.desk('approve', { ids: [studio.id] })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(state().jobs.find((job) => job.kind === 'harvest')).toMatchObject({ state: 'running', origin: 'operator' })
    // While the harvest runs, the desk moves on and ASSIST discovers the next channel beside it.
    operator.desk('assist', { on: true })
    operator.desk('next', {})
    expect(currentChannel(db).number).toBe(3)
    await new Promise((resolve) => setTimeout(resolve, 5))
    // Switching ASSIST on works on the channel the desk is on; NEXT then works on the one it arrives at.
    const assisted = state().jobs.filter((job) => job.origin === 'assist').map((job) => `${job.kind} ${job.channelId}`).sort()
    expect(assisted).toEqual([`discover ${channelId(live, 2)}`, `discover ${channelId(live, 3)}`, `refresh ${channelId(live, 2)}`, `refresh ${channelId(live, 3)}`])
    expect(state().jobs.find((job) => job.kind === 'discover' && job.origin === 'assist' && job.channelId === channelId(live, 3))?.state).toBe('done')
    release()
    await (operator.queue as JobQueue).idle()
    expect(state().jobs.find((job) => job.kind === 'harvest')?.state).toBe('done')
    expect(discoveryView(db, channelId(live, 2)).decided[0]).toMatchObject({ status: 'ADDED' })
    expect((operator.harvester as Harvester).log.some((line) => /Job \d+ queued: HARVEST APPROVED SOURCES 002 Crafts/.test(line.message))).toBe(true)
  })
})

describe('Phase 2B keeps the Run 5 fixes', () => {
  it('a shipped original whose publisher page is gone never marks its programmes unavailable', async () => {
    const workspace = newWorkspace()
    const harvester = new Harvester(workspace, deps({
      read: async () => {
        throw new ReadFailure('NOT FOUND', 'YouTube has no channel at that link')
      },
    }))
    for (let n = 0; n < 3; n += 1) await harvester.refreshChannel(channelId(workspace, 2))
    const rows = workspace.db.prepare("SELECT p.playability FROM programmes p JOIN sources s ON s.id = p.source_id WHERE s.channel_id = ? AND s.provenance = 'shipped'").all(channelId(workspace, 2)) as { playability: string }[]
    expect(rows.length).toBe(4)
    expect(rows.every((row) => row.playability !== 'unavailable')).toBe(true)
  })
})
