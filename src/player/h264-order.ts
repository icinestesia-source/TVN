/**
 * The order an H.264 track's frames are shown in, from each frame's picture order count, for MP4 files that
 * carry B-frames but no composition offsets (`ctts`): browsers then show those frames in decoding order,
 * a back-and-forth stutter. Only each frame's first slice header is read.
 */

class Bits {
  private at = 0
  private readonly bytes: Uint8Array
  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }
  bit(): number {
    const byte = this.bytes[this.at >> 3]
    if (byte === undefined) throw new Error('out of data')
    const value = (byte >> (7 - (this.at & 7))) & 1
    this.at += 1
    return value
  }
  u(count: number): number {
    let value = 0
    for (let index = 0; index < count; index += 1) value = value * 2 + this.bit()
    return value
  }
  ue(): number {
    let zeros = 0
    while (this.bit() === 0) {
      zeros += 1
      if (zeros > 31) throw new Error('bad code')
    }
    return 2 ** zeros - 1 + this.u(zeros)
  }
  se(): number {
    const code = this.ue()
    return code % 2 ? (code + 1) / 2 : -code / 2
  }
}

/** The NAL payload without its emulation-prevention bytes, from just after the NAL header. */
function rbsp(nal: Uint8Array, limit = nal.length): Uint8Array {
  const out: number[] = []
  let zeros = 0
  for (let index = 1; index < Math.min(nal.length, limit); index += 1) {
    const byte = nal[index]
    if (zeros >= 2 && byte === 3) {
      zeros = 0
      continue
    }
    zeros = byte === 0 ? zeros + 1 : 0
    out.push(byte)
  }
  return Uint8Array.from(out)
}

interface Sps {
  frameNumBits: number
  pocType: number
  pocLsbBits: number
  frameMbsOnly: boolean
  separateColourPlane: boolean
}

const HIGH_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135])

function skipScalingList(bits: Bits, size: number): void {
  let last = 8
  let next = 8
  for (let index = 0; index < size; index += 1) {
    if (next !== 0) next = (last + bits.se() + 256) % 256
    last = next === 0 ? last : next
  }
}

function parseSps(nal: Uint8Array): [number, Sps] {
  const bits = new Bits(rbsp(nal))
  const profile = bits.u(8)
  bits.u(16)
  const id = bits.ue()
  let separateColourPlane = false
  if (HIGH_PROFILES.has(profile)) {
    const chroma = bits.ue()
    if (chroma === 3) separateColourPlane = bits.bit() === 1
    bits.ue()
    bits.ue()
    bits.bit()
    if (bits.bit()) for (let index = 0; index < (chroma === 3 ? 12 : 8); index += 1) if (bits.bit()) skipScalingList(bits, index < 6 ? 16 : 64)
  }
  const frameNumBits = bits.ue() + 4
  const pocType = bits.ue()
  let pocLsbBits = 0
  if (pocType === 0) pocLsbBits = bits.ue() + 4
  else if (pocType === 1) throw new Error('picture order type 1 is not read')
  bits.ue()
  bits.bit()
  bits.ue()
  bits.ue()
  const frameMbsOnly = bits.bit() === 1
  return [id, { frameNumBits, pocType, pocLsbBits, frameMbsOnly, separateColourPlane }]
}

function parsePps(nal: Uint8Array): [number, number] {
  const bits = new Bits(rbsp(nal, 16))
  return [bits.ue(), bits.ue()]
}

export interface AvcConfig {
  lengthSize: number
  sps: Uint8Array[]
  pps: Uint8Array[]
}

/** The `avcC` record of an avc1/avc3 sample entry. */
export function readAvcConfig(record: Uint8Array): AvcConfig {
  const lengthSize = (record[4] & 3) + 1
  const sps: Uint8Array[] = []
  const pps: Uint8Array[] = []
  let at = 6
  for (let count = record[5] & 31; count > 0; count -= 1) {
    const size = (record[at] << 8) | record[at + 1]
    sps.push(record.subarray(at + 2, at + 2 + size))
    at += 2 + size
  }
  for (let count = record[at++]; count > 0; count -= 1) {
    const size = (record[at] << 8) | record[at + 1]
    pps.push(record.subarray(at + 2, at + 2 + size))
    at += 2 + size
  }
  return { lengthSize, sps, pps }
}

/** Reads the frames' order keys one frame at a time, keeping the parameter sets and count state between them. */
export class PictureOrder {
  private readonly spsById = new Map<number, Sps>()
  private readonly ppsToSps = new Map<number, number>()
  private prevMsb = 0
  private prevLsb = 0
  private epoch = -1
  private readonly config: AvcConfig

  constructor(config: AvcConfig) {
    this.config = config
    for (const nal of config.sps) this.addSps(nal)
    for (const nal of config.pps) this.addPps(nal)
  }

  private addSps(nal: Uint8Array) {
    const [id, sps] = parseSps(nal)
    this.spsById.set(id, sps)
  }

  private addPps(nal: Uint8Array) {
    const [id, sps] = parsePps(nal)
    this.ppsToSps.set(id, sps)
  }

  /**
   * The display key of one frame from its bytes (all of them, or enough to reach its first slice header):
   * frames sort into display order by it. Throws on anything it cannot read.
   */
  key(sample: Uint8Array): number {
    const size = this.config.lengthSize
    let at = 0
    while (at + size <= sample.length) {
      let length = 0
      for (let index = 0; index < size; index += 1) length = length * 256 + sample[at + index]
      const nal = sample.subarray(at + size, at + size + length)
      at += size + length
      if (nal.length === 0) continue
      const type = nal[0] & 31
      if (type === 7) this.addSps(nal)
      else if (type === 8) this.addPps(nal)
      else if (type === 1 || type === 5) return this.sliceKey(nal, type === 5)
    }
    throw new Error('no slice in this frame')
  }

  private sliceKey(nal: Uint8Array, idr: boolean): number {
    const bits = new Bits(rbsp(nal, 48))
    bits.ue()
    bits.ue()
    const spsId = this.ppsToSps.get(bits.ue())
    const sps = spsId === undefined ? undefined : this.spsById.get(spsId)
    if (!sps) throw new Error('unknown parameter set')
    if (sps.separateColourPlane) bits.u(2)
    bits.u(sps.frameNumBits)
    if (!sps.frameMbsOnly && bits.bit()) throw new Error('field pictures are not read')
    if (idr) bits.ue()
    if (idr || this.epoch < 0) {
      this.epoch += 1
      this.prevMsb = 0
      this.prevLsb = 0
    }
    if (sps.pocType === 2) return this.epoch * 2 ** 32
    const lsb = bits.u(sps.pocLsbBits)
    const max = 2 ** sps.pocLsbBits
    const msb =
      lsb < this.prevLsb && this.prevLsb - lsb >= max / 2 ? this.prevMsb + max : lsb > this.prevLsb && lsb - this.prevLsb > max / 2 ? this.prevMsb - max : this.prevMsb
    if (((nal[0] >> 5) & 3) !== 0) {
      this.prevMsb = msb
      this.prevLsb = lsb
    }
    return this.epoch * 2 ** 32 + msb + lsb + 2 ** 31
  }
}

/**
 * Each frame's place in display order (rank by decoding index), from the frames' order keys; ties keep
 * decoding order. Null when the frames are already shown in decoding order.
 */
export function displayRanks(keys: ArrayLike<number>): Int32Array | null {
  const order = Array.from({ length: keys.length }, (_, index) => index).sort((a, b) => keys[a] - keys[b] || a - b)
  const ranks = new Int32Array(keys.length)
  let moved = false
  order.forEach((sample, rank) => {
    ranks[sample] = rank
    if (sample !== rank) moved = true
  })
  return moved ? ranks : null
}
