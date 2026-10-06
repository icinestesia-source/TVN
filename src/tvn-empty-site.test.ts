import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isEmptySite, prefixedStorage, siteName } from './app/site.ts'
import { readNetworkBase } from './data/user-overlay.ts'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
  }
}

describe('tvn.lol/tvn: TVN without channels or users', () => {
  it('is the /tvn path only', () => {
    expect(isEmptySite('/tvn')).toBe(true)
    expect(isEmptySite('/tvn/')).toBe(true)
    expect(isEmptySite('/')).toBe(false)
    expect(isEmptySite('/tvnx')).toBe(false)
    expect(isEmptySite(undefined)).toBe(false)
  })

  it('keeps its browser storage apart from the main site', () => {
    expect(siteName('retrotv-user', true)).not.toBe('retrotv-user')
    expect(siteName('retrotv-user', false)).toBe('retrotv-user')
    const shared = memoryStorage()
    shared.setItem('tvn.notice.v1', 'main')
    const own = prefixedStorage(shared)
    expect(own.getItem('tvn.notice.v1')).toBeNull()
    own.setItem('tvn.notice.v1', 'empty')
    expect(shared.getItem('tvn.notice.v1')).toBe('main')
    expect(own.length).toBe(1)
    own.clear()
    expect(shared.getItem('tvn.notice.v1')).toBe('main')
    expect(own.length).toBe(0)
  })

  it('always starts from a new network, without the shipped channels', () => {
    const store = memoryStorage()
    store.setItem('retrotv.network-base', 'tvn')
    expect(readNetworkBase(store, true)).toBe('new')
  })

  it('NEW USER on the main site notice opens it; there it clears that network instead', () => {
    const notice = readFileSync('src/legal/FirstRunNotice.tsx', 'utf8')
    expect(notice).toMatch(/if \(!EMPTY_SITE\) \{\s+acknowledgeNotice\(\)\s+window\.location\.assign\(`\$\{EMPTY_SITE_PATH\}\$\{EMPTY_SITE_WELCOMED\}`\)/)
    expect(readFileSync('src/main.tsx', 'utf8').startsWith("import './site-storage.ts'")).toBe(true)
  })
})
