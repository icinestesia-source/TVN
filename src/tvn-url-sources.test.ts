import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { playbackCommand } from './player/command.ts'
import { routedPlayer, routeFor } from './player/routed.ts'
import type { PlayerHandle } from './player/types.ts'
import { vimeoEmbedSrc, vimeoIdOf } from './player/vimeo.ts'
import { classifySourceUrl } from './services/channel-sources.ts'
import { lookUpFeed, sourcePreviewLines } from './services/podcast-source.ts'
import { addPodcastChannel, addStreamChannel } from './services/user-network.ts'
import { buildUserNetworkExport, exportSource, publicMediaAddress, serialiseUserNetworkExport } from './services/user-network-export.ts'
import { readUserNetworkFile, recordsFromExport, resolveRestored } from './services/user-network-restore.ts'
import { addRoute, capabilitiesFor, describeSource, identifyUrl, INGEST_MESSAGE, PROVIDERS, UNSAFE_MESSAGE } from './sources/providers.ts'
import type { Programme } from './types/programme.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('identifying an address before anything is read', () => {
  it('sends YouTube to its lookup and every other public web address to the source reader', () => {
    expect(identifyUrl('@kexp')).toMatchObject({ route: 'youtube', provider: 'youtube' })
    expect(identifyUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toMatchObject({ route: 'youtube' })
    expect(identifyUrl('https://vimeo.com/1228694119')).toMatchObject({ route: 'reader', provider: 'vimeo' })
    expect(identifyUrl('odysee.com/@Odysee:8')).toMatchObject({ route: 'reader', provider: 'odysee' })
    expect(identifyUrl('https://www.bitchute.com/channel/bitchute/')).toMatchObject({ route: 'reader', provider: 'bitchute' })
    expect(identifyUrl('https://rumble.com/c/c-296012/videos')).toMatchObject({ route: 'reader', provider: 'rumble' })
    expect(identifyUrl('https://cdn.example.net/live.m3u8')).toMatchObject({ route: 'reader', provider: 'unknown' })
    expect(identifyUrl('radio.example.net:8000/stream')).toMatchObject({ route: 'reader' })
  })

  it('Edit Channel DETECT reads a video site channel as the reader does, whatever its path, never as a live stream', () => {
    for (const address of ['https://rumble.com/c/c-296012', 'https://rumble.com/c/c-296012/videos', 'rumble.com/user/example', 'https://vimeo.com/1228694119', 'https://odysee.com/@Odysee:8', 'https://www.bitchute.com/channel/bitchute/']) {
      expect(classifySourceUrl(address).kind).toBe('podcast')
    }
    expect(classifySourceUrl('radio.example.net:8000/stream').kind).toBe('audio')
  })

  it('refuses ingest addresses with what TVN needs instead, and unsafe schemes outright', () => {
    for (const ingest of ['rtmp://live.example.com/app/KEY', 'rtmps://a.rtmp.youtube.com/live2', 'srt://1.2.3.4:9000', 'rtsp://cam.example/1']) expect(() => identifyUrl(ingest)).toThrow(INGEST_MESSAGE)
    for (const unsafe of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', 'blob:https://x/1', 'about:blank']) expect(() => identifyUrl(unsafe)).toThrow(UNSAFE_MESSAGE)
    expect(() => addRoute('rtmp://live.example.com/app')).toThrow(/ingest address/)
    expect(addRoute('daft punk')).toBe('youtube')
  })

  it('describes each provider’s capabilities, and a live stream as unseekable', () => {
    expect(PROVIDERS.vimeo.capabilities).toMatchObject({ canEmbed: true, canSeek: true, canReadPublishedDate: true, canDetectLive: false })
    expect(PROVIDERS.dash.capabilities.canPlay).toBe(false)
    expect(capabilitiesFor('hls', 'live')).toMatchObject({ canPlay: true, canSeek: false, canDetectEnded: false, canDetectLive: true })
    expect(capabilitiesFor('hls', 'video').canSeek).toBe(true)
    expect(describeSource('vimeo', 'video')).toBe('Vimeo · Video')
    expect(describeSource('hls', 'live')).toBe('HLS · Live stream')
    expect(describeSource('direct', 'video', true)).toBe('Direct media · Audio')
    expect(describeSource('direct', 'live', true)).toBe('Direct media · Live stream')
  })
})

describe('what ADD shows and adds', () => {
  it('reads a provider’s video as programmes and a live stream as a stream, and says which', async () => {
    const vimeo = (async () =>
      json({
        feedUrl: 'https://vimeo.com/1111111',
        title: 'First Film',
        episodes: [{ id: 'vimeo-1111111', title: 'First Film', durationSec: 141, published: '2026-09-21', media: 'https://player.vimeo.com/video/1111111', type: 'video/vimeo' }],
        listed: 1,
        shape: 'feed',
        via: 'address',
        provider: 'vimeo',
        form: 'video',
      })) as unknown as typeof fetch
    const film = await lookUpFeed('https://vimeo.com/1111111', vimeo)
    expect(film).toMatchObject({ provider: 'vimeo', form: 'video' })
    expect(film.episodes[0]).toMatchObject({ media: 'https://player.vimeo.com/video/1111111', mediaKind: 'video', published: '2026-09-21' })
    expect(sourcePreviewLines(film)).toEqual([
      { label: 'Source', value: 'First Film' },
      { label: 'Type', value: 'Vimeo · Video' },
      { label: 'Found', value: '1 programme' },
    ])
    const hls = (async () => json({ feedUrl: 'https://cdn.example.net/live.m3u8', title: 'Example Live', episodes: [], listed: 0, shape: 'feed', via: 'address', provider: 'hls', form: 'live', live: { url: 'https://cdn.example.net/live.m3u8', media: 'video', format: 'hls' } })) as unknown as typeof fetch
    const live = await lookUpFeed('https://cdn.example.net/live.m3u8', hls)
    expect(live).toMatchObject({ provider: 'hls', form: 'live', episodes: [], live: { url: 'https://cdn.example.net/live.m3u8', format: 'hls' } })
    expect(sourcePreviewLines(live).map((line) => line.value)).toEqual(['Example Live', 'HLS · Live stream', 'Video, joined live'])
  })

  it('puts a live stream on a channel of its own, once', () => {
    const first = addStreamChannel([], { url: 'https://cdn.example.net/live.m3u8', title: 'Example Live', kind: 'video-hls' }, 1)
    expect(first.status).toBe('added')
    const record = first.sources.find((source) => source.channelNumber === first.number)
    expect(record).toMatchObject({ name: 'Example Live', automatic: true, channelSources: [{ kind: 'video-hls', url: 'https://cdn.example.net/live.m3u8' }] })
    expect(record?.id).toMatch(/^stream:[0-9a-z]+$/)
    expect(addStreamChannel(first.sources, { url: 'https://cdn.example.net/live.m3u8', title: 'Again', kind: 'video-hls' }, 2)).toMatchObject({ status: 'duplicate', number: first.number })
  })

  it('exports a provider source with its episodes’ public files, never a signed or expiring one', () => {
    const exported = exportSource(
      {
        id: 's1',
        kind: 'podcast',
        url: 'https://odysee.com/@Example:1',
        label: 'Example',
        enabled: true,
        videos: [
          { id: 'x', title: 'A', durationSec: 60, media: 'https://odysee.com/$/rss/media/a/b/c.mp4', mediaKind: 'video' },
          { id: 'y', title: 'B', durationSec: 60, media: 'https://cdn.example.net/b.mp4?Expires=1&Signature=abc' },
          { id: 'z', title: 'C', durationSec: 60, media: 'https://cdn.example.net/c.mp3?token=abc' },
        ],
        status: { state: 'ready', checkedAt: 1 },
      },
      () => null,
    )
    expect(exported).toMatchObject({ sourceType: 'podcast', url: 'https://odysee.com/@Example:1' })
    expect(exported.videos).toEqual([
      { id: 'x', title: 'A', durationSec: 60, media: 'https://odysee.com/$/rss/media/a/b/c.mp4', mediaKind: 'video' },
      { id: 'y', title: 'B', durationSec: 60 },
      { id: 'z', title: 'C', durationSec: 60 },
    ])
    expect(publicMediaAddress('https://user:pw@cdn.example.net/a.mp4')).toBe('')
    expect(publicMediaAddress('https://cdn.example.net/a.mp4?X-Amz-Signature=1')).toBe('')
    expect(publicMediaAddress('https://cdn.example.net/a.mp3?ver=2')).toBe('https://cdn.example.net/a.mp3?ver=2')
  })
})

describe('Complete Export and Restore', () => {
  it('carries a provider channel with its episodes and a live stream channel by address; restore airs them at once, then reads the provider again', async () => {
    const film = { id: 'vimeo-1111111', title: 'First Film', durationSec: 141, published: '2026-09-21', media: 'https://player.vimeo.com/video/1111111', mediaKind: 'video' as const }
    const withFilm = addPodcastChannel([], { feedUrl: 'https://vimeo.com/1111111', website: null, title: 'First Film', episodes: [film] }, 1)
    const withLive = addStreamChannel(withFilm.sources, { url: 'https://cdn.example.net/live.m3u8', title: 'Example Live', kind: 'video-hls' }, 2)
    const text = serialiseUserNetworkExport(buildUserNetworkExport(withLive.sources, new Date(3)))
    expect(text).toContain('"url": "https://vimeo.com/1111111"')
    expect(text).toContain('"sourceType": "video-hls"')
    expect(text).toContain('"media": "https://player.vimeo.com/video/1111111"')
    const file = readUserNetworkFile(text)
    expect(file.ok).toBe(true)
    if (!file.ok) return
    const offline = async () => {
      throw new Error('not asked')
    }
    const fromFile = await resolveRestored(recordsFromExport(file.value, 4), { resolveYouTube: offline, resolveFeed: offline }, 4, 4, { read: false })
    const aired = fromFile.records.flatMap((record) => record.channelSources ?? []).find((source) => source.kind === 'podcast')
    expect(aired?.videos).toEqual([film])
    expect(fromFile.records.find((record) => record.channelSources?.some((source) => source.kind === 'podcast'))?.videos).toEqual([film])
    const asked: string[] = []
    const resolved = await resolveRestored(recordsFromExport(file.value, 4), {
      resolveYouTube: async () => {
        throw new Error('not asked')
      },
      resolveFeed: async (url) => (asked.push(url), { feedUrl: url, episodes: [film] }),
    }, 4)
    expect(asked).toEqual(['https://vimeo.com/1111111'])
    const sources = resolved.records.flatMap((record) => record.channelSources ?? [])
    expect(sources.find((source) => source.kind === 'podcast')?.videos?.[0]).toMatchObject({ media: 'https://player.vimeo.com/video/1111111' })
    expect(sources.find((source) => source.kind === 'video-hls')).toMatchObject({ url: 'https://cdn.example.net/live.m3u8' })
  })
})

describe('playing a Vimeo video behind TVN’s glass', () => {
  const programme = (mediaUrl: string) => ({ id: 'p', title: 'T', description: '', videoId: null, mediaUrl, durationSeconds: 141, mediaDurationSeconds: 141 }) as unknown as Programme

  it('routes only Vimeo’s own player address to the embed, and starts it at the broadcast position', () => {
    expect(vimeoIdOf('https://player.vimeo.com/video/1111111')).toBe('1111111')
    expect(vimeoIdOf('https://evil.example/video/1111111')).toBeNull()
    expect(vimeoIdOf('https://player.vimeo.com/video/1111111?h=abc')).toBeNull()
    const command = playbackCommand(programme('https://player.vimeo.com/video/1111111'), 30, null)
    expect(routeFor(command)).toBe('embed')
    expect(routeFor(playbackCommand(programme('https://cdn.example.net/a.mp4'), 30, null))).toBe('local')
    expect(playbackCommand(programme('https://cdn.example.net/film.m3u8'), 30, null)).toMatchObject({ hls: true })
    expect(vimeoEmbedSrc('1111111', 30.4, false)).toMatch(/^https:\/\/player\.vimeo\.com\/video\/1111111\?autoplay=1&muted=0&controls=0&dnt=1.*#t=30s$/)
  })

  it('silences the other players when the embed takes over', async () => {
    const calls: string[] = []
    const fake = (name: string): PlayerHandle & { stop(): void } => ({
      load: async (request) => (calls.push(`${name}.load:${request.videoId ?? request.localUrl ?? 'silence'}`), 'playing'),
      play: () => undefined,
      pause: () => undefined,
      seek: () => undefined,
      setAudible: (audible) => void calls.push(`${name}.audible:${audible}`),
      currentTime: () => 0,
      actualVideoId: () => null,
      stop: () => void calls.push(`${name}.stop`),
    })
    const youtube = fake('youtube')
    const local = fake('local')
    const embed = fake('embed')
    const player = routedPlayer(() => youtube, () => local, () => undefined, () => embed)
    await player.load({ videoId: null, localUrl: 'https://player.vimeo.com/video/1111111', startSeconds: 0, loop: false })
    expect(calls).toEqual(['embed.audible:true', 'youtube.audible:false', 'local.audible:false', 'youtube.load:silence', 'local.stop', 'embed.load:https://player.vimeo.com/video/1111111'])
  })

  it('keeps the provider player under the glass, sandboxed and with its own controls off', () => {
    const stage = readFileSync('src/player/EmbedStage.tsx', 'utf8')
    expect(stage).toContain('sandbox="allow-scripts allow-same-origin allow-presentation"')
    expect(stage).toContain('event.origin !== VIMEO_ORIGIN')
    expect(readFileSync('src/styles/shell.css', 'utf8')).toMatch(/\.stage iframe,[\s\S]*?pointer-events: none/)
  })
})
