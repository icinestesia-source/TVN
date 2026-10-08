import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { commandFromKey } from './input/keyboard.ts'
import { MEDIA_ACCEPT, mediaKindOf, remuxFor } from './session/import.ts'
import { clearSession, replaceSession, sessionBroadcast, sessionNeighbour, setUrlRevoker } from './session/session-channel.ts'
import { playbackCommand } from './player/command.ts'
import { remuxOf } from './player/flv.ts'
import { channelsFromSources, type StoredSource } from './services/channels-import.ts'
import { buildUserNetworkExport, validateUserNetworkExport } from './services/user-network-export.ts'
import { favouritesAfterRestore, readUserNetworkFile, recordsFromExport, resolveRestored, restoreUserNetwork } from './services/user-network-restore.ts'
import { guideTabLabel, guideTabs, nextGuideTab } from './state/guide-tabs.ts'
import { userFilter } from './data/user-network/users.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const plain = { meta: false, ctrl: false, alt: false }

afterEach(() => clearSession())

describe('Import Media takes more file types, FLV among them', () => {
  const anything = () => true

  it('offers FLV and the other added containers in the picker', () => {
    for (const ext of ['.flv', '.f4v', '.3g2', '.m4b', '.mka', '.qt', '.ogm', '.aiff']) expect(MEDIA_ACCEPT).toContain(ext)
  })

  it('reads an FLV as video to be repackaged, whether the system names its type or not', () => {
    for (const type of ['video/x-flv', '', 'application/octet-stream']) {
      const file = { name: 'Old Show.flv', type }
      expect(mediaKindOf(file, anything)).toBe('video')
      expect(remuxFor(file)).toBe('flv')
    }
    expect(remuxFor({ name: 'clip.mp4', type: 'video/mp4' })).toBeUndefined()
  })

  it('still skips a file the browser cannot play', () => {
    expect(mediaKindOf({ name: 'Old Show.flv', type: '' }, () => false)).toBeNull()
    expect(mediaKindOf({ name: 'notes.txt', type: 'text/plain' }, anything)).toBeNull()
  })

  it('an imported FLV reaches the player marked for repackaging; a web FLV address does too', () => {
    setUrlRevoker(() => {})
    replaceSession(
      [
        { title: 'Flv', durationSeconds: 60, url: 'blob:flv', kind: 'video', remux: 'flv' },
        { title: 'Mp4', durationSeconds: 60, url: 'blob:mp4', kind: 'video' },
      ],
      0,
    )
    const [flv, mp4] = sessionBroadcastProgrammes()
    expect(playbackCommand(flv, 0, null)).toMatchObject({ localUrl: 'blob:flv', remux: 'flv' })
    expect(playbackCommand(mp4, 0, null).remux).toBeUndefined()
    expect(remuxOf('https://example.org/show.flv?x=1')).toBe('flv')
    expect(remuxOf('https://example.org/show.mp4')).toBeUndefined()
  })

  it('the FLV library is loaded only when an FLV plays', () => {
    const flv = read('src/player/flv.ts')
    expect(flv).toContain("await import('mpegts.js')")
    expect(flv).not.toMatch(/^import (?!type ).*mpegts/m)
  })
})

function sessionBroadcastProgrammes() {
  const first = sessionBroadcast(0).current.programme
  const second = sessionBroadcast(first.durationSeconds * 1000).current.programme
  return [first, second]
}

describe('B and N on 1000 Local Media', () => {
  it('step to the imported programme after or before the one airing, round the running order', () => {
    setUrlRevoker(() => {})
    replaceSession(
      ['One', 'Two', 'Three'].map((title) => ({ title, durationSeconds: 100, url: `blob:${title}`, kind: 'video' as const })),
      0,
    )
    expect(sessionNeighbour(10_000, 1)?.title).toBe('Two')
    expect(sessionNeighbour(10_000, -1)?.title).toBe('Three')
    expect(sessionNeighbour(150_000, 1)?.title).toBe('Three')
    expect(sessionNeighbour(250_000, 1)?.title).toBe('One')
  })

  it('are null on the empty channel, and the provider plays the step through Play Now', () => {
    expect(sessionNeighbour(0, 1)).toBeNull()
    const provider = read('src/state/TvProvider.tsx')
    expect(provider).toMatch(/here\?\.origin === 'session'\) \{\s+const target = sessionNeighbour\(Date\.now\(\), direction, here\.number\)\s+if \(target\) sessionRef\.current\.play\(target\.id\)/)
  })
})

describe('RESTORE brings back exactly the file’s channels', () => {
  const file = readUserNetworkFile(read('public/user-network/starter-network.json'))
  const failing = {
    resolveYouTube: () => Promise.reject(new Error('offline')),
    resolveFeed: () => Promise.reject(new Error('offline')),
  }

  it('every channel stays listed on its own number even when no source can be read', async () => {
    expect(file.ok).toBe(true)
    if (!file.ok) return
    const bare = { ...file.value, channels: file.value.channels.map((channel) => ({ ...channel, sources: channel.sources.map((source) => ({ ...source, videos: [] })) })) }
    const resolved = await resolveRestored(recordsFromExport(bare, 0), failing, 0)
    const built = channelsFromSources(resolved.records)
    expect(built.channels).toHaveLength(file.value.channels.length)
    expect(built.channels.map((channel) => channel.number)).toEqual(file.value.channels.map((channel) => channel.number))
  })

  it('missing channels are added and channels not in the file go, whatever the browser held', async () => {
    if (!file.ok) return
    const extra: StoredSource = { id: 'added:mine', name: 'Mine', videos: [{ id: 'v1', title: 'V', durationSec: 60 }], channelNumber: 1500, inLibrary: false, automatic: true, updatedAt: 0 }
    const records = recordsFromExport(file.value, 0)
    const partial = records.slice(0, 40)
    const resolved = await resolveRestored(records, failing, 0)
    const next = restoreUserNetwork([...partial, extra], resolved.records)
    const user = next.filter((record) => (record.channelNumber ?? 0) >= 1001)
    expect(user).toHaveLength(file.value.channels.length)
    expect(user.some((record) => record.id === 'added:mine')).toBe(false)
    expect(channelsFromSources(next).channels).toHaveLength(file.value.channels.length)
  })
})

describe('USER exports carry their Favourites; RESTORE offers ALL or USER', () => {
  const record = (number: number, empty = false): StoredSource =>
    empty
      ? { id: `slot:${number}`, name: 'Empty', videos: [], channelNumber: number, inLibrary: false, automatic: true, updatedAt: 0, emptySlot: true }
      : { id: `added:UC${number}`, name: `Ch ${number}`, videos: [{ id: `v${number}`, title: 'V', durationSec: 60 }], channelNumber: number, inLibrary: false, automatic: true, updatedAt: 0 }

  it('a USER export lists the User Network Favourites only, in order', () => {
    const doc = buildUserNetworkExport([record(1001), record(1002), record(1003, true)], new Date(0), () => null, [], [225, 1002, 1003, 1001, 1999])
    expect(doc.favourites).toEqual([1002, 1001])
    expect(validateUserNetworkExport(JSON.parse(JSON.stringify(doc))).ok).toBe(true)
    expect(buildUserNetworkExport([record(1001)], new Date(0)).favourites).toBeUndefined()
  })

  it('a file’s Favourites must be User Network numbers, each once', () => {
    const doc = buildUserNetworkExport([record(1001)], new Date(0), () => null, [], [1001])
    expect(validateUserNetworkExport({ ...doc, favourites: [225] }).ok).toBe(false)
    expect(validateUserNetworkExport({ ...doc, favourites: [1001, 1001] }).ok).toBe(false)
  })

  it('restoring a file with Favourites replaces only the User Network ones', () => {
    const restored = [record(1001), record(1002), record(1003)]
    expect(favouritesAfterRestore([225, 1003, 534], restored, [1002, 1001, 1777])).toEqual([225, 534, 1002, 1001])
    expect(favouritesAfterRestore([225, 1003, 1777], restored)).toEqual([225, 1003])
  })

  it('ALL restores everything; USER only the User Network with its Favourites', () => {
    const provider = read('src/state/TvProvider.tsx')
    expect(provider).toContain("async (document: TvnExport, scope: 'all' | 'user' = 'all', onProgress?: (note: string) => void) =>")
    expect(provider).toContain('return importUserNetwork({ ...checked.value.userNetwork, favourites }, onProgress)')
    const add = read('src/components/GuideAdd.tsx')
    for (const label of ["'Restore ALL'", "'Restore USER only'", "'Restore USER'", "'Export ALL'", "'Export USER'"]) expect(add).toContain(label)
    const options = read('src/components/GuideOptions.tsx')
    expect(options).toContain('Export ALL')
    expect(options).toContain('Export USER')
  })
})

describe('R cycles All, User and Fav', () => {
  it('R is the Guide-tab cycle, with the Guide open or closed; Space stays Random', () => {
    expect(commandFromKey('r', plain, false)).toEqual({ type: 'guide-cycle' })
    expect(commandFromKey('R', plain, true)).toEqual({ type: 'guide-cycle' })
    expect(commandFromKey(' ', plain, false)).toEqual({ type: 'random-channel' })
  })

  it('goes All → User → each named user → Fav → All, as the tabs are shown', () => {
    const ids = ['a1', 'b2']
    expect(guideTabs(ids)).toEqual(['all', 'user', userFilter('a1'), userFilter('b2'), 'favourites'])
    let filter = nextGuideTab('all', ids)
    const seen = [filter]
    for (let step = 0; step < 4; step += 1) seen.push((filter = nextGuideTab(filter, ids)))
    expect(seen).toEqual(['user', userFilter('a1'), userFilter('b2'), 'favourites', 'all'])
    expect(nextGuideTab('favourites', [])).toBe('all')
    expect(nextGuideTab('films', ids)).toBe('all')
  })

  it('names each tab as its button does', () => {
    const users = [{ id: 'a1', name: 'Jan' }]
    expect(guideTabLabel('all', users)).toBe('ALL')
    expect(guideTabLabel('favourites', users)).toBe('FAV')
    expect(guideTabLabel(userFilter('a1'), users)).toBe('JAN')
  })
})
