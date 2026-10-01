import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'

const gate = vi.hoisted(() => ({ on: true }))

vi.mock('../library/exclusions.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../library/exclusions.ts')>()
  return {
    ...actual,
    excludedChannelName: (name: string) => gate.on && actual.excludedChannelName(name),
    excludedTitle: (title: string | undefined) => gate.on && actual.excludedTitle(title),
    excludedProgramme: (item: Parameters<typeof actual.excludedProgramme>[0]) => gate.on && actual.excludedProgramme(item),
  }
})

it('the recorded exclusion removals are exactly what the exclusion takes from each 000–999 channel', async () => {
  const doc = JSON.parse(readFileSync('public/independent/playable.json', 'utf8'))
  const recorded = JSON.parse(readFileSync('docs/exclusion-removals-v43.json', 'utf8')).removed as Record<string, string[]>

  const pools = async (on: boolean) => {
    gate.on = on
    vi.resetModules()
    const { resetDirector } = await import('./director.ts')
    const { setMediaLibrary } = await import('./library.ts')
    const { expandPlayableCatalogue } = await import('../library/playable-catalogue.ts')
    const { getChannelMedia } = await import('../library/query.ts')
    const items = expandPlayableCatalogue(doc)
    resetDirector()
    setMediaLibrary(items)
    const out = new Map<number, Set<string>>()
    for (let channel = 0; channel <= 999; channel++) out.set(channel, new Set(getChannelMedia(items, channel).map((item) => item.id)))
    return out
  }

  const open = await pools(false)
  const closed = await pools(true)
  gate.on = true
  const removed: Record<string, string[]> = {}
  for (let channel = 0; channel <= 999; channel++) {
    const now = closed.get(channel)!
    const lost = [...open.get(channel)!].filter((id) => !now.has(id)).sort()
    if (lost.length > 0) removed[channel] = lost
  }
  expect(removed).toEqual(recorded)
}, 300_000)
