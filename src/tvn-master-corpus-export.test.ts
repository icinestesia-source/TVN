import { describe, expect, it } from 'vitest'
import { eligibleOf } from './services/channel-curation.ts'
import type { ChannelSource } from './services/channel-sources.ts'
import { channelsFromSources, type ImportedVideo, type StoredSource } from './services/channels-import.ts'
import { overridesFromExport } from './services/central-curation.ts'
import type { CuratedEdit } from './services/curated-edits.ts'
import { curatedChannelManifest, userChannelManifest, type EditorialManifest } from './services/editorial-manifest.ts'
import { buildTvnExport, readRestoreFile, serialiseTvnExport, type PortableSettings, type TvnExport } from './services/tvn-export.ts'
import { recordsFromExport, resolveRestored } from './services/user-network-restore.ts'
import { DEFAULT_TRANSITION_SETTINGS } from './state/transitions.ts'
import { DEFAULT_SHORTCUTS } from './view/info-shortcuts.ts'

const settings: PortableSettings = {
  volume: 45,
  muted: false,
  subtitles: false,
  sleepMinutes: 60,
  guideSplit: 0.5,
  infoShortcuts: { ...DEFAULT_SHORTCUTS },
  surfRange: { minSeconds: 4, maxSeconds: 10 },
  transition: 'tv-tune',
  transitionStyle: { ...DEFAULT_TRANSITION_SETTINGS },
}

const NOW = new Date(Date.UTC(2026, 9, 4, 16, 25))
const id = (prefix: string, n: number) => `${prefix}${String(n).padStart(11 - prefix.length, '0')}`

/** 740 programmes: dates on some, an uploader on some, 23 held back by LOAD, every one watched in this browser. */
function deepPool(): ImportedVideo[] {
  return Array.from({ length: 740 }, (_, n) => ({
    id: id('dp', n),
    title: n % 9 === 0 ? `Shorts ${n} #shorts` : `Programme ${n}`,
    durationSec: n % 9 === 0 ? 45 : 600 + n,
    watched: true,
    ...(n % 3 === 0 ? { published: `20${String(10 + (n % 16)).padStart(2, '0')}-0${1 + (n % 9)}-1${n % 10}` } : {}),
    ...(n % 5 === 0 ? { creator: { name: 'Deep Channel', channelId: 'UCdeepdeepdeepdeepdeep01', handle: 'deep' } } : {}),
    ...(n % 7 === 0 ? { year: 2000 + (n % 26) } : {}),
    ...(n >= 717 ? { pending: true as const } : {}),
  }))
}

function deepChannel(): StoredSource {
  const pool = deepPool()
  const sources: ChannelSource[] = [
    {
      id: 's1',
      kind: 'youtube',
      url: 'https://www.youtube.com/channel/UCdeepdeepdeepdeepdeep01',
      label: 'Deep Channel',
      enabled: true,
      ref: 'UCdeepdeepdeepdeepdeep01',
      youtube: 'channel',
      videos: pool,
      filter: { include: { terms: ['episode', 'programme'], yearFrom: 2012, yearTo: 2026, unknownYear: 'drop' }, exclude: { terms: ['trailer'], shorts: true } },
      mode: 'all',
      listed: 912,
      more: 'continuation-position-not-for-files',
      deep: true,
      status: { state: 'ready', playable: 740, checkedAt: 1 },
    },
    {
      id: 's2',
      kind: 'website',
      url: 'https://example.org/',
      label: 'Example site',
      enabled: true,
      videos: [{ id: 'web-1', title: 'Example site', durationSec: 1800, web: 'website', media: 'https://example.org/', image: 'https://example.org/a.png', summary: 'A page' }],
    },
    {
      id: 's3',
      kind: 'podcast',
      url: 'https://feeds.example.org/show.xml',
      label: 'A Show',
      enabled: false,
      ref: 'https://feeds.example.org/show.xml',
      videos: [{ id: 'ep-1', title: 'Episode 1', durationSec: 3000, published: '2026-09-30', media: 'https://cdn.example.org/ep1.mp3?signature=abc' }],
    },
  ]
  const order = pool.filter((video) => !video.pending).map((video) => video.id).reverse()
  return {
    id: 'yt:UCdeepdeepdeepdeepdeep01',
    name: 'Deep Channel',
    videos: pool,
    channelNumber: 1042,
    inLibrary: false,
    automatic: true,
    updatedAt: 1,
    channelSources: sources,
    runningOrder: order,
    scheduleSize: 200,
    orderKind: 'latest',
    liveFromMs: NOW.getTime() - 3_600_000,
    editorial: { purpose: 'Everything Deep Channel has made', tags: ['deep'] },
  }
}

/** 510 as the viewer made it: Chill, from Café del Mar's 60 programmes, TVN's own programming off. */
function chill(): CuratedEdit {
  const videos = Array.from({ length: 60 }, (_, n) => ({ id: id('cm', n), title: `Chill ${n}`, durationSec: 3600 + n, ...(n % 2 ? { published: '2025-06-01' } : {}) }))
  return {
    channelNumber: 510,
    name: 'Chill',
    description: 'Slow music',
    sources: [
      { id: 'tvn', kind: 'tvn', url: '', label: 'TVN programming', enabled: false },
      { id: 's1', kind: 'youtube', url: 'https://www.youtube.com/channel/UCha0QKR45iw7FCUQ3-1PnhQ', label: 'Café del Mar', enabled: true, ref: 'UCha0QKR45iw7FCUQ3-1PnhQ', youtube: 'channel', videos },
    ],
    order: videos.map((video) => video.id),
    orderKind: 'az',
    originals: [{ ref: 'src_ride', enabled: false, name: 'Ride', programmes: 60 }],
    baseline: { name: 'Shoegaze', programmes: 6, fingerprint: 'ed231880' },
    savedAt: NOW.getTime() - 60_000,
  }
}

const exportOf = (stored: StoredSource[], curated: CuratedEdit[]) =>
  serialiseTvnExport(buildTvnExport({ stored, users: [], favourites: [1042, 510], settings, now: NOW, curated, app: { commit: 'abc1234', build: 'test' } }))

const restored = (text: string) => {
  const read = readRestoreFile(text)
  if (read.kind !== 'complete' || !read.ok) throw new Error(`refused: ${JSON.stringify(read)}`)
  return { doc: read.value, records: recordsFromExport(read.value.userNetwork, 2), curated: overridesFromExport(read.value.central!) }
}

/** Sources, available (held), eligible (after rules), and scheduled: what the channel airs, or a TVN channel's running order. */
const counts = (manifest: EditorialManifest, scheduled: number) => ({
  sources: manifest.current.sources.filter((source) => source.sourceType !== 'tvn').length,
  available: manifest.current.sources.reduce((sum, source) => sum + (source.held ?? 0), 0),
  eligible: manifest.current.sources.reduce((sum, source) => sum + source.programmes, 0),
  scheduled,
})
const airing = (record: StoredSource) => [...channelsFromSources([record]).programmes.values()][0]?.length ?? 0
const curatedOrder = (edit: CuratedEdit) => (edit.scheduleSize ? Math.min(edit.scheduleSize, edit.order?.length ?? 0) : (edit.order?.length ?? 0))

describe('EXPORT ALL as the Master Corpus seed', () => {
  it('names its schema and the TVN that wrote it', () => {
    const doc = JSON.parse(exportOf([deepChannel()], [chill()])) as TvnExport
    expect(doc).toMatchObject({ format: 'tvn-export-v1', version: 1, app: { commit: 'abc1234', build: 'test' } })
    expect(Object.keys(doc)).toEqual(['format', 'version', 'exportedAt', 'app', 'userNetwork', 'favourites', 'settings', 'central', 'guides', 'manifests'])
  })

  it('carries a deep channel’s whole available pool, its rules and its running order, not just what is scheduled', () => {
    const doc = JSON.parse(exportOf([deepChannel()], [])) as TvnExport
    const channel = doc.userNetwork.channels[0]
    expect(channel).toMatchObject({ id: 'yt:UCdeepdeepdeepdeepdeep01', number: 1042, name: 'Deep Channel', enabled: true, scheduleSize: 200, orderKind: 'latest', liveFromMs: NOW.getTime() - 3_600_000 })
    expect(channel.runningOrder).toHaveLength(717)
    const [youtube, website, podcast] = channel.sources
    expect(youtube).toMatchObject({ sourceType: 'youtube-channel', providerId: 'UCdeepdeepdeepdeepdeep01', mode: 'all', listed: 912, deep: true, filter: { include: { terms: ['episode', 'programme'], yearFrom: 2012, yearTo: 2026, unknownYear: 'drop' }, exclude: { terms: ['trailer'], shorts: true } } })
    expect(youtube.videos).toHaveLength(740)
    expect(youtube.videosOmitted).toBeUndefined()
    expect(youtube.videos!.filter((video) => video.published)).toHaveLength(247)
    expect(youtube.videos!.filter((video) => video.pending)).toHaveLength(23)
    expect(youtube.videos![5]).toEqual({ id: id('dp', 5), title: 'Programme 5', durationSec: 605, creator: { name: 'Deep Channel', channelId: 'UCdeepdeepdeepdeepdeep01', handle: 'deep' } })
    expect(website.videos).toEqual([{ id: 'web-1', title: 'Example site', durationSec: 1800, media: 'https://example.org/', summary: 'A page', image: 'https://example.org/a.png', web: 'website' }])
    expect(podcast).toMatchObject({ sourceType: 'podcast', enabled: false, providerId: 'https://feeds.example.org/show.xml' })
    expect(podcast.videos).toEqual([{ id: 'ep-1', title: 'Episode 1', durationSec: 3000, published: '2026-09-30' }])
  })

  it('never carries watched marks, a listing position, media addresses or anything secret', () => {
    const text = exportOf([deepChannel()], [chill()])
    expect(text).not.toContain('"watched"')
    expect(text).not.toContain('continuation-position')
    expect(text).not.toContain('"more"')
    expect(text).not.toContain('cdn.example.org')
    expect(text).not.toContain('signature')
    expect(text).not.toMatch(/AIza[0-9A-Za-z_-]{30}/)
    expect(text).not.toContain('blob:')
  })

  it('exports 510 as the viewer’s Chill with its own programmes, never the shipped Shoegaze', () => {
    const doc = JSON.parse(exportOf([], [chill()])) as TvnExport
    const override = doc.central!.overrides[0]
    expect(override).toMatchObject({ number: 510, name: 'Chill', description: 'Slow music', orderKind: 'az', baseline: { name: 'Shoegaze' } })
    expect(override.runningOrder).toHaveLength(60)
    expect(override.sources.map((source) => [source.sourceType, source.enabled, source.videos?.length ?? 0])).toEqual([['tvn', false, 0], ['youtube-channel', true, 60]])
    expect(override.sources[1].videos!.filter((video) => video.published)).toHaveLength(30)
  })

  it('restores structurally what it exported: the deep channel and 510 count the same before and after', () => {
    const deep = deepChannel()
    const before = { deep: counts(userChannelManifest(deep), airing(deep)), chill: counts(curatedChannelManifest(510, chill(), [], []), curatedOrder(chill())) }
    expect(before.deep).toEqual({ sources: 3, available: 742, eligible: 175, scheduled: 170 })
    expect(before.deep.eligible).toBe(eligibleOf(deep.channelSources![0]).length + 1)
    expect(before.chill).toEqual({ sources: 1, available: 60, eligible: 60, scheduled: 60 })
    const { doc, records, curated } = restored(exportOf([deep], [chill()]))
    const back = records[0]
    expect(back).toMatchObject({ id: deep.id, channelNumber: 1042, name: 'Deep Channel', automatic: true, scheduleSize: 200, orderKind: 'latest', liveFromMs: deep.liveFromMs, editorial: deep.editorial })
    expect(back.runningOrder).toEqual(deep.runningOrder)
    expect(back.channelSources![0]).toMatchObject({ listed: 912, deep: true, mode: 'all', filter: deep.channelSources![0].filter })
    expect(back.channelSources![0].videos!.filter((video) => video.published)).toHaveLength(247)
    expect(back.channelSources![0].videos!.filter((video) => video.pending)).toHaveLength(23)
    // The podcast is read again on restore, since its media addresses never travel; it is off, so nothing airing is lost.
    expect(counts(userChannelManifest(back), airing(back))).toEqual({ ...before.deep, available: 741 })
    expect(back.channelSources![1].videos).toEqual([{ id: 'web-1', title: 'Example site', durationSec: 1800, media: 'https://example.org/', summary: 'A page', image: 'https://example.org/a.png', web: 'website' }])
    expect(counts(curatedChannelManifest(510, curated[0], [], []), curatedOrder(curated[0]))).toEqual(before.chill)
    expect(curated[0]).toMatchObject({ name: 'Chill', orderKind: 'az', order: chill().order, originals: chill().originals })
    expect(doc.favourites).toEqual([1042, 510])
  })

  it('a second export of what was restored is the same file', () => {
    const first = exportOf([deepChannel()], [chill()])
    const { records, curated } = restored(first)
    const second = exportOf(records, curated)
    const strip = (text: string) => JSON.stringify({ ...JSON.parse(text), manifests: undefined, userNetwork: { ...JSON.parse(text).userNetwork, channels: JSON.parse(text).userNetwork.channels.map((channel: { sources: { sourceType: string }[] }) => ({ ...channel, sources: channel.sources.filter((source) => source.sourceType !== 'podcast') })) } })
    expect(strip(second)).toBe(strip(first))
  })

  it('restoring keeps the exported pool: a YouTube read adds to it, and a failed read loses nothing', async () => {
    const { records } = restored(exportOf([deepChannel()], []))
    const fresh = { id: id('nw', 1), title: 'Brand new', durationSec: 900, published: '2026-10-04' }
    const read = await resolveRestored(records, { resolveYouTube: async () => ({ channelId: 'UCdeepdeepdeepdeepdeep01', title: 'Deep Channel', videos: [fresh] }) }, 3)
    expect(read.records[0].channelSources![0].videos).toHaveLength(741)
    expect(read.records[0].channelSources![0].videos![0]).toMatchObject(fresh)
    const failed = await resolveRestored(records, { resolveYouTube: async () => Promise.reject(new Error('offline')) }, 3)
    expect(failed.records[0].channelSources![0].videos).toHaveLength(740)
    expect(failed.records[0].channelSources![0].status?.state).toBe('failed')
  })

  it('reads older files: no app, no pools, no order kind', () => {
    const doc = JSON.parse(exportOf([deepChannel()], [chill()])) as TvnExport & { app?: unknown }
    delete doc.app
    for (const channel of doc.userNetwork.channels) {
      delete channel.orderKind
      delete channel.liveFromMs
      for (const source of channel.sources) if (source.sourceType !== 'collection') delete source.videos
    }
    for (const override of doc.central!.overrides) delete override.orderKind
    expect(readRestoreFile(JSON.stringify(doc))).toMatchObject({ kind: 'complete', ok: true })
  })

  it('refuses a malformed order kind or build', () => {
    const doc = JSON.parse(exportOf([deepChannel()], [])) as Record<string, unknown> & TvnExport
    expect(readRestoreFile(JSON.stringify({ ...doc, app: 'x' }))).toMatchObject({ ok: false })
    const bad = structuredClone(doc)
    ;(bad.userNetwork.channels[0] as { orderKind: string }).orderKind = 'sideways'
    expect(readRestoreFile(JSON.stringify(bad))).toMatchObject({ ok: false })
  })
})
