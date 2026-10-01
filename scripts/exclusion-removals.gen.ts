import { readFileSync, writeFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'

const gate = vi.hoisted(() => ({ on: true }))

vi.mock('../src/library/exclusions.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/library/exclusions.ts')>()
  return {
    ...actual,
    excludedChannelName: (name: string) => gate.on && actual.excludedChannelName(name),
    excludedTitle: (title: string | undefined) => gate.on && actual.excludedTitle(title),
    excludedProgramme: (item: Parameters<typeof actual.excludedProgramme>[0]) => gate.on && actual.excludedProgramme(item),
  }
})

it('records the programmes the mandatory 000–999 exclusion removes from each channel', async () => {
  const actual = await vi.importActual<typeof import('../src/library/exclusions.ts')>('../src/library/exclusions.ts')
  const doc = JSON.parse(readFileSync('public/independent/playable.json', 'utf8'))

  const pools = async (on: boolean) => {
    gate.on = on
    vi.resetModules()
    const { resetDirector } = await import('../src/director/director.ts')
    const { setMediaLibrary } = await import('../src/director/library.ts')
    const { expandPlayableCatalogue } = await import('../src/library/playable-catalogue.ts')
    const { getChannelMedia } = await import('../src/library/query.ts')
    const items = expandPlayableCatalogue(doc)
    resetDirector()
    setMediaLibrary(items)
    const out = new Map<number, Set<string>>()
    for (let channel = 0; channel <= 999; channel++) out.set(channel, new Set(getChannelMedia(items, channel).map((item) => item.id)))
    return { items, out }
  }

  const open = await pools(false)
  const closed = await pools(true)
  const byId = new Map(open.items.map((item) => [item.id, item]))
  const removed: Record<string, string[]> = {}
  for (let channel = 0; channel <= 999; channel++) {
    const now = closed.out.get(channel)!
    const lost = [...open.out.get(channel)!].filter((id) => !now.has(id))
    for (const id of lost) expect(actual.excludedProgramme(byId.get(id)!), `${channel} ${id}`).toBe(true)
    if (lost.length > 0) removed[channel] = lost.sort()
  }

  for (const version of ['v38', 'v40', 'v41', 'v42']) {
    const baseline = JSON.parse(readFileSync(`docs/remaining-content-map-${version}.json`, 'utf8')).baselineProgrammes as Record<string, number>
    for (const [channel, count] of Object.entries(baseline)) {
      if (version === 'v42' && Number(channel) >= 900) continue
      expect(open.out.get(Number(channel))!.size, `${version} ${channel}`).toBeGreaterThanOrEqual(count)
    }
  }

  const programmes = new Set(Object.values(removed).flat())
  writeFileSync(
    'docs/exclusion-removals-v43.json',
    `${JSON.stringify(
      {
        catalogue: 'catalogue-v43',
        note: 'Programmes the mandatory 000–999 space/aviation/religion exclusion removes from each channel pool. Every id is rejected by src/library/exclusions.ts; without the exclusion every channel meets the v38/v40/v41 baselines and every static channel meets v42.',
        channels: Object.keys(removed).length,
        programmes: programmes.size,
        removed,
      },
      null,
      1,
    )}\n`,
  )
  gate.on = true
}, 600_000)
