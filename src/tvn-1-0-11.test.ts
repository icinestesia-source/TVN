import { existsSync, readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChannelEditor } from './components/ChannelEditor.tsx'
import { lookUpChannel } from './services/add-channel.ts'
import {
  applyFilter,
  cleanEditorial,
  cleanFilter,
  eligibleOf,
  filterVerdict,
  previewFilter,
  videoYear,
  type SourceFilter,
} from './services/channel-curation.ts'
import { applyChannelEdit, editOf, keptOrder, rescanSources, widenSources, type ChannelEdit, type RescanDeps } from './services/channel-editor.ts'
import { addChannelFromFile, buildChannelFile, CHANNEL_FILE_FORMAT, readChannelFile, serialiseChannelFile, validateChannelFile } from './services/channel-file.ts'
import { inventoryOf, type ChannelSource } from './services/channel-sources.ts'
import { channelsFromSources, type ImportedVideo, type StoredSource } from './services/channels-import.ts'
import { saveCuratedEdit } from './services/curated-edits.ts'
import { EDITORIAL_MANIFEST_FORMAT, manifestText, userChannelManifest } from './services/editorial-manifest.ts'
import { buildUserNetworkExport, serialiseUserNetworkExport, validateUserNetworkExport } from './services/user-network-export.ts'
import { readUserNetworkFile, recordsFromExport, resolveRestored } from './services/user-network-restore.ts'
import type { Channel } from './types/channel.ts'

const NOW = Date.UTC(2026, 9, 2, 12)
const ARTIST = 'UCdaft00000000000000000a'

const id = (prefix: string, index: number) => `${prefix}${String(index).padStart(11 - prefix.length, '0')}`

/**
 * A large music source, shaped like a real artist's official channel: its recent uploads are mostly Shorts,
 * teasers, reactions and side projects; its career sits further back, much of it only in TVN's shipped back
 * catalogue. The fixture is named for the first test case; the code under test never sees the name.
 */
function artistFixture() {
  const recent: ImportedVideo[] = []
  for (let index = 0; index < 100; index += 1) {
    const kind = index % 5
    if (kind === 0) recent.push({ id: id('s', index), title: `Daft Punk studio moment #shorts ${index}`, durationSec: 75 })
    else if (kind === 1) recent.push({ id: id('t', index), title: `Random Access Memories anniversary teaser ${index}`, durationSec: 150 })
    else if (kind === 2) recent.push({ id: id('r', index), title: `Fans react to Daft Punk – reaction ${index}`, durationSec: 600 })
    else if (kind === 3) recent.push({ id: id('m', index), title: `Thomas Bangalter – Mythologies excerpt ${index}`, durationSec: 240 })
    else recent.push({ id: id('v', index), title: `Daft Punk – Lose Yourself to Dance (Visualizer ${2013 + (index % 10)}) take ${index}`, durationSec: 330 })
  }
  const career: [string, number][] = [
    ['Da Funk', 1995],
    ['Around the World', 1997],
    ['Burnin', 1997],
    ['Revolution 909', 1998],
    ['One More Time', 2000],
    ['Digital Love', 2001],
    ['Harder Better Faster Stronger', 2001],
    ['Something About Us', 2003],
    ['Robot Rock', 2005],
    ['Technologic', 2005],
    ['Derezzed', 2010],
    ['Get Lucky', 2013],
    ['Instant Crush', 2013],
  ]
  const archive: ImportedVideo[] = []
  career.forEach(([track, year], index) => {
    archive.push({ id: id('a', index), title: `Daft Punk - ${track} (Official Video ${year})`, durationSec: 240 + index * 10, published: '2009-10-01' })
    archive.push({ id: id('x', index), title: `Daft Punk - ${track} reaction stream`, durationSec: 900, published: '2014-01-01' })
  })
  archive.reverse()
  return { recent, archive }
}

const careerFilter: SourceFilter = {
  include: { terms: ['Daft Punk'], minSeconds: 120 },
  exclude: { terms: ['reaction', 'teaser'], shorts: true },
}

function youtubeSource(videos: ImportedVideo[], patch: Partial<ChannelSource> = {}): ChannelSource {
  return { id: 's1', kind: 'youtube', url: `https://www.youtube.com/channel/${ARTIST}`, label: 'Daft Punk', enabled: true, ref: ARTIST, youtube: 'channel', videos, ...patch }
}

function userChannel(number: number, sources: ChannelSource[], extra: Partial<StoredSource> = {}): StoredSource {
  return {
    id: `yt:${sources[0]?.ref ?? 'none'}`,
    name: 'Daft Punk',
    videos: inventoryOf(sources),
    channelNumber: number,
    inLibrary: false,
    automatic: true,
    updatedAt: 1,
    channelSources: sources,
    ...extra,
  }
}

const loopTitles = (record: StoredSource) => {
  const built = channelsFromSources([record])
  return built.programmes.get(`user-${record.id}`)!.map((programme) => programme.title)
}

describe('source filters', () => {
  const videos: ImportedVideo[] = [
    { id: 'aaaaaaaaaa1', title: 'Daft Punk - Da Funk (1995)', durationSec: 330 },
    { id: 'aaaaaaaaaa2', title: 'DAFT PUNK – Around the World', durationSec: 240, published: '2009-05-01' },
    { id: 'aaaaaaaaaa3', title: 'Daft Punk reaction', durationSec: 600 },
    { id: 'aaaaaaaaaa4', title: 'Daft Punk #shorts', durationSec: 90 },
    { id: 'aaaaaaaaaa5', title: 'Daft Punk teaser', durationSec: 45 },
    { id: 'aaaaaaaaaa6', title: 'Daft Punk Alive 2007 full concert', durationSec: 5400 },
    { id: 'aaaaaaaaaa7', title: 'Thomas Bangalter interview', durationSec: 1200 },
    { id: 'aaaaaaaaaa8', title: 'Daft Punk live', durationSec: 300, lists: ['PLlive000000000000'] },
  ]
  const ids = (filter: SourceFilter) => applyFilter(videos, filter).map((video) => video.id.slice(-1))

  it('include terms match any term, ignoring case and accents', () => {
    expect(ids({ include: { terms: ['daft punk'] } })).toEqual(['1', '2', '3', '4', '5', '6', '8'])
    expect(ids({ include: { terms: ['bangalter', 'alive'] } })).toEqual(['6', '7'])
    expect(filterVerdict(videos[6], { include: { terms: ['daft punk'] } })).toBe('No matching term or playlist')
  })

  it('exclude terms and Shorts always win', () => {
    expect(ids({ include: { terms: ['daft punk'] }, exclude: { terms: ['reaction'], shorts: true } })).toEqual(['1', '2', '6', '8'])
    expect(filterVerdict(videos[3], { exclude: { shorts: true } })).toBe('Short')
    expect(filterVerdict(videos[4], { exclude: { shorts: true } })).toBe('Short')
  })

  it('duration bounds keep programmes inside them', () => {
    expect(ids({ include: { minSeconds: 300, maxSeconds: 1200 } })).toEqual(['1', '3', '7', '8'])
    expect(filterVerdict(videos[5], { include: { maxSeconds: 3600 } })).toBe('Too long')
  })

  it('playlists select programmes found in them, alongside terms', () => {
    expect(ids({ include: { playlists: ['PLlive000000000000'] } })).toEqual(['8'])
    expect(ids({ include: { terms: ['bangalter'], playlists: ['PLlive000000000000'] } })).toEqual(['7', '8'])
  })

  it('era bounds use a year in the title or the upload date, and keep unknown years unless told', () => {
    expect(videoYear(videos[0])).toBe(1995)
    expect(videoYear(videos[1])).toBe(2009)
    expect(videoYear(videos[2])).toBeNull()
    expect(ids({ include: { yearFrom: 1990, yearTo: 2000 } })).toEqual(['1', '3', '4', '5', '7', '8'])
    expect(ids({ include: { yearFrom: 1990, yearTo: 2000, unknownYear: 'drop' } })).toEqual(['1'])
  })

  it('is a small structured schema: anything malformed is dropped, empty means none', () => {
    expect(cleanFilter({})).toBeUndefined()
    expect(cleanFilter({ include: { terms: ['  ', 'x'.repeat(200)] } })?.include?.terms?.[0]).toHaveLength(80)
    expect(cleanFilter({ include: { minSeconds: 600, maxSeconds: 60 } })).toEqual({ include: { minSeconds: 60, maxSeconds: 600 } })
    expect(cleanFilter({ include: { playlists: ['https://www.youtube.com/playlist?list=PLabcdefghij123', 'RDmix', 42] } })).toEqual({
      include: { playlists: ['PLabcdefghij123'] },
    })
    expect(cleanFilter({ include: { terms: 'Daft Punk', script: 'alert(1)' }, exclude: { shorts: 'yes' } })).toBeUndefined()
  })
})

describe('filters, modes and editorial notes persist on a user channel', () => {
  const { recent } = artistFixture()
  const base = () => [userChannel(1001, [youtubeSource(recent)])]

  it('save keeps the filter in canonical form, the mode when not recent, and the notes', () => {
    const edit = editOf(base()[0])
    const saved = applyChannelEdit(
      base(),
      1001,
      {
        ...edit,
        sources: [{ ...edit.sources[0], filter: { include: { terms: ['Daft Punk', 'daft punk'] }, exclude: { shorts: true } }, mode: 'all' }],
        editorial: { purpose: '  The whole career  ', tags: ['french house', 'French House'], targetHours: 12, gaps: '' },
      },
      NOW,
    )
    const record = JSON.parse(JSON.stringify(saved[0])) as StoredSource
    expect(record.channelSources?.[0].filter).toEqual({ include: { terms: ['Daft Punk'] }, exclude: { shorts: true } })
    expect(record.channelSources?.[0].mode).toBe('all')
    expect(record.editorial).toEqual({ purpose: 'The whole career', tags: ['french house'], targetHours: 12 })
    const reopened = editOf(record)
    expect(reopened.sources[0].filter).toEqual(record.channelSources?.[0].filter)
    expect(reopened.sources[0].mode).toBe('all')
    expect(reopened.editorial).toEqual(record.editorial)
    expect(record.videos.every((video) => /daft punk/i.test(video.title) && video.durationSec > 60)).toBe(true)
    expect(record.channelSources?.[0].videos).toHaveLength(recent.length)
  })

  it('recent is the default and is not written down', () => {
    const edit = editOf(base()[0])
    const saved = applyChannelEdit(base(), 1001, { ...edit, sources: [{ ...edit.sources[0], mode: 'recent' }] }, NOW)
    expect('mode' in (saved[0].channelSources?.[0] ?? {})).toBe(false)
    expect(saved[0].editorial).toBeUndefined()
  })

  it('a filter never removes what the source holds: clearing it brings everything back', () => {
    const edit = editOf(base()[0])
    const filtered = applyChannelEdit(base(), 1001, { ...edit, sources: [{ ...edit.sources[0], filter: careerFilter }] }, NOW)
    const cleared = applyChannelEdit(filtered, 1001, { ...editOf(filtered[0]), sources: [{ ...editOf(filtered[0]).sources[0], filter: undefined }] }, NOW)
    expect(filtered[0].videos.length).toBeLessThan(recent.length)
    expect(cleared[0].videos).toHaveLength(recent.length)
  })
})

describe('preview', () => {
  it('counts matches and exclusions with samples, and changes nothing', () => {
    const { recent } = artistFixture()
    const source = youtubeSource(recent)
    const edit: ChannelEdit = { name: 'Daft Punk', sources: [source], order: recent.slice(0, 5).map((video) => video.id) }
    const before = JSON.stringify(edit)
    const preview = previewFilter(source, careerFilter, 'recent')
    expect(preview.matches).toBe(20)
    expect(preview.excluded).toBe(80)
    expect(preview.matches + preview.excluded).toBe(recent.length)
    expect(preview.sample).toHaveLength(8)
    expect(preview.excludedSample.map((entry) => entry.reason)).toContain('Short')
    expect(JSON.stringify(edit)).toBe(before)
  })
})

describe('running order stays separate from filters', () => {
  it('the viewer’s order is kept for eligible programmes; a filtered-out programme leaves the loop, not the order’s arrangement', () => {
    const videos: ImportedVideo[] = ['a', 'b', 'c', 'd'].map((letter) => ({ id: letter.repeat(11), title: `Daft Punk ${letter}`, durationSec: 300 }))
    const order = ['dddddddddddd'.slice(0, 11), 'bbbbbbbbbbb', 'aaaaaaaaaaa', 'ccccccccccc']
    const source = youtubeSource(videos, { filter: { exclude: { terms: ['Daft Punk b'] } } })
    expect(keptOrder([source], order)).toEqual(['ddddddddddd', 'aaaaaaaaaaa', 'ccccccccccc'])
    const saved = applyChannelEdit([userChannel(1001, [youtubeSource(videos)])], 1001, { name: 'x', sources: [source], order }, NOW)
    expect(saved[0].runningOrder).toEqual(['ddddddddddd', 'aaaaaaaaaaa', 'ccccccccccc'])
    expect(loopTitles(saved[0])).toEqual(['Daft Punk d', 'Daft Punk a', 'Daft Punk c'])
    // Editorial notes never decide what plays.
    const noted = applyChannelEdit(saved, 1001, { ...editOf(saved[0]), editorial: { purpose: 'Only b', exclude: 'everything but b' } }, NOW)
    expect(loopTitles(noted[0])).toEqual(loopTitles(saved[0]))
  })
})

describe('source modes', () => {
  it('the lookup asks the server for everything only in ARCHIVE and ALL', async () => {
    const asked: string[] = []
    const read = (async (url: string) => {
      asked.push(url)
      return new Response(JSON.stringify({ channelId: ARTIST, title: 'x', videos: [{ id: 'aaaaaaaaaaa', title: 't', durationSec: 100 }] }))
    }) as unknown as typeof fetch
    await lookUpChannel('https://www.youtube.com/@x', read)
    await lookUpChannel('https://www.youtube.com/@x', read, { mode: 'archive' })
    await lookUpChannel('https://www.youtube.com/@x', read, { mode: 'all', fresh: true, now: () => 7 })
    expect(asked[0]).not.toContain('mode=')
    expect(asked[1]).toContain('&mode=archive')
    expect(asked[2]).toContain('&mode=all&refresh=7')
  })

  it('a rescan in ALL keeps what it found before, reads filter playlists and adds the shipped back catalogue; RECENT replaces', async () => {
    const calls: [string, unknown][] = []
    const deps: RescanDeps = {
      resolveYouTube: async (url, options) => {
        calls.push([url, options])
        if (url.includes('playlist?list=PLcareer')) return { channelId: 'PLcareer000000000', title: 'Career', videos: [{ id: 'pppppppppp1', title: 'Daft Punk - Teachers', durationSec: 260 }] }
        return { channelId: ARTIST, sourceType: 'youtube-channel', title: 'Daft Punk', videos: [{ id: 'nnnnnnnnnn1', title: 'Daft Punk new', durationSec: 300 }] }
      },
      probeStream: async () => 'online',
      archiveOf: () => [{ id: 'hhhhhhhhhh1', title: 'Daft Punk - Da Funk (1995)', durationSec: 330, published: '2009-10-01' }],
    }
    const held = [{ id: 'oooooooooo1', title: 'Daft Punk old find', durationSec: 300 }]
    const [all] = await rescanSources([youtubeSource(held, { mode: 'all', filter: { include: { playlists: ['PLcareer000000000'] } } })], deps, NOW)
    expect(calls[0]).toEqual([`https://www.youtube.com/channel/${ARTIST}`, { mode: 'all' }])
    expect(calls[1]).toEqual(['https://www.youtube.com/playlist?list=PLcareer000000000', { mode: 'all' }])
    expect(all.videos?.map((video) => video.id)).toEqual(['nnnnnnnnnn1', 'oooooooooo1', 'pppppppppp1', 'hhhhhhhhhh1'])
    expect(all.videos?.find((video) => video.id === 'pppppppppp1')?.lists).toEqual(['PLcareer000000000'])
    expect(eligibleOf(all).map((video) => video.id)).toEqual(['pppppppppp1'])
    calls.length = 0
    const [recent] = await rescanSources([youtubeSource(held)], deps, NOW)
    expect(calls).toEqual([[`https://www.youtube.com/channel/${ARTIST}`, undefined]])
    expect(recent.videos?.map((video) => video.id)).toEqual(['nnnnnnnnnn1'])
  })
})

describe('Daft Punk fixture: a curated timeless channel from a large music source', () => {
  const { recent, archive } = artistFixture()
  const years = (titles: readonly string[]) => titles.map((title) => videoYear({ title })).filter((year): year is number => year !== null)

  it('RECENT (the original behaviour) opens on the newest uploads, noise included', () => {
    const titles = loopTitles(userChannel(1001, [youtubeSource(recent)]))
    expect(titles.slice(0, 10).some((title) => /#shorts|reaction|teaser|Bangalter/.test(title))).toBe(true)
    expect(years(titles.slice(0, 10)).every((year) => year >= 2013)).toBe(true)
  })

  it('ALL with a career filter selects historical matching programmes across the career, without Shorts or noise', () => {
    const sources = widenSources([youtubeSource(recent, { mode: 'all', filter: careerFilter })], () => archive)
    const [record] = applyChannelEdit([userChannel(1001, [youtubeSource(recent)])], 1001, { name: 'Daft Punk', sources }, NOW)
    const titles = loopTitles(record)
    expect(titles.length).toBe(20 + 13)
    expect(titles.every((title) => /daft punk/i.test(title) && !/#shorts|reaction|teaser/i.test(title))).toBe(true)
    expect(new Set(titles).size).toBe(titles.length)
    const career = years(titles)
    expect(Math.min(...career)).toBe(1995)
    expect(Math.max(...career)).toBeGreaterThanOrEqual(2013)
    // The opening stretch of the loop already spans the career, not just the newest uploads.
    const opening = years(titles.slice(0, 8))
    expect(opening.some((year) => year <= 2001)).toBe(true)
    expect(opening.some((year) => year >= 2013)).toBe(true)
  })

  it('the selection is generic: nothing in the curation code names an artist', () => {
    for (const file of ['src/services/channel-curation.ts', 'src/services/channel-editor.ts', 'src/services/channels-import.ts', 'src/components/ChannelCuration.tsx', 'server/youtube-channel.ts']) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/\bdaft\b|\bpunk\b/i)
    }
  })
})

describe('EXPORT CHANNEL · tvn-channel-v1', () => {
  const { recent } = artistFixture()
  const record = (): StoredSource => {
    const [saved] = applyChannelEdit(
      [userChannel(1004, [youtubeSource(recent)], { owner: 'u-abc' })],
      1004,
      {
        name: 'Daft Punk',
        sources: [
          youtubeSource(recent.map((video) => ({ ...video, watched: true })), { mode: 'archive', filter: careerFilter, info: { website: 'https://daftpunk.com' } }),
          { id: 's2', kind: 'audio', url: 'https://radio.example/stream?token=abc&station=1', label: 'Radio', enabled: false },
        ],
        order: [recent[4].id, recent[9].id],
        editorial: { purpose: 'The career', include: 'official videos', exclude: 'reactions', gaps: '1993–1995 demos', eras: '1995–2013', tags: ['house'], targetHours: 8, targetProgrammes: 60 },
      },
      NOW,
    )
    return saved
  }

  it('carries the channel, its filters, modes, notes and running order, and nothing private', () => {
    const file = buildChannelFile(record(), new Date(NOW))
    const text = serialiseChannelFile(file)
    expect(file.format).toBe(CHANNEL_FILE_FORMAT)
    expect(file.channel.editorial).toMatchObject({ purpose: 'The career', gaps: '1993–1995 demos', targetHours: 8 })
    expect(file.channel.sources[0]).toMatchObject({ sourceType: 'youtube-channel', mode: 'archive', filter: careerFilter })
    expect(file.channel.runningOrder?.slice(0, 2)).toEqual([recent[4].id, recent[9].id])
    expect(file.channel.runningOrder).toHaveLength(20)
    expect(file.facts?.programmeCount).toBe(20)
    expect('owner' in file.channel).toBe(false)
    expect(text).not.toMatch(/watched|token=|AIza|ya29|password|secret|u-abc/)
    expect(file.channel.sources[1].url).toBe('https://radio.example/stream?station=1')
    expect(validateChannelFile(JSON.parse(text)).ok).toBe(true)
  })

  it('refuses a TVN channel and a file holding a key', () => {
    expect(() => buildChannelFile({ ...record(), channelNumber: 42 }, new Date(NOW))).toThrow()
    const file = JSON.parse(serialiseChannelFile(buildChannelFile(record(), new Date(NOW))))
    file.channel.sources[0].label = `AIza${'x'.repeat(35)}`
    expect(readChannelFile(JSON.stringify(file)).ok).toBe(false)
    file.channel.sources[0].label = 'ok'
    file.channel.sources[0].filter = { include: { terms: 'x' } }
    expect(readChannelFile(JSON.stringify(file)).ok).toBe(false)
  })

  it('imports on the lowest free user number, beside the original, and round-trips', async () => {
    const original = record()
    const file = readChannelFile(serialiseChannelFile(buildChannelFile(original, new Date(NOW))))
    if (!file.ok) throw new Error(file.errors.join())
    const existing = [original, userChannel(1001, [youtubeSource(recent, { ref: 'UCother000000000000000a' })], { id: 'yt:UCother000000000000000a' })]
    const before = JSON.stringify(existing)
    const added = addChannelFromFile(existing, file.value, 'u-new', NOW)
    expect(JSON.stringify(existing)).toBe(before)
    expect(added.number).toBe(1002)
    expect(added.sources.slice(0, 2)).toEqual(existing)
    expect(added.record.id).not.toBe(original.id)
    expect(added.record.owner).toBe('u-new')
    const resolved = await resolveRestored([added.record], { resolveYouTube: async () => ({ channelId: ARTIST, title: 'Daft Punk', videos: recent }) }, NOW)
    const back = resolved.records[0]
    expect(back.name).toBe('Daft Punk')
    expect(back.editorial).toEqual(original.editorial)
    expect(back.runningOrder).toEqual(original.runningOrder)
    expect(back.channelSources?.[0]).toMatchObject({ filter: careerFilter, mode: 'archive', ref: ARTIST })
    expect(back.videos.map((video) => video.id)).toEqual(original.videos.map((video) => video.id))
  })

  it('an empty user slot is filled first; nothing else is replaced', () => {
    const file = buildChannelFile(record(), new Date(NOW))
    const slot: StoredSource = { id: 'slot:1001', name: 'Empty channel', videos: [], channelNumber: 1001, inLibrary: false, automatic: true, updatedAt: 1, channelSources: [], emptySlot: true }
    const added = addChannelFromFile([slot, record()], file, 'tvn', NOW)
    expect(added.number).toBe(1001)
    expect(added.sources).toHaveLength(2)
    expect(added.record.owner).toBeUndefined()
  })

  it('arrives through + → Import channel list, which keeps reading channel lists', () => {
    const guide = readFileSync('src/components/Guide.tsx', 'utf8')
    expect(guide).toContain('text.includes(CHANNEL_FILE_FORMAT)')
    expect(guide).toContain('tv.importChannelFile(text, listOwner ?? TVN_OWNER)')
    expect(guide).toContain('channelLinksFrom(text)')
    expect(guide).toContain('parseChannelsExport(text)')
  })

  it('writes a readable manifest with every section', () => {
    const text = manifestText(userChannelManifest(record()), record())
    for (const heading of ['# CHANNEL 1004', '## PURPOSE', '## CURRENT SOURCES', '## FILTERS', '## PROGRAMMES', '## HOURS', '## PROGRAMME TYPES', '## EDITORIAL NOTES', '## KNOWN GAPS', '## TARGETS']) {
      expect(text).toContain(heading)
    }
    expect(text).toContain('include titles containing: Daft Punk')
    expect(text).toContain('exclude Shorts')
    expect(text).not.toMatch(/token=|AIza/)
  })
})

describe('User Network export compatibility', () => {
  const { recent } = artistFixture()

  it('round-trips filters, modes and editorial notes', () => {
    const [saved] = applyChannelEdit(
      [userChannel(1001, [youtubeSource(recent)])],
      1001,
      { name: 'Daft Punk', sources: [youtubeSource(recent, { filter: careerFilter, mode: 'all' })], editorial: { purpose: 'Career', tags: ['house'], targetProgrammes: 40 } },
      NOW,
    )
    const collection: StoredSource = { id: 'src:list', name: 'List', videos: recent.slice(0, 3), channelNumber: 1002, inLibrary: true, automatic: true, updatedAt: 1, editorial: { gaps: 'More' } }
    const text = serialiseUserNetworkExport(buildUserNetworkExport([saved, collection], new Date(NOW)))
    const read = readUserNetworkFile(text)
    if (!read.ok) throw new Error(read.errors.join())
    const [back, list] = recordsFromExport(read.value, NOW)
    expect(back.editorial).toEqual(saved.editorial)
    expect(back.channelSources?.[0]).toMatchObject({ filter: careerFilter, mode: 'all' })
    expect(list.editorial).toEqual({ gaps: 'More' })
  })

  it('a file from before curation is still valid and restores as it always did', () => {
    const legacy = {
      format: 'tvn-user-network-v1',
      version: 1,
      exportedAt: '2026-09-01T00:00:00.000Z',
      numbering: { first: 1001, limit: 10000 },
      channels: [
        { number: 1001, name: 'Alpha', state: 'populated', enabled: true, edited: false, sources: [{ sourceType: 'youtube-channel', url: `https://www.youtube.com/channel/${ARTIST}`, providerId: ARTIST, label: 'Alpha', enabled: true }] },
        { number: 1002, name: 'Empty channel', state: 'empty', enabled: true, edited: false, sources: [] },
      ],
    }
    const checked = validateUserNetworkExport(legacy)
    expect(checked.ok).toBe(true)
    const [alpha, empty] = recordsFromExport(legacy as never, NOW)
    expect(alpha).toMatchObject({ id: `yt:${ARTIST}`, sourceType: 'youtube-channel' })
    expect(alpha.channelSources).toBeUndefined()
    expect(alpha.editorial).toBeUndefined()
    expect(empty.emptySlot).toBe(true)
  })

  it('refuses malformed curation rather than guessing', () => {
    const bad = (patch: object) =>
      validateUserNetworkExport({
        format: 'tvn-user-network-v1',
        version: 1,
        exportedAt: '2026-09-01T00:00:00.000Z',
        numbering: { first: 1001, limit: 10000 },
        channels: [{ number: 1001, name: 'A', state: 'populated', enabled: true, edited: true, sources: [{ sourceType: 'youtube-channel', url: `https://www.youtube.com/channel/${ARTIST}`, label: 'A', enabled: true }], ...patch }],
      }).ok
    expect(bad({})).toBe(true)
    expect(bad({ editorial: { purpose: 5 } })).toBe(false)
    expect(bad({ editorial: { script: 'x' } })).toBe(false)
    expect(bad({ sources: [{ sourceType: 'youtube-channel', url: `https://www.youtube.com/channel/${ARTIST}`, label: 'A', enabled: true, mode: 'everything' }] })).toBe(false)
    expect(bad({ sources: [{ sourceType: 'youtube-channel', url: `https://www.youtube.com/channel/${ARTIST}`, label: 'A', enabled: true, filter: { run: 'x' } }] })).toBe(false)
  })
})

describe('central channels 001–999 cannot be curated or rewritten from User Edit Channel', () => {
  const { recent } = artistFixture()

  it('a user edit for a curated number is refused even if a stored record claims it', () => {
    const claimed = userChannel(5, [youtubeSource(recent)])
    expect(() => applyChannelEdit([claimed], 5, { name: 'x', sources: [] }, NOW)).toThrow('no longer in your User Network')
    expect(() => applyChannelEdit([claimed], 999, { name: 'x', sources: [] }, NOW)).toThrow()
  })

  it('a TVN channel’s local override keeps filters, modes and notes (TVN 2.0)', () => {
    const memory = new Map<string, string>()
    const store = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value) }
    const saved = saveCuratedEdit(
      { number: 2, name: 'Two' },
      { name: 'Two', sources: [youtubeSource(recent, { filter: careerFilter, mode: 'all' })], editorial: { purpose: 'Rewrite Two' } },
      NOW,
      store,
    )
    const own = saved?.sources.find((source) => source.kind === 'youtube')
    expect(own?.filter).toEqual(careerFilter)
    expect(own?.mode).toBe('all')
    expect(saved?.editorial).toEqual({ purpose: 'Rewrite Two' })
  })

  it('the editor offers curation for both scopes and EXPORT CHANNEL for user channels only', () => {
    const [record] = applyChannelEdit([userChannel(1001, [youtubeSource(recent)])], 1001, { name: 'Daft Punk', sources: [youtubeSource(recent)] }, NOW)
    const channel = channelsFromSources([record]).channels[0] as Channel
    const edit = editOf(record)
    const render = (scope: 'user' | 'curated', number: number) =>
      renderToStaticMarkup(
        createElement(ChannelEditor, {
          channel: { ...channel, number },
          scope,
          initial: edit,
          onLoad: async () => edit,
          onSave: async () => '',
          onRescan: async () => ({ edit, message: '' }),
          onDelete: async () => '',
          onClose: () => {},
          onExport: async () => '',
        }),
      )
    const user = render('user', 1001)
    expect(user).toContain('Research · editorial')
    expect(user).toContain('Export channel')
    expect(user).toContain('Export manifest')
    const curated = render('curated', 42)
    expect(curated).toContain('Research · editorial')
    expect(curated).toContain('Export manifest')
    expect(curated).not.toContain('Export channel')
  })
})

describe('editorial manifest: current facts and editorial intent stay apart', () => {
  const { recent } = artistFixture()

  it('facts follow the sources and filters; intent is only what the owner wrote', () => {
    const plain = userChannel(1001, [youtubeSource(recent)])
    const manifest = userChannelManifest(plain)
    expect(manifest.format).toBe(EDITORIAL_MANIFEST_FORMAT)
    expect(Object.keys(manifest.current)).toEqual(expect.arrayContaining(['programmeCount', 'hours', 'sources', 'sourceConcentration']))
    expect(Object.keys(manifest.editorial)).toEqual(expect.arrayContaining(['purpose', 'include', 'exclude', 'desiredCoverage', 'gaps', 'eras', 'targets']))
    expect(Object.keys(manifest.current).some((key) => key in manifest.editorial)).toBe(false)
    expect(manifest.editorial.purpose).toBeNull()
    expect(manifest.current.programmeCount).toBe(100)

    const noted = { ...plain, editorial: cleanEditorial({ purpose: 'Career', targetHours: 10 }) }
    expect(userChannelManifest(noted).current).toEqual(manifest.current)
    expect(userChannelManifest(noted).editorial.purpose).toBe('Career')

    const filtered = userChannel(1001, [youtubeSource(recent, { filter: careerFilter })])
    expect(userChannelManifest(filtered).current.programmeCount).toBe(20)
    expect(userChannelManifest(filtered).editorial).toEqual(manifest.editorial)
    expect(userChannelManifest(filtered).current.sourceConcentration).toEqual({ largestSource: 's1', programmeShare: 1, hoursShare: 1 })
  })

  it('the central baseline leaves every purpose blank and keeps the two halves apart', () => {
    const path = 'reports/network-editorial/TVN_FULL_CHANNEL_MANIFEST.json'
    expect(existsSync(path)).toBe(true)
    const baseline = JSON.parse(readFileSync(path, 'utf8')) as { records: { channel_number: number }[]; manifests: { scope: string; current: object; editorial: { purpose: null } }[] }
    expect(baseline.records).toHaveLength(999)
    expect(baseline.records[0].channel_number).toBe(1)
    expect(baseline.manifests.every((entry) => entry.scope === 'central' && entry.editorial.purpose === null)).toBe(true)
  })
})
