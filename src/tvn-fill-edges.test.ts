import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { shownDescription } from './components/ProgrammeInfo.tsx'
import type { Programme } from './types/programme.ts'
import { containedBox, FILL_EDGES_KEY, leavesEdges, loadFillEdges, setFillEdges, shapedThumbnail, youtubeAspect } from './view/fill-edges.ts'

const memory = () => {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) }
}

describe('Fill edges', () => {
  it('is off until the viewer turns it on, and is kept', () => {
    const store = memory()
    expect(loadFillEdges(store)).toBe(false)
    setFillEdges(true, store)
    expect(store.getItem(FILL_EDGES_KEY)).toBe('on')
    expect(loadFillEdges(store)).toBe(true)
    setFillEdges(false, store)
    expect(loadFillEdges(store)).toBe(false)
  })

  it('places a Short in a centred box of its own shape', () => {
    const slot = { width: 1600, height: 900 }
    expect(containedBox(slot, 9 / 16)).toEqual({ left: (1600 - 506.25) / 2, top: 0, width: 506.25, height: 900 })
    expect(containedBox(slot, 16 / 9)).toEqual({ left: 0, top: 0, width: 1600, height: 900 })
  })

  it('fills only where the picture leaves real edges', () => {
    const slot = { width: 1600, height: 900 }
    expect(leavesEdges(slot, 9 / 16)).toBe(true)
    expect(leavesEdges(slot, 4 / 3)).toBe(true)
    expect(leavesEdges(slot, 16 / 9)).toBe(false)
    expect(leavesEdges(slot, 1.7)).toBe(false)
    expect(leavesEdges({ width: 0, height: 0 }, 9 / 16)).toBe(false)
  })

  it("reads a YouTube video's shape from its own-shape thumbnail, once", async () => {
    let loads = 0
    const load = async (src: string) => {
      loads += 1
      expect(src).toBe(shapedThumbnail('shortAbc123'))
      return { width: 720, height: 1280 }
    }
    expect(await youtubeAspect('shortAbc123', load)).toBeCloseTo(9 / 16)
    expect(await youtubeAspect('shortAbc123', load)).toBeCloseTo(9 / 16)
    expect(loads).toBe(1)
    expect(await youtubeAspect('plainXyz789', async () => null)).toBeNull()
  })

  it('is a choice in Options, under Display', () => {
    const options = readFileSync('src/components/GuideOptions.tsx', 'utf8')
    expect(options).toMatch(/<Row label="Fill edges">/)
  })
})

describe('Information overlay text', () => {
  const programme = (fields: Partial<Programme>): Programme =>
    ({ id: 'p', title: 'A clip', channelId: 'c', durationSeconds: 60, videoId: null, ...fields }) as Programme

  it("keeps a feed clip's own description (Odysee, BitChute, archives) off the overlay", () => {
    expect(shownDescription(programme({ sourceRef: 'podcast:abc', mediaKind: 'video', mediaUrl: 'https://example.org/a.mp4', description: 'Subscribe and follow me on…' }))).toBeNull()
    expect(shownDescription(programme({ sourceRef: 'youtube:abc', description: 'A film about the sea.' }))).toBe('A film about the sea.')
  })
})

describe('A playing channel outside the selection', () => {
  it('shows in the gold, not italic, over a user row', () => {
    const css = readFileSync('src/styles/guide.css', 'utf8')
    const visiting = css.lastIndexOf('.channel-cell.is-visiting .ch-name { color: var(--gold); }')
    expect(visiting).toBeGreaterThan(css.indexOf('.channel-cell.is-user .ch-name {'))
    expect(css).not.toMatch(/is-visiting[^{]*\{[^}]*font-style:\s*italic/)
  })
})
