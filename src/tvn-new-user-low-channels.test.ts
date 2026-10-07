import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { AddChannelForm } from './components/GuideAdd.tsx'
import { isLowUserNumber, isOwnNumber } from './data/network.ts'
import { setNetworkBase } from './data/user-overlay.ts'
import { migrateLegacyUserNumbers, type ImportedVideo, type StoredSource } from './services/channels-import.ts'
import { alphabeticalOrder, blockFor, LOW_BLOCK, moveTarget, renumberUserNetwork, USER_BLOCK, userOrder } from './services/network-order.ts'
import { buildUserNetworkExport, serialiseUserNetworkExport } from './services/user-network-export.ts'
import { readUserNetworkFile, recordsFromExport } from './services/user-network-restore.ts'
import { editorScope } from './view/channel-edit.ts'

const videos = (prefix: string): ImportedVideo[] =>
  Array.from({ length: 3 }, (_, index) => ({ id: `${prefix}${String(index).padStart(11 - prefix.length, '0')}`, title: `${prefix} ${index + 1}`, durationSec: 900 }))
const own = (n: number, name: string): StoredSource => ({
  id: `yt:UC${String(n).padStart(22, '0')}`,
  name,
  videos: videos(`c${n}`),
  channelNumber: n,
  inLibrary: false,
  automatic: true,
  updatedAt: 1,
})
const numbered = (sources: readonly StoredSource[]) => sources.map((source) => `${source.channelNumber} ${source.name}`).sort()

afterEach(() => setNetworkBase('tvn', null))

describe('NEW USER: own channels from 001 as well as 1001', () => {
  it('001–990 are the viewer’s own numbers; 991–1000 are Local Media', () => {
    expect([1, 990].every(isLowUserNumber)).toBe(true)
    expect([0, 991, 1000, 1001].some(isLowUserNumber)).toBe(false)
    expect([1, 990, 1001, 99_999].every((n) => isOwnNumber(n, true))).toBe(true)
    expect([991, 999, 1000, 100_000].some((n) => isOwnNumber(n, true))).toBe(false)
    expect(isOwnNumber(1)).toBe(false)
    setNetworkBase('new', null)
    expect(isOwnNumber(1)).toBe(true)
    expect(blockFor(7)).toEqual(LOW_BLOCK)
    expect(blockFor(1004)).toEqual(USER_BLOCK)
  })

  it('a network of the viewer’s own keeps 001+ where they are; the TVN network still moves them to 1001+', () => {
    const sources = [own(1, 'Morning'), own(2, 'Evening'), own(1001, 'Archive')]
    expect(numbered(migrateLegacyUserNumbers(sources, true).sources)).toEqual(['1 Morning', '1001 Archive', '2 Evening'])
    expect(migrateLegacyUserNumbers(sources, false).sources.every((source) => (source.channelNumber ?? 0) >= 1001)).toBe(true)
  })

  it('001+ and 1001+ each reorder among themselves', () => {
    const sources = [own(1, 'Zebra'), own(2, 'alpha'), own(1001, 'Yak'), own(1002, 'Bee')]
    expect(userOrder(sources, LOW_BLOCK).map((source) => source.name)).toEqual(['Zebra', 'alpha'])
    const low = renumberUserNetwork(sources, alphabeticalOrder(sources, (source) => source.name, LOW_BLOCK), LOW_BLOCK).sources
    expect(numbered(low)).toEqual(['1 alpha', '1001 Yak', '1002 Bee', '2 Zebra'])
    expect(moveTarget(userOrder(sources, LOW_BLOCK), 2, LOW_BLOCK)).toEqual({ index: 1 })
    expect(moveTarget(userOrder(sources, LOW_BLOCK), 1001, LOW_BLOCK)).toHaveProperty('error')
    expect(moveTarget(userOrder(sources), 1002)).toEqual({ index: 1 })
  })

  it('channels at 001+ open in Edit Channel and survive EXPORT USER and RESTORE, only in a network of the viewer’s own', () => {
    expect(editorScope({ number: 1, origin: 'user-import' })).not.toBe('user')
    setNetworkBase('new', null)
    expect(editorScope({ number: 1, origin: 'user-import' })).toBe('user')
    expect(editorScope({ number: 1 })).not.toBe('user')
    const file = readUserNetworkFile(serialiseUserNetworkExport(buildUserNetworkExport([own(1, 'Morning'), own(1001, 'Archive')], new Date('2026-10-07T12:00:00Z'))))
    expect(file.ok).toBe(true)
    if (file.ok) expect(numbered(recordsFromExport(file.value, 5).filter((record) => !record.emptySlot))).toEqual(['1 Morning', '1001 Archive'])
  })

  it('the + row offers "New channel 001" only in a network of the viewer’s own', () => {
    const form = (nextLowNumber: number | null) =>
      renderToStaticMarkup(createElement(AddChannelForm, { nextNumber: 1001, onAdd: async () => '', onNewChannel: async () => {}, nextLowNumber, onNewLowChannel: async () => {} }))
    expect(form(1)).toContain('New channel 001')
    expect(form(1)).toContain('New channel…')
    expect(form(null)).not.toContain('New channel 0')
  })
})

describe('NEW USER: a channel at 001 is the viewer’s own, not TVN’s channel 1', () => {
  it('schedules only its own programmes', async () => {
    const { channelsFromSources } = await import('./services/channels-import.ts')
    const { installUserCatalogue } = await import('./data/user-overlay.ts')
    const { guideSlots } = await import('./services/broadcast.ts')
    const built = channelsFromSources([own(1, 'Morning')])
    installUserCatalogue(built.channels, built.programmes)
    try {
      const channel = built.channels[0]!
      const slots = guideSlots(channel, Date.UTC(2026, 9, 7, 12), Date.UTC(2026, 9, 7, 18))
      expect(slots.length).toBeGreaterThan(0)
      expect(slots.every((slot) => slot.programme.channelId === channel.id && slot.programme.title.startsWith('c1 '))).toBe(true)
    } finally {
      installUserCatalogue([], new Map())
    }
  })
})
