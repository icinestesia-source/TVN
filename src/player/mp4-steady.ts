import { displayRanks, PictureOrder, readAvcConfig } from './h264-order.ts'

/**
 * Steadies an MP4 whose video frame times are bunched: some downloads pack several frames into one frame's
 * time and next to a gap, which browsers show as a stutter while the sound runs on smoothly. Only the
 * file's index (`moov`) is read and rewritten: the frames follow one another at the file's own frame rate,
 * meeting its own times again at any real pause, so the picture keeps step with the sound. The pictures and sound are not
 * touched, and the file on disk never changes; what plays is the original bytes behind a corrected index.
 */

/** An index larger than this is not read; such a file plays as it is. */
const MAX_INDEX_BYTES = 64 * 1024 * 1024
/** Below this share of frames off the grid, a file is steady enough to play as it is. */
const UNEVEN_SHARE = 0.03
/** The grid must be the clear rhythm of the file, or it is genuinely variable and left alone. */
const GRID_SHARE = 0.5
/** How far the file's own times may run ahead of an even sequence before they count as a real pause. */
const HOLD_FRAMES = 8

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'mvex'])
/** Frames looked at first for B-frames; a file with none among them is taken to have none. */
const FIRST_LOOK = 150
/** Enough of a frame to reach its first slice header past any SEI in front of it. */
const FRAME_HEAD = 4096
const READ_WINDOW = 8 * 1024 * 1024

interface Box {
  type: string
  start: number
  headerSize: number
  size: number
  children?: Box[]
}

const typeAt = (bytes: Uint8Array, at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3])

function parseBoxes(bytes: Uint8Array, view: DataView, from: number, to: number): Box[] {
  const boxes: Box[] = []
  let at = from
  while (at + 8 <= to) {
    let size = view.getUint32(at)
    const type = typeAt(bytes, at + 4)
    let headerSize = 8
    if (size === 1) {
      if (at + 16 > to) throw new Error('truncated box')
      size = Number(view.getBigUint64(at + 8))
      headerSize = 16
    } else if (size === 0) size = to - at
    if (size < headerSize || at + size > to) throw new Error('bad box size')
    const box: Box = { type, start: at, headerSize, size }
    if (CONTAINERS.has(type)) box.children = parseBoxes(bytes, view, at + headerSize, at + size)
    boxes.push(box)
    at += size
  }
  return boxes
}

const child = (box: Box | undefined, type: string) => box?.children?.find((item) => item.type === type)

/** Top-level boxes of a file, read header by header from the Blob without loading the media itself. */
async function topLevel(file: Blob): Promise<{ type: string; start: number; size: number }[]> {
  const out: { type: string; start: number; size: number }[] = []
  let at = 0
  while (at + 8 <= file.size && out.length < 64) {
    const head = new DataView(await file.slice(at, at + 16).arrayBuffer())
    let size = head.getUint32(0)
    const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7))
    if (size === 1) size = Number(head.getBigUint64(8))
    else if (size === 0) size = file.size - at
    if (size < 8) break
    out.push({ type, start: at, size })
    at += size
  }
  return out
}

/** Where each frame's bytes are in the file, from the sample size, sample-to-chunk and chunk offset tables. */
function sampleLayout(view: DataView, stbl: Box): { sizes: Uint32Array; offsets: Float64Array } | null {
  const stsz = child(stbl, 'stsz')
  const stsc = child(stbl, 'stsc')
  const stco = child(stbl, 'stco') ?? child(stbl, 'co64')
  if (!stsz || !stsc || !stco) return null
  const sizeAt = stsz.start + stsz.headerSize
  const uniform = view.getUint32(sizeAt + 4)
  const count = view.getUint32(sizeAt + 8)
  const sizes = new Uint32Array(count)
  for (let index = 0; index < count; index += 1) sizes[index] = uniform || view.getUint32(sizeAt + 12 + index * 4)
  const chunkAt = stco.start + stco.headerSize
  const chunks = view.getUint32(chunkAt + 4)
  const wide = stco.type === 'co64'
  const chunkOffset = (index: number) => (wide ? Number(view.getBigUint64(chunkAt + 8 + index * 8)) : view.getUint32(chunkAt + 8 + index * 4))
  const runAt = stsc.start + stsc.headerSize
  const runs = view.getUint32(runAt + 4)
  const offsets = new Float64Array(count)
  let sample = 0
  for (let run = 0; run < runs && sample < count; run += 1) {
    const first = view.getUint32(runAt + 8 + run * 12) - 1
    const perChunk = view.getUint32(runAt + 12 + run * 12)
    const last = run + 1 < runs ? view.getUint32(runAt + 8 + (run + 1) * 12) - 1 : chunks
    for (let chunk = first; chunk < last && sample < count; chunk += 1) {
      let at = chunkOffset(chunk)
      for (let step = 0; step < perChunk && sample < count; step += 1) {
        offsets[sample] = at
        at += sizes[sample]
        sample += 1
      }
    }
  }
  return sample === count ? { sizes, offsets } : null
}

/** The `avcC` record of a track's first sample entry, if it is H.264. */
function avcRecord(bytes: Uint8Array, view: DataView, stbl: Box): Uint8Array | null {
  const stsd = child(stbl, 'stsd')
  if (!stsd) return null
  const entry = stsd.start + stsd.headerSize + 8
  const type = typeAt(bytes, entry + 4)
  if (type !== 'avc1' && type !== 'avc3') return null
  const end = entry + view.getUint32(entry)
  for (let at = entry + 86; at + 8 <= end; ) {
    const size = view.getUint32(at)
    if (size < 8) return null
    if (typeAt(bytes, at + 4) === 'avcC') return bytes.subarray(at + 8, at + size)
    at += size
  }
  return null
}

/** Display-order keys for the first `count` frames, read window by window in decoding order. */
async function orderKeys(file: Blob, layout: { sizes: Uint32Array; offsets: Float64Array }, record: Uint8Array, count: number): Promise<Float64Array> {
  const order = new PictureOrder(readAvcConfig(record))
  const keys = new Float64Array(count)
  const { sizes, offsets } = layout
  const head = (index: number) => Math.min(sizes[index], FRAME_HEAD)
  let index = 0
  while (index < count) {
    const start = offsets[index]
    let end = start + head(index)
    let next = index + 1
    while (next < count && offsets[next] >= start && offsets[next] + head(next) - start <= READ_WINDOW) {
      end = Math.max(end, offsets[next] + head(next))
      next += 1
    }
    const window = new Uint8Array(await file.slice(start, end).arrayBuffer())
    for (let frame = index; frame < next; frame += 1) {
      const from = offsets[frame] - start
      try {
        keys[frame] = order.key(window.subarray(from, from + head(frame)))
      } catch (error) {
        if (head(frame) === sizes[frame]) throw error
        keys[frame] = order.key(new Uint8Array(await file.slice(offsets[frame], offsets[frame] + sizes[frame]).arrayBuffer()))
      }
    }
    index = next
  }
  return keys
}

/** A box of the given type holding `entries` pairs of numbers, as stts and ctts are. */
function pairBox(type: string, pairs: [number, number][]): Uint8Array {
  const bytes = new Uint8Array(16 + pairs.length * 8)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, bytes.length)
  bytes.set([...type].map((c) => c.charCodeAt(0)), 4)
  view.setUint32(12, pairs.length)
  pairs.forEach(([count, value], index) => {
    view.setUint32(16 + index * 8, count)
    view.setUint32(20 + index * 8, value)
  })
  return bytes
}

const runsOf = (values: ArrayLike<number>): [number, number][] => {
  const runs: [number, number][] = []
  for (let index = 0; index < values.length; index += 1) {
    const last = runs.at(-1)
    if (last && last[1] === values[index]) last[0] += 1
    else runs.push([1, values[index]])
  }
  return runs
}

/** Frame start times, in the track's own units, from its time-to-sample table. */
function decodeTimes(view: DataView, stts: Box): Float64Array {
  const at = stts.start + stts.headerSize
  const entries = view.getUint32(at + 4)
  let total = 0
  for (let index = 0; index < entries; index += 1) total += view.getUint32(at + 8 + index * 8)
  const times = new Float64Array(total)
  let sample = 0
  let time = 0
  for (let index = 0; index < entries; index += 1) {
    const count = view.getUint32(at + 8 + index * 8)
    const delta = view.getUint32(at + 12 + index * 8)
    for (let step = 0; step < count; step += 1) {
      times[sample++] = time
      time += delta
    }
  }
  return times
}

/**
 * New frame times on the grid of the most common frame length: each frame at its nearest grid point, never
 * earlier than one frame after the last. Null when the frames are already even, or have no clear grid.
 */
export function steadyTimes(times: ArrayLike<number>): { times: Float64Array; frame: number; lag: number } | null {
  const count = times.length
  if (count < 48) return null
  const tally = new Map<number, number>()
  for (let index = 1; index < count; index += 1) {
    const gap = times[index] - times[index - 1]
    tally.set(gap, (tally.get(gap) ?? 0) + 1)
  }
  let frame = 0
  let best = 0
  for (const [gap, seen] of tally) if (seen > best && gap > 0) [frame, best] = [gap, seen]
  if (frame <= 0 || best < (count - 1) * GRID_SHARE) return null
  let uneven = 0
  for (let index = 1; index < count; index += 1) {
    const gap = times[index] - times[index - 1]
    if (Math.abs(gap - frame) > frame * 0.1) uneven += 1
  }
  if (uneven < (count - 1) * UNEVEN_SHARE) return null
  // One frame after another, so a bunch is spread over the gap whichever side of it the bunch falls; the file's own
  // time is taken up again only when it runs well ahead, which is a real pause in the picture.
  const hold = frame * HOLD_FRAMES
  const out = new Float64Array(count)
  out[0] = times[0]
  for (let index = 1; index < count; index += 1) {
    const next = out[index - 1] + frame
    const own = times[0] + Math.round((times[index] - times[0]) / frame) * frame
    out[index] = own - next > hold ? own : next
  }
  // How far behind its own times the picture now runs, typically; the edit list takes it back so the sound still matches.
  const behind = Float64Array.from(out, (time, index) => time - times[index]).sort()
  return { times: out, frame, lag: behind[Math.floor(count / 2)] }
}

/** A time-to-sample box for the given frame times, run-length coded. */
function sttsBox(times: ArrayLike<number>, frame: number): Uint8Array {
  return pairBox('stts', runsOf(Array.from({ length: times.length }, (_, index) => (index + 1 < times.length ? times[index + 1] - times[index] : frame))))
}

/** The edit list with its first media edit starting `lag` later in the track, so the picture is shown that much sooner. */
function laterStart(bytes: Uint8Array, elst: Box, lag: number): Uint8Array {
  const out = bytes.slice(elst.start, elst.start + elst.size)
  const view = new DataView(out.buffer)
  const at = elst.headerSize
  const wide = out[at] === 1
  const entries = view.getUint32(at + 4)
  for (let index = 0; index < entries; index += 1) {
    const entry = at + 8 + index * (wide ? 20 : 12)
    const start = wide ? Number(view.getBigInt64(entry + 8)) : view.getInt32(entry + 4)
    if (start === -1) continue
    if (wide) view.setBigInt64(entry + 8, BigInt(Math.max(0, start + lag)))
    else view.setInt32(entry + 4, Math.max(0, start + lag))
    break
  }
  return out
}

/** The box tree written out again, with `replace` standing in for the boxes it names. */
function rebuild(bytes: Uint8Array, box: Box, replace: Map<Box, Uint8Array>): Uint8Array {
  const swapped = replace.get(box)
  if (swapped) return swapped
  if (!box.children) return bytes.subarray(box.start, box.start + box.size)
  const parts = box.children.map((item) => rebuild(bytes, item, replace))
  const lead = bytes.subarray(box.start + box.headerSize, box.children[0]?.start ?? box.start + box.size)
  const size = 8 + lead.length + parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  view.setUint32(0, size)
  out.set(bytes.subarray(box.start + 4, box.start + 8), 4)
  out.set(lead, 8)
  let at = 8 + lead.length
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** Every chunk offset moved by `shift`, as the media moves when an index in front of it changes size. */
function shiftOffsets(moov: Uint8Array, shift: number): void {
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength)
  const walk = (boxes: Box[]) => {
    for (const box of boxes) {
      if (box.children) walk(box.children)
      const at = box.start + box.headerSize
      if (box.type === 'stco') {
        const entries = view.getUint32(at + 4)
        for (let index = 0; index < entries; index += 1) {
          const value = view.getUint32(at + 8 + index * 4) + shift
          if (value < 0 || value > 0xffffffff) throw new Error('offset out of range')
          view.setUint32(at + 8 + index * 4, value)
        }
      } else if (box.type === 'co64') {
        const entries = view.getUint32(at + 4)
        for (let index = 0; index < entries; index += 1) view.setBigUint64(at + 8 + index * 8, view.getBigUint64(at + 8 + index * 8) + BigInt(shift))
      }
    }
  }
  walk(parseBoxes(moov, view, 0, moov.length))
}

/**
 * One video track's new timing tables (stts, with a ctts after it when frames are shown out of decoding order),
 * and how much later its edit list must start to keep the picture with the sound. Null when it needs nothing.
 */
async function steadyTrack(file: Blob, bytes: Uint8Array, view: DataView, stbl: Box, stts: Box): Promise<{ tables: Uint8Array; later: number } | null> {
  const decode = decodeTimes(view, stts)
  const count = decode.length
  const ctts = child(stbl, 'ctts')
  // Each frame's own shown time, and its place in display order.
  let shown = decode
  let ranks: Int32Array | null = null
  let reordered = false
  if (ctts) {
    const at = ctts.start + ctts.headerSize
    const signed = bytes[at] === 1
    shown = new Float64Array(count)
    let sample = 0
    for (let entry = 0; entry < view.getUint32(at + 4); entry += 1) {
      const runs = view.getUint32(at + 8 + entry * 8)
      const offset = signed ? view.getInt32(at + 12 + entry * 8) : view.getUint32(at + 12 + entry * 8)
      for (let step = 0; step < runs && sample < count; step += 1, sample += 1) shown[sample] = decode[sample] + offset
    }
    ranks = displayRanks(shown)
  } else {
    const record = avcRecord(bytes, view, stbl)
    const layout = record ? sampleLayout(view, stbl) : null
    if (record && layout && layout.sizes.length === count) {
      const first = Math.min(count, FIRST_LOOK)
      if (displayRanks(await orderKeys(file, layout, record, first))) {
        ranks = displayRanks(await orderKeys(file, layout, record, count))
        reordered = ranks !== null
      }
    }
  }
  // The shown times in display order: a frame without offsets is shown at a decoding time, in display order.
  const inOrder = ctts ? Float64Array.from(shown).sort() : decode
  const steady = steadyTimes(inOrder)
  if (!steady && !reordered) return null
  const frame = steady?.frame ?? mostCommonGap(inOrder)
  const even = steady?.times ?? inOrder
  if (!ranks) return { tables: sttsBox(even, frame), later: (steady?.lag ?? 0) - (ctts ? inOrder[0] : 0) }
  const order = ranks
  let shift = 0
  for (let sample = 0; sample < count; sample += 1) shift = Math.max(shift, even[sample] - even[order[sample]])
  const offsets = Float64Array.from({ length: count }, (_, sample) => even[order[sample]] - even[sample] + shift)
  const tables = new Uint8Array([...sttsBox(even, frame), ...pairBox('ctts', runsOf(offsets))])
  return { tables, later: (steady?.lag ?? 0) + shift - inOrder[0] }
}

function mostCommonGap(times: ArrayLike<number>): number {
  const tally = new Map<number, number>()
  for (let index = 1; index < times.length; index += 1) tally.set(times[index] - times[index - 1], (tally.get(times[index] - times[index - 1]) ?? 0) + 1)
  return [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1
}

/**
 * The file with its video frames put back on an even grid, or null when it needs nothing (or is not an MP4
 * TVN can read this way: fragmented, very large index, no video). Never throws.
 */
export async function steadyMp4(file: Blob): Promise<Blob | null> {
  try {
    const top = await topLevel(file)
    const found = top.find((box) => box.type === 'moov')
    if (!found || found.size > MAX_INDEX_BYTES || top.some((box) => box.type === 'moof')) return null
    const bytes = new Uint8Array(await file.slice(found.start, found.start + found.size).arrayBuffer())
    const view = new DataView(bytes.buffer)
    const [moov] = parseBoxes(bytes, view, 0, bytes.length)
    if (moov?.type !== 'moov' || child(moov, 'mvex')) return null
    const replace = new Map<Box, Uint8Array>()
    for (const trak of moov.children?.filter((box) => box.type === 'trak') ?? []) {
      const mdia = child(trak, 'mdia')
      const hdlr = child(mdia, 'hdlr')
      if (!hdlr || typeAt(bytes, hdlr.start + hdlr.headerSize + 8) !== 'vide') continue
      const stbl = child(child(mdia, 'minf'), 'stbl')
      const stts = child(stbl, 'stts')
      if (!stbl || !stts) continue
      const fixed = await steadyTrack(file, bytes, view, stbl, stts)
      if (!fixed) continue
      replace.set(stts, fixed.tables)
      const ctts = child(stbl, 'ctts')
      if (ctts) replace.set(ctts, new Uint8Array(0))
      const elst = child(child(trak, 'edts'), 'elst')
      if (elst && fixed.later !== 0) replace.set(elst, laterStart(bytes, elst, Math.round(fixed.later)))
    }
    if (replace.size === 0) return null
    const index = rebuild(bytes, moov, replace)
    const firstMedia = top.find((box) => box.type === 'mdat')
    if (firstMedia && found.start < firstMedia.start && index.length !== bytes.length) shiftOffsets(index, index.length - bytes.length)
    return new Blob([file.slice(0, found.start), index as Uint8Array<ArrayBuffer>, file.slice(found.start + found.size)], { type: file.type || 'video/mp4' })
  } catch {
    return null
  }
}

const steadied = new Map<string, Promise<string>>()
const made = new Map<string, string>()
const KEEP = 6
const MP4_FIRST_BOX = new Set(['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot'])

/**
 * What to play for a file on this device: an address for its steadied copy when its frames are bunched, else
 * the address it came with. Worked out once per address; only MP4-family files are looked at.
 */
export function steadyLocalUrl(url: string): Promise<string> {
  const known = steadied.get(url)
  if (known) return known
  const work = (async () => {
    if (!url.startsWith('blob:') || typeof fetch === 'undefined') return url
    const file = await (await fetch(url)).blob()
    const head = new Uint8Array(await file.slice(4, 8).arrayBuffer())
    if (head.length < 4 || !MP4_FIRST_BOX.has(typeAt(head, 0))) return url
    const fixed = await steadyMp4(file)
    const address = fixed ? URL.createObjectURL(fixed) : url
    if (steadied.has(url)) made.set(url, address)
    else if (address !== url) URL.revokeObjectURL(address)
    return address
  })().catch(() => url)
  steadied.set(url, work)
  if (steadied.size > KEEP) {
    const [oldest, address] = steadied.entries().next().value as [string, Promise<string>]
    steadied.delete(oldest)
    made.delete(oldest)
    void address.then((address) => {
      if (address !== oldest) URL.revokeObjectURL(address)
    })
  }
  return work
}

/** The address playing for `url` once worked out: its steadied copy, or itself. */
export function steadiedUrl(url: string): string {
  return made.get(url) ?? url
}
