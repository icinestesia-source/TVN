import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { channelsFromSources } from './services/channels-import.ts'
import { buildUserNetworkExport } from './services/user-network-export.ts'
import { readUserNetworkFile, recordsFromExport, resolveRestored } from './services/user-network-restore.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const file = readUserNetworkFile(read('public/user-network/starter-network.json'))

describe('RESTORE comes back at once from the file, then reads its sources', () => {
  it('without reading, nothing is asked and every channel keeps what the file holds', async () => {
    if (!file.ok) throw new Error('unreadable')
    const asked: string[] = []
    const ask = async (url: string): Promise<never> => {
      asked.push(url)
      throw new Error('offline')
    }
    const resolved = await resolveRestored(recordsFromExport(file.value, 0), { resolveYouTube: ask, resolveFeed: ask }, 0, 4, { read: false })
    expect(asked).toEqual([])
    expect(resolved.failed).toBe(0)
    const offline = await resolveRestored(recordsFromExport(file.value, 0), { resolveYouTube: ask, resolveFeed: ask }, 0)
    expect(buildUserNetworkExport(resolved.records, new Date(0)).channels).toEqual(buildUserNetworkExport(offline.records, new Date(0)).channels)
    const built = channelsFromSources(resolved.records).channels
    expect(built.map((channel) => channel.number)).toEqual(file.value.channels.map((channel) => channel.number))
    expect(resolved.records.flatMap((record) => record.channelSources ?? []).some((source) => source.status?.state === 'failed')).toBe(false)
  })

  it('reading reports each finished source out of all of them', async () => {
    if (!file.ok) throw new Error('unreadable')
    const seen: [number, number][] = []
    const offline = () => Promise.reject(new Error('offline'))
    const resolved = await resolveRestored(recordsFromExport(file.value, 0), { resolveYouTube: offline, resolveFeed: offline }, 0, 4, {
      onProgress: (done, total) => seen.push([done, total]),
    })
    expect(seen.length).toBeGreaterThan(0)
    const total = seen[0][1]
    expect(seen.map(([done]) => done)).toEqual(Array.from({ length: total }, (_, index) => index + 1))
    expect(seen.every(([, all]) => all === total)).toBe(true)
    expect(resolved.failed).toBeGreaterThan(0)
  })

  it('the provider saves the file’s channels first and replaces only records untouched since', () => {
    const provider = read('src/state/TvProvider.tsx')
    expect(provider).toContain('resolveRestored(records, restoreDeps, now, 4, { read: false })')
    expect(provider).toContain('void refreshRestored(records, resolved.records, run, onProgress)')
    expect(provider).toMatch(/asRestored\.get\(record\.id\) !== JSON\.stringify\(record\)\) return record/)
    expect(provider).toMatch(/const run = \+\+restoreRun\.current/)
  })

  it('the Import panel shows the sources being read after the restore', () => {
    const panel = read('src/components/GuideAdd.tsx')
    expect(panel).toContain('const progress = (update: string) => setNote(`${done ?? restoring} · ${update}`)')
    expect(panel).toMatch(/onApplyComplete\(chosen\.document, scope, progress\) : await onApply\(chosen\.document, progress\)/)
  })
})
