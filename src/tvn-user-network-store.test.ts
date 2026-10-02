import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { channelByNumber, adjacentChannel } from './data/catalogue.ts'
import { installUserCatalogue } from './data/user-overlay.ts'
import { lookUpChannel } from './services/add-channel.ts'
import { channelsFromSources, mergeParsedExports, parseChannelsExport, type StoredSource } from './services/channels-import.ts'
import { setShippedArchive, uploaderArchive, uploaderIdFor } from './services/user-archive.ts'
import { addChannelSource, channelLinksFrom, nextUserNumber, planTestChannels, removeUserChannels } from './services/user-network.ts'
import { SESSION_CHANNEL_NUMBER } from './session/session-channel.ts'

const stored = vi.hoisted(() => ({ sources: [] as unknown[] }))
vi.mock('./services/user-db.ts', () => ({
  loadStoredSources: async () => stored.sources,
  saveStoredSources: async (next: unknown[]) => {
    stored.sources = next
  },
}))

const testSet = mergeParsedExports(
  ['public/user-network/channels.txt', 'public/user-network/more-channels.txt'].map((path) => parseChannelsExport(readFileSync(path, 'utf8'))),
)
setShippedArchive(JSON.parse(readFileSync('public/user-network/uploaders.json', 'utf8')))

function source(id: string, name: string, number: number | null, videoId = `${id.replace(/\W/g, '').slice(0, 8).padEnd(8, 'x')}001`): StoredSource {
  return { id, name, videos: [{ id: videoId, title: `${name} video`, durationSec: 900 }], channelNumber: number, inLibrary: true, automatic: number !== null, updatedAt: 1 }
}

const added = (channelId: string, title: string) => ({
  channelId,
  title,
  videos: [
    { id: `${channelId.slice(2, 10)}001`, title: 'First', durationSec: 1200 },
    { id: `${channelId.slice(2, 10)}002`, title: 'Second', durationSec: 900 },
  ],
})

afterEach(() => {
  stored.sources = []
  installUserCatalogue([], new Map())
  vi.unstubAllGlobals()
})

describe('a new viewer', () => {
  it('loads only what is stored: bootstrap itself installs nothing (the starter network comes later, from the provider)', async () => {
    const { bootstrapUserNetwork } = await import('./data/user-network/bootstrap.ts')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    const result = await bootstrapUserNetwork()
    expect(result.sources).toEqual([])
    expect(stored.sources).toEqual([])
    const built = channelsFromSources(result.sources)
    expect(built.channels).toEqual([])
    const text = readFileSync('src/data/user-network/bootstrap.ts', 'utf8')
    const body = text.slice(text.indexOf('export async function bootstrapUserNetwork'))
    expect(body).not.toMatch(/readCatalogueTexts|applyBuiltInCatalogues|saveStoredSources/)
  })

  it('keeps the canonical domains with no user channels: 000 TVN, 001–999 curated, 1000 session', () => {
    installUserCatalogue([], new Map())
    expect(channelByNumber(1000)?.origin).toBe('session')
    expect(channelByNumber(1001)).toBeUndefined()
    expect(channelByNumber(SESSION_CHANNEL_NUMBER)?.origin).toBe('session')
    expect(adjacentChannel(SESSION_CHANNEL_NUMBER, 1).number).toBe(0)
    expect(adjacentChannel(0, 1).number).toBe(1)
    expect(adjacentChannel(1, -1).number).toBe(0)
    expect(adjacentChannel(0, -1).number).toBe(SESSION_CHANNEL_NUMBER)
  })
})

describe('an existing installation', () => {
  it('keeps every stored 1001+ channel exactly as it was', async () => {
    const mine = planTestChannels([], testSet, 5, uploaderIdFor).sources
    stored.sources = structuredClone(mine)
    const { bootstrapUserNetwork } = await import('./data/user-network/bootstrap.ts')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    const result = await bootstrapUserNetwork()
    expect(result.sources).toEqual(mine)
    expect(stored.sources).toEqual(mine)
    expect(channelsFromSources(result.sources).channels.map((channel) => channel.number)).toEqual(mine.map((entry) => entry.channelNumber))
  })
})

describe('LOAD TVN TEST CHANNELS', () => {
  it('installs the bundled set from 1001 for an empty network', () => {
    const plan = planTestChannels([], testSet, 5, uploaderIdFor)
    expect(plan.added).toEqual(Array.from({ length: testSet.sources.length }, (_, index) => 1001 + index))
    expect(plan.sources.map((entry) => entry.name)).toEqual(testSet.sources.map((entry) => entry.name))
  })

  it('appends after the viewer’s own channels without changing them, and never duplicates', () => {
    const own = [source('yt:UCown00000000000000000001', 'My Channel', 1001), source('src:reaper', 'Reaper', 1002)]
    const first = planTestChannels(own, testSet, 5, uploaderIdFor)
    expect(first.sources.slice(0, 2)).toEqual(own)
    expect(first.skipped).toBe(1)
    expect(first.added[0]).toBe(1003)
    expect(first.sources.filter((entry) => entry.name === 'Reaper')).toHaveLength(1)
    const again = planTestChannels(first.sources, testSet, 6, uploaderIdFor)
    expect(again.added).toEqual([])
    expect(again.sources).toEqual(first.sources)
  })

  it('skips a bundled collection whose uploader was already added by link', () => {
    const reaperId = uploaderIdFor('Reaper')!
    expect(reaperId).toMatch(/^UC/)
    const own = [source(`yt:${reaperId}`, 'Reaper (added)', 1001)]
    const plan = planTestChannels(own, testSet, 5, uploaderIdFor)
    expect(plan.sources.filter((entry) => entry.name === 'Reaper')).toHaveLength(0)
    expect(plan.skipped).toBe(1)
  })
})

describe('ADD CHANNEL', () => {
  it('adds a channel as the last user channel, after any gap', () => {
    const own = [source('src:a', 'A', 1001), source('src:c', 'C', 1004)]
    expect(nextUserNumber(own)).toBe(1005)
    expect(nextUserNumber([])).toBe(1001)
    const result = addChannelSource(own, added('UCnew00000000000000000001', 'New Channel'), 9)
    expect(result.status).toBe('added')
    expect(result.number).toBe(1005)
    expect(result.sources.slice(0, 2)).toEqual(own)
    expect(result.sources[2]).toMatchObject({ id: 'yt:UCnew00000000000000000001', name: 'New Channel', channelNumber: 1005, automatic: true })
  })

  it('refreshes a channel added again, keeping its number, and reports a bundled twin instead of duplicating it', () => {
    const first = addChannelSource([], added('UCnew00000000000000000001', 'New Channel'), 9)
    const second = addChannelSource(first.sources, { ...added('UCnew00000000000000000001', 'New Channel'), videos: [{ id: 'fresh000001', title: 'Fresh', durationSec: 700 }] }, 10)
    expect(second.status).toBe('updated')
    expect(second.number).toBe(1001)
    expect(second.sources).toHaveLength(1)
    expect(second.sources[0].videos.map((video) => video.id)).toEqual(['fresh000001'])
    const bundled = planTestChannels([], testSet, 5, uploaderIdFor).sources
    const reaperNumber = bundled.find((entry) => entry.name === 'Reaper')!.channelNumber
    const twin = addChannelSource(bundled, added(uploaderIdFor('Reaper')!, 'Reaper'), 11, uploaderIdFor)
    expect(twin).toMatchObject({ status: 'duplicate', number: reaperNumber })
    expect(twin.sources).toHaveLength(bundled.length)
  })

  it('schedules an added channel from its own uploads, and from its archive when TVN has one', () => {
    const reaperId = uploaderIdFor('Reaper')!
    const result = addChannelSource([], added(reaperId, 'Reaper'), 9)
    const built = channelsFromSources(result.sources, { archive: uploaderArchive })
    const list = built.programmes.get(built.channels[0].id) ?? []
    const allowed = new Set([...result.sources[0].videos.map((video) => video.id), ...(uploaderArchive(result.sources[0])?.videos ?? []).map((video) => video.id)])
    expect(list.length).toBeGreaterThan(2)
    expect(list.every((programme) => allowed.has(programme.videoId ?? ''))).toBe(true)
    expect(built.channels[0]).toMatchObject({ number: 1001, name: 'Reaper', origin: 'user-import' })
  })

  it('reads the lookup answer and passes its errors on in plain words', async () => {
    const answer = { channelId: 'UCnew00000000000000000001', title: 'New Channel', videos: [{ id: 'abcdefghij1', title: 'One', durationSec: 600 }, { id: 'bad' }] }
    const ok = await lookUpChannel('https://www.youtube.com/@new', (async (url: string) => {
      expect(url).toBe('/api/channel?url=https%3A%2F%2Fwww.youtube.com%2F%40new')
      return new Response(JSON.stringify(answer), { status: 200 })
    }) as typeof fetch)
    expect(ok.videos).toEqual([{ id: 'abcdefghij1', title: 'One', durationSec: 600 }])
    await expect(
      lookUpChannel('x', (async () => new Response(JSON.stringify({ error: 'That is not a YouTube channel or video link' }), { status: 400 })) as typeof fetch),
    ).rejects.toThrow('That is not a YouTube channel or video link')
  })
})

describe('channel list files', () => {
  it('accepts a list of links in three shapes and leaves TVN exports to the export reader', () => {
    expect(channelLinksFrom('["https://youtu.be/Bu9SOZwn2Oo", " @VintageVerseTV "]')).toEqual(['https://youtu.be/Bu9SOZwn2Oo', '@VintageVerseTV'])
    expect(channelLinksFrom('{"channels":["https://www.youtube.com/@a"]}')).toEqual(['https://www.youtube.com/@a'])
    expect(channelLinksFrom('{"channels":[{"url":"https://www.youtube.com/@a"}]}')).toEqual(['https://www.youtube.com/@a'])
    expect(channelLinksFrom(readFileSync('public/user-network/channels.txt', 'utf8'))).toBeNull()
    expect(channelLinksFrom('not json')).toBeNull()
  })
})

describe('removing user channels', () => {
  it('removes only the chosen channel, or everything when asked, and never on its own', () => {
    const own = [source('src:a', 'A', 1001), source('src:b', 'B', 1002), source('src:lib', 'Library only', null)]
    expect(removeUserChannels(own, [1002]).map((entry) => entry.id)).toEqual(['src:a', 'src:lib'])
    expect(removeUserChannels(own, [])).toEqual(own)
    expect(removeUserChannels(own, 'all')).toEqual([])
  })
})
