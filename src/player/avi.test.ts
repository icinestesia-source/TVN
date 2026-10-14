import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildSessionItems, isAviFile } from '../session/import.ts'
import { aviRoute, aviToFlv, mp3Frame, nalUnits, parseAviHeader } from './avi.ts'
import { scanFile } from './flv-index.ts'

/** Two seconds of 64×48 H.264 with B-frames (20 pictures at 10 a second) and MP3 sound, made by ffmpeg. */
const tiny = new Uint8Array(readFileSync('src/player/fixtures/tiny-h264-mp3.avi'))

/** The FLV's video tags: [keyframe, decode ms, composition offset ms]. */
async function videoTags(flv: Blob): Promise<[boolean, number, number][]> {
  const bytes = new Uint8Array(await flv.arrayBuffer())
  const tags: [boolean, number, number][] = []
  let at = 13
  while (at + 11 <= bytes.length) {
    const size = (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]
    const ms = ((bytes[at + 7] << 24) | (bytes[at + 4] << 16) | (bytes[at + 5] << 8) | bytes[at + 6]) >>> 0
    if (bytes[at] === 9 && bytes[at + 12] === 1) tags.push([bytes[at + 11] === 0x17, ms, (bytes[at + 13] << 16) | (bytes[at + 14] << 8) | bytes[at + 15]])
    at += 11 + size + 4
  }
  return tags
}

describe('AVI files in Import media', () => {
  it('reads the streams an AVI declares', () => {
    const header = parseAviHeader(tiny)
    expect(header?.streams.map((stream) => [stream.kind, stream.codec])).toEqual([
      ['video', 'H264'],
      ['audio', '55'],
    ])
    expect(header?.streams[0]).toMatchObject({ width: 64, height: 48, rate: 10, scale: 1 })
    expect(parseAviHeader(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBeNull()
  })

  it('repackages H.264 with MP3 or AAC itself, and leaves Xvid, Motion-JPEG and other sound to the converter', () => {
    const header = parseAviHeader(tiny)!
    expect(aviRoute(header)).toBe('flv')
    const as = (video: string, formatTag?: number, extra = new Uint8Array(0)) =>
      aviRoute({
        video: 0,
        audio: formatTag === undefined ? -1 : 1,
        streams: [
          { ...header.streams[0], codec: video },
          ...(formatTag === undefined ? [] : [{ ...header.streams[1], formatTag, extra, sampleSize: 0 }]),
        ],
      })
    expect(as('XVID', 0x55)).toBe('convert')
    expect(as('DX50', 0x55)).toBe('convert')
    expect(as('MJPG', 1)).toBe('convert')
    expect(as('H264', 1)).toBe('convert')
    expect(as('H264', 0xff, new Uint8Array([0x12, 0x10]))).toBe('flv')
    expect(as('avc1')).toBe('flv')
  })

  it('rewrites an H.264 AVI as an FLV that plays for the same time, with every picture in the order it is shown', async () => {
    const flv = await aviToFlv(new Blob([tiny]), parseAviHeader(tiny)!)
    const scan = await scanFile(flv)
    expect(scan?.hasVideo).toBe(true)
    expect(scan?.hasAudio).toBe(true)
    expect(scan?.duration).toBeGreaterThan(1.8)
    expect(scan?.duration).toBeLessThan(2.2)
    const tags = await videoTags(flv)
    expect(tags).toHaveLength(20)
    expect(tags[0][0]).toBe(true)
    expect(tags.map(([, ms]) => ms)).toEqual(tags.map((_, at) => at * 100))
    // Shown times (decode + offset) are each 100 ms apart once sorted: no picture lost or doubled.
    const shown = tags.map(([, ms, cts]) => ms + cts).sort((a, b) => a - b)
    expect(new Set(shown).size).toBe(20)
    expect(shown.at(-1)! - shown[0]).toBe(1900)
    expect(tags.some(([, , cts]) => cts > 0)).toBe(true)
  })

  it('finds NAL units in start-code and length-prefixed frames, and MP3 frame lengths', () => {
    expect(nalUnits(new Uint8Array([0, 0, 0, 1, 0x67, 1, 0, 0, 1, 0x68, 2])).map((unit) => [...unit])).toEqual([[0x67, 1], [0x68, 2]])
    expect(nalUnits(new Uint8Array([0, 0, 0, 2, 0x65, 9, 0, 0, 0, 1, 0x41]), 4).map((unit) => [...unit])).toEqual([[0x65, 9], [0x41]])
    expect(mp3Frame(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), 0)).toEqual({ bytes: 417, samples: 1152, rate: 44100 })
    expect(mp3Frame(new Uint8Array([0, 0, 0, 0]), 0)).toBeNull()
  })

  it('converts AVI files as they are imported, titled by their own name, and counts those that cannot be', async () => {
    const avi = new File([tiny], 'Holiday_1998.avi', { type: 'video/x-msvideo' })
    const broken = new File([new Uint8Array(16)], 'Broken.avi', { type: 'video/x-msvideo' })
    expect(isAviFile(avi)).toBe(true)
    expect(isAviFile(new File([], 'clip.mp4'))).toBe(false)
    const made: string[] = []
    const result = await buildSessionItems([avi, broken], {
      canPlay: () => true,
      convertAvi: async (file) => (file.size > 16 ? new File([await aviToFlv(file, parseAviHeader(tiny)!)], 'Holiday_1998.flv', { type: 'video/x-flv' }) : null),
      createUrl: (file, remux) => {
        made.push(`${file.name}:${remux}`)
        return 'blob:1'
      },
      revokeUrl: () => {},
      probe: async () => 2,
    })
    expect(made).toEqual(['Holiday_1998.flv:flv'])
    expect(result.items.map((item) => [item.title, item.remux])).toEqual([['Holiday 1998', 'flv']])
    expect(result.convert).toBe(1)
  })

  it('without a converter, an AVI is still counted as needing conversion', async () => {
    const result = await buildSessionItems([new File([tiny], 'a.avi')], { canPlay: () => true, createUrl: () => 'blob:1', revokeUrl: () => {}, probe: async () => 2 })
    expect(result.items).toEqual([])
    expect(result.convert).toBe(1)
  })

  it('loads the converter only when an AVI needs it, from TVN itself', () => {
    const provider = readFileSync('src/state/TvProvider.tsx', 'utf8')
    expect(provider).toMatch(/await import\('\.\.\/player\/avi-convert\.ts'\)/)
    const convert = readFileSync('src/player/avi-convert.ts', 'utf8')
    expect(convert).toMatch(/await import\('\.\/avi-ffmpeg\.ts'\)/)
    expect(convert).not.toMatch(/^import .*avi-ffmpeg/m)
    const ffmpeg = readFileSync('src/player/avi-ffmpeg.ts', 'utf8')
    expect(ffmpeg).toMatch(/@ffmpeg\/core\?url/)
    expect(ffmpeg).not.toMatch(/https?:\/\//)
  })
})
