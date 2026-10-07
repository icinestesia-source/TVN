import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { listChannels } from './data/catalogue.ts'
import { channelMatchesFilter } from './data/network.ts'
import { installUserCatalogue } from './data/user-overlay.ts'
import { ownerOf, releaseUserChannels, TVN_OWNER, userFilter, type NetworkUser } from './data/user-network/users.ts'
import type { ChannelSource } from './services/channel-sources.ts'
import { channelsFromSources, emptySlotRecord, mergeParsedExports, parseChannelsExport, type ImportedVideo, type StoredSource } from './services/channels-import.ts'
import { setShippedArchive, uploaderIdFor } from './services/user-archive.ts'
import { clearUserChannel, planTestChannels } from './services/user-network.ts'
import { buildUserNetworkExport, serialiseUserNetworkExport, validateUserNetworkExport, type UserNetworkExport } from './services/user-network-export.ts'
import { favouritesAfterRestore, readUserNetworkFile, recordsFromExport, resolveRestored, restoreUserNetwork, usersFromExport } from './services/user-network-restore.ts'
import { randomTarget, stepTarget, universeChannels, type ChannelUniverse } from './state/tuning.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const provider = read('src/state/TvProvider.tsx')
const guide = read('src/components/Guide.tsx')
const NOW = new Date(2026, 9, 2, 3, 0)

const SAM: NetworkUser = { id: 'usam1', name: 'Sam' }
const ALEX: NetworkUser = { id: 'ualex2', name: 'Alex' }
const USERS = [SAM, ALEX]
const LIST = 'PL490JTer_zRIZbIlQUdavpI-yelTGVBgu'

function videos(prefix: string, count: number): ImportedVideo[] {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}${String(index).padStart(11 - prefix.length, '0')}`, title: `${prefix} ${index + 1}`, durationSec: 900 }))
}

const channelId = (n: number) => `UC${String(n).padStart(22, '0')}`

function added(n: number, name: string, owner?: string): StoredSource {
  return { id: `yt:${channelId(n)}`, name, videos: videos(`c${n}`, 4), channelNumber: n, inLibrary: false, automatic: true, updatedAt: 1, ...(owner ? { owner } : {}) }
}

/** TVN: 1001, 1002 and an empty 1003. Sam: 1004 and a playlist on 1005. Alex: a renamed channel with a disabled source on 1006. */
function network(): StoredSource[] {
  const alexSources: ChannelSource[] = [
    { id: 's1', kind: 'youtube', url: '', label: 'Original Alex Source', enabled: true, ref: channelId(1006), youtube: 'channel', videos: videos('c1006', 3) },
    { id: 's2', kind: 'audio', url: 'https://radio.example/stream', label: 'Radio', enabled: false },
  ]
  return [
    added(1001, 'TVN One'),
    added(1002, 'TVN Two'),
    emptySlotRecord(1003, 1),
    added(1004, 'Sam News', SAM.id),
    { id: `yt:${LIST}`, name: 'Sam Films', sourceType: 'youtube-playlist', videos: videos('pl', 3), channelNumber: 1005, inLibrary: false, automatic: true, updatedAt: 1, owner: SAM.id },
    { ...added(1006, 'Alex Renamed', ALEX.id), channelSources: alexSources, videos: videos('c1006', 3) },
  ]
}

function install(sources: readonly StoredSource[], users: readonly NetworkUser[] = USERS) {
  const built = channelsFromSources(sources, { users: new Set(users.map((user) => user.id)) })
  installUserCatalogue(built.channels, built.programmes)
  return built
}

const userNumbers = (filter: ChannelUniverse['filter']) => universeChannels({ filter, favourites: [] }).filter((channel) => channel.number >= 1001).map((channel) => channel.number)

/** RESTORE reads every YouTube source again; here a stand-in lookup answers for all of them. */
const resolved = async (records: StoredSource[]) =>
  (await resolveRestored(records, { resolveYouTube: async (url) => ({ channelId: url, title: url, videos: videos('rr', 2) }) }, 5)).records

const exported = (sources = network(), users = USERS) => JSON.parse(serialiseUserNetworkExport(buildUserNetworkExport(sources, NOW, () => null, users))) as UserNetworkExport

afterEach(() => installUserCatalogue([], new Map()))

describe('EXPORT carries the named users and who owns each channel', () => {
  it('lists the users by stable id and gives every channel exactly one owner, TVN built in', () => {
    const doc = exported()
    expect(doc.format).toBe('tvn-user-network-v1')
    expect(doc.version).toBe(1)
    expect(doc.users).toEqual([SAM, ALEX])
    expect(doc.users?.some((user) => user.id === TVN_OWNER || user.name === 'TVN')).toBe(false)
    expect(doc.channels.map((channel) => [channel.number, channel.owner])).toEqual([
      [1001, 'tvn'],
      [1002, 'tvn'],
      [1003, 'tvn'],
      [1004, SAM.id],
      [1005, SAM.id],
      [1006, ALEX.id],
    ])
    expect(validateUserNetworkExport(doc)).toMatchObject({ ok: true })
  })

  it('never names an owner it does not list: a channel of a vanished user is exported as TVN', () => {
    const doc = exported(network(), [SAM])
    expect(doc.channels.find((channel) => channel.number === 1006)?.owner).toBe('tvn')
    expect(validateUserNetworkExport(doc)).toMatchObject({ ok: true })
  })
})

describe('RESTORE rebuilds the users and ownership', () => {
  it('round-trips TVN, Sam and Alex: numbers, owners, playlist, rename, disabled source and the empty slot', async () => {
    const text = serialiseUserNetworkExport(buildUserNetworkExport(network(), NOW, () => null, USERS))
    const file = readUserNetworkFile(text)
    if (!file.ok) throw new Error(file.errors.join('; '))
    expect(file.users).toBe(2)
    const records = recordsFromExport(file.value, 5)
    expect(usersFromExport(file.value)).toEqual(USERS)
    expect(records.map((record) => [record.channelNumber, record.owner ?? 'tvn'])).toEqual([
      [1001, 'tvn'],
      [1002, 'tvn'],
      [1003, 'tvn'],
      [1004, SAM.id],
      [1005, SAM.id],
      [1006, ALEX.id],
    ])
    expect(records[2].emptySlot).toBe(true)
    expect(records[4]).toMatchObject({ sourceType: 'youtube-playlist', id: `yt:${LIST}` })
    expect(records[5].name).toBe('Alex Renamed')
    expect(records[5].channelSources?.map((source) => [source.kind, source.enabled])).toEqual([
      ['youtube', true],
      ['audio', false],
    ])

    // A different local network goes; the file's comes back on its own numbers.
    const local = [added(1001, 'Something Else', 'uother'), added(1009, 'Stray')]
    const after = restoreUserNetwork(local, await resolved(records))
    expect(after.map((record) => record.channelNumber)).toEqual([1001, 1002, 1003, 1004, 1005, 1006])
    install(after, usersFromExport(file.value))
    expect(userNumbers('user')).toEqual([1001, 1002, 1003])
    expect(userNumbers(userFilter(SAM.id))).toEqual([1004, 1005])
    expect(userNumbers(userFilter(ALEX.id))).toEqual([1006])
  })

  it('keeps an empty slot with the user it belonged to', () => {
    const sources = clearUserChannel(network(), 1004, 3).sources
    expect(sources.find((record) => record.channelNumber === 1004)).toMatchObject({ emptySlot: true, owner: SAM.id })
    const records = recordsFromExport(exported(sources), 5)
    expect(records.find((record) => record.channelNumber === 1004)).toMatchObject({ emptySlot: true, owner: SAM.id })
  })

  it('a file from before named users restores, every channel to TVN, and leaves no named users', async () => {
    const legacy = exported() as unknown as Record<string, unknown>
    delete legacy.users
    for (const channel of legacy.channels as Record<string, unknown>[]) delete channel.owner
    const file = readUserNetworkFile(JSON.stringify(legacy))
    if (!file.ok) throw new Error(file.errors.join('; '))
    expect(file.users).toBe(0)
    const records = recordsFromExport(file.value, 5)
    expect(records.every((record) => record.owner === undefined)).toBe(true)
    expect(records.map((record) => record.channelNumber)).toEqual([1001, 1002, 1003, 1004, 1005, 1006])
    expect(usersFromExport(file.value)).toEqual([])
    install(await resolved(records), [])
    expect(userNumbers('user')).toEqual([1001, 1002, 1003, 1004, 1005, 1006])
  })

  it('refuses malformed users or ownership whole, before anything is built', () => {
    const bad = (change: (doc: Record<string, any>) => void) => {
      const doc = structuredClone(exported()) as Record<string, any>
      change(doc)
      return readUserNetworkFile(JSON.stringify(doc))
    }
    const cases: Record<string, (doc: Record<string, any>) => void> = {
      'unknown owner': (doc) => (doc.channels[3].owner = 'unobody'),
      'missing owner': (doc) => delete doc.channels[0].owner,
      'owner not text': (doc) => (doc.channels[0].owner = 7),
      'duplicate user id': (doc) => (doc.users[1].id = SAM.id),
      'duplicate user name': (doc) => (doc.users[1].name = 'sam'),
      'user claiming TVN by id': (doc) => doc.users.push({ id: 'tvn', name: 'Built In' }),
      'user claiming TVN by name': (doc) => doc.users.push({ id: 'utvn', name: 'TVN' }),
      'malformed user id': (doc) => (doc.users[0].id = 'Sam!'),
      'users not a list': (doc) => (doc.users = { sam: 'Sam' }),
      'owner without users': (doc) => delete doc.users,
    }
    for (const [label, change] of Object.entries(cases)) expect(bad(change), label).toMatchObject({ ok: false })
    // A legacy file may name TVN itself, the only owner that needs no users list.
    expect(
      bad((doc) => {
        delete doc.users
        for (const channel of doc.channels) channel.owner = 'tvn'
      }),
    ).toMatchObject({ ok: true })
    // The Guide reads and validates before it asks, and applies only the validated document.
    const tools = read('src/components/GuideAdd.tsx')
    expect(tools.indexOf('readRestoreFile(await file.text())')).toBeLessThan(tools.indexOf("setPending({ kind: 'network', document: read.value"))
  })

  it('replaces the users with the file’s, by id, and leaves favourites on their numbers', () => {
    const body = provider.slice(provider.indexOf('const importUserNetwork = useCallback'), provider.indexOf('const openChannelEdit = useCallback'))
    expect(body).toContain('const users = usersFromExport(document)')
    expect(body.indexOf('commitUsers(users)')).toBeLessThan(body.indexOf('installSources(next)'))
    expect(favouritesAfterRestore([5, 1004, 1099], recordsFromExport(exported(), 5))).toEqual([5, 1004])
  })
})

describe('IMPORT CHANNEL LIST under + is not RESTORE', () => {
  it('creates one new user and merges the list into it; it never reads a User Network file or replaces users', () => {
    const body = guide.slice(guide.indexOf('const importListAsUser = async'), guide.indexOf('const sessionMatches'))
    expect(body.match(/createNetworkUser\(/g)).toHaveLength(1)
    expect(body).toContain('await importList(file, user.id)')
    for (const restore of ['importUserNetwork', 'readUserNetworkFile', 'recordsFromExport']) expect(body).not.toContain(restore)
    expect(guide).toContain("throw new Error('A User Network file: use OPTIONS then RESTORE to restore it')")
    // Only the channels the list adds take the new owner; channels already present keep theirs.
    expect(provider).toContain('if (owner) plan.sources = plan.sources.map((source) => (before.has(source.id) ? source : { ...source, owner }))')
  })
})

describe('users organise the Guide; they never change a channel', () => {
  it('ALL lists every user channel, TVN only TVN’s, each user only its own', () => {
    install(network())
    expect(userNumbers('all')).toEqual([1001, 1002, 1003, 1004, 1005, 1006])
    expect(userNumbers('user')).toEqual([1001, 1002, 1003])
    expect(userNumbers(userFilter(SAM.id))).toEqual([1004, 1005])
    expect(userNumbers(userFilter(ALEX.id))).toEqual([1006])
    expect(listChannels().some((channel) => channel.number < 1000 && channelMatchesFilter(channel, 'all', []))).toBe(true)
  })

  it('CH+, CH- and R stay inside the chosen user’s tunable channels', () => {
    install(network())
    const sam: ChannelUniverse = { filter: userFilter(SAM.id), favourites: [] }
    const tvn: ChannelUniverse = { filter: 'user', favourites: [] }
    const tuned = (channelNumber: number) => ({ channelNumber, previousNumber: null })
    expect(stepTarget(tuned(1004), null, 1, sam)).toBe(1005)
    expect(stepTarget(tuned(1005), null, 1, sam)).toBe(1004)
    expect(stepTarget(tuned(1004), null, -1, sam)).toBe(1005)
    expect(stepTarget(tuned(42), null, 1, sam)).toBe(1004)
    // TVN skips its empty slot and never lands on Sam's or Alex's channels.
    expect(stepTarget(tuned(1002), null, 1, tvn)).toBe(1001)
    for (let i = 0; i < 20; i += 1) expect([1004, 1005]).toContain(randomTarget(1004, sam, () => i / 20)?.number)
  })

  it('a channel whose owner is not a user lists under TVN, so nothing is orphaned', () => {
    install([added(1001, 'Orphan', 'ugone'), added(1002, 'Sam’s', SAM.id)], [SAM])
    expect(userNumbers('user')).toEqual([1001])
    expect(userNumbers(userFilter(SAM.id))).toEqual([1002])
    expect(ownerOf('ugone', [SAM])).toBe(TVN_OWNER)
    expect(ownerOf(undefined, [SAM])).toBe(TVN_OWNER)
    expect(ownerOf(SAM.id, new Set([SAM.id]))).toBe(SAM.id)
  })

  it('renaming a user changes only its name: ownership follows the id', () => {
    const before = install(network(), USERS).channels.map((channel) => [channel.id, channel.number, channel.owner])
    const renamed = USERS.map((user) => (user.id === SAM.id ? { ...user, name: 'Samuel' } : user))
    const after = install(network(), renamed).channels.map((channel) => [channel.id, channel.number, channel.owner])
    expect(after).toEqual(before)
    const body = provider.slice(provider.indexOf('const renameNetworkUser = useCallback'), provider.indexOf('const deleteNetworkUser = useCallback'))
    for (const write of ['saveStoredSources', 'installSources', 'setFavourites', 'setGuideFilter']) expect(body).not.toContain(write)
  })

  it('DELETE · MOVE TO TVN keeps number, name, sources, schedule and channel id; only the owner changes', () => {
    const sources = network()
    const moved = releaseUserChannels(sources, SAM.id, 'move')
    const strip = ({ owner: _owner, ...rest }: StoredSource) => rest
    expect(moved.map(strip)).toEqual(sources.map(strip))
    expect(moved.filter((record) => record.owner === SAM.id)).toEqual([])
    const ids = (list: StoredSource[]) => channelsFromSources(list).channels.map((channel) => [channel.id, channel.number, channel.name])
    expect(ids(moved)).toEqual(ids(sources))
    install(moved, [ALEX])
    expect(userNumbers('user')).toEqual([1001, 1002, 1003, 1004, 1005])
  })

  it('DELETE · DELETE THEM TOO removes the user’s channels; nothing else moves', () => {
    const sources = network()
    const removed = sources.filter((source) => source.owner !== SAM.id)
    expect(removed.find((record) => record.channelNumber === 1006)).toBe(sources[5])
    expect(removed.some((record) => record.owner === SAM.id)).toBe(false)
    expect(provider).toContain("const remaining = channels === 'remove' ? existing.filter((source) => source.owner !== id) : releaseUserChannels(existing, id, 'move')")
    expect(provider).toMatch(/forgetChannels\(goneNumbers\(existing, remaining\)/)
  })

  it('ADD STARTER NETWORK keeps the named users and every channel’s owner', () => {
    setShippedArchive(JSON.parse(read('public/user-network/uploaders.json')))
    const starter = mergeParsedExports(['public/user-network/channels.txt'].map((path) => parseChannelsExport(read(path))))
    const plan = planTestChannels(network(), starter, 5, uploaderIdFor)
    expect(plan.sources.filter((record) => record.owner).map((record) => [record.channelNumber, record.owner])).toEqual([
      [1004, SAM.id],
      [1005, SAM.id],
      [1006, ALEX.id],
    ])
    const body = provider.slice(provider.indexOf('const loadTestChannels = useCallback'), provider.indexOf('const starterRanRef'))
    for (const write of ['commitUsers', 'saveUsers', 'setNetworkUsers']) expect(body).not.toContain(write)
  })
})

describe('+ and OPTIONS close when pressed again, or with Esc', () => {
  it('a second press closes the panel; Esc closes it without adding anyone', () => {
    expect(provider).toContain("} else if (panelOpenRef.current() === kind && (channelNumber === undefined || channelNumber === cursorRef.current.channelNumber)) {")
    expect(provider).toContain('else if (guideOpenRef.current && (editingRef.current() || panelOpenRef.current())) closeGuideTool()')
    const plus = guide.slice(guide.indexOf('const pressPlus = () =>'), guide.indexOf('const sessionMatches'))
    expect(plus).toContain("if (tool === 'users' && newUserName.trim())")
    expect(plus).toContain('tv.createNetworkUser(newUserName, true)')
    expect(plus).toContain("tv.dispatch({ type: 'guide-tool', tool: 'users' })")
    expect(guide).toContain('onClick={pressPlus}')
    expect(read('src/components/GuideAdd.tsx')).toMatch(/event\.key === 'Escape'\) \{\s+event\.preventDefault\(\)\s+event\.stopPropagation\(\)\s+onCancel\(\)/)
  })

  it('closing OPTIONS keeps a rename still being typed; its other settings are already kept as they change', () => {
    const options = read('src/components/GuideOptions.tsx')
    expect(options).toContain('pending.current = renaming && name.trim() && name.trim() !== user.name ? name : null')
    expect(options).toMatch(/useEffect\(\s+\(\) => \(\) => \{\s+if \(pending\.current === null\) return/)
  })
})
