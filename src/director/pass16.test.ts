import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { expandPlayableCatalogue } from '../library/playable-catalogue.ts'
import { getChannelMedia } from '../library/query.ts'
import type { LibraryMedia } from '../library/types.ts'
import { resetDirector } from './director.ts'
import { DEDICATED, programmeSuitsChannel } from './fit.ts'
import { setMediaLibrary } from './library.ts'
import type { MediaItem } from './types.ts'

const HOMES: Record<string, number> = {
  src_huntley_motoring: 836, src_huntley_sailing: 833, src_huntley_architecture: 848, src_huntley_social: 422,
  src_huntley_events: 429, src_travel_film_archive: 779, src_chicago_film_archives: 801,
}
const EXCLUDED = /\b(space|nasa|rockets?|satellites?|astronom\w*|aircraft|aviation|airplanes?|airborne|helicopters?|airports?|church|christian|mosque|prayer)\b/i

describe('Pass 16 acquisitions', () => {
  let items: LibraryMedia[] = []
  const airing = (channel: number) => getChannelMedia(items as MediaItem[], channel) as LibraryMedia[]

  beforeAll(() => {
    items = expandPlayableCatalogue(JSON.parse(readFileSync('public/independent/playable.json', 'utf8')))
    resetDirector()
    setMediaLibrary(items)
  })

  it('keeps every new source dedicated to its one home, with at least three hours there', () => {
    for (const [source, home] of Object.entries(HOMES)) {
      expect(DEDICATED[source], source).toEqual([home])
      const own = items.filter((item) => item.sourceId === source)
      expect(own.length, source).toBeGreaterThan(0)
      const other = own.find((item) => item.explicitChannelIncludes?.some((channel) => channel !== home))
      if (other) for (const channel of other.explicitChannelIncludes!.filter((n) => n !== home && !other.curatedChannels?.includes(n))) expect(programmeSuitsChannel(other as MediaItem, channel)).toBe(false)
      for (const item of own) expect(item.title, source).not.toMatch(EXCLUDED)
      const hours = airing(home).reduce((sum, item) => sum + item.durationSeconds, 0) / 3600
      expect(hours, `${home}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('never shares a Huntley film between its subject splits', () => {
    const seen = new Map<string, string>()
    for (const item of items) {
      if (!item.sourceId?.startsWith('src_huntley_')) continue
      const id = item.id
      const prior = seen.get(id)
      if (prior) expect(prior, id).toBe(item.sourceId)
      seen.set(id, item.sourceId)
    }
  })

  it('keeps the general archive and architecture channels to their own publishers', () => {
    expect(airing(801).every((item) => item.sourceId === 'src_chicago_film_archives')).toBe(true)
    expect(airing(848).every((item) => item.sourceId === 'src_huntley_architecture')).toBe(true)
    expect(airing(805).every((item) => item.sourceId === 'src_british_pathe')).toBe(true)
  })
})
