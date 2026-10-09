import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { BRAND, STARTUP_COPY, StartupScreen } from './components/StartupScreen.tsx'
import { SLEEP_COPY } from './components/SleepScreen.tsx'
import { networkLabel } from './components/ProgrammeInfo.tsx'
import { adjacentChannel, channelByNumber, listChannels } from './data/catalogue.ts'
import { installUserCatalogue } from './data/user-overlay.ts'
import { playbackCommand } from './player/command.ts'
import { routeFor } from './player/routed.ts'
import { calculateSchedule } from './scheduler/calculate.ts'
import { SCHEDULE_EPOCH_MS } from './scheduler/epoch.ts'
import {
  channelsFromSources,
  mergeParsedExports,
  parseChannelsExport,
  planImport,
  type StoredSource,
} from './services/channels-import.ts'
import {
  isRefusalCode,
  learnRefusal,
  parsePlaybackManifest,
  refusedVideos,
  resetRefusalsForTests,
  setShippedRefusals,
} from './services/embed-refusals.ts'
import { resetArchiveForTests, setShippedArchive, uploaderArchive } from './services/user-archive.ts'
import { planArchive, runningOrder } from './services/user-depth.ts'
import { SESSION_CHANNEL_NUMBER } from './session/session-channel.ts'
import type { Channel } from './types/channel.ts'
import type { Programme } from './types/programme.ts'

const DAY = Date.UTC(2026, 8, 30, 5, 0, 0)
const texts = ['public/user-network/channels.txt', 'public/user-network/more-channels.txt'].map((path) => readFileSync(path, 'utf8'))
const sources: StoredSource[] = planImport([], mergeParsedExports(texts.map((text) => parseChannelsExport(text))), { library: true, automatic: true }, [], 1).sources
const shippedRefused = new Set(parsePlaybackManifest(JSON.parse(readFileSync('public/user-network/playback.json', 'utf8'))))
const archiveFile = JSON.parse(readFileSync('public/user-network/uploaders.json', 'utf8'))
setShippedArchive(archiveFile)
const built = channelsFromSources(sources, { refused: shippedRefused, archive: uploaderArchive })

/** Every video the collection's own uploader has published that the build may schedule. */
function uploaderVideos(source: StoredSource): Set<string> {
  return new Set([...source.videos.map((video) => video.id), ...(uploaderArchive(source)?.videos ?? []).map((video) => video.id)])
}

function channel(number: number): { channel: Channel; programmes: Programme[]; source: StoredSource } {
  const found = built.channels.find((entry) => entry.number === number)!
  return { channel: found, programmes: built.programmes.get(found.id) ?? [], source: sources.find((entry) => `user-${entry.id}` === found.id)! }
}

function airDay(target: Channel, programmes: readonly Programme[]): string[] {
  const aired: string[] = []
  for (let at = DAY; at < DAY + 86_400_000; ) {
    const snap = calculateSchedule({ channelId: target.id, phaseOffsetSeconds: target.phaseOffsetSeconds, programmes, epochMs: SCHEDULE_EPOCH_MS, nowMs: at })
    aired.push(snap.current.programme.videoId ?? '')
    at = snap.current.endMs + 1
  }
  return aired
}

function distinct(programmes: readonly Programme[]): number {
  return new Set(programmes.map((programme) => programme.videoId)).size
}

afterEach(() => {
  resetRefusalsForTests()
  setShippedArchive(archiveFile)
})

describe('TVN brand', () => {
  it('shows TVN on the startup screen, the sleep screen, the page title and the guide, not on each channel', () => {
    expect(BRAND).toBe('TVN')
    const markup = renderToStaticMarkup(createElement(StartupScreen, { phase: 'loading', progress: 0 }))
    expect(markup).toContain('LOADING TVN...')
    expect(markup).toContain('alt="TVN"')
    expect(markup).toContain(STARTUP_COPY.loading)
    expect(`${STARTUP_COPY.loading} ${STARTUP_COPY.failed} ${SLEEP_COPY.title}`).not.toMatch(/retro/i)
    const html = readFileSync('index.html', 'utf8')
    expect(html).toContain('<title>TVN</title>')
    expect(html).not.toMatch(/retro ?tv/i)
    expect(readFileSync('src/components/Guide.tsx', 'utf8')).toContain("['user', userNetworkName(undefined, tv.networkUsers)]")
    expect(networkLabel({ number: 101, origin: 'default' } as Channel)).toBeNull()
  })

  it('leaves no RetroTV product name in on-screen copy', () => {
    for (const path of ['src/components/TestCard.tsx', 'src/components/StartupScreen.tsx', 'src/components/SleepScreen.tsx', 'src/data/originals/originals.json']) {
      const visible = readFileSync(path, 'utf8').replace(/retrotv-originals-v1/g, '')
      expect(visible, path).not.toMatch(/RETRO ?TV|RetroTV|Retro TV/)
    }
  })
})

describe('User Network depth', () => {
  it('1015 no longer airs one programme all day', () => {
    const { channel: target, programmes, source } = channel(1015)
    expect(source.name).toBe('DflowHoops')
    expect(source.videos).toHaveLength(1)
    expect(distinct(programmes)).toBeGreaterThanOrEqual(8)
    expect(new Set(airDay(target, programmes)).size).toBeGreaterThanOrEqual(8)
    expect(programmes.some((programme) => programme.videoId === source.videos[0].id)).toBe(true)
    const own = uploaderVideos(source)
    expect(programmes.every((programme) => own.has(programme.videoId ?? ''))).toBe(true)
  })

  it('1036 no longer airs one programme all day and shows only Reaper uploads', () => {
    const { channel: target, programmes, source } = channel(1036)
    expect(source.name).toBe('Reaper')
    expect(distinct(programmes)).toBeGreaterThanOrEqual(8)
    expect(new Set(airDay(target, programmes)).size).toBeGreaterThanOrEqual(8)
    const own = uploaderVideos(source)
    expect(programmes.every((programme) => own.has(programme.videoId ?? ''))).toBe(true)
    expect(programmes.some((programme) => programme.videoId === source.videos[0].id)).toBe(true)
  })

  it('1039 carries only Reservoir Reels, whose uploads all refuse embedding, and says so', () => {
    const { channel: target, programmes, source } = channel(1039)
    expect(source.name).toBe('Reservoir Reels')
    expect(uploaderArchive(source)?.videos).toEqual([])
    expect(programmes.map((programme) => programme.videoId).sort()).toEqual(source.videos.map((video) => video.id).sort())
    expect(target.description).toContain('2 of its videos cannot play outside YouTube')
  })

  it('samples older uploads as well as the newest when topping up', () => {
    const own = [{ id: 'own', title: 'Own', durationSec: 600 }]
    const archive = Array.from({ length: 60 }, (_, index) => ({ id: `a${index}`, title: `Upload ${index}`, durationSec: 1200 }))
    const picked = planArchive(own, archive).map((video) => Number(video.id.slice(1)))
    expect(picked.length).toBeGreaterThanOrEqual(15)
    const recent = picked.filter((index) => index < 20).length
    expect(recent).toBeGreaterThan(picked.length / 2)
    expect(picked.some((index) => index >= 40)).toBe(true)
    expect(picked).toEqual([...picked].sort((left, right) => left - right))
  })

  it('airs every programme of a deep channel once a cycle: nothing repeats until everything has played', () => {
    const { programmes, source } = channel(built.channels.find((entry) => entry.name === 'NBA on ESPN')!.number)
    const count = (id: string) => programmes.filter((programme) => programme.videoId === id).length
    expect(count(source.videos[0].id)).toBe(1)
    expect(count(source.videos[source.videos.length - 1].id)).toBe(1)
    expect(new Set(programmes.map((programme) => programme.videoId)).size).toBe(programmes.length)
  })

  it('keeps every older playable video of a collection in rotation', () => {
    for (const target of built.channels) {
      const { programmes, source } = channel(target.number)
      const aired = new Set(programmes.map((programme) => programme.videoId))
      for (const video of source.videos) if (!shippedRefused.has(video.id)) expect(aired.has(video.id), `${target.number} ${video.id}`).toBe(true)
    }
  })

  it('never airs the same programme twice in a row when an alternative exists', () => {
    for (const target of built.channels) {
      const { programmes } = channel(target.number)
      if (distinct(programmes) < 2) continue
      const aired = airDay(target, programmes)
      for (let index = 1; index < aired.length; index += 1) expect(aired[index], `${target.number} at ${index}`).not.toBe(aired[index - 1])
    }
    const order = runningOrder(
      ['a', 'b', 'c', 'd', 'e'].map((key) => ({ key, item: key, repeat: false })),
      [],
    )
    for (let index = 0; index < order.length; index += 1) expect(order[index].key).not.toBe(order[(index + 1) % order.length].key)
  })

  it('spaces the second airing of a recent programme well apart from its first', () => {
    for (const target of built.channels) {
      const { programmes } = channel(target.number)
      const cycle = programmes.reduce((sum, programme) => sum + programme.durationSeconds, 0)
      const starts = new Map<string, number[]>()
      let at = 0
      for (const programme of programmes) {
        starts.set(programme.videoId ?? '', [...(starts.get(programme.videoId ?? '') ?? []), at])
        at += programme.durationSeconds
      }
      for (const [id, list] of starts) {
        if (list.length < 2) continue
        const gaps = list.map((start, index) => (index + 1 < list.length ? list[index + 1] - start : cycle - start + list[0]))
        expect(Math.min(...gaps) / cycle, `${target.number} ${id}`).toBeGreaterThanOrEqual(0.15)
      }
    }
  })

  it('corrects every thin channel whose uploader has more to show, through the one mechanism', () => {
    const thin = built.channels.filter((target) => channel(target.number).source.videos.length <= 3)
    expect(thin.length).toBeGreaterThan(20)
    const stillThin = thin.filter((target) => distinct(channel(target.number).programmes) <= 3)
    for (const target of stillThin) {
      const { programmes, source } = channel(target.number)
      const aired = new Set(programmes.map((programme) => programme.videoId))
      const unused = [...source.videos, ...(uploaderArchive(source)?.videos ?? [])].filter(
        (video) => !shippedRefused.has(video.id) && !aired.has(video.id),
      )
      expect(unused, target.name).toEqual([])
    }
  })

  it('schedules each channel only from its own uploader', () => {
    for (const target of built.channels) {
      const { programmes, source } = channel(target.number)
      const own = uploaderVideos(source)
      for (const programme of programmes) {
        expect(own.has(programme.videoId ?? ''), `${target.number} ${source.name} ${programme.videoId}`).toBe(true)
        expect(programme.source).toBe('imported')
      }
    }
  })

  it('maps every built-in collection to one uploader in the shipped archive', () => {
    for (const source of sources) expect(uploaderArchive(source), source.name).not.toBeNull()
  })

  it('keeps each channel to its own collection when no archive is shipped', () => {
    resetArchiveForTests()
    const bare = channelsFromSources(sources, { refused: shippedRefused, archive: uploaderArchive })
    for (const target of bare.channels) {
      const source = sources.find((entry) => `user-${entry.id}` === target.id)!
      const ids = new Set(source.videos.map((video) => video.id))
      for (const programme of bare.programmes.get(target.id) ?? []) expect(ids.has(programme.videoId ?? '')).toBe(true)
    }
  })
})

describe('1053 and 1054 playback', () => {
  it('ships the embed refusals found for the built-in User Network, with no key', () => {
    const raw = readFileSync('public/user-network/playback.json', 'utf8')
    expect(raw).not.toMatch(/AIza/)
    expect(shippedRefused.size).toBe(19)
  })

  it('1053 schedules only videos that may play embedded and routes them to the YouTube player', () => {
    const { channel: target, programmes, source } = channel(1053)
    expect(source.name).toBe('VintageVerse')
    expect(source.videos.filter((video) => shippedRefused.has(video.id))).toHaveLength(13)
    expect(programmes.some((programme) => programme.videoId === 'Bu9SOZwn2Oo')).toBe(true)
    expect(programmes.every((programme) => !shippedRefused.has(programme.videoId ?? ''))).toBe(true)
    expect(distinct(programmes)).toBeGreaterThanOrEqual(8)
    const own = uploaderVideos(source)
    expect(programmes.every((programme) => own.has(programme.videoId ?? ''))).toBe(true)
    const snap = calculateSchedule({ channelId: target.id, phaseOffsetSeconds: target.phaseOffsetSeconds, programmes, epochMs: SCHEDULE_EPOCH_MS, nowMs: DAY })
    const command = playbackCommand(snap.current.programme, snap.current.seekSeconds, null)
    expect(command.kind).toBe('real')
    expect(command.videoId).toBe(snap.current.programme.videoId)
    expect(routeFor(command)).toBe('youtube')
    expect(target.description).toContain('13 of its videos cannot play outside YouTube')
  })

  it('1054 keeps its own two refused films rather than another channel, and says why', () => {
    const { channel: target, programmes, source } = channel(1054)
    expect(source.name).toBe('VintageVerse Vault')
    expect(source.videos.every((video) => shippedRefused.has(video.id))).toBe(true)
    expect(uploaderArchive(source)?.videos).toEqual([])
    expect(programmes.map((programme) => programme.videoId).sort()).toEqual(source.videos.map((video) => video.id).sort())
    expect(target.description).toContain('2 of its videos cannot play outside YouTube')
    const snap = calculateSchedule({ channelId: target.id, phaseOffsetSeconds: target.phaseOffsetSeconds, programmes, epochMs: SCHEDULE_EPOCH_MS, nowMs: DAY })
    expect(routeFor(playbackCommand(snap.current.programme, snap.current.seekSeconds, null))).toBe('youtube')
  })

  it('learns a refusal from the player and rebuilds without that video', () => {
    expect(isRefusalCode('150')).toBe(true)
    expect(isRefusalCode('101')).toBe(true)
    expect(isRefusalCode('100')).toBe(true)
    expect(isRefusalCode('5')).toBe(false)
    expect(isRefusalCode('timeout')).toBe(false)
    setShippedRefusals(shippedRefused)
    const { source } = channel(1015)
    const only = source.videos[0].id
    expect(learnRefusal(only)).toBe(true)
    expect(learnRefusal(only)).toBe(false)
    const rebuilt = channelsFromSources(sources, { refused: refusedVideos(), archive: uploaderArchive })
    const list = rebuilt.programmes.get(`user-${source.id}`) ?? []
    expect(list.some((programme) => programme.videoId === only)).toBe(false)
    expect(distinct(list)).toBeGreaterThanOrEqual(8)
  })

  it('keeps a collection with no playable or related video listed so the card can explain it', () => {
    const lone: StoredSource = {
      id: 'src:lone',
      name: 'Lone Uploader',
      videos: [{ id: 'zzLone00001', title: 'Untitled upload', durationSec: 600 }],
      channelNumber: 1001,
      inLibrary: true,
      automatic: true,
      updatedAt: 1,
    }
    const result = channelsFromSources([lone], { refused: new Set(['zzLone00001']) })
    expect(result.programmes.get('user-src:lone')?.map((programme) => programme.videoId)).toEqual(['zzLone00001'])
    expect(result.channels[0].description).toContain('cannot play outside YouTube')
  })
})

describe('network domains after the fix', () => {
  it('keeps 000 TVN, 001-999 curated, 1000 Local Media and 1001+ user', () => {
    installUserCatalogue(built.channels, built.programmes)
    try {
      expect(channelByNumber(1000)?.origin).toBe('session')
      expect(channelByNumber(SESSION_CHANNEL_NUMBER)?.origin).toBe('session')
      expect(built.channels.map((entry) => entry.number)).toEqual(Array.from({ length: built.channels.length }, (_, index) => 1001 + index))
      const curated = listChannels().filter((entry) => entry.number >= 1 && entry.number < 991)
      expect(curated.every((entry) => entry.origin !== 'user-import' && entry.origin !== 'session')).toBe(true)
      expect(adjacentChannel(1001, -1).number).toBeLessThan(991)
      expect(adjacentChannel(1001, -1).number).toBeGreaterThanOrEqual(1)
    } finally {
      installUserCatalogue([], new Map())
    }
  })
})

describe('no runtime acquisition key', () => {
  const scan = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = `${dir}/${name}`
      if (statSync(path).isDirectory()) return scan(path)
      return /\.(ts|tsx|js|json|txt|html|css|svg|toml|md)$/.test(name) ? [path] : []
    })

  it('ships no Google API key and never calls the Data API from the app', () => {
    const roots = ['src', 'public', ...(existsSync('dist') ? ['dist'] : [])]
    for (const path of roots.flatMap(scan)) expect(readFileSync(path, 'utf8'), path).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/)
    for (const path of scan('src').filter((file) => !file.endsWith('.test.ts'))) {
      expect(readFileSync(path, 'utf8'), path).not.toContain('googleapis.com/youtube/v3')
    }
  })
})
