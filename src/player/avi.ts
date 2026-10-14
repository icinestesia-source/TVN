import { displayRanks, PictureOrder, readAvcConfig, type AvcConfig } from './h264-order.ts'

/**
 * AVI, which no browser plays. One holding H.264 picture with MP3 or AAC sound is rewritten here as an FLV
 * (the same pictures and sound, repackaged), which TVN's FLV player then plays. Anything else (Xvid, DivX,
 * Motion-JPEG, other sound) is left to the in-page converter (avi-ffmpeg.ts).
 */
export interface AviStream {
  kind: 'video' | 'audio' | 'other'
  /** The picture's FourCC (H264, XVID…), or the sound's format tag in hex. */
  codec: string
  scale: number
  rate: number
  sampleSize: number
  width?: number
  height?: number
  formatTag?: number
  channels?: number
  sampleRate?: number
  /** The codec's own set-up bytes (an H.264 avcC or parameter sets; an AAC AudioSpecificConfig). */
  extra: Uint8Array
}

export interface AviHeader {
  streams: AviStream[]
  video: number
  audio: number
}

export type AviRoute = 'flv' | 'convert'

const H264_CODECS = new Set(['h264', 'x264', 'avc1', 'davc', 'vssh'])
const MP3 = 0x55
const AAC = 0xff

const fourcc = (bytes: Uint8Array, at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3])
const u32 = (bytes: Uint8Array, at: number) => (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
const u16 = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8)

/** The streams an AVI declares, from its opening bytes (its `hdrl` list); null when it is not an AVI. */
export function parseAviHeader(bytes: Uint8Array): AviHeader | null {
  if (bytes.length < 12 || fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'AVI ') return null
  const streams: AviStream[] = []
  const walk = (start: number, end: number) => {
    let at = start
    while (at + 8 <= end) {
      const id = fourcc(bytes, at)
      const size = u32(bytes, at + 4)
      const body = at + 8
      const stop = Math.min(body + size, end)
      if (id === 'LIST') {
        const type = fourcc(bytes, body)
        if (type === 'hdrl' || type === 'strl') walk(body + 4, stop)
        if (type === 'movi') return
      } else if (id === 'strh' && stop - body >= 48) {
        const type = fourcc(bytes, body)
        streams.push({
          kind: type === 'vids' ? 'video' : type === 'auds' ? 'audio' : 'other',
          codec: fourcc(bytes, body + 4),
          scale: u32(bytes, body + 20),
          rate: u32(bytes, body + 24),
          sampleSize: u32(bytes, body + 44),
          extra: new Uint8Array(0),
        })
      } else if (id === 'strf' && streams.length > 0) {
        const stream = streams[streams.length - 1]
        if (stream.kind === 'video' && stop - body >= 40) {
          const headerSize = Math.max(40, Math.min(u32(bytes, body), stop - body))
          stream.width = u32(bytes, body + 4)
          stream.height = Math.abs(u32(bytes, body + 8) | 0)
          stream.codec = fourcc(bytes, body + 16)
          stream.extra = bytes.slice(body + headerSize, stop)
        } else if (stream.kind === 'audio' && stop - body >= 16) {
          stream.formatTag = u16(bytes, body)
          stream.codec = stream.formatTag.toString(16)
          stream.channels = u16(bytes, body + 2)
          stream.sampleRate = u32(bytes, body + 4)
          const extraSize = stop - body >= 18 ? Math.min(u16(bytes, body + 16), stop - body - 18) : 0
          stream.extra = bytes.slice(body + 18, body + 18 + extraSize)
        }
      }
      at = body + size + (size & 1)
    }
  }
  walk(12, bytes.length)
  return { streams, video: streams.findIndex((stream) => stream.kind === 'video'), audio: streams.findIndex((stream) => stream.kind === 'audio') }
}

/** Whether TVN repackages this AVI itself, or hands it to the converter. */
export function aviRoute(header: AviHeader): AviRoute {
  const video = header.streams[header.video]
  if (!video || !H264_CODECS.has(video.codec.toLowerCase()) || !(video.rate > 0 && video.scale > 0)) return 'convert'
  const audio = header.streams[header.audio]
  if (!audio) return 'flv'
  if (audio.formatTag === MP3) return 'flv'
  if (audio.formatTag === AAC && audio.extra.length >= 2 && audio.sampleSize === 0) return 'flv'
  return 'convert'
}

/** The NAL units of one H.264 frame, in Annex B (start codes) or length-prefixed form. */
export function nalUnits(data: Uint8Array, lengthSize = 0): Uint8Array[] {
  const units: Uint8Array[] = []
  if (lengthSize > 0) {
    let at = 0
    while (at + lengthSize <= data.length) {
      let length = 0
      for (let index = 0; index < lengthSize; index += 1) length = length * 256 + data[at + index]
      units.push(data.subarray(at + lengthSize, Math.min(data.length, at + lengthSize + length)))
      at += lengthSize + length
    }
    return units.filter((unit) => unit.length > 0)
  }
  let start = -1
  let index = 0
  while (index + 2 < data.length) {
    if (data[index] === 0 && data[index + 1] === 0 && data[index + 2] === 1) {
      if (start >= 0) {
        let end = index
        while (end > start && data[end - 1] === 0) end -= 1
        units.push(data.subarray(start, end))
      }
      index += 3
      start = index
    } else index += 1
  }
  if (start >= 0 && start < data.length) units.push(data.subarray(start))
  return units.filter((unit) => unit.length > 0)
}

/** Length-prefixed (4 bytes) frame data, without parameter sets, delimiters or filler. */
function avccSample(units: readonly Uint8Array[]): Uint8Array {
  const kept = units.filter((unit) => ![7, 8, 9, 12].includes(unit[0] & 31))
  const out = new Uint8Array(kept.reduce((sum, unit) => sum + 4 + unit.length, 0))
  let at = 0
  for (const unit of kept) {
    out[at] = unit.length >>> 24
    out[at + 1] = (unit.length >>> 16) & 255
    out[at + 2] = (unit.length >>> 8) & 255
    out[at + 3] = unit.length & 255
    out.set(unit, at + 4)
    at += 4 + unit.length
  }
  return out
}

/** An AVCDecoderConfigurationRecord from one SPS and one PPS. */
export function avcRecord(sps: Uint8Array, pps: Uint8Array): Uint8Array {
  return Uint8Array.from([1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 255, ...sps, 1, pps.length >> 8, pps.length & 255, ...pps])
}

const MP3_RATES = [
  [11025, 12000, 8000],
  [0, 0, 0],
  [22050, 24000, 16000],
  [44100, 48000, 32000],
]
const MP3_KBPS_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
const MP3_KBPS_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]

/** An MP3 frame's length in bytes and samples, from the header at `at`; null if there is none there. */
export function mp3Frame(data: Uint8Array, at: number): { bytes: number; samples: number; rate: number } | null {
  if (at + 4 > data.length || data[at] !== 0xff || (data[at + 1] & 0xe0) !== 0xe0) return null
  const version = (data[at + 1] >> 3) & 3
  const layer = (data[at + 1] >> 1) & 3
  if (version === 1 || layer !== 1) return null
  const kbps = (version === 3 ? MP3_KBPS_V1 : MP3_KBPS_V2)[data[at + 2] >> 4]
  const rate = MP3_RATES[version][(data[at + 2] >> 2) & 3]
  if (!kbps || !rate) return null
  const padding = (data[at + 2] >> 1) & 1
  const v1 = version === 3
  return { bytes: Math.floor(((v1 ? 144 : 72) * kbps * 1000) / rate) + padding, samples: v1 ? 1152 : 576, rate }
}

type Read = (position: number, length: number) => Promise<Uint8Array>

/** Sequential reads of a large file through one window, so the many small chunks cost few disk reads. */
export function windowedReader(file: Blob, windowBytes = 8 * 1024 * 1024): Read {
  let start = 0
  let bytes = new Uint8Array(0)
  return async (position, length) => {
    if (position >= start && position + length <= start + bytes.length) return bytes.subarray(position - start, position - start + length)
    start = position
    bytes = new Uint8Array(await file.slice(position, position + Math.max(length, windowBytes)).arrayBuffer())
    return bytes.subarray(0, length)
  }
}

interface Chunk {
  stream: number
  position: number
  size: number
}

/** Every stream chunk in the file's `movi` lists, OpenDML extensions (RIFF AVIX) included, in file order. */
export async function aviChunks(read: Read, fileSize: number, onChunk: (chunk: Chunk) => Promise<void> | void, onProgress?: (fraction: number) => void): Promise<void> {
  const walk = async (start: number, end: number, inside: boolean): Promise<void> => {
    let at = start
    while (at + 8 <= end) {
      const head = await read(at, 12)
      if (head.length < 8) return
      const id = fourcc(head, 0)
      const size = u32(head, 4)
      const body = at + 8
      const stop = Math.min(body + (size || end - body), end)
      if (id === 'RIFF' || id === 'LIST') {
        const type = head.length >= 12 ? fourcc(head, 8) : ''
        if (id === 'RIFF' || type === 'movi' || (inside && type === 'rec ')) await walk(body + 4, stop, inside || type === 'movi')
      } else if (inside && /^\d\d(dc|db|wb)$/.test(id)) {
        await onChunk({ stream: Number(id.slice(0, 2)), position: body, size: Math.min(size, stop - body) })
      }
      onProgress?.(stop / fileSize)
      at = body + size + (size & 1)
      if (size === 0 && (id === 'RIFF' || id === 'LIST')) return
    }
  }
  await walk(0, fileSize, false)
}

class FlvWriter {
  private readonly blobs: Blob[] = []
  private parts: Uint8Array<ArrayBuffer>[] = []
  private pending = 0

  constructor(hasAudio: boolean) {
    this.push(Uint8Array.from([0x46, 0x4c, 0x56, 1, hasAudio ? 5 : 1, 0, 0, 0, 9, 0, 0, 0, 0]))
  }

  private push(bytes: Uint8Array<ArrayBuffer>) {
    this.parts.push(bytes)
    this.pending += bytes.length
    if (this.pending > 4 * 1024 * 1024) {
      this.blobs.push(new Blob(this.parts))
      this.parts = []
      this.pending = 0
    }
  }

  tag(type: 8 | 9, timeMs: number, head: readonly number[], body: Uint8Array) {
    const size = head.length + body.length
    const time = Math.max(0, Math.round(timeMs))
    const tag = new Uint8Array(11 + size + 4)
    tag.set([type, (size >> 16) & 255, (size >> 8) & 255, size & 255, (time >> 16) & 255, (time >> 8) & 255, time & 255, (time >>> 24) & 255, 0, 0, 0])
    tag.set(head, 11)
    tag.set(body, 11 + head.length)
    const total = 11 + size
    tag.set([(total >>> 24) & 255, (total >> 16) & 255, (total >> 8) & 255, total & 255], 11 + size)
    this.push(tag)
  }

  finish(): Blob {
    return new Blob([...this.blobs, new Blob(this.parts)], { type: 'video/x-flv' })
  }
}

/** The stream's parameter sets, from its own set-up bytes if it has them: an avcC, or Annex B SPS/PPS. */
function configFrom(extra: Uint8Array): { config: AvcConfig; framed: number } | null {
  if (extra.length > 6 && extra[0] === 1) {
    const config = readAvcConfig(extra)
    return config.sps.length && config.pps.length ? { config: { ...config, lengthSize: 4 }, framed: config.lengthSize } : null
  }
  const units = nalUnits(extra)
  const sps = units.find((unit) => (unit[0] & 31) === 7)
  const pps = units.find((unit) => (unit[0] & 31) === 8)
  return sps && pps ? { config: { lengthSize: 4, sps: [sps], pps: [pps] }, framed: 0 } : null
}

/**
 * Rewrites an H.264 AVI as an FLV. Two passes over the file: the first reads each frame's slice header for
 * the order frames are shown in (AVI keeps no presentation times), the second writes the tags.
 */
export async function aviToFlv(file: Blob, header: AviHeader, onProgress?: (fraction: number) => void): Promise<Blob> {
  const video = header.streams[header.video]
  const audio = header.streams[header.audio] as AviStream | undefined
  const frameMs = (video.scale / video.rate) * 1000
  const framedAs = configFrom(video.extra)
  let config = framedAs?.config ?? null
  const lengthSize = framedAs?.framed ?? 0
  let order = config ? new PictureOrder(config) : null

  // First pass: which chunks are frames, which can be shown, and the order they are shown in.
  const frames: { position: number; size: number; index: number; key: boolean }[] = []
  const keys: number[] = []
  let ordered = true
  let videoIndex = 0
  let read = windowedReader(file)
  await aviChunks(
    read,
    file.size,
    async (chunk) => {
      if (chunk.stream !== header.video) return
      const index = videoIndex
      videoIndex += 1
      if (chunk.size === 0) return
      const head = await read(chunk.position, Math.min(chunk.size, 1024))
      const units = nalUnits(head, lengthSize)
      if (!config) {
        const sps = units.find((unit) => (unit[0] & 31) === 7)
        const pps = units.find((unit) => (unit[0] & 31) === 8)
        if (sps && pps) {
          config = { lengthSize: 4, sps: [sps.slice()], pps: [pps.slice()] }
          order = new PictureOrder(config)
        }
      }
      if (!config) return
      const key = units.some((unit) => (unit[0] & 31) === 5)
      frames.push({ position: chunk.position, size: chunk.size, index, key })
      if (!ordered || !order) return
      try {
        keys.push(order.key(avccSample(units)))
      } catch {
        ordered = false
      }
    },
    (fraction) => onProgress?.(fraction / 2),
  )
  if (!config || frames.length === 0) throw new Error('no H.264 pictures')
  const ranks = ordered ? displayRanks(keys) : null
  let delay = 0
  if (ranks) ranks.forEach((rank, at) => (delay = Math.max(delay, at - rank)))

  // Second pass: the tags, in the file's own order.
  const flv = new FlvWriter(Boolean(audio))
  const [sps] = config.sps
  const [pps] = config.pps
  flv.tag(9, 0, [0x17, 0, 0, 0, 0], avcRecord(sps, pps))
  if (audio?.formatTag === AAC) flv.tag(8, 0, [0xaf, 0], audio.extra)
  const byPosition = new Map(frames.map((frame, at) => [frame.position, at]))
  let audioMs = 0
  let audioCarry = new Uint8Array(0)
  let aacFrames = 0
  const aacRate = audio?.sampleRate || 44100
  read = windowedReader(file)
  await aviChunks(
    read,
    file.size,
    async (chunk) => {
      if (chunk.stream === header.video) {
        const at = byPosition.get(chunk.position)
        if (at === undefined) return
        const frame = frames[at]
        const sample = avccSample(nalUnits(await read(chunk.position, chunk.size), lengthSize))
        if (sample.length === 0) return
        const cts = ranks ? Math.round((ranks[at] + delay - at) * frameMs) : 0
        flv.tag(9, frame.index * frameMs, [frame.key ? 0x17 : 0x27, 1, (cts >> 16) & 255, (cts >> 8) & 255, cts & 255], sample)
      } else if (audio && chunk.stream === header.audio && chunk.size > 0) {
        const data = await read(chunk.position, chunk.size)
        if (audio.formatTag === AAC) {
          flv.tag(8, (aacFrames * 1024 * 1000) / aacRate, [0xaf, 1], data.slice())
          aacFrames += 1
          return
        }
        // MP3 chunks need not hold whole frames: the sound is cut again at its own frame headers.
        const joined = new Uint8Array(audioCarry.length + data.length)
        joined.set(audioCarry)
        joined.set(data, audioCarry.length)
        let at = 0
        while (at + 4 <= joined.length) {
          const frame = mp3Frame(joined, at)
          if (!frame) {
            at += 1
            continue
          }
          if (at + frame.bytes > joined.length) break
          flv.tag(8, audioMs, [0x2f], joined.subarray(at, at + frame.bytes))
          audioMs += (frame.samples * 1000) / frame.rate
          at += frame.bytes
        }
        audioCarry = joined.slice(at)
      }
    },
    (fraction) => onProgress?.(0.5 + fraction / 2),
  )
  return flv.finish()
}
