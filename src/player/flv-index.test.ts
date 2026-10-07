import { describe, expect, it } from 'vitest'
// @ts-expect-error mpegts.js ships its AMF reader as untyped source
import AMF from 'mpegts.js/src/demux/amf-parser.js'
import { FLV_KEEP_BEHIND_SECONDS, FLV_READ_AHEAD_SECONDS } from './flv.ts'
import { indexedParts, scanFlv, withKeyframeIndex } from './flv-index.ts'

/** A small FLV: header, AVC codec header, then a keyframe every second with plain frames and audio between. */
function flv(seconds: number, metadata?: Uint8Array): Uint8Array {
  const out: number[] = [0x46, 0x4c, 0x56, 1, 5, 0, 0, 0, 9, 0, 0, 0, 0]
  const tag = (type: number, ms: number, data: number[]) => {
    const size = data.length
    out.push(type, (size >> 16) & 255, (size >> 8) & 255, size & 255, (ms >> 16) & 255, (ms >> 8) & 255, ms & 255, (ms >> 24) & 255, 0, 0, 0, ...data)
    const total = 11 + size
    out.push((total >>> 24) & 255, (total >> 16) & 255, (total >> 8) & 255, total & 255)
  }
  if (metadata) tag(18, 0, [...metadata])
  tag(9, 0, [0x17, 0, 0, 0, 0, 1, 2, 3])
  for (let ms = 0; ms < seconds * 1000; ms += 250) {
    tag(9, ms, [ms % 1000 === 0 ? 0x17 : 0x27, 1, 0, 0, 0, ...new Array(40).fill(7)])
    tag(8, ms, [0xaf, 1, ...new Array(20).fill(3)])
  }
  return new Uint8Array(out)
}

const reader = (bytes: Uint8Array) => async (start: number, end: number) => bytes.slice(start, end)

describe('FLV playback of long files', () => {
  it('reads ahead a bounded amount and lets go of what has played, so the browser buffer never fills', () => {
    expect(FLV_READ_AHEAD_SECONDS).toBeLessThanOrEqual(120)
    expect(FLV_KEEP_BEHIND_SECONDS).toBeLessThanOrEqual(120)
  })

  it('finds every keyframe from the tag headers, with the codec header first', async () => {
    const bytes = flv(5)
    const scan = (await scanFlv(reader(bytes), bytes.length))!
    expect(scan.keyframes.times).toEqual([0, 0, 1, 2, 3, 4])
    expect(scan.hasAudio && scan.hasVideo).toBe(true)
    expect(scan.duration).toBeCloseTo(4.75)
    for (const position of scan.keyframes.filepositions) expect(bytes[position]).toBe(9)
  })

  it('adds an index the FLV player reads, pointing at the same keyframes in the new file', async () => {
    const bytes = flv(5)
    const scan = (await scanFlv(reader(bytes), bytes.length))!
    const parts = indexedParts(scan, bytes.slice(0, 9))!
    const joined = new Uint8Array([...parts.head, ...bytes.slice(parts.bodyStart)])
    const rescan = (await scanFlv(reader(joined), joined.length))!
    expect(rescan.metadata?.indexed).toBe(true)
    const tagSize = (joined[14]! << 16) | (joined[15]! << 8) | joined[16]!
    const meta = AMF.parseScriptData(joined.buffer, 13 + 11, tagSize).onMetaData
    expect(meta.keyframes.times).toEqual(scan.keyframes.times)
    expect(meta.keyframes.filepositions).toEqual(rescan.keyframes.filepositions)
    for (const position of meta.keyframes.filepositions) expect(joined[position]).toBe(9)
    expect(meta.duration).toBeCloseTo(4.75)
  })

  it('leaves a file that already has an index, or is not FLV, exactly as it is', async () => {
    const indexed = flv(2, new Uint8Array([2, 0, 10, ...[...'onMetaData'].map((c) => c.charCodeAt(0)), 8, 0, 0, 0, 1, 0, 13, ...[...'filepositions'].map((c) => c.charCodeAt(0)), 1, 0, 0, 0, 9]))
    const scan = (await scanFlv(reader(indexed), indexed.length))!
    expect(scan.metadata?.indexed).toBe(true)
    expect(indexedParts(scan, indexed.slice(0, 9))).toBeNull()
    const other = new Blob(['not a video'])
    expect(await withKeyframeIndex(other)).toBe(other)
  })
})
