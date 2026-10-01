import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { channelByNumber, listChannels } from './data/catalogue.ts'
import { BUILT_IN_CATALOGUE_FILES } from './data/user-network/bootstrap.ts'
import { claimStarterInstall, hasEarlierState, setStarterState, STARTER_KEY, starterIds, starterState, withoutStarter } from './data/user-network/starter.ts'
import { installUserCatalogue } from './data/user-overlay.ts'
import { applyChannelEdit, editOf, rescanChannel } from './services/channel-editor.ts'
import { channelsFromSources, mergeParsedExports, parseChannelsExport, type StoredSource } from './services/channels-import.ts'
import { setShippedArchive, uploaderIdFor } from './services/user-archive.ts'
import { addChannelSource, nextUserNumber, planTestChannels, removeUserChannels } from './services/user-network.ts'
import { SESSION_CHANNEL_NUMBER } from './session/session-channel.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const template = mergeParsedExports(BUILT_IN_CATALOGUE_FILES.map((file) => parseChannelsExport(read(`public${file.path}`))))
const pristine = structuredClone(template)
setShippedArchive(JSON.parse(read('public/user-network/uploaders.json')))

const STARTER = Array.from({ length: 81 }, (_, index) => 1001 + index)

function memoryStore(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed))
  return {
    get length() {
      return data.size
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, String(value)),
  }
}

const install = (existing: readonly StoredSource[] = []) => planTestChannels(existing, template, 5, uploaderIdFor)

function own(id: string, name: string, number: number): StoredSource {
  return { id, name, videos: [{ id: `${id.replace(/\W/g, '').slice(0, 8).padEnd(8, 'x')}001`, title: name, durationSec: 900 }], channelNumber: number, inLibrary: false, automatic: true, updatedAt: 1 }
}

afterEach(() => installUserCatalogue([], new Map()))

describe('the bundled starter network', () => {
  it('1. installs automatically for a genuinely fresh viewer, claimed before anything is saved', () => {
    const store = memoryStore()
    expect(claimStarterInstall(store)).toBe(true)
    expect(starterState(store)).toBe('pending')
    expect(claimStarterInstall(store)).toBe(true)
    const plan = install()
    expect(plan.added).toEqual(STARTER)
    setStarterState('installed', store)
    expect(claimStarterInstall(store)).toBe(false)
  })

  it('2. is exactly the 81 shipped definitions, in order, and never mutates the template', () => {
    expect(template.sources).toHaveLength(81)
    const plan = install()
    expect(plan.sources.map((source) => [source.channelNumber, source.id, source.name])).toEqual(
      template.sources.map((source, index) => [1001 + index, source.id, source.name]),
    )
    expect(new Set(plan.sources.map((source) => source.id)).size).toBe(81)
    plan.sources[0].name = 'Renamed'
    plan.sources[0].videos.pop()
    expect(template).toEqual(pristine)
  })

  it('3–5. leaves 001–999 untouched, 000 session-only and 1000 unused', () => {
    const curated = () => listChannels().filter((channel) => channel.number >= 1 && channel.number <= 999).map((channel) => [channel.number, channel.id, channel.name])
    const before = curated()
    const built = channelsFromSources(install().sources)
    installUserCatalogue(built.channels, built.programmes)
    expect(curated()).toEqual(before)
    expect(channelByNumber(SESSION_CHANNEL_NUMBER)?.origin).toBe('session')
    expect(built.channels.some((channel) => channel.number < 1001)).toBe(false)
    expect(channelByNumber(1000)).toBeUndefined()
    expect(channelByNumber(1001)?.origin).toBe('user-import')
    expect(channelByNumber(1081)?.origin).toBe('user-import')
    expect(channelByNumber(1082)).toBeUndefined()
  })

  it('6. a starter channel is editable user data: renamed and re-sourced in place, keeping its identity', () => {
    const sources = install().sources
    const edit = { ...editOf(sources[0]), name: 'My Starter Channel' }
    const next = applyChannelEdit(sources, 1001, edit, 9)
    expect(next[0]).toMatchObject({ id: sources[0].id, name: 'My Starter Channel', channelNumber: 1001 })
    expect(next.slice(1)).toEqual(sources.slice(1))
    expect(template).toEqual(pristine)
  })

  it('7. one starter channel can be deleted, the rest keep their numbers', () => {
    const sources = install().sources
    const left = removeUserChannels(sources, [1005])
    expect(left).toHaveLength(80)
    expect(left.map((source) => source.channelNumber)).toEqual(STARTER.filter((number) => number !== 1005))
  })

  it('8. the whole starter set can be deleted, edited or not, leaving the viewer’s own channels', () => {
    const mine = own('yt:UCmine0000000000000000001', 'Mine', 1082)
    const sources = [...applyChannelEdit(install().sources, 1001, { ...editOf(install().sources[0]), name: 'Renamed' }, 9), mine]
    expect(withoutStarter(sources, starterIds(template))).toEqual([mine])
  })

  it('9. never comes back after removal: reload, upgrade, either route, catalogue refresh', () => {
    const store = memoryStore()
    claimStarterInstall(store)
    setStarterState('removed', store)
    for (let visit = 0; visit < 3; visit += 1) expect(claimStarterInstall(store)).toBe(false)
    expect(starterState(store)).toBe('removed')
    const provider = read('src/state/TvProvider.tsx')
    expect(provider).toContain("if (numbers === 'all') setStarterState('removed')")
    expect(provider).toMatch(/const removeStarterNetwork = useCallback\(async \(\) => \{[\s\S]*?setStarterState\('removed'\)/)
    expect(read('src/data/user-network/bootstrap.ts')).not.toMatch(/planTestChannels|claimStarterInstall/)
  })

  it('10–11. adding it again is deliberate, never overwrites, and relocates to free numbers after the viewer’s own', () => {
    const mine = [own('yt:UCmine0000000000000000001', 'Mine', 1001), own('yt:UCmine0000000000000000002', 'Also mine', 1002)]
    const restored = install(mine)
    expect(restored.sources.slice(0, 2)).toEqual(mine)
    expect(restored.added).toEqual(STARTER.map((number) => number + 2))
    expect(install(restored.sources).added).toEqual([])
    const partial = removeUserChannels(install().sources, [1003, 1004])
    const topUp = install(partial)
    expect(topUp.sources.slice(0, 79)).toEqual(partial)
    expect(topUp.added).toEqual([1082, 1083])
  })

  it('12. new channels are allocated after 1081', () => {
    const sources = install().sources
    expect(nextUserNumber(sources)).toBe(1082)
    const added = addChannelSource(sources, { channelId: 'UCnew00000000000000000001', title: 'New', videos: [{ id: 'abcdefghij1', title: 'One', durationSec: 600 }] }, 9)
    expect(added).toMatchObject({ status: 'added', number: 1082 })
  })

  it('13. an existing viewer is never populated on upgrade, even with an empty User Network', () => {
    for (const key of ['retrotv.preferences.v1', 'tvn.notice.v1', 'tvn.surf.v1', 'retrotv.builtin-catalogues.v1']) {
      const store = memoryStore({ [key]: '1' })
      expect(hasEarlierState(store)).toBe(true)
      expect(claimStarterInstall(store)).toBe(false)
      expect(starterState(store)).toBe('skipped')
      expect(claimStarterInstall(store)).toBe(false)
    }
    expect(hasEarlierState(memoryStore({ 'other.site': 'x' }))).toBe(false)
    const provider = read('src/state/TvProvider.tsx')
    expect(provider).toMatch(/if \(automatic && existing\.length > 0\) \{\s*setStarterState\('skipped'\)/)
    expect(provider.indexOf('claimStarterInstall()')).toBeLessThan(provider.indexOf('loadPreferences()'))
  })

  it('14–15. / and /tvn share one User Network and one marker; changing route never reinstalls', () => {
    const starter = read('src/data/user-network/starter.ts')
    expect(starter).not.toMatch(/pathname|entryMode|location/)
    expect(STARTER_KEY).toBe('tvn.starter-network.v1')
    const store = memoryStore()
    claimStarterInstall(store)
    setStarterState('installed', store)
    expect(claimStarterInstall(store)).toBe(false)
    expect(read('src/state/TvProvider.tsx')).toMatch(/if \(startupPhase !== 'ready' \|\| !starterDue \|\| starterRanRef\.current\) return/)
  })

  it('16–17. the Channel Editor, ADD and rescan still work on starter channels', async () => {
    const sources = install().sources
    const rescanned = await rescanChannel(sources, 1002, editOf(sources[1]), { resolveYouTube: async () => { throw new Error('offline') }, probeStream: async () => 'online' }, 9)
    expect(rescanned.all[1].id).toBe(sources[1].id)
    expect(rescanned.all.filter((_, index) => index !== 1)).toEqual(sources.filter((_, index) => index !== 1))
    const guide = read('src/components/Guide.tsx')
    expect(guide).toContain('onSave={tv.saveChannelEdit}')
    expect(guide).toContain('onRescan={tv.rescanChannelEdit}')
    expect(guide).toContain('onRemoveStarter={tv.removeStarterNetwork}')
    expect(read('src/components/GuideAdd.tsx')).toContain("key('Channel list', () => listInput.current?.click())")
  })

  it('an existing viewer adds it deliberately from Guide → Add → Add starter network, whatever the marker says', () => {
    const guide = read('src/components/Guide.tsx')
    const add = read('src/components/GuideAdd.tsx')
    expect(add).toContain("action('Add', tool === 'add', () => onTool('add'))")
    expect(guide).toContain('onLoadTest={tv.loadTestChannels}')
    expect(add).toContain("key('Add starter network', () => void run(onLoadTest))")
    expect(guide).toContain('<TestChannelsButton onLoad={tv.loadTestChannels} />')
    const provider = read('src/state/TvProvider.tsx')
    const load = provider.slice(provider.indexOf('const loadTestChannels = useCallback('), provider.indexOf('const starterRanRef'))
    expect(load).toMatch(/if \(automatic && existing\.length > 0\)/)
    expect(load).not.toMatch(/starterState\(|claimStarterInstall/)
    for (const state of ['skipped', 'removed'] as const) {
      const store = memoryStore({ 'retrotv.preferences.v1': '{}' })
      setStarterState(state, store)
      expect(claimStarterInstall(store)).toBe(false)
    }
  })

  it('an existing viewer with no user channels gets exactly 1001–1081; one with channels keeps them and gets the rest after', () => {
    expect(install([]).added).toEqual(STARTER)
    const mine = [own('yt:UCmine0000000000000000001', 'Mine', 1001), own('yt:UCmine0000000000000000002', 'Mine too', 1040)]
    const plan = install(mine)
    expect(plan.sources.slice(0, 2)).toEqual(mine)
    expect(plan.added[0]).toBe(1041)
    expect(plan.added).toHaveLength(81)
    expect(new Set(plan.sources.map((source) => source.channelNumber)).size).toBe(plan.sources.length)
  })

  it('ships the template in the release build input', () => {
    for (const file of BUILT_IN_CATALOGUE_FILES) expect(read(`public${file.path}`).length).toBeGreaterThan(100_000)
  })
})
