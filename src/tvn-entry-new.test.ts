import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { adjacentChannel, channelByNumber, channels, listChannels, randomChannel } from './data/catalogue.ts'
import { claimStarterInstall, setStarterState, STARTER_KEY } from './data/user-network/starter.ts'
import { currentNetworkBase, installUserCatalogue, NETWORK_BASE_KEY, readNetworkBase, setNetworkBase } from './data/user-overlay.ts'
import { FirstRunNotice } from './legal/FirstRunNotice.tsx'
import { chooseTvn, resetTvnChannel, setTvnLookup, setTvnRandom, tvnBroadcast } from './tvn/tvn-channel.ts'
import type { Channel } from './types/channel.ts'
import type { Programme } from './types/programme.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const memoryStore = () => {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), data }
}
const notice = read('src/legal/FirstRunNotice.tsx')
const provider = read('src/state/TvProvider.tsx')
const newNetwork = provider.slice(provider.indexOf('const startNewNetwork = useCallback'), provider.indexOf('/** A new, empty 1001+ channel for Edit Channel to fill'))

afterEach(() => {
  setNetworkBase('tvn', memoryStore())
  installUserCatalogue([], new Map())
})

describe('the entry screen reads TVN · NEW · LEGAL', () => {
  it('in that order, with one line saying the channels are an example', () => {
    const html = renderToStaticMarkup(createElement(FirstRunNotice))
    expect([...html.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((match) => match[1])).toEqual(['TVN - CONTINUE', 'NEW USER', 'LEGAL'])
    expect(html).toContain('TVN includes an example network of channels to demonstrate the platform.')
    expect(html).not.toContain('>Continue<')
  })

  it('TVN only carries on: it acknowledges the screen and nothing else, no reload, retune or restore', () => {
    expect(notice).toContain('onClick={() => acknowledgeNotice()} disabled={busy} autoFocus title="Continue with TVN as it is loaded"')
    expect(notice).not.toMatch(/requestTune|loadTestChannels|restore|setNetworkBase\('tvn'\)/)
  })

  it('LEGAL opens About as before and leaves the entry screen to come back to', () => {
    expect(notice).toContain('onClick={() => openAbout()} disabled={busy} title="About, sources and legal information"')
    const legal = notice.slice(notice.indexOf('openAbout()') - 40, notice.indexOf('openAbout()') + 20)
    expect(legal).not.toContain('acknowledgeNotice')
  })

  it('NEW asks first only when the network holds the viewer’s own work; CANCEL leaves it as it was', () => {
    expect(notice).toContain('if (confirming || !(await networkCustomised())) return startNew()')
    expect(notice).toContain('Start new network?')
    expect(notice).toContain('This removes the channels in your current network.')
    expect(notice).toContain('onClick={() => setConfirming(false)}')
    const cancel = notice.slice(notice.indexOf('setConfirming(false)') - 20, notice.indexOf('setConfirming(false)') + 60)
    expect(cancel).not.toMatch(/startNew|acknowledge/)
  })
})

describe('NEW clears the example network for this browser', () => {
  it('leaves 000 TVN and 1000 Local Media, and no 001–999 or 1001+', () => {
    expect(listChannels().some((channel) => channel.number >= 1 && channel.number <= 999)).toBe(true)
    setNetworkBase('new', memoryStore())
    const numbers = listChannels().map((channel) => channel.number)
    expect(numbers).toEqual([0, 992, 993, 994, 995, 996, 997, 998, 999, 1000])
    expect(channelByNumber(1)).toBeUndefined()
    expect(channelByNumber(0)?.number).toBe(0)
    expect(channelByNumber(1000)?.number).toBe(1000)
    expect(randomChannel(0)).toBeUndefined()
    expect(() => adjacentChannel(0, 1)).not.toThrow()
  })

  it('channels added afterwards are the network, and the shipped ones stay out', () => {
    setNetworkBase('new', memoryStore())
    const added = { ...channels[0], id: 'mine', number: 1001, name: 'Mine', origin: 'user-import', enabled: true } as Channel
    installUserCatalogue([added], new Map())
    expect(listChannels().map((channel) => channel.number)).toEqual([0, 992, 993, 994, 995, 996, 997, 998, 999, 1000, 1001])
  })

  it('is kept: the next start reads NEW back, and the starter network is never claimed again', () => {
    const store = memoryStore()
    setNetworkBase('new', store)
    expect(store.data.get(NETWORK_BASE_KEY)).toBe('new')
    expect(readNetworkBase(store)).toBe('new')
    expect(readNetworkBase(memoryStore())).toBe('tvn')
    setStarterState('removed', store)
    expect(claimStarterInstall(store)).toBe(false)
    expect(store.data.get(STARTER_KEY)).toBe('removed')
    expect(provider).toContain("if (automatic && (starterState() !== 'pending' || currentNetworkBase() === 'new')) return ''")
  })

  it('only NEW clears: no start, upgrade or migration sets it', () => {
    const setters = [...provider.matchAll(/setNetworkBase\(/g)].length
    expect(setters).toBe(1)
    expect(newNetwork).toContain("setNetworkBase('new')")
    expect(currentNetworkBase()).toBe('tvn')
  })

  it('removes the stored channels and curated changes at once, sweeps out a starter install still running, stays on 000', () => {
    expect(newNetwork.indexOf("setStarterState('removed')")).toBeLessThan(newNetwork.indexOf('await saveStoredSources([])'))
    expect(newNetwork).not.toContain('await starterRunRef.current')
    expect(newNetwork).toMatch(/void starterRunRef\.current[\s\S]*?withoutStarter\(stored, ids\)/)
    expect(newNetwork).toContain('await saveStoredSources([])')
    expect(newNetwork).toContain('replaceCuratedEdits([])')
    expect(newNetwork).toContain('forgetChannels(gone, [])')
    expect(newNetwork).not.toMatch(/requestTune|tuneTo|loadTestChannels|restoreDefault/)
  })

  it('the Guide and NETWORK list the effective network', () => {
    expect(read('src/components/Guide.tsx')).toContain("import { channelByNumber, listChannels } from '../data/catalogue.ts'")
    expect(read('src/components/NetworkEditor.tsx')).toContain("import { listChannels } from '../data/catalogue.ts'")
    expect(read('src/services/guide-search-pool.ts')).toContain('const channels = listChannels()')
  })
})

describe('000 on an empty network', () => {
  it('shows TVN’s own nothing-to-choose card, and picks up channels once there are some', () => {
    resetTvnChannel()
    const now = Date.parse('2026-10-03T20:00:00Z')
    setTvnRandom(() => 0.5, () => now)
    let network: Channel[] = []
    const programme = { id: 'p', title: 'Show', videoId: 'abcdefghijk', durationSeconds: 3600, channelId: 'mine', source: 'youtube', kind: 'programme' } as Programme
    setTvnLookup({
      channels: () => network,
      onAir: () => true,
      refused: () => new Set(),
      broadcastOf: (_channel, at) => ({ current: { programme, startMs: at - 60_000, endMs: at + 3_000_000, offsetSeconds: 60 } }) as never,
    })
    expect(chooseTvn(now)).toBe(false)
    expect(tvnBroadcast(now).current.programme.id).toBe('tvn-nothing')
    network = [{ ...channels[0], id: 'mine', number: 5, origin: 'default', enabled: true } as Channel]
    chooseTvn(now)
    expect(tvnBroadcast(now).current.programme.id).not.toBe('tvn-nothing')
    resetTvnChannel()
  })
})
