import { publicFeedUrl, TIMEOUT_MS, USER_AGENT } from './web-read.ts'

/**
 * How long a public media file runs, read from a few kilobytes of it: an MP3's frame header (its Xing/VBRI
 * frame count, or its constant bitrate against the file's size), or an MP4's movie header. Nothing is
 * downloaded whole, kept or passed on. A file the publisher keeps behind a sign-in answers 401/402/403.
 */
export type Measured = { seconds: number } | { locked: true }

interface Chunk {
  bytes: Uint8Array
  total: number | null
}

class Locked extends Error {}

async function range(url: string, start: number, end: number, read: typeof fetch): Promise<Chunk> {
  const response = await read(url, { headers: { 'user-agent': USER_AGENT, range: `bytes=${start}-${end}` }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (response.status === 401 || response.status === 402 || response.status === 403) throw new Locked()
  if (!response.ok) throw new Error(`media answered ${response.status}`)
  const total = Number(response.headers.get('content-range')?.match(/\/(\d+)\s*$/)?.[1]) || (response.status === 200 ? Number(response.headers.get('content-length')) || null : null)
  const want = end - start + 1
  // A server that ignores Range sends the whole file from the start: only the part asked for is read.
  if (response.status === 200 && start > 0) {
    void response.body?.cancel().catch(() => undefined)
    throw new Error('media server does not serve ranges')
  }
  const bytes = await readAtMost(response, want)
  return { bytes, total }
}

async function readAtMost(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(await response.arrayBuffer()).slice(0, limit)
  const reader = response.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  try {
    while (size < limit) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
      size += value.length
    }
  } finally {
    void reader.cancel().catch(() => undefined)
  }
  const out = new Uint8Array(Math.min(size, limit))
  let at = 0
  for (const part of parts) {
    if (at >= out.length) break
    out.set(part.subarray(0, out.length - at), at)
    at += part.length
  }
  return out
}

const u32 = (bytes: Uint8Array, at: number) => ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3]
const text4 = (bytes: Uint8Array, at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3])

const BITRATES = {
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
const RATES = [44100, 48000, 32000]

interface Frame {
  at: number
  bitrate: number
  sampleRate: number
  samples: number
  mono: boolean
  mpeg1: boolean
}

/** The first MPEG layer III frame header in `bytes`, checked against the one after it. */
export function firstFrame(bytes: Uint8Array): Frame | null {
  for (let at = 0; at + 4 <= bytes.length; at += 1) {
    const frame = frameAt(bytes, at)
    if (!frame) continue
    const length = Math.floor(((frame.mpeg1 ? 144 : 72) * frame.bitrate * 1000) / frame.sampleRate) + ((bytes[at + 2] >> 1) & 1)
    if (at + length + 4 <= bytes.length && !frameAt(bytes, at + length)) continue
    return frame
  }
  return null
}

function frameAt(bytes: Uint8Array, at: number): Frame | null {
  if (bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) return null
  const version = (bytes[at + 1] >> 3) & 3
  const layer = (bytes[at + 1] >> 1) & 3
  if (version === 1 || layer !== 1) return null
  const mpeg1 = version === 3
  const bitrate = (mpeg1 ? BITRATES.v1 : BITRATES.v2)[(bytes[at + 2] >> 4) & 15]
  const rateIndex = (bytes[at + 2] >> 2) & 3
  if (!bitrate || rateIndex === 3) return null
  const sampleRate = RATES[rateIndex] / (mpeg1 ? 1 : version === 2 ? 2 : 4)
  return { at, bitrate, sampleRate, samples: mpeg1 ? 1152 : 576, mono: (bytes[at + 3] >> 6) === 3, mpeg1 }
}

/** Seconds of MP3 audio from the bytes after any ID3 tag and the file's total size. */
export function mp3Seconds(bytes: Uint8Array, audioBytes: number): number {
  const frame = firstFrame(bytes)
  if (!frame) return 0
  const side = frame.mpeg1 ? (frame.mono ? 17 : 32) : frame.mono ? 9 : 17
  const xing = frame.at + 4 + side
  if (xing + 12 <= bytes.length && /^(?:Xing|Info)$/.test(text4(bytes, xing)) && u32(bytes, xing + 4) & 1) {
    return Math.round((u32(bytes, xing + 8) * frame.samples) / frame.sampleRate)
  }
  const vbri = frame.at + 36
  if (vbri + 18 <= bytes.length && text4(bytes, vbri) === 'VBRI') return Math.round((u32(bytes, vbri + 14) * frame.samples) / frame.sampleRate)
  return audioBytes > 0 ? Math.round((audioBytes * 8) / (frame.bitrate * 1000)) : 0
}

/** An ID3v2 tag's full length (header, body, footer), or 0 when the file has none. */
export function id3Length(bytes: Uint8Array): number {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0
  const body = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f)
  return 10 + body + (bytes[5] & 0x10 ? 10 : 0)
}

/** Seconds from an `mvhd` box's contents (after its 8-byte header). */
export function mvhdSeconds(bytes: Uint8Array, at: number): number {
  const version = bytes[at]
  const scale = version === 1 ? u32(bytes, at + 20) : u32(bytes, at + 12)
  const duration = version === 1 ? u32(bytes, at + 24) * 2 ** 32 + u32(bytes, at + 28) : u32(bytes, at + 16)
  return scale > 0 ? Math.round(duration / scale) : 0
}

/** An EBML variable-length number at `at`: its value and its length in bytes. */
function vint(bytes: Uint8Array, at: number, keepMarker = false): { value: number; length: number } | null {
  const first = bytes[at]
  if (first === undefined || first === 0) return null
  let length = 1
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length += 1
  if (length > 8 || at + length > bytes.length) return null
  let value = keepMarker ? first : first & (0xff >> length)
  for (let index = 1; index < length; index += 1) value = value * 256 + bytes[at + index]
  return { value, length }
}

/** Seconds from a WebM/Matroska file's first bytes: the Segment Info's Duration in its TimecodeScale. */
export function webmSeconds(bytes: Uint8Array): number {
  for (let at = 0; at + 4 < bytes.length; at += 1) {
    if (bytes[at] !== 0x15 || bytes[at + 1] !== 0x49 || bytes[at + 2] !== 0xa9 || bytes[at + 3] !== 0x66) continue
    // The SeekHead names Info's id too; only the element that holds a Duration counts.
    const size = vint(bytes, at + 4)
    if (!size) continue
    const end = Math.min(bytes.length, at + 4 + size.length + size.value)
    let scale = 1_000_000
    let duration = 0
    for (let child = at + 4 + size.length; child < end; ) {
      const id = vint(bytes, child, true)
      const length = id ? vint(bytes, child + id.length) : null
      if (!id || !length) break
      const body = child + id.length + length.length
      const view = new DataView(bytes.buffer, bytes.byteOffset + body, Math.min(length.value, bytes.length - body))
      if (id.value === 0x2ad7b1) scale = [...bytes.subarray(body, body + length.value)].reduce((sum, byte) => sum * 256 + byte, 0)
      if (id.value === 0x4489) duration = length.value === 4 ? view.getFloat32(0) : length.value === 8 ? view.getFloat64(0) : 0
      child = body + length.value
    }
    if (duration > 0) return Math.round((duration * scale) / 1e9)
  }
  return 0
}

const isWebm = (url: string, type: string) => /webm|matroska/.test(type) || /\.(?:webm|mkv)(?:[?#]|$)/i.test(url)

const isMp4 = (url: string, type: string) => /^video\/|audio\/(?:mp4|x-m4a|aac)/.test(type) || /\.(?:mp4|m4a|m4v|mov)(?:[?#]|$)/i.test(url)

async function mp4Seconds(url: string, read: typeof fetch): Promise<number> {
  let chunk = await range(url, 0, 65535, read)
  let base = 0
  let at = 0
  for (let hop = 0; hop < 12; hop += 1) {
    if (at + 8 > chunk.bytes.length) {
      base += at
      chunk = { ...(await range(url, base, base + 4095, read)), total: chunk.total }
      at = 0
      if (chunk.bytes.length < 8) return 0
    }
    let size = u32(chunk.bytes, at)
    const type = text4(chunk.bytes, at + 4)
    let header = 8
    if (size === 1 && at + 16 <= chunk.bytes.length) {
      size = u32(chunk.bytes, at + 8) * 2 ** 32 + u32(chunk.bytes, at + 12)
      header = 16
    }
    if (type === 'moov') {
      // mvhd is the movie header, normally moov's first child.
      let inner = chunk
      let start = at + header
      if (start + 40 > inner.bytes.length) {
        inner = await range(url, base + start, base + start + 4095, read)
        start = 0
      }
      for (let child = start; child + 8 <= inner.bytes.length && child < start + 4096; ) {
        const childSize = u32(inner.bytes, child)
        if (text4(inner.bytes, child + 4) === 'mvhd') return mvhdSeconds(inner.bytes, child + 8)
        if (childSize < 8) break
        child += childSize
      }
      return 0
    }
    if (size < 8 || (size === 0 && type !== 'moov')) return 0
    at += size
    if (chunk.total !== null && base + at >= chunk.total) return 0
  }
  return 0
}

async function mp3SecondsOf(url: string, read: typeof fetch): Promise<number> {
  const head = await range(url, 0, 16383, read)
  const tag = id3Length(head.bytes)
  const audio = head.total !== null ? head.total - tag : 0
  if (tag + 4096 <= head.bytes.length) return mp3Seconds(head.bytes.subarray(tag), audio)
  const after = await range(url, tag, tag + 8191, read)
  return mp3Seconds(after.bytes, audio)
}

/** How long a public file runs; `locked` when its publisher keeps it behind a sign-in or subscription. */
export async function measureMedia(raw: string, type: string, read: typeof fetch = fetch): Promise<Measured> {
  const url = publicFeedUrl(raw)
  if (!url) return { seconds: 0 }
  try {
    const seconds = isWebm(url.toString(), type)
      ? webmSeconds((await range(url.toString(), 0, 65535, read)).bytes)
      : isMp4(url.toString(), type)
        ? await mp4Seconds(url.toString(), read)
        : await mp3SecondsOf(url.toString(), read)
    return { seconds: Number.isFinite(seconds) && seconds > 0 && seconds < 48 * 3600 ? seconds : 0 }
  } catch (error) {
    if (error instanceof Locked) return { locked: true }
    return { seconds: 0 }
  }
}
