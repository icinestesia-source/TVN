/**
 * Many FLV files carry no keyframe index, and without one the FLV player cannot start part-way through or
 * seek past what it has read: the picture stops. For a file on this device TVN reads the tag headers once
 * (only the headers are looked at), and if the file has no index, hands the player the same file with an
 * index added at the front. The new file is put together from slices of the original, so nothing is copied.
 */

const CHUNK_BYTES = 1 << 20
const TAG_HEADER = 11
const TAG_AUDIO = 8
const TAG_VIDEO = 9
const TAG_SCRIPT = 18

export interface FlvScan {
  /** Bytes of the FLV header, before the first PreviousTagSize. */
  headerSize: number
  /** The file's own first onMetaData tag, if it opens with one: [start, end) including its PreviousTagSize. */
  metadata: { start: number; end: number; indexed: boolean } | null
  /** Tag positions and times (seconds), first entry the codec header, as FLV tools write them. */
  keyframes: { filepositions: number[]; times: number[] }
  duration: number
  hasAudio: boolean
  hasVideo: boolean
}

type Read = (start: number, end: number) => Promise<Uint8Array>

/** Reads through the file in large chunks, handing out the few bytes each tag header needs. */
function chunkedReader(read: Read, size: number) {
  let start = 0
  let bytes: Uint8Array = new Uint8Array(0)
  return async (at: number, length: number): Promise<Uint8Array | null> => {
    if (at + length > size) return null
    if (at < start || at + length > start + bytes.length) {
      start = at
      bytes = await read(at, Math.min(size, at + Math.max(CHUNK_BYTES, length)))
    }
    return bytes.subarray(at - start, at - start + length)
  }
}

const u24 = (bytes: Uint8Array, at: number) => (bytes[at]! << 16) | (bytes[at + 1]! << 8) | bytes[at + 2]!
const u32 = (bytes: Uint8Array, at: number) => ((bytes[at]! << 24) >>> 0) + u24(bytes, at + 1)

function contains(haystack: Uint8Array, needle: string): boolean {
  const codes = [...needle].map((c) => c.charCodeAt(0))
  outer: for (let i = 0; i + codes.length <= haystack.length; i += 1) {
    for (let j = 0; j < codes.length; j += 1) if (haystack[i + j] !== codes[j]) continue outer
    return true
  }
  return false
}

/** The tags of an FLV file, as far as they are whole; null if it is not FLV. */
export async function scanFlv(read: Read, size: number): Promise<FlvScan | null> {
  const at = chunkedReader(read, size)
  const header = await at(0, 9)
  if (!header || header[0] !== 0x46 || header[1] !== 0x4c || header[2] !== 0x56) return null
  const headerSize = u32(header, 5)
  const scan: FlvScan = {
    headerSize,
    metadata: null,
    keyframes: { filepositions: [], times: [] },
    duration: 0,
    hasAudio: (header[4]! & 4) !== 0,
    hasVideo: (header[4]! & 1) !== 0,
  }
  let sequenceHeader = false
  let first = true
  let position = headerSize + 4
  for (;;) {
    const tag = await at(position, TAG_HEADER + 2)
    if (!tag) break
    const type = tag[0]! & 0x1f
    const dataSize = u24(tag, 1)
    const end = position + TAG_HEADER + dataSize + 4
    if (end > size) break
    const time = (u24(tag, 4) | (tag[7]! << 24)) / 1000
    if (type === TAG_SCRIPT && first) {
      const data = (await at(position + TAG_HEADER, dataSize)) ?? new Uint8Array(0)
      if (contains(data, 'onMetaData')) scan.metadata = { start: position, end, indexed: contains(data, 'filepositions') }
    } else if (type === TAG_VIDEO && dataSize > 0) {
      const frameType = tag[TAG_HEADER]! >> 4
      const codec = tag[TAG_HEADER]! & 0x0f
      const avc = codec === 7 || codec === 12
      const packetType = tag[TAG_HEADER + 1]
      // The first entry stands for the codec header; FLV players skip it.
      if (avc && packetType === 0 && !sequenceHeader) {
        sequenceHeader = true
        scan.keyframes.filepositions.push(position)
        scan.keyframes.times.push(time)
      } else if (frameType === 1 && (!avc || packetType === 1)) {
        if (scan.keyframes.times.length === 0) {
          scan.keyframes.filepositions.push(position)
          scan.keyframes.times.push(time)
        }
        scan.keyframes.filepositions.push(position)
        scan.keyframes.times.push(time)
      }
    }
    if (type === TAG_VIDEO || type === TAG_AUDIO) scan.duration = Math.max(scan.duration, time)
    first = false
    position = end
  }
  return scan
}

/** AMF0, just enough for an onMetaData of numbers, booleans and number arrays. */
function amf(value: unknown, out: number[]): void {
  if (typeof value === 'number') {
    const bytes = new Uint8Array(8)
    new DataView(bytes.buffer).setFloat64(0, value)
    out.push(0x00, ...bytes)
  } else if (typeof value === 'boolean') {
    out.push(0x01, value ? 1 : 0)
  } else if (Array.isArray(value)) {
    out.push(0x0a, ...uint32(value.length))
    for (const item of value) amf(item, out)
  } else if (value && typeof value === 'object') {
    out.push(0x03)
    for (const [key, item] of Object.entries(value)) {
      out.push(...name(key))
      amf(item, out)
    }
    out.push(0, 0, 9)
  }
}
const uint32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const name = (text: string) => [(text.length >> 8) & 0xff, text.length & 0xff, ...[...text].map((c) => c.charCodeAt(0))]

function metadataTag(fields: Record<string, unknown>): Uint8Array {
  const data: number[] = [0x02, ...name('onMetaData'), 0x08, ...uint32(Object.keys(fields).length)]
  for (const [key, value] of Object.entries(fields)) {
    data.push(...name(key))
    amf(value, data)
  }
  data.push(0, 0, 9)
  const size = data.length
  return new Uint8Array([TAG_SCRIPT, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff, 0, 0, 0, 0, 0, 0, 0, ...data, ...uint32(TAG_HEADER + size)])
}

/** The parts of the indexed file: the header, a new onMetaData with the index, then the original's tags. */
export function indexedParts(scan: FlvScan, header: Uint8Array): { head: Uint8Array<ArrayBuffer>; bodyStart: number } | null {
  if (scan.metadata?.indexed || scan.keyframes.times.length < 2) return null
  const bodyStart = scan.metadata ? scan.metadata.end : scan.headerSize + 4
  const fields = (shift: number) => ({
    duration: scan.duration,
    hasAudio: scan.hasAudio,
    hasVideo: scan.hasVideo,
    keyframes: { filepositions: scan.keyframes.filepositions.map((position) => position + shift), times: scan.keyframes.times },
  })
  // The index's own length moves every position after it; numbers are fixed width, so one pass settles it.
  const lead = scan.headerSize + 4
  const sized = metadataTag(fields(0)).length
  const tag = metadataTag(fields(lead + sized - bodyStart))
  const head = new Uint8Array(lead + tag.length)
  head.set(header.subarray(0, scan.headerSize))
  head.set(tag, lead)
  return { head, bodyStart }
}

const indexed = new WeakMap<Blob, Promise<Blob>>()

/** The file itself if it already has an index or cannot be read as FLV; otherwise the same file with one. */
export function withKeyframeIndex(file: Blob): Promise<Blob> {
  let made = indexed.get(file)
  if (!made) {
    made = (async () => {
      try {
        const read: Read = async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer())
        const scan = await scanFlv(read, file.size)
        if (!scan) return file
        const parts = indexedParts(scan, await read(0, scan.headerSize))
        return parts ? new Blob([parts.head, file.slice(parts.bodyStart)], { type: file.type }) : file
      } catch {
        return file
      }
    })()
    indexed.set(file, made)
  }
  return made
}
