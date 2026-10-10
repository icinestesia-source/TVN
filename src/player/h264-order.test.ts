import { describe, expect, it } from 'vitest'
import { displayRanks, PictureOrder, readAvcConfig } from './h264-order.ts'

class Writer {
  private bits: number[] = []
  u(count: number, value: number) {
    for (let index = count - 1; index >= 0; index -= 1) this.bits.push((value >> index) & 1)
    return this
  }
  ue(value: number) {
    const code = value + 1
    const length = Math.floor(Math.log2(code))
    return this.u(length, 0).u(length + 1, code)
  }
  bytes(): number[] {
    const bits = [...this.bits, 1]
    while (bits.length % 8) bits.push(0)
    return Array.from({ length: bits.length / 8 }, (_, index) => bits.slice(index * 8, index * 8 + 8).reduce((byte, bit) => byte * 2 + bit, 0))
  }
}

// Main profile, frame_num in 4 bits, picture order count type 0 with 6-bit lsb, frames only.
const SPS = [0x67, ...new Writer().u(8, 77).u(8, 0).u(8, 30).ue(0).ue(0).ue(0).ue(2).ue(1).u(1, 0).ue(0).ue(0).u(1, 1).bytes()]
const PPS = [0x68, ...new Writer().ue(0).ue(0).u(1, 0).bytes()]
const record = Uint8Array.from([1, 77, 0, 30, 0xff, 0xe1, 0, SPS.length, ...SPS, 1, 0, PPS.length, ...PPS])

/** One frame: a 4-byte length, then a slice with the given picture order count lsb. */
function frame(poc: number, kind: 'idr' | 'ref' | 'b', frameNum = 0): Uint8Array {
  const header = kind === 'idr' ? 0x65 : kind === 'ref' ? 0x41 : 0x01
  const slice = new Writer().ue(0).ue(kind === 'b' ? 1 : kind === 'idr' ? 2 : 0).ue(0).u(4, frameNum)
  if (kind === 'idr') slice.ue(0)
  const nal = [header, ...slice.u(6, poc % 64).bytes()]
  return Uint8Array.from([0, 0, 0, nal.length, ...nal])
}

describe('the order H.264 frames are shown in', () => {
  it('puts B-frames decoded after the frame they precede back in front of it', () => {
    const order = new PictureOrder(readAvcConfig(record))
    // Decoded I P B B P B B; shown I B B P B B P.
    const decoded = [frame(0, 'idr'), frame(6, 'ref', 1), frame(2, 'b', 2), frame(4, 'b', 2), frame(12, 'ref', 2), frame(8, 'b', 3), frame(10, 'b', 3)]
    const ranks = displayRanks(decoded.map((sample) => order.key(sample)))
    expect([...ranks!]).toEqual([0, 3, 1, 2, 6, 4, 5])
  })

  it('follows the count past its wrap and starts again at each IDR', () => {
    const order = new PictureOrder(readAvcConfig(record))
    const keys = [frame(0, 'idr'), frame(20, 'ref', 1), frame(40, 'ref', 2), frame(60, 'ref', 3), frame(16, 'ref', 4), frame(0, 'idr'), frame(2, 'ref', 1)].map((sample) => order.key(sample))
    for (let index = 1; index < keys.length; index += 1) expect(keys[index]).toBeGreaterThan(keys[index - 1])
  })

  it('says nothing needs reordering when frames are shown as decoded', () => {
    const order = new PictureOrder(readAvcConfig(record))
    expect(displayRanks([frame(0, 'idr'), frame(2, 'ref', 1), frame(4, 'ref', 2)].map((sample) => order.key(sample)))).toBeNull()
  })
})
