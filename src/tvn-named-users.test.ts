import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { channelMatchesFilter } from './data/network.ts'
import { addUser, checkUserName, filterUserId, freeUserName, loadUsers, releaseUserChannels, saveUsers, userFilter, USERS_KEY } from './data/user-network/users.ts'
import { channelsFromSources, emptySlotRecord, type StoredSource } from './services/channels-import.ts'
import { installUserCatalogue } from './data/user-overlay.ts'
import { listChannels } from './data/catalogue.ts'
import { guideFilterForChannel } from './epg/navigation.ts'
import { guideToolTarget } from './view/guide-tool.ts'
import { DEFAULT_PREFERENCES, PREFERENCES_KEY, loadPreferences } from './services/preferences.ts'

const guide = readFileSync('src/components/Guide.tsx', 'utf8')

function memory() {
  const map = new Map<string, string>()
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value), map }
}

function source(n: number, owner?: string): StoredSource {
  return {
    id: `yt:UC${String(n).padStart(22, '0')}`,
    name: `Channel ${n}`,
    videos: [{ id: `v${String(n).padStart(10, '0')}`, title: `Video ${n}`, durationSec: 600 }],
    channelNumber: n,
    inLibrary: false,
    automatic: true,
    updatedAt: 1,
    ...(owner ? { owner } : {}),
  }
}

afterEach(() => installUserCatalogue([], new Map()))

describe('named users', () => {
  it('takes a trimmed, unique name that is not already a Guide tab', () => {
    expect(checkUserName('  Sam   Smith ', [])).toEqual({ ok: true, name: 'Sam Smith' })
    expect(checkUserName('', []).ok).toBe(false)
    for (const name of ['All', 'tvn', 'FAV', 'Favourites']) expect(checkUserName(name, []).ok).toBe(false)
    const { users } = addUser([], 'Sam', 1)
    expect(checkUserName('sam', users).ok).toBe(false)
    expect(checkUserName('x'.repeat(25), users).ok).toBe(false)
    expect(() => addUser(users, 'Sam', 2)).toThrow(/already a user called Sam/)
  })

  it('names a user made from a channel list after the file, never clashing', () => {
    const { users } = addUser([], 'Sports list', 1)
    expect(freeUserName('sports_list', users)).toBe('sports list 2')
    expect(freeUserName('', [])).toBe('User')
  })

  it('keeps the users in this browser and ignores anything malformed', () => {
    const store = memory()
    const { users } = addUser(addUser([], 'Sam', 1).users, 'Alex', 2)
    saveUsers(users, store)
    expect(loadUsers(store)).toEqual(users)
    store.setItem(USERS_KEY, '[{"id":"bad id","name":"X"},{"id":"u1","name":""},"no"]')
    expect(loadUsers(store)).toEqual([])
    store.setItem(USERS_KEY, '{')
    expect(loadUsers(store)).toEqual([])
  })

  it('a user tab lists only the channels it owns; TVN lists the user channels with no owner', () => {
    const { user } = addUser([], 'Sam', 1)
    const built = channelsFromSources([source(1001), source(1002, user.id), source(1003, user.id)])
    installUserCatalogue(built.channels, built.programmes)
    const listed = (filter: string) => listChannels().filter((channel) => channelMatchesFilter(channel, filter, [])).map((channel) => channel.number)
    expect(listed('user')).toEqual([1001])
    expect(listed(userFilter(user.id))).toEqual([1002, 1003])
    expect(listed('all')).toEqual(expect.arrayContaining([1001, 1002, 1003]))
    expect(listed(userFilter('unother'))).toEqual([])
  })

  it('tuning to an owned channel shows its user tab; ADD on a user tab stays on it', () => {
    const { user } = addUser([], 'Sam', 1)
    const built = channelsFromSources([source(1001), source(1002, user.id)])
    installUserCatalogue(built.channels, built.programmes)
    const owned = listChannels().find((channel) => channel.number === 1002)!
    expect(guideFilterForChannel(owned, 'favourites', [])).toBe(userFilter(user.id))
    const target = guideToolTarget('add', userFilter(user.id), [], { channelNumber: 5, timeMs: 0 }, listChannels(), 0)
    expect(target.filter).toBe(userFilter(user.id))
    expect(target.cursor.channelNumber).toBe(1002)
    expect(guideToolTarget('users', 'all', [], { channelNumber: 5, timeMs: 0 }, listChannels(), 0)).toEqual({ filter: 'all', cursor: { channelNumber: 5, timeMs: 0 } })
  })

  it('a saved user tab survives a reload', () => {
    const store = new Map<string, string>([[PREFERENCES_KEY, JSON.stringify({ ...DEFAULT_PREFERENCES, guideFilter: 'user:uabc' })]])
    const original = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) },
      configurable: true,
    })
    try {
      expect(loadPreferences().guideFilter).toBe('user:uabc')
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true })
    }
    expect(filterUserId('user:uabc')).toBe('uabc')
    expect(filterUserId('user')).toBeNull()
  })

  it('channels added on a user tab, or from a channel list on +, belong to that user', () => {
    expect(guide).toContain('const result = await tv.addChannel(link, owner)')
    expect(guide).toContain("await tv.applyImport(parsed, { library: true, automatic: true }, { filename: file.name, owner: listOwner })")
    expect(guide).toContain('await tv.addChannel(link, listOwner)')
    expect(guide).toMatch(/const importListAsUser = async \(file: File\) => \{\s*const user = tv\.createNetworkUser\(freeUserName\(/)
  })

  it('deleting a user moves its channels to TVN, or removes them with it; no other channel changes', () => {
    const sources = [source(1001), source(1002, 'usam'), source(1003, 'ualex'), source(1004, 'usam')]
    const moved = releaseUserChannels(sources, 'usam', 'move')
    expect(moved.map((item) => [item.channelNumber, item.owner ?? null])).toEqual([[1001, null], [1002, null], [1003, 'ualex'], [1004, null]])
    expect(Object.hasOwn(moved[1], 'owner')).toBe(false)
    const removed = releaseUserChannels(sources, 'usam', 'remove', (item) => emptySlotRecord(item.channelNumber as number, 9))
    expect(removed.map((item) => [item.channelNumber, item.emptySlot ?? false, item.owner ?? null])).toEqual([
      [1001, false, null],
      [1002, true, null],
      [1003, false, 'ualex'],
      [1004, true, null],
    ])
    expect(removed[0]).toBe(sources[0])
    expect(sources[1].owner).toBe('usam')
  })
})

describe('OPTIONS', () => {
  const actions = readFileSync('src/components/GuideAdd.tsx', 'utf8')
  const options = readFileSync('src/components/GuideOptions.tsx', 'utf8')
  const provider = readFileSync('src/state/TvProvider.tsx', 'utf8')

  it('sits before NOW and opens in the Guide body in place of the listings', () => {
    expect(actions.indexOf("action('Options'")).toBeLessThan(actions.indexOf("action('Now'"))
    expect(guide).toMatch(/\{tool === 'options' \? \(\s*<GuideOptions \/>/)
    expect(guideToolTarget('options', 'user', [], { channelNumber: 7, timeMs: 1 }, listChannels(), 1)).toEqual({ filter: 'user', cursor: { channelNumber: 7, timeMs: 1 } })
  })

  it('lays out every setting as a card, users first', () => {
    const cards = [...options.matchAll(/<Card title="([^"]+)"/g)].map((match) => match[1])
    expect(cards).toEqual(['Users', 'Picture & sound', 'Channel change', 'Display', 'Sleep', 'Guide', 'Random Cycle', 'Information overlay shortcuts', 'Save & restore', 'About'])
  })

  it('deletes a user only after asking what happens to its channels; TVN cannot be deleted', () => {
    expect(options).toContain("onClick={() => setConfirming(true)}")
    expect(options).toContain("void remove('move')")
    expect(options).toContain("void remove('remove')")
    expect(options).toContain('the first User Network, always kept')
    const tvnRow = options.slice(options.indexOf('<strong>TVN</strong>'), options.indexOf('{tv.networkUsers.map'))
    expect(tvnRow).not.toMatch(/Delete|Rename/)
    expect(provider).toContain("if (guideFilter === userFilter(id)) setGuideFilter('user')")
  })

  it('sets the sleep timer to an exact choice, and only to a listed one', () => {
    expect(provider).toContain('command.minutes !== undefined && SLEEP_CHOICES.includes(command.minutes) ? command.minutes : nextSleepMinutes(sleepMinutesRef.current)')
    expect(options).toContain("tv.dispatch({ type: 'sleep-cycle', minutes })")
  })
})
