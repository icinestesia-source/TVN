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
  src_wendover: 623, src_engineering_rosie: 669, src_eric_strebel: 659, src_design_museum: 658, src_bof: 627, src_starter_story: 613,
  src_lbs: 608, src_bank_of_england: 618, src_chief_makoi: 657, src_oceanliner_designs: 832, src_road_guy_rob: 835,
  src_huntley_industrial: 809, src_huntley_transport: 839, src_ap_archive: 945, src_british_movietone: 945, src_comic_tropes: 252,
  src_strip_panel_naked: 252, src_button_poetry: 842, src_poetry_foundation: 842, src_hay_festival: 92, src_josh_revell: 345,
  src_goodwood: 344, src_clints_reptiles: 478, src_ben_g_thomas: 478, src_li_ziqi: 789, src_dianxi_xiaoge: 789, src_wsl_surf: 359,
  src_steve_wallis: 780, src_headspace: 743, src_tracey_marks: 742,
}
const EXCLUDED = /\b(space|nasa|rockets?|satellites?|astronom\w*|aircraft|aviation|airplanes?|helicopters?|airports?|church|mosque|prayer)\b/i

describe('Pass 15B acquisitions', () => {
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

  it('keeps current news feeds off the news archive while they still air on the news channels', () => {
    const archive = airing(945)
    expect(archive.length).toBeGreaterThan(0)
    expect(archive.every((item) => item.sourceId === 'src_ap_archive' || item.sourceId === 'src_british_movietone')).toBe(true)
    expect(airing(901).some((item) => item.sourceId === 'src_nbc_news_now' || item.sourceId === 'src_livenow_fox')).toBe(true)
  })
})
