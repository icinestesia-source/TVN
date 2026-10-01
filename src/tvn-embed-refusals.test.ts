import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mediaLibrary } from './director/library.ts'
import { getEligibleMedia } from './library/query.ts'
import { librarySnapshot, loadShippedIndependentCatalogue, republishLibrary, resetLibraryForTests, setLibraryWriter } from './library/store.ts'
import {
  CURATED_PLAYBACK_PATH,
  isRefusedVideo,
  learnRefusal,
  loadShippedRefusals,
  PLAYBACK_PATH,
  refusedVideos,
  resetRefusalsForTests,
  setShippedRefusals,
} from './services/embed-refusals.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const shipped = JSON.parse(read('public/independent/playable.json'))
const routedTo = (channel: number) =>
  (shipped.items as [string, string, number, string, number[]][]).filter((row) => row[4]?.includes(channel)).map((row) => row[0])

function memoryStorage() {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) })
}

async function loadCatalogue() {
  resetLibraryForTests()
  setLibraryWriter({ async write() {}, async read() { return { media: [], sources: [] } } })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(shipped), { status: 200 })))
  await loadShippedIndependentCatalogue()
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetLibraryForTests()
  resetRefusalsForTests()
})

describe('curated videos that refuse embedded playback', () => {
  it('reads the curated list alongside the User Network list, either one missing', async () => {
    const lists: Record<string, unknown> = {
      [PLAYBACK_PATH]: { embedRefused: ['userRefused'] },
      [CURATED_PLAYBACK_PATH]: { embedRefused: ['curatedOne1', 'curatedTwo2'] },
    }
    const fake = async (path: string) =>
      path in lists ? new Response(JSON.stringify(lists[path]), { status: 200 }) : new Response('', { status: 404 })
    await loadShippedRefusals(fake as typeof fetch)
    expect([...refusedVideos()].sort()).toEqual(['curatedOne1', 'curatedTwo2', 'userRefused'])
    delete lists[CURATED_PLAYBACK_PATH]
    await loadShippedRefusals(fake as typeof fetch)
    expect([...refusedVideos()]).toEqual(['userRefused'])
    await loadShippedRefusals((async () => { throw new TypeError('offline') }) as typeof fetch)
    expect(refusedVideos().size).toBe(0)
  })

  it('are never scheduled, but stay in the library (hidden, not deleted)', async () => {
    memoryStorage()
    await loadCatalogue()
    const [refused, playable] = routedTo(225)
    expect(mediaLibrary().some((item) => item.externalId === refused)).toBe(true)
    setShippedRefusals([refused!])
    republishLibrary()
    expect(mediaLibrary().some((item) => item.externalId === refused)).toBe(false)
    expect(mediaLibrary().some((item) => item.externalId === playable)).toBe(true)
    expect(getEligibleMedia(mediaLibrary(), 225).some((item) => item.externalId === refused)).toBe(false)
    expect(librarySnapshot().media.some((item) => item.externalId === refused)).toBe(true)
  }, 120_000)

  it('a refusal seen in this browser hides the video at once and is remembered', async () => {
    memoryStorage()
    await loadCatalogue()
    const [, , seen] = routedTo(225)
    expect(learnRefusal(seen!)).toBe(true)
    expect(learnRefusal(seen!)).toBe(false)
    expect(isRefusedVideo(seen!)).toBe(true)
    republishLibrary()
    expect(mediaLibrary().some((item) => item.externalId === seen)).toBe(false)
  }, 120_000)

  it('the provider learns refusals on every channel and retunes in place', () => {
    const provider = read('src/state/TvProvider.tsx')
    expect(provider).toContain('if (!videoId || !isRefusalCode(detail) || !learnRefusal(videoId)) return')
    expect(provider).toMatch(/return\n\s*\}\n\s*republishLibrary\(\)\n\s*loadedKey\.current = ''\n\s*syncLive\(Date\.now\(\)\)/)
    expect(read('src/library/store.ts')).toContain('forDirector(item) && !isRefusedVideo(item.externalId)')
  })
})

describe('the shipped curated list', () => {
  const list = JSON.parse(read('public/independent/playback.json'))
  const ids = new Set((shipped.items as [string][]).map((row) => row[0]))

  it('lists only catalogue video ids, each once', () => {
    expect(Array.isArray(list.embedRefused)).toBe(true)
    expect(new Set(list.embedRefused).size).toBe(list.embedRefused.length)
    for (const id of [...list.embedRefused, ...list.suspectedRefused]) expect(ids.has(id), id).toBe(true)
    expect(list.videos).toBeGreaterThanOrEqual(list.embedRefused.length)
  })

  it('holds only the trusted first stretch: 759 tested on 225, three refusals still only suspected', () => {
    expect(list.videos).toBe(759)
    expect(list.states.CONFIRMED_REFUSED).toBe(list.embedRefused.length)
    expect(list.suspectedRefused).toEqual(['R8kc1_Nusrs', 'zXVoG3z8CMo', '9M7sI3TjtKE'])
    expect(list.states.TIMEOUT + list.states.INCONCLUSIVE).toBe(0)
  })

  it('TVN hides confirmed refusals only, never suspected ones', async () => {
    await loadShippedRefusals((async (path: string) =>
      new Response(path === CURATED_PLAYBACK_PATH ? JSON.stringify(list) : '', { status: path === CURATED_PLAYBACK_PATH ? 200 : 404 })) as typeof fetch)
    for (const id of list.suspectedRefused) expect(isRefusedVideo(id)).toBe(false)
    expect(refusedVideos().size).toBe(list.embedRefused.length)
  })

  it('comes from a probe that uses the public player only: no key, the same refusal codes as TVN', () => {
    const probe = read('scripts/embed_probe.ts')
    const core = read('scripts/embed-probe-core.ts')
    expect(`${probe}${core}`).not.toMatch(/retrotv_key|googleapis|key=/)
    expect(core).toContain("export const REFUSED = new Set(['100', '101', '150'])")
    expect(read('src/services/embed-refusals.ts')).toContain("const REFUSAL_CODES = new Set(['100', '101', '150'])")
    expect(probe).toContain('https://www.youtube.com/iframe_api')
  })
})
