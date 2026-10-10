import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChannelEditor } from './components/ChannelEditor.tsx'
import { channels } from './data/catalogue.ts'
import { MAX_SOURCE_VIDEOS, previewFilter, rescanned } from './services/channel-curation.ts'
import { applyChannelEdit, canLoadMore, editOf, keptScheduleSize, loadMoreSource, rescanSources, type ChannelEdit, type LoadMoreDeps } from './services/channel-editor.ts'
import type { ChannelSource } from './services/channel-sources.ts'
import { channelsFromSources, type ImportedVideo, type StoredSource } from './services/channels-import.ts'
import { buildCuratedEdit, loadCuratedEdit, curatedEditOf, saveCuratedEdit, tvnSource } from './services/curated-edits.ts'
import { buildCentralCuration, overridesFromExport } from './services/central-curation.ts'
import { alphabeticalVideos, latestVideos, rebuiltVideos, shuffledVideos } from './view/programme-order.ts'
import type { Channel } from './types/channel.ts'

/** A deep catalogue: `count` programmes, newest first, the newest 20 dated. */
const catalogue = (count: number): ImportedVideo[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `v${String(index).padStart(10, '0')}`,
    title: `Programme ${index + 1}`,
    durationSec: 600 + index,
    ...(index < 20 ? { published: `2026-0${1 + Math.floor(index / 10)}-${String(28 - (index % 10)).padStart(2, '0')}` } : {}),
  }))

const DEEP = catalogue(742)

/** A YouTube lookup that lists DEEP as the real one does: 60 first, then pages of 100 behind cursors. */
function fakeYouTube(calls: string[] = []): LoadMoreDeps {
  const page = (start: number) => ({ videos: DEEP.slice(start, start + 100).map(({ published: _p, ...video }) => video), listed: 759, ...(start + 100 < DEEP.length ? { next: `at-${start + 100}` } : {}) })
  return {
    resolveYouTube: async () => {
      calls.push('first')
      return { channelId: 'UCdeep00000000000000000a', title: 'Deep', videos: DEEP.slice(0, 60), listed: 759, next: 'at-60' }
    },
    resolveBatch: async (cursor) => {
      calls.push(cursor)
      if (cursor === 'stale') throw new Error('That batch link is not one TVN made')
      return page(Number(cursor.slice(3)))
    },
  }
}

const deepSource = (extra: Partial<ChannelSource> = {}): ChannelSource => ({
  id: 's1',
  kind: 'youtube',
  url: 'https://www.youtube.com/channel/UCdeep00000000000000000a',
  label: 'Deep',
  enabled: true,
  ref: 'UCdeep00000000000000000a',
  youtube: 'channel',
  videos: DEEP.slice(0, 60),
  listed: 759,
  more: 'at-60',
  status: { state: 'ready', playable: 60, checkedAt: 1 },
  ...extra,
})

describe('a source deeper than its first 60 programmes', () => {
  it('LOAD MORE adds the next batch, without duplicates, keeping dates already found', async () => {
    const calls: string[] = []
    const more = await loadMoreSource(deepSource(), fakeYouTube(calls), {}, 5)
    expect(calls).toEqual(['at-60'])
    expect(more.videos).toHaveLength(160)
    expect(new Set(more.videos!.map((video) => video.id)).size).toBe(160)
    expect(more.videos!.slice(0, 20).every((video) => video.published)).toBe(true)
    expect(more.more).toBe('at-160')
    expect(more.deep).toBe(true)
    expect(more.listed).toBe(759)
    expect(canLoadMore(more)).toBe(true)
  })

  it('LOAD ALL reads past 60 to the end of the list, reporting progress, then stops offering more', async () => {
    const progress: number[] = []
    const all = await loadMoreSource(deepSource(), fakeYouTube(), { all: true, onProgress: (loaded) => progress.push(loaded) }, 5)
    expect(all.videos).toHaveLength(742)
    expect(new Set(all.videos!.map((video) => video.id)).size).toBe(742)
    expect(all.videos!.map((video) => video.id)).toEqual(DEEP.map((video) => video.id))
    expect(all.complete).toBe(true)
    expect(all.more).toBeUndefined()
    expect(progress.at(-1)).toBe(742)
    expect(progress.length).toBeGreaterThan(5)
    expect(canLoadMore(all)).toBe(false)
    // A read that stopped early (100 of 449, marked whole) reads on; one short only by what cannot play stays whole.
    const cut = { ...all, videos: all.videos!.slice(0, 100), listed: 449 }
    expect(canLoadMore(cut)).toBe(true)
    expect(canLoadMore({ ...cut, videos: all.videos!.slice(0, 420) })).toBe(false)
  })

  it('STOP keeps what has arrived and leaves the rest to load later', async () => {
    const stop = new AbortController()
    const deps = fakeYouTube()
    const partial = await loadMoreSource(
      deepSource(),
      { ...deps, resolveBatch: async (cursor) => {
        const batch = await deps.resolveBatch(cursor)
        if (cursor === 'at-160') stop.abort()
        return batch
      } },
      { all: true, signal: stop.signal },
      5,
    )
    expect(partial.videos).toHaveLength(260)
    expect(partial.more).toBe('at-260')
    expect(partial.complete).toBeUndefined()
  })

  it('finds its place again when a remembered position has gone stale, or was never kept', async () => {
    const calls: string[] = []
    const stale = await loadMoreSource(deepSource({ more: 'stale' }), fakeYouTube(calls), {}, 5)
    expect(calls).toEqual(['stale', 'first', 'at-60'])
    expect(stale.videos).toHaveLength(160)
    const fresh: string[] = []
    const old = await loadMoreSource(deepSource({ more: undefined, listed: undefined }), fakeYouTube(fresh), {}, 5)
    expect(fresh).toEqual(['first', 'at-60'])
    expect(old.videos).toHaveLength(160)
  })

  it('never holds more than the safety ceiling', async () => {
    let n = 0
    const endless: LoadMoreDeps = {
      resolveYouTube: async () => ({ channelId: 'UCdeep00000000000000000a', title: 'x', videos: [] }),
      resolveBatch: async () => ({ videos: catalogue(100).map((video) => ({ ...video, id: `e${String(n++).padStart(10, '0')}` })), next: 'again' }),
    }
    const capped = await loadMoreSource(deepSource({ videos: [] }), endless, { all: true }, 5)
    expect(capped.videos).toHaveLength(MAX_SOURCE_VIDEOS)
    expect(canLoadMore(capped)).toBe(false)
  })

  it('a rescan of a source loaded deeper adds new uploads and keeps the older ones', async () => {
    const all = await loadMoreSource(deepSource(), fakeYouTube(), { all: true }, 5)
    const newest = catalogue(3).map((video, index) => ({ ...video, id: `new${String(index).padStart(8, '0')}` }))
    const [after] = await rescanSources(
      [all],
      { resolveYouTube: async () => ({ channelId: 'UCdeep00000000000000000a', title: 'Deep', videos: [...newest, ...DEEP.slice(0, 57)], listed: 762, next: 'at-60' }), probeStream: async () => 'online' },
      9,
    )
    expect(after.videos).toHaveLength(745)
    expect(after.complete).toBe(true)
    expect(after.listed).toBe(762)
    expect(rescanned(newest, DEEP.slice(0, 5), 'recent')).toHaveLength(3)
    expect(rescanned(newest, DEEP.slice(0, 5), 'recent', true)).toHaveLength(8)
  })

  it('a rescan never cuts a YouTube source holding more than one read back to its newest 60, and it can still load', async () => {
    const unmarked = deepSource({ videos: DEEP.slice(0, 500), more: undefined, complete: true })
    const [after] = await rescanSources(
      [unmarked],
      { resolveYouTube: async () => ({ channelId: 'UCdeep00000000000000000a', title: 'Deep', videos: DEEP.slice(0, 60), listed: 759 }), probeStream: async () => 'online' },
      9,
    )
    expect(after.videos).toHaveLength(500)
    expect(after.deep).toBe(true)
    expect(canLoadMore(after)).toBe(true)
    // Already cut back to 60 and marked whole by a plain rescan: LOAD is offered again to put it right.
    expect(canLoadMore({ ...unmarked, videos: DEEP.slice(0, 60), listed: undefined })).toBe(true)
  })

  it('a podcast read in full keeps every episode through a rescan, and one already cut back can be read again', async () => {
    const episodes = catalogue(500).map((video, index) => ({ ...video, id: `ep-${index}`, mediaUrl: `https://example.com/${index}.mp3` }))
    const feed = (count: number) => async () => ({ feedUrl: 'https://example.com/feed/podcast/', title: 'Pod', website: null, description: '', episodes: episodes.slice(0, count) })
    const podcast: ChannelSource = { id: 's1', kind: 'podcast', url: 'https://example.com/feed/podcast/', label: 'Pod', enabled: true, videos: episodes.slice(0, 60) }
    const whole = await loadMoreSource(podcast, { resolveYouTube: fakeYouTube().resolveYouTube, resolveBatch: fakeYouTube().resolveBatch, resolveFeed: feed(500) as never }, {}, 5)
    expect(whole.videos).toHaveLength(500)
    expect(whole.listed).toBe(500)
    expect(canLoadMore(whole)).toBe(false)
    const deps = { resolveYouTube: fakeYouTube().resolveYouTube, resolveFeed: feed(60) as never, probeStream: async () => 'online' as const }
    const [after] = await rescanSources([whole], deps, 9)
    expect(after.videos).toHaveLength(500)
    // Added through ADD with the whole feed, never marked deeper: still kept whole.
    const { deep: _d, complete: _c, listed: _l, ...added } = whole
    const [kept] = await rescanSources([added], deps, 9)
    expect(kept.videos).toHaveLength(500)
    // Cut back to 60 yet marked whole, as an older rescan left it: LOAD reads the feed again.
    expect(canLoadMore({ ...added, videos: episodes.slice(0, 60), complete: true })).toBe(true)
    expect(canLoadMore({ ...whole, videos: episodes.slice(0, 60) })).toBe(true)
  })
})

const record = (list: ImportedVideo[]): StoredSource => ({
  id: 'yt:UCdeep00000000000000000a',
  name: 'Deep',
  videos: list,
  channelNumber: 1001,
  inLibrary: false,
  automatic: true,
  updatedAt: 1,
  channelSources: [deepSource({ videos: list })],
})
const channelId = 'user-yt:UCdeep00000000000000000a'

describe('the source pool and the running order', () => {
  it('loading 742 programmes does not schedule them all once a schedule size is chosen', () => {
    const all = [record(DEEP)]
    const order = shuffledVideos(DEEP).map((video) => video.id)
    const saved = applyChannelEdit(all, 1001, { ...editOf(all[0]), order, scheduleSize: 180 }, 5)
    expect(saved[0].runningOrder).toHaveLength(742)
    expect(saved[0].scheduleSize).toBe(180)
    const back = editOf(structuredClone(saved[0]))
    expect(back.scheduleSize).toBe(180)
    expect(back.order).toEqual(order)
    const aired = channelsFromSources(saved).programmes.get(channelId)!
    expect(aired.map((programme) => programme.videoId)).toEqual(order.slice(0, 180))
  })

  it('a schedule size is dropped without an order, or when it covers everything', () => {
    expect(keptScheduleSize(undefined, 10)).toBeUndefined()
    expect(keptScheduleSize(['a', 'b'], 2)).toBeUndefined()
    expect(keptScheduleSize(['a', 'b', 'c'], 2.7)).toBe(2)
    const all = [record(DEEP.slice(0, 5))]
    const saved = applyChannelEdit(all, 1001, { ...editOf(all[0]), scheduleSize: 3 }, 5)
    expect('scheduleSize' in saved[0]).toBe(false)
  })

  it('a filter narrows what is eligible from what is available', () => {
    const preview = previewFilter({ videos: DEEP }, { exclude: { terms: ['programme 1'] } }, 'recent')
    // "Programme 1", "Programme 10"–"19", "100"–"199": 1 + 10 + 100 matches of the phrase.
    expect(preview.excluded).toBe(111)
    expect(preview.matches).toBe(742 - 111)
    const dated = previewFilter({ videos: DEEP }, { include: { yearFrom: 2026, yearTo: 2026, unknownYear: 'drop' } }, 'recent')
    expect(dated.matches).toBe(20)
    expect(previewFilter({ videos: DEEP }, { include: { yearFrom: 2027 } }, 'recent').matches).toBe(722)
  })
})

describe('A–Z, LATEST, RANDOMISE and REBUILD', () => {
  const list = [
    { id: 'a', title: 'beta 10', published: '2024-01-01' },
    { id: 'b', title: 'Alpha', from: 'one' },
    { id: 'c', title: 'beta 2', published: '2025-06-01', from: 'two' },
    { id: 'd', title: 'Gamma', published: '2024-01-01', from: 'two' },
  ]

  it('A–Z reads as people read; LATEST puts the newest first and the undated last, ties stable', () => {
    expect(alphabeticalVideos(list).map((video) => video.id)).toEqual(['b', 'c', 'a', 'd'])
    expect(latestVideos(list).map((video) => video.id)).toEqual(['c', 'a', 'd', 'b'])
  })

  it('RANDOMISE is an unbiased shuffle of the same programmes', () => {
    const counts = new Map<string, number>()
    let seed = 7
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    for (let trial = 0; trial < 6000; trial += 1) {
      const key = shuffledVideos(['x', 'y', 'z'], random).join('')
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    expect(counts.size).toBe(6)
    for (const count of counts.values()) expect(Math.abs(count - 1000)).toBeLessThan(120)
    expect(shuffledVideos(DEEP).map((video) => video.id).sort()).toEqual(DEEP.map((video) => video.id).sort())
  })

  it('REBUILD draws every eligible programme, taking the sources in turn', () => {
    const pool = [...Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, from: 'A' })), ...Array.from({ length: 2 }, (_, i) => ({ id: `b${i}`, from: 'B' }))]
    const rebuilt = rebuiltVideos(pool)
    expect(rebuilt).toHaveLength(8)
    expect(new Set(rebuilt.map((video) => video.id)).size).toBe(8)
    expect(rebuilt.slice(0, 4).filter((video) => video.from === 'B')).toHaveLength(2)
  })
})

function memoryStore() {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) }
}

describe('on a TVN channel', () => {
  it('keeps the rebuilt order and schedule size as a local override, never changing what TVN ships', () => {
    const shipped = channels.find((channel) => channel.number === 7)!
    const store = memoryStore()
    const own = DEEP.slice(0, 10)
    const source = deepSource({ videos: own })
    const order = shuffledVideos(own).map((video) => video.id)
    const saved = saveCuratedEdit(shipped, { name: shipped.name, sources: [tvnSource(), source], order, scheduleSize: 4 }, 3, store)!
    expect(saved.scheduleSize).toBe(4)
    expect(curatedEditOf(shipped, loadCuratedEdit(7, store)).scheduleSize).toBe(4)
    expect(buildCuratedEdit(shipped, saved).programmes!.map((programme) => programme.videoId)).toEqual(order.slice(0, 4))
    expect(channels.find((channel) => channel.number === 7)).toBe(shipped)
    const exported = buildCentralCuration([saved])
    expect(exported.overrides[0].scheduleSize).toBe(4)
    expect(overridesFromExport(exported)[0].scheduleSize).toBe(4)
  })
})

describe('the Channel Editor', () => {
  const user = { ...channels[0], number: 1001, id: 'user-x', origin: 'user-import' } as Channel
  const render = (edit: ChannelEdit, more = true) =>
    renderToStaticMarkup(
      createElement(ChannelEditor, {
        channel: user,
        scope: 'user',
        initial: edit,
        onLoad: async () => edit,
        onSave: async () => '',
        onRescan: async () => ({ edit, message: '' }),
        ...(more ? { onLoadMore: async (source: ChannelSource) => source } : {}),
        onDelete: async () => '',
        onClose: () => {},
      }),
    )

  it('shows how much of a source is loaded, with LOAD MORE and LOAD ALL while there is more', () => {
    const html = render({ name: 'Deep', sources: [deepSource()] })
    expect(html).toContain('60 loaded · 759 listed')
    expect(html).toContain('>Load more</button>')
    expect(html).toContain('>Load all</button>')
    const done = render({ name: 'Deep', sources: [deepSource({ videos: DEEP, more: undefined, complete: true, deep: true })] })
    expect(done).toContain('742 loaded · 759 listed · whole source read')
    expect(done).toMatch(/<button[^>]*disabled=""[^>]*title="The whole source is read"[^>]*>Load more<\/button>/)
  })

  it('counts available, eligible and scheduled, and offers RANDOMISE and REBUILD', () => {
    const order = DEEP.map((video) => video.id)
    const html = render({ name: 'Deep', sources: [deepSource({ videos: DEEP, filter: { exclude: { terms: ['programme 1'] } } })], order, scheduleSize: 180 })
    expect(html).toContain('<span>742 available</span><span>631 eligible</span><span class="editor-pool-on">180 scheduled</span>')
    expect(html).toContain('>Randomise</button>')
    expect(html).toContain('>Rebuild</button>')
    expect(html).toContain('Not scheduled from here')
    expect(html).toContain('Show all 631')
  })
})
