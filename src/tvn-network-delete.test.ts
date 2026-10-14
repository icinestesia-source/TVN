import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setNetworkBase } from './data/user-overlay.ts'
import type { ImportedVideo, StoredSource } from './services/channels-import.ts'
import { deleteUserChannel, remapNumbers, renumberUserNetwork, USER_BLOCK, userOrder } from './services/network-order.ts'
import { clearUserChannel } from './services/user-network.ts'

const videos = (prefix: string): ImportedVideo[] => Array.from({ length: 3 }, (_, index) => ({ id: `${prefix}${String(index).padStart(11 - prefix.length, '0')}`, title: `${prefix} ${index}`, durationSec: 900 }))
const channel = (number: number, name: string): StoredSource => ({ id: `yt:UC${String(number).padStart(22, '0')}`, name, videos: videos(`c${number}`), channelNumber: number, inLibrary: false, automatic: true, updatedAt: 1 })

describe('X in NETWORK', () => {
  it('deletes a User Network channel and moves every later channel up one number', () => {
    const sources = [channel(1001, 'Alpha'), channel(1002, 'Bravo'), channel(1003, 'Charlie'), channel(1004, 'Delta')]
    const deleted = deleteUserChannel(sources, 1002)
    expect(deleted.status).toBe('deleted')
    const { sources: closed, moves } = renumberUserNetwork(deleted.sources, userOrder(deleted.sources, USER_BLOCK).map((source) => source.id), USER_BLOCK)
    expect(userOrder(closed).map((source) => `${source.channelNumber} ${source.name}`)).toEqual(['1001 Alpha', '1002 Charlie', '1003 Delta'])
    // Favourites, Multi View and history follow the channels that moved.
    expect(remapNumbers([1004, 1001, 7], moves)).toEqual([1003, 1001, 7])
  })

  it('leaves one of the viewer’s own 001–990 as an empty channel on its number, and nothing else moves', () => {
    setNetworkBase('new', null)
    try {
      const sources = [channel(951, 'Radio A'), channel(952, 'Radio B'), channel(1001, 'Alpha')]
      const cleared = clearUserChannel(sources, 951, 5)
      expect(cleared.status).toBe('cleared')
      expect(cleared.sources.map((source) => [source.channelNumber, source.emptySlot ?? false])).toEqual([
        [951, true],
        [952, false],
        [1001, false],
      ])
      expect(clearUserChannel(cleared.sources, 951, 6).status).toBe('already-empty')
    } finally {
      setNetworkBase('tvn', null)
    }
  })

  it('the provider closes up 1001+ and empties 001–990; TVN’s own channels are never deleted', () => {
    const provider = readFileSync('src/state/TvProvider.tsx', 'utf8')
    const body = provider.slice(provider.indexOf('const deleteNetworkChannel = useCallback('), provider.indexOf('/** MOVE TO:'))
    expect(body).toContain("if (scopeOf(number).scope !== 'user') throw new Error('TVN’s own channels cannot be deleted')")
    expect(body).toMatch(/if \(isLowUserNumber\(number\)\) \{\s*const result = clearUserChannel\(/)
    expect(body).toMatch(/await deleteUserChannel\(number, true\)\s*const remaining = userOrder\([\s\S]*USER_BLOCK\)\s*const moved = await reorderUserNetwork\(remaining\.map\(\(source\) => source\.id\), USER_BLOCK\)/)
  })

  it('every row has X, which asks once before deleting, and is off for TVN’s own channels', () => {
    const editor = readFileSync('src/components/NetworkEditor.tsx', 'utf8')
    expect(editor).toContain("className={deleting === channel.id ? 'tab network-delete is-on remove-key' : 'tab network-delete'}")
    expect(editor).toContain('disabled={busy || !user}')
    expect(editor).toMatch(/if \(deleting !== channel\.id\) \{\s*setDeleting\(channel\.id\)/)
    expect(editor).toContain('setNote(await tv.deleteNetworkChannel(channel.number))')
    expect(editor).toContain("{deleting === channel.id ? 'Delete?' : '✕'}")
  })

  it('LATEST, A–Z and RANDOM work on any Guide row, not only the selected one', () => {
    const guide = readFileSync('src/components/Guide.tsx', 'utf8')
    const arrange = guide.slice(guide.indexOf('{ARRANGEMENTS.map('), guide.indexOf("onArrange('reset')"))
    expect(arrange).toContain('disabled={busy}')
    expect(arrange).not.toContain('!selected}')
    expect(arrange).toContain("if (!busy) onArrange?.('latest-now')")
  })
})
