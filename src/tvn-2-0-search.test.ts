import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GuideActions } from './components/GuideAdd.tsx'
import { isShippedEditorial, shippedEditorial } from './data/central-editorial.ts'
import { channelByNumber, shippedChannel, shippedProgrammes } from './data/catalogue.ts'
import { installCuratedEdits, installUserCatalogue } from './data/user-overlay.ts'
import { resetDirector } from './director/director.ts'
import { setMediaLibrary } from './director/library.ts'
import type { MediaItem } from './director/types.ts'
import { schedulingPool } from './library/mode.ts'
import { expandPlayableCatalogue, type PlayableCatalogueV2 } from './library/playable-catalogue.ts'
import { getChannelMedia } from './library/query.ts'
import { eligibleOf, type SourceFilter } from './services/channel-curation.ts'
import { rescanSources } from './services/channel-editor.ts'
import { classifySourceUrl, webAddress, type ChannelSource } from './services/channel-sources.ts'
import { buildCuratedEdit, curatedEditOf, loadCuratedEdits, saveCuratedEdit, tvnSource } from './services/curated-edits.ts'
import { buildSearchGuide, buildSearchIndex, parseQuery, scoreProgrammes, SEARCH_TARGET, type SearchChannel } from './services/guide-search.ts'
import { searchChannels } from './services/guide-search-pool.ts'
import { originalSourcesOf } from './services/original-sources.ts'
import { addPodcastChannel } from './services/user-network.ts'
import { channelsFromSources } from './services/channels-import.ts'
import { applyGuideAction, buildGuidesExport, checkGuides, EMPTY_LIBRARY, type GuideItem } from './services/viewing-guides.ts'
import type { Channel } from './types/channel.ts'
import type { Programme } from './types/programme.ts'
import { addedContributions, contributionText } from './view/channel-provenance.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const doc = JSON.parse(read('public/independent/playable.json')) as PlayableCatalogueV2
const central = JSON.parse(read('src/data/central-sources.json')) as {
  channels: Record<string, { name: string; sources: { id: string; input: string; mode: string; filter: SourceFilter }[]; editorial: Record<string, unknown> }>
}

describe('channel 555: Daft Punk, from @daftpunk', () => {
  let items: ReturnType<typeof expandPlayableCatalogue> = []
  beforeAll(() => {
    items = expandPlayableCatalogue(doc)
    resetDirector()
    setMediaLibrary(items)
  }, 120_000)
  afterAll(() => resetDirector())

  it('is defined centrally from the @daftpunk handle, reviewing, with its gaps recorded', () => {
    const definition = central.channels['555']
    expect(definition.name).toBe('Daft Punk')
    expect(definition.sources.at(-1)).toMatchObject({ id: 'src_daftpunk', input: '@daftpunk', mode: 'all' })
    expect(definition.sources.every((source) => source.mode === 'all')).toBe(true)
    expect(definition.editorial.status).toBe('reviewing')
    expect(String(definition.editorial.gaps)).toMatch(/Tron/)
    expect(channelByNumber(555)!.name).toBe('Daft Punk')
  })

  it('airs only the official channel, career-wide, with no Shorts or promo fragments', () => {
    const pool = getChannelMedia(schedulingPool(items) as unknown as MediaItem[], 555)
    const hours = pool.reduce((sum, item) => sum + (item.durationSeconds ?? 0), 0) / 3600
    console.info(`555: ${pool.length} programmes, ${hours.toFixed(2)} h`)
    expect(pool.length).toBeGreaterThanOrEqual(30)
    expect([...new Set(pool.map((item) => (item as { sourceId?: string }).sourceId))].every((id) => id?.startsWith('src_daftpunk'))).toBe(true)
    expect(pool.every((item) => (item.durationSeconds ?? 0) >= 120)).toBe(true)
    expect(pool.some((item) => /watch now|#shorts/i.test(item.title ?? ''))).toBe(false)
    expect(pool.some((item) => /Television Rules the Nation|Contact|Human After All/i.test(item.title ?? ''))).toBe(true)
  })

  it('applies the career filter: Shorts, short promos and teasers out, official remixes and archive in', () => {
    const filter = central.channels['555'].sources[0].filter
    const videos = [
      { id: 'a', title: 'Daft Punk - Contact (Official Video)', durationSec: 380 },
      { id: 'b', title: 'Memory Tapes · Watch Now #GetLucky', durationSec: 62 },
      { id: 'c', title: 'Something new #shorts', durationSec: 40 },
      { id: 'd', title: 'Random Access Memories teaser', durationSec: 300 },
      { id: 'e', title: 'Making of Infinity Repeating (Part 2)', durationSec: 600 },
    ]
    expect(eligibleOf({ videos, filter, mode: 'all' }).map((video) => video.id).sort()).toEqual(['a', 'e'])
  })
})

describe('flexible source input', () => {
  it('reads @daftpunk in every common spelling as the one YouTube handle address', () => {
    for (const typed of ['@daftpunk', '  @daftpunk ', 'youtube.com/@daftpunk', 'www.youtube.com/@daftpunk', 'https://youtube.com/@daftpunk', 'https://www.youtube.com/@daftpunk', 'http://m.youtube.com/@daftpunk']) {
      expect(classifySourceUrl(typed), typed).toEqual({ kind: 'youtube', url: 'https://www.youtube.com/@daftpunk' })
    }
    expect(classifySourceUrl('youtube.com/playlist?list=PL0123456789ab').kind).toBe('youtube')
    expect(classifySourceUrl('UC_kRDKYrUlrbtrSiyu5Tflg')).toEqual({ kind: 'youtube', url: 'UC_kRDKYrUlrbtrSiyu5Tflg' })
  })

  it('makes a plausible domain HTTPS and never reads an ordinary word, a script or a private trick as one', () => {
    expect(webAddress('example.com').toString()).toBe('https://example.com/')
    expect(webAddress('www.example.com/feed').toString()).toBe('https://www.example.com/feed')
    expect(webAddress('http://example.com').protocol).toBe('http:')
    for (const bad of ['music', 'Daft Punk', 'hello world.com', 'javascript:alert(1)', 'example', '@']) expect(() => webAddress(bad), bad).toThrow()
    expect(() => classifySourceUrl('javascript:alert(1)')).toThrow()
    expect(() => classifySourceUrl('ftp://example.com/a.mp3')).toThrow()
    expect(classifySourceUrl('crrow777radio.com', 'podcast')).toEqual({ kind: 'podcast', url: 'https://crrow777radio.com/' })
    expect(classifySourceUrl('https://www.example.org/feed/podcast/').kind).toBe('podcast')
  })

  it('an @handle is only a source once the resolver confirms it; then the canonical channel is stored', async () => {
    const typed: ChannelSource = { id: 's1', kind: 'youtube', url: classifySourceUrl('@daftpunk').url, label: '', enabled: true }
    const found = await rescanSources([typed], {
      resolveYouTube: async () => ({ channelId: 'UC_kRDKYrUlrbtrSiyu5Tflg', sourceType: 'youtube-channel', title: 'Daft Punk', videos: [{ id: 'aaaaaaaaaa1', title: 'Contact', durationSec: 380 }] }),
      probeStream: async () => 'online',
    }, 1)
    expect(found[0]).toMatchObject({ url: 'https://www.youtube.com/channel/UC_kRDKYrUlrbtrSiyu5Tflg', ref: 'UC_kRDKYrUlrbtrSiyu5Tflg', label: 'Daft Punk', status: { state: 'ready' } })
    const unknown = await rescanSources([{ ...typed, url: 'https://www.youtube.com/@nosuchhandle' }], {
      resolveYouTube: async () => {
        throw new Error('YouTube has no channel at that link')
      },
      probeStream: async () => 'online',
    }, 1)
    expect(unknown[0].status?.state).toBe('failed')
    expect(unknown[0].ref).toBeUndefined()
  })
})

describe('original and added sources mix, with provenance', () => {
  const shipped = shippedChannel(555)!
  const entry = (videoId: string, title: string, minutes: number, sourceId: string) => ({ videoId, title, durationSeconds: minutes * 60, sourceId })
  const originals = originalSourcesOf([entry('aaaaaaaaaa1', 'Original one', 30, 'src_a'), entry('bbbbbbbbbb1', 'Original two', 20, 'src_b')], {
    sources: { src_a: { name: 'Source A', provider: 'youtube' }, src_b: { name: 'Source B', provider: 'youtube' } },
  })
  const added: ChannelSource = { id: 'c', kind: 'youtube', url: 'https://www.youtube.com/channel/UCcccccccccccccccccccccc', ref: 'UCcccccccccccccccccccccc', label: 'Source C', enabled: true, videos: [{ id: 'ccccccccccc', title: 'Added one', durationSec: 1500 }] }

  it('A + B + C, not C only; the shipped catalogue is never changed', () => {
    const before = JSON.stringify([shippedChannel(555), shippedProgrammes(shipped.id)])
    const built = buildCuratedEdit(shipped, { channelNumber: 555, name: shipped.name, sources: [tvnSource(), added], savedAt: 1 }, new Set(), [], originals)
    expect(built.programmes?.map((programme) => programme.videoId).sort()).toEqual(['aaaaaaaaaa1', 'bbbbbbbbbb1', 'ccccccccccc'])
    const offB = buildCuratedEdit(shipped, { channelNumber: 555, name: shipped.name, sources: [tvnSource(), added], originals: [{ ref: 'src_b', enabled: false, name: 'Source B', programmes: 1 }], savedAt: 1 }, new Set(), [], originals)
    expect(offB.programmes?.map((programme) => programme.videoId).sort()).toEqual(['aaaaaaaaaa1', 'ccccccccccc'])
    expect(JSON.stringify([shippedChannel(555), shippedProgrammes(shipped.id)])).toBe(before)
  })

  it('each programme keeps its source, and the editor counts what each added source brings', () => {
    const built = buildCuratedEdit(shipped, { channelNumber: 555, name: shipped.name, sources: [tvnSource(), added], savedAt: 1 }, new Set(), [], originals)
    const refs = new Map(built.programmes!.map((programme) => [programme.videoId, programme.sourceRef ?? '']))
    expect(refs.get('ccccccccccc')).not.toBe(refs.get('aaaaaaaaaa1'))
    const { rows, total } = addedContributions([tvnSource(), added], new Set(['aaaaaaaaaa1', 'bbbbbbbbbb1']))
    expect(rows.get('c')).toEqual({ programmes: 1, seconds: 1500 })
    expect(contributionText(rows.get('c')!, total + 3000)).toBe('1 programme · 25m · 33%')
  })
})

describe('555 editorial ships with the channel', () => {
  it('shows the shipped notes until the curator changes them, and keeping them needs no override', () => {
    const shipped = shippedChannel(555)!
    const shown = curatedEditOf(shipped, null)
    expect(shown.editorial?.status).toBe('reviewing')
    expect(shown.editorial?.sourceNotes).toContain('@daftpunk')
    expect(isShippedEditorial(555, shown.editorial)).toBe(true)
    const memory = new Map<string, string>()
    const store = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value) }
    expect(saveCuratedEdit(shipped, shown, 1, store)).toBeNull()
    expect(loadCuratedEdits(store)).toEqual({})
    expect(shippedEditorial(556)).toBeUndefined()
  })
})

const programme = (id: string, title: string, minutes: number, source = 'Uploader') => ({ id, title, durationSeconds: minutes * 60, videoId: id.padEnd(11, 'x').slice(0, 11), source })
const channel = (number: number, name: string, programmes: ReturnType<typeof programme>[], extra: Partial<SearchChannel> = {}): SearchChannel => ({ number, name, programmes, ...extra })
const fixture: SearchChannel[] = [
  channel(555, 'Daft Punk', Array.from({ length: 30 }, (_, at) => programme(`dp${at}`, `Track ${at} (Official Video)`, 5, 'Daft Punk')), { category: 'music', tags: ['music', 'daft punk'] }),
  channel(518, 'Disco', [programme('disco1', 'Get Lucky (Daft Punk cover)', 6), programme('disco2', 'Disco night live', 40)], { category: 'music' }),
  channel(556, 'Concerts', Array.from({ length: 12 }, (_, at) => programme(`con${at}`, `Live at the hall ${at}`, 45, `Band ${at % 4}`)), { category: 'music' }),
  channel(574, 'Karaoke', Array.from({ length: 10 }, (_, at) => programme(`kar${at}`, `Song ${at} (Karaoke Version)`, 4)), { category: 'music' }),
  channel(401, 'Basketball History', [programme('mj1', 'Michael Jordan: the final shot', 20), programme('mj2', 'Jordan vs Bird', 15), programme('bb1', 'The 1992 Dream Team', 60)], { category: 'sport', tags: ['basketball', 'nba'] }),
  channel(163, 'Actors', [programme('mbj', 'Michael B. Jordan on Sinners', 30)], { category: 'film' }),
  channel(781, 'Camping', Array.from({ length: 8 }, (_, at) => programme(`camp${at}`, `Wild weekend ${at}`, 25)), { category: 'outdoors', purpose: 'Camping, hiking and bushcraft.' }),
  channel(783, 'Bushcraft', Array.from({ length: 6 }, (_, at) => programme(`bush${at}`, `Shelter build ${at}`, 30))),
  channel(430, 'Geography', [programme('geo1', 'Geography Now! Vietnam', 15, 'Geography Now'), programme('viet1', 'Vietnamese music: a short history', 25)], { category: 'learning' }),
  channel(99, 'Shorts', [programme('short1', 'Daft Punk in 30 seconds #shorts', 0.5), programme('tiny1', 'Daft Punk teaser', 1)]),
]
const index = buildSearchIndex(fixture)

describe('CREATE GUIDE FROM… search', () => {
  it('an exact name finds its channel and title matches first, with the reasons kept for diagnostics', () => {
    const scored = scoreProgrammes(index, parseQuery('Daft Punk'))
    expect(scored[0].entry.programme.id).toBe('disco1')
    expect(scored[0].reasons).toContain('title phrase')
    const own = scored.filter((item) => item.entry.channel.number === 555)
    expect(own).toHaveLength(30)
    expect(own[0].reasons).toEqual(expect.arrayContaining(['tags: daft punk', 'channel: Daft Punk']))
    expect(scored.some((item) => /short|tiny/.test(item.entry.programme.id))).toBe(false)
    const guide = buildSearchGuide(index, 'Daft Punk')
    expect(guide.picks.filter((pick) => pick.entry.channel.number === 555).length).toBeGreaterThan(guide.picks.length / 2)
  })

  it('a broad topic reaches its neighbours across channels, and is not one artist only', () => {
    const guide = buildSearchGuide(index, 'Music')
    const channels = new Set(guide.picks.map((pick) => pick.entry.channel.number))
    expect(channels.size).toBeGreaterThanOrEqual(3)
    expect(channels.has(555) && channels.size > 1).toBe(true)
    const camping = buildSearchGuide(index, 'Camping')
    expect(new Set(camping.picks.map((pick) => pick.entry.channel.number))).toEqual(new Set([781, 783]))
    expect(parseQuery('Vietnamese music').phrases[0]).toMatchObject({ words: ['vietnamese', 'music'], topic: 'music' })
  })

  it('matches programmes, not only channels: a person on a sports channel, and not a namesake', () => {
    const guide = buildSearchGuide(index, 'Michael Jordan')
    expect(guide.picks.map((pick) => pick.entry.programme.id)).toEqual(['mj1'])
    expect(guide.small).toBe(true)
    expect(guide.seconds).toBe(20 * 60)
    expect(buildSearchGuide(index, 'Plymouth Argyle').picks).toEqual([])
  })

  it('builds a watchable schedule: channels take turns, nothing twice, two to four hours, never padded', () => {
    const guide = buildSearchGuide(index, 'Music')
    expect(guide.seconds).toBeGreaterThanOrEqual(SEARCH_TARGET.min)
    expect(guide.seconds).toBeLessThanOrEqual(SEARCH_TARGET.max)
    const keys = guide.picks.map((pick) => pick.entry.key)
    expect(new Set(keys).size).toBe(keys.length)
    const backToBack = guide.picks.filter((pick, at) => at > 0 && pick.entry.channel.number === guide.picks[at - 1].entry.channel.number).length
    expect(backToBack).toBeLessThanOrEqual(1)
    const karaoke = buildSearchGuide(index, 'Karaoke')
    expect(karaoke.seconds).toBe(40 * 60)
  })

  it('RESCAN gives a meaningfully different valid schedule, and says when the pool is too small', () => {
    const first = buildSearchGuide(index, 'Music')
    const second = buildSearchGuide(index, 'Music', { seed: 1, previous: new Set(first.picks.map((pick) => pick.entry.key)) })
    const same = second.picks.filter((pick) => first.picks.some((item) => item.entry.key === pick.entry.key)).length
    expect(same / second.picks.length).toBeLessThan(0.5)
    expect(second.seconds).toBeGreaterThanOrEqual(SEARCH_TARGET.min)
    expect(buildSearchGuide(index, 'Music')).toEqual(first)
    const small = buildSearchGuide(index, 'Karaoke', { seed: 1, previous: new Set(buildSearchGuide(index, 'Karaoke').picks.map((pick) => pick.entry.key)) })
    expect(small.small).toBe(true)
  })

  it('GUIDE turns green while a Map is watched, and the words it was built from stay inside the Map editor', () => {
    const markup = renderToStaticMarkup(createElement(GuideActions, { tool: null, picked: false, following: true, onNow: () => {}, onTool: () => {} }))
    expect(markup).toContain('class="tab guide-section guide-follow is-on is-following"')
    expect(markup).not.toContain('guide-query')
    expect(readFileSync('src/components/GuidePanel.tsx', 'utf8')).toContain('<p className="plan-note map-built">Built from “{search.query}”</p>')
  })

  it('a generated Guide saves under its words with the existing Guide system and exports, podcasts included', () => {
    const items: GuideItem[] = [
      { id: 'i-1', channelNumber: 555, channelName: 'Daft Punk', programme: { id: 'p1', title: 'Contact', videoId: 'aaaaaaaaaa1', durationSeconds: 380, source: 'imported' } },
      { id: 'i-2', channelNumber: 1001, channelName: 'Example Radio', programme: { id: 'p2', title: 'Episode 2', videoId: null, mediaUrl: 'https://cdn.radio-example.org/ep2.mp3', durationSeconds: 3723, source: 'imported' } },
    ]
    let library = applyGuideAction(EMPTY_LIBRARY, { type: 'new', name: 'Daft Punk' }, 1)
    library = applyGuideAction(library, { type: 'fill', items }, 2)
    library = applyGuideAction(library, { type: 'save' }, 3)
    expect(library.saved[0]).toMatchObject({ name: 'Daft Punk', items })
    library = applyGuideAction(library, { type: 'rename', name: 'Robots' }, 4)
    expect(library.saved[0].name).toBe('Robots')
    const errors: string[] = []
    checkGuides(JSON.parse(JSON.stringify(buildGuidesExport(library))), 'guides', errors)
    expect(errors).toEqual([])
  })
})

describe('search scope follows the network as it is now', () => {
  afterAll(() => {
    installCuratedEdits([], new Map())
    installUserCatalogue([], new Map())
  })

  it('respects a curator override, never searches disabled channels, and includes User Channel podcast episodes', () => {
    const shipped = shippedChannel(555)!
    const own: ChannelSource = { id: 'mine', kind: 'youtube', url: 'https://www.youtube.com/channel/UCdddddddddddddddddddddd', ref: 'UCdddddddddddddddddddddd', label: 'Fan', enabled: true, videos: [{ id: 'ddddddddddd', title: 'Daft Punk fan edit', durationSec: 600 }] }
    const built = buildCuratedEdit(shipped, { channelNumber: 555, name: 'Daft Punk', sources: [{ ...tvnSource(), enabled: false }, own], savedAt: 1 }, new Set(), [])
    installCuratedEdits([built.channel], new Map([[built.channel.id, built.programmes as Programme[]]]))
    const radio: Channel = { ...shipped, id: 'user-1001', number: 1001, name: 'Example Radio', origin: 'user-import', customLineup: undefined }
    const episode: Programme = { id: 'ep2', title: 'Episode 2: Ancient Rome', description: '', videoId: null, mediaUrl: 'https://cdn.radio-example.org/ep2.mp3', durationSeconds: 3723, channelId: radio.id, category: radio.category, source: 'imported', kind: 'programme', playbackMode: 'linear', creator: 'Example Radio' }
    const off: Channel = { ...radio, id: 'user-1002', number: 1002, name: 'Rome Hidden', enabled: false }
    installUserCatalogue([radio, off], new Map([[radio.id, [episode]], [off.id, [{ ...episode, id: 'ep9', channelId: off.id }]]]))
    const channels = searchChannels(() => undefined, new Set())
    expect(channels.find((item) => item.number === 555)?.programmes.map((item) => item.videoId)).toEqual(['ddddddddddd'])
    expect(channels.some((item) => item.number === 1002)).toBe(false)
    const guide = buildSearchGuide(buildSearchIndex(channels), 'Ancient Rome')
    expect(guide.picks.some((pick) => pick.entry.programme.mediaUrl === episode.mediaUrl)).toBe(true)
  }, 120_000)
})

describe('a podcast as a new User Channel', () => {
  it('is named from its publisher, keeps the canonical feed, and plays its episodes as audio', () => {
    const feed = {
      feedUrl: 'https://www.radio-example.org/feed/podcast/',
      website: 'https://www.radio-example.org/',
      title: 'Example Radio',
      episodes: [{ id: 'pod-1', title: 'Episode 2: Ancient Rome', durationSec: 3723, media: 'https://cdn.radio-example.org/ep2.mp3', published: '2026-09-01' }],
    }
    const result = addPodcastChannel([], feed, 1)
    expect(result).toMatchObject({ status: 'added', number: 1001 })
    expect(result.sources[0]).toMatchObject({ name: 'Example Radio', channelSources: [{ kind: 'podcast', url: feed.feedUrl, label: 'Example Radio', info: { website: feed.website } }] })
    expect(addPodcastChannel(result.sources, feed, 2).status).toBe('duplicate')
    const built = channelsFromSources(result.sources)
    const [programme] = built.programmes.get(built.channels[0].id)!
    expect(built.channels[0].mediaKind).toBe('audio')
    expect(programme).toMatchObject({ title: 'Episode 2: Ancient Rome', mediaUrl: 'https://cdn.radio-example.org/ep2.mp3', videoId: null, durationSeconds: 3723 })
  })
})
