import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionImportTools } from './components/GuideAdd.tsx'
import { forgetFlvSource, localFlvSeconds, registerFlvSource } from './player/flv.ts'
import { scanFlv } from './player/flv-index.ts'
import { sliceLoader } from './player/flv-slices.ts'
import { buildSessionItems, sniffRemux } from './session/import.ts'

const read = (path: string) => readFileSync(path, 'utf8')

/** A small FLV with one picture codec: header, codec header, then frames and audio for `seconds`. */
function flv(seconds: number, codec = 7): Uint8Array<ArrayBuffer> {
  const out: number[] = [0x46, 0x4c, 0x56, 1, 5, 0, 0, 0, 9, 0, 0, 0, 0]
  const tag = (type: number, ms: number, data: number[]) => {
    const size = data.length
    out.push(type, (size >> 16) & 255, (size >> 8) & 255, size & 255, (ms >> 16) & 255, (ms >> 8) & 255, ms & 255, (ms >> 24) & 255, 0, 0, 0, ...data)
    const total = 11 + size
    out.push((total >>> 24) & 255, (total >> 16) & 255, (total >> 8) & 255, total & 255)
  }
  tag(9, 0, [0x10 | codec, 0, 0, 0, 0, 1, 2, 3])
  for (let ms = 0; ms <= seconds * 1000; ms += 500) {
    tag(9, ms, [(ms % 1000 === 0 ? 0x10 : 0x20) | codec, 1, 0, 0, 0, 7, 7, 7])
    tag(8, ms, [0xaf, 1, 3, 3, 3])
  }
  return new Uint8Array(out)
}

describe('Local Media editor', () => {
  it('has a Close button, after the others, wherever the editor opens', () => {
    const closing = renderToStaticMarkup(createElement(SessionImportTools, { onImport: async () => '', onClose: () => {} }))
    expect(closing).toMatch(/<button type="button" class="tab">Close<\/button><\/div>/)
    expect(renderToStaticMarkup(createElement(SessionImportTools, { onImport: async () => '' }))).not.toContain('>Close<')
    expect(read('src/components/Guide.tsx')).toMatch(/<SessionImportTools[\s\S]*?onClose=\{\(\) => tv\.dispatch\(\{ type: 'guide-tool', tool: 'media' \}\)\}/)
    expect(read('src/app/TvScreen.tsx')).toMatch(/<SessionImportTools[\s\S]*?onClose=\{\(\) => tv\.dispatch\(\{ type: 'guide-tool', tool: 'edit' \}\)\}/)
  })
})

describe('FLV from this device', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is known by its own bytes, so an FLV saved as .mp4 is still repackaged', async () => {
    expect(await sniffRemux(new Blob([flv(2)]))).toBe('flv')
    expect(await sniffRemux(new Blob([new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70])]))).toBeUndefined()
    const urls = new Map<string, string | undefined>()
    const result = await buildSessionItems([new File([flv(90)], 'Mountain.mp4', { type: 'video/mp4' })], {
      canPlay: () => true,
      createUrl: (_file, remux) => {
        urls.set('blob:1', remux)
        return 'blob:1'
      },
      revokeUrl: () => {},
      sniff: sniffRemux,
      probe: async (_url, _kind, remux) => (remux === 'flv' ? 90 : null),
    })
    expect(urls.get('blob:1')).toBe('flv')
    expect(result.items.map((item) => item.remux)).toEqual(['flv'])
  })

  it('is measured from its tags, without loading it into a media element', async () => {
    vi.stubGlobal('window', { MediaSource: { isTypeSupported: () => true } })
    registerFlvSource('blob:h264', new Blob([flv(30)]))
    registerFlvSource('blob:vp6', new Blob([flv(30, 4)]))
    try {
      expect(await localFlvSeconds('blob:h264', 'video')).toBe(30)
      expect(await localFlvSeconds('blob:vp6', 'video')).toBeNull()
      expect(await localFlvSeconds('blob:unknown', 'video')).toBeUndefined()
    } finally {
      forgetFlvSource('blob:h264')
      forgetFlvSource('blob:vp6')
    }
    const bytes = flv(3, 12)
    expect((await scanFlv(async (start, end) => bytes.slice(start, end), bytes.length))?.videoCodec).toBe(12)
  })

  it('reaches the FLV player a slice at a time, never the whole file in one piece', async () => {
    const file = new Blob([new Uint8Array(5000)])
    const Loader = sliceLoader(file, 2000)
    const loader = new Loader()
    const chunks: [number, number, number | undefined][] = []
    const done = new Promise<[number, number]>((resolve) => {
      loader.onComplete = (from, to) => resolve([from, to])
    })
    loader.onDataArrival = (chunk, start, received) => chunks.push([chunk.byteLength, start, received])
    loader.open(null, { from: 500, to: -1 })
    expect(await done).toEqual([500, 4999])
    expect(chunks).toEqual([
      [2000, 500, 2000],
      [2000, 2500, 4000],
      [500, 4500, 4500],
    ])
    expect(loader.status).toBe(4)
  })

  it('stops reading when the player pauses it', async () => {
    const Loader = sliceLoader(new Blob([new Uint8Array(10_000)]), 1000)
    const loader = new Loader()
    let arrived = 0
    loader.onDataArrival = () => {
      arrived += 1
      if (arrived === 2) loader.abort()
    }
    loader.open(null, { from: 0, to: 9999 })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(arrived).toBe(2)
    expect(loader.isWorking()).toBe(false)
  })
})
