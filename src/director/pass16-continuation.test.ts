import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { expandPlayableCatalogue } from '../library/playable-catalogue.ts'
import { getChannelMedia } from '../library/query.ts'
import type { LibraryMedia } from '../library/types.ts'
import { resetDirector } from './director.ts'
import { DEDICATED, PROGRAMME_REUSE, programmeSuitsChannel } from './fit.ts'
import { setMediaLibrary } from './library.ts'
import type { MediaItem } from './types.ts'

const HOMES: Record<string, number> = {
  src_gresham_law: 451, src_gresham_crime: 462, src_gresham_medicine: 746, src_gresham_politics: 423, src_rai: 494,
  src_lse_sociology: 495, src_sag_foundation: 163, src_ace_editors: 166, src_patrick_willems: 196, src_thomas_flight: 196,
  src_comicstorian: 253, src_trash_theory: 560, src_linux_foundation: 635, src_brick_immortar: 653, src_mellow: 384,
  src_indigo_traveller: 799, src_eva_zu_beck: 799, src_brad_stanfield: 744, src_clutterbug: 768, src_cannes_lions: 611,
  src_patrick_boyle: 694, src_92ny_books: 840,
}
const EXCLUDED = /\b(space|nasa|rockets?|satellites?|astronom\w*|astrophysic\w*|aircraft|aviation|airplanes?|helicopters?|airports?|church|christianity|mosque|prayer|bible|theolog\w*|protestant|papal)\b/i

function lecture(title: string): string {
  const main = title.split(' | ')[0].replace(/\((video|slides|audio)[^)]*\)/gi, '')
  const parts = main.split(' - ')
  const bare = parts.length > 1 && !/\d/.test(parts[parts.length - 1]) ? parts.slice(0, -1).join(' - ') : main
  return bare.toLowerCase().replace(/[^a-z0-9]/g, '')
}

describe('Pass 16 continuation acquisitions', () => {
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
      const foreign = (item: LibraryMedia, channel: number) => channel !== home && !(item.curatedChannels?.includes(channel) && PROGRAMME_REUSE[channel]?.includes(source))
      const other = own.find((item) => item.explicitChannelIncludes?.some((channel) => foreign(item, channel)))
      if (other) for (const channel of other.explicitChannelIncludes!.filter((n) => foreign(other, n))) expect(programmeSuitsChannel(other as MediaItem, channel)).toBe(false)
      for (const item of own) expect(item.title, source).not.toMatch(EXCLUDED)
    }
    for (const home of new Set(Object.values(HOMES))) {
      const hours = airing(home).reduce((sum, item) => sum + item.durationSeconds, 0) / 3600
      expect(hours, `${home}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('airs each Gresham, RAI, LSE and 92NY lecture once, never twice across uploads or subject splits', () => {
    const lectures = ['src_gresham_law', 'src_gresham_crime', 'src_gresham_medicine', 'src_gresham_politics', 'src_rai', 'src_lse_sociology', 'src_92ny_books']
    for (const group of [lectures.slice(0, 4), ...lectures.slice(4).map((source) => [source])]) {
      const seen = new Map<string, string>()
      for (const item of items.filter((row) => group.includes(row.sourceId ?? ''))) {
        const key = lecture(item.title ?? '')
        expect(seen.has(key), `${item.title} (${item.sourceId}, also ${seen.get(key)})`).toBe(false)
        seen.set(key, item.sourceId ?? '')
      }
    }
  })

  it('leaves out the sources rejected after acquisition', () => {
    const doc = JSON.parse(readFileSync('public/independent/playable.json', 'utf8')) as { sources: Record<string, string> }
    for (const source of ['src_bafta_actors', 'src_vashi_visuals', 'src_lse_anthropology']) {
      expect(items.some((item) => item.sourceId === source), source).toBe(false)
      expect(doc.sources[source], source).toBeUndefined()
      expect(DEDICATED[source], source).toBeUndefined()
    }
  })

  it('keeps the screen-craft and archive channels to their own publishers', () => {
    const only = (channel: number, sources: string[]) => {
      const pool = airing(channel)
      expect(pool.length, `${channel}`).toBeGreaterThan(0)
      for (const item of pool) expect(sources, `${channel} ${item.title}`).toContain(item.sourceId)
    }
    only(163, ['src_sag_foundation'])
    only(166, ['src_ace_editors'])
    only(196, ['src_patrick_willems', 'src_thomas_flight'])
    only(801, ['src_chicago_film_archives'])
    only(848, ['src_huntley_architecture'])
    only(805, ['src_british_pathe'])
  })
})
