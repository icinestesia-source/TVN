import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { steadyMp4, steadyTimes } from './mp4-steady.ts'

const FRAME = 3750

/** Bunched like the jittery downloads: four frames packed into one frame's time, beside a gap, before or after it. */
function bunched(count: number): number[] {
  const deltas: number[] = []
  for (let index = 0; index < count - 1; index += 1) {
    const at = index % 40
    const gapFirst = Math.floor(index / 40) % 2 === 1
    const squeezed = gapFirst ? at >= 31 && at < 35 : at >= 30 && at < 34
    const gap = gapFirst ? at === 30 : at === 34
    deltas.push(squeezed ? 937 : gap ? FRAME * 5 - 937 * 4 : FRAME)
  }
  return deltas
}

const times = (deltas: number[]) => deltas.reduce<number[]>((out, delta) => [...out, out.at(-1)! + delta], [0])

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const size = 8 + parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(size)
  new DataView(out.buffer).setUint32(0, size)
  out.set([...type].map((c) => c.charCodeAt(0)), 4)
  let at = 8
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const u32 = (...values: number[]) => {
  const out = new Uint8Array(values.length * 4)
  values.forEach((value, index) => new DataView(out.buffer).setUint32(index * 4, value))
  return out
}

/** A small MP4: one video track with the given frame lengths, its index in front of (or behind) the media. */
function mp4(deltas: number[], indexFirst: boolean): { file: Blob; mediaAt: number } {
  const runs: number[] = []
  for (const delta of [...deltas, FRAME]) runs.push(1, delta)
  const hdlr = box('hdlr', u32(0, 0), new TextEncoder().encode('vide'), u32(0, 0, 0), new Uint8Array([0]))
  const stco = (offset: number) => box('stco', u32(0, 1, offset))
  const moovWith = (offset: number) =>
    box('moov', box('trak', box('mdia', hdlr, box('minf', box('stbl', box('stts', u32(0, runs.length / 2, ...runs)), stco(offset))))))
  const ftyp = box('ftyp', new TextEncoder().encode('isom'), u32(0))
  const mdat = box('mdat', new Uint8Array(64).fill(7))
  if (!indexFirst) return { file: new Blob([ftyp, mdat, moovWith(ftyp.length + 8)] as BlobPart[]), mediaAt: ftyp.length + 8 }
  const size = moovWith(0).length
  const mediaAt = ftyp.length + size + 8
  return { file: new Blob([ftyp, moovWith(mediaAt), mdat] as BlobPart[]), mediaAt }
}

/** Frame lengths and the media offset as the steadied file's index gives them. */
async function readBack(file: Blob): Promise<{ deltas: number[]; offset: number; media: number }> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const text = new TextDecoder('latin1').decode(bytes)
  const view = new DataView(bytes.buffer)
  const stts = text.indexOf('stts') + 4
  const deltas: number[] = []
  for (let index = 0; index < view.getUint32(stts + 4); index += 1) {
    for (let step = 0; step < view.getUint32(stts + 8 + index * 8); step += 1) deltas.push(view.getUint32(stts + 12 + index * 8))
  }
  return { deltas, offset: view.getUint32(text.indexOf('stco') + 12), media: text.indexOf('mdat') + 4 }
}

describe('a local MP4 whose frames are bunched plays steadily', () => {
  it('puts every frame on the file’s own grid without drifting from the sound', () => {
    const before = times(bunched(400))
    const steady = steadyTimes(before)!
    expect(steady.frame).toBe(FRAME)
    const after = [...steady.times]
    for (let index = 1; index < after.length; index += 1) expect(after[index] - after[index - 1]).toBe(FRAME)
    const drift = after.map((time, index) => Math.abs(time - before[index]))
    expect(Math.max(...drift)).toBeLessThanOrEqual(FRAME * 5)
  })

  it('takes up the file’s own time again after a real pause in the picture', () => {
    const deltas = bunched(400)
    deltas[300] = FRAME * 48
    const before = times(deltas)
    const after = [...steadyTimes(before)!.times]
    expect(after[301] - after[300]).toBeGreaterThan(FRAME * 8)
    expect(Math.abs(after[399] - before[399])).toBeLessThanOrEqual(FRAME)
  })

  it('leaves even, nearly even and genuinely variable timing alone', () => {
    expect(steadyTimes(times(Array(400).fill(FRAME)))).toBeNull()
    expect(steadyTimes(times(Array.from({ length: 400 }, (_, index) => (index === 200 ? 937 : FRAME))))).toBeNull()
    expect(steadyTimes(times(Array.from({ length: 400 }, (_, index) => 1000 + (index % 7) * 500)))).toBeNull()
  })

  it('rewrites only the index, moving the media offsets when the index sits in front of the media', async () => {
    for (const indexFirst of [true, false]) {
      const { file } = mp4(bunched(400), indexFirst)
      const fixed = (await steadyMp4(file))!
      expect(fixed).not.toBeNull()
      const back = await readBack(fixed)
      expect(back.deltas).toHaveLength(400)
      expect(new Set(back.deltas)).toEqual(new Set([FRAME]))
      expect(back.offset).toBe(back.media)
      expect(fixed.size).toBeLessThan(file.size)
    }
  })

  it('returns nothing for an even file or one that is not an MP4', async () => {
    expect(await steadyMp4(mp4(Array(400).fill(FRAME), true).file)).toBeNull()
    expect(await steadyMp4(new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8])]))).toBeNull()
  })

  it('plays files from this device through it, and never for streams or the web', () => {
    const stage = readFileSync('src/player/LocalStage.tsx', 'utf8')
    expect(stage).toMatch(/if \(!live && url\.startsWith\('blob:'\)\) \{[\s\S]*steadyLocalUrl\(url\)/)
  })
})
