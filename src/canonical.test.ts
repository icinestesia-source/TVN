import { afterEach, describe, expect, it } from 'vitest'
import { channelByNumber, channels, listChannels, programmesFor } from './data/catalogue.ts'
import { canonicalByNumber, canonicalChannels } from './data/canonical.ts'
import { channelMatchesFilter, USER_NUMBER_START } from './data/network.ts'
import { protectedNameDiscrepancies } from './data/reconcile.ts'
import { policyFor } from './director/policies.ts'
import { visibleRowRange } from './epg/geometry.ts'
import { tunerStep } from './input/tuner.ts'
import { mediaSeekSeconds } from './player/seek.ts'
import { migrateProvisionalOverrides } from './services/overrides.ts'
import { installUserCatalogue } from './data/user-overlay.ts'
import { channelsFromSources, planImport, parseChannelsExport } from './services/channels-import.ts'

afterEach(() => {
  installUserCatalogue([], new Map())
})

describe('canonical manifest', () => {
  it('covers 000–999 exactly once and leaves 1000 unallocated', () => {
    const plan = canonicalChannels()
    expect(plan).toHaveLength(1000)
    expect(new Set(plan.map((entry) => entry.number)).size).toBe(1000)
    const zero = canonicalByNumber(0)
    expect(zero?.enabled).toBe(false)
    expect(zero?.channelType).toBe('reserved')
    expect(plan.filter((entry) => entry.enabled && entry.number >= 1 && entry.number <= 999)).toHaveLength(999)
    expect(plan.some((entry) => entry.number === 1000)).toBe(false)
    expect(USER_NUMBER_START).toBe(1001)
  })

  it('loads 999 default broadcast channels and no duplicate numbers', () => {
    const defaults = channels.filter((channel) => channel.origin === 'default')
    expect(defaults).toHaveLength(999)
    expect(new Set(defaults.map((channel) => channel.number)).size).toBe(999)
    expect(defaults.every((channel) => channel.number >= 1 && channel.number <= 999)).toBe(true)
    expect(channelByNumber(0)?.origin).toBe('session')
    expect(channelByNumber(1000)).toBeUndefined()
    expect(listChannels().filter((channel) => channel.name === 'CNN')).toHaveLength(1)
  })
})

describe('protected and canonical identities', () => {
  it('names 001–060 from the manifest and keeps Late Feature', () => {
    expect(channelByNumber(1)?.name).toBe('One')
    expect(channelByNumber(60)?.name).toBe('History Mix')
    expect(channelByNumber(101)?.name).toBe('Late Feature')
    expect(canonicalByNumber(1)?.name).toBe('One')
    expect(canonicalByNumber(101)?.name).toBe('Film One')
    const feature = programmesFor('ch-101').find((programme) => programme.durationSeconds >= 3 * 60 * 60)
    expect(feature?.title).toBe('The Night Crossing')
    const discrepancies = protectedNameDiscrepancies(channels)
    expect(discrepancies.some((item) => item.number <= 60)).toBe(false)
    expect(discrepancies.some((item) => item.number === 101 && item.manifestName === 'Film One')).toBe(true)
    // Stage 4D: a seed listing must not borrow an unrelated demonstration film.
    expect(programmesFor('ch-001').every((programme) => programme.videoId === null)).toBe(true)
    expect(programmesFor('ch-001').every((programme) => programme.title === 'No programming available')).toBe(true)
    expect(programmesFor('ch-060').some((programme) => programme.videoId)).toBe(true)
  })

  it('gives 001–060 the manifest identity and manifest routing', () => {
    for (let number = 1; number <= 60; number += 1) {
      expect(channelByNumber(number)?.name).toBe(canonicalByNumber(number)?.name)
      const policy = policyFor(number)
      if (policy) expect(policy.eligibility.routedOnly).toBe(true)
    }
    expect(channelByNumber(31)?.name).toBe('Drama')
  })

  it('places the named canonical stations', () => {
    expect(channelByNumber(315)?.name).toBe('ESPN')
    expect(channelByNumber(316)?.name).toBe('ESPN NBA')
    expect(channelByNumber(317)?.name).toBe('NBA')
    expect(channelByNumber(318)?.name).toBe('NFL')
    expect(channelByNumber(319)?.name).toBe('NFL Films & Archive')
    expect(channelByNumber(320)?.name).toBe('MLB')
    expect(channelByNumber(321)?.name).toBe('NHL')
    expect(channelByNumber(322)?.name).toBe('WNBA')
    expect(channelByNumber(323)?.name).toBe('FIFA')
    expect(channelByNumber(324)?.name).toBe('UEFA')
    expect(channelByNumber(400)?.name).toBe('History')
    expect(channelByNumber(450)?.name).toBe('Law')
    expect(channelByNumber(500)?.name).toBe('Music')
    expect(channelByNumber(544)?.name).toBe('1990s')
    expect(channelByNumber(590)?.name).toBe('VEVO')
    expect(channelByNumber(591)?.name).toBe('VEVO Pop')
    expect(channelByNumber(599)?.name).toBe('VEVO Discover')
    expect(channelByNumber(600)?.name).toBe('Business')
    expect(channelByNumber(700)?.name).toBe('Food')
    expect(channelByNumber(850)?.name).toBe('Live World')
    expect(channelByNumber(853)?.name).toBe('London Live')
    expect(channelByNumber(863)?.name).toBe('Railcams')
    expect(channelByNumber(869)?.name).toBe('Wildlife Live')
    expect(channelByNumber(873)?.name).toBe('Space Live')
    expect(channelByNumber(879)?.name).toBe('Cat Cams')
    expect(channelByNumber(900)?.name).toBe('News')
    expect(channelByNumber(920)?.name).toBe('CNN')
    expect(channelByNumber(921)?.name).toBe('Fox News')
    expect(channelByNumber(925)?.name).toBe('NBC News NOW')
    expect(channelByNumber(949)?.name).toBe('Information')
    expect(channelByNumber(950)?.name).toBe('Radio One')
    expect(channelByNumber(999)?.name).toBe('Closedown')
  })
})

describe('sources stay absent', () => {
  it('does not turn a provider hint into a playable source', () => {
    const espn = channelByNumber(315)!
    expect(espn.providerHint).toBe('ESPN')
    expect(espn.channelType).toBe('official')
    expect(espn.sources.some((source) => 'url' in source)).toBe(false)
    const programmes = programmesFor(espn.id)
    expect(programmes.length).toBeGreaterThanOrEqual(4)
    expect(programmes.every((programme) => programme.videoId === null)).toBe(true)
    expect(programmes.every((programme) => programme.playback === 'generated')).toBe(true)
    const cnn = programmesFor(channelByNumber(920)!.id)
    expect(cnn.every((programme) => programme.videoId === null)).toBe(true)
  })

  it('seeks recordings and does not seek live playback', () => {
    const recorded = mediaSeekSeconds(90, {
      playbackMode: 'linear',
      durationSeconds: 600,
      playback: 'seekable-recorded',
    })
    const live = mediaSeekSeconds(90, {
      playbackMode: 'linear',
      durationSeconds: 600,
      playback: 'live',
    })
    expect(recorded).toBe(90)
    expect(live).toBe(0)
  })

  it('moves a CNN override by identity and leaves the manifest unchanged', () => {
    const before = canonicalByNumber(920)?.name
    const result = migrateProvisionalOverrides(
      [
        {
          channelNumber: 910,
          additionalSources: [
            {
              id: 'override:910',
              provider: 'youtube',
              mediaKind: 'video',
              capability: 'seekable-recorded',
              externalId: 'aqz-KE-bpKQ',
              label: 'Local source',
              priority: 0,
              enabled: true,
            },
          ],
        },
        { channelNumber: 930 },
      ],
      canonicalChannels(),
    )
    expect(result.moved).toEqual([{ from: 910, to: 920, name: 'CNN' }])
    expect(result.overrides.find((item) => item.channelNumber === 920)?.boundName).toBe('CNN')
    expect(result.overrides.some((item) => item.channelNumber === 910)).toBe(false)
    expect(result.overrides.some((item) => item.channelNumber === 930)).toBe(true)
    expect(canonicalByNumber(1)?.name).toBe('One')
    expect(canonicalByNumber(920)?.name).toBe(before)
    expect(channelByNumber(1)?.name).toBe('One')
  })
})

describe('guide filters and tuning', () => {
  const sample = JSON.stringify({
    v: '2.4',
    channels: [{ name: 'Archive Desk', videos: [{ id: 'aaa111', title: 'Note', durationSec: 90 }] }],
  })

  it('filters by canonical category and keeps user channels separate', () => {
    const parsed = parseChannelsExport(sample)
    const plan = planImport([], parsed, { library: true, automatic: true }, channels.map((channel) => channel.number), 1)
    const built = channelsFromSources(plan.sources)
    installUserCatalogue(built.channels, built.programmes)
    const visible = listChannels()
    const defaults = visible.filter((channel) => channel.origin === 'default')
    expect(defaults).toHaveLength(999)
    const user = visible.filter((channel) => channelMatchesFilter(channel, 'user', []))
    expect(user.map((channel) => channel.number)).toEqual([1001])
    const sport = visible.filter((channel) => channelMatchesFilter(channel, 'sport', []))
    expect(sport.some((channel) => channel.number === 301)).toBe(true)
    expect(sport.some((channel) => channel.number === 315)).toBe(false)
    expect(sport.every((channel) => channel.categoryId === 'sport')).toBe(true)
    const music = visible.filter((channel) => channelMatchesFilter(channel, 'music', []))
    expect(music.some((channel) => channel.number === 590)).toBe(true)
    expect(music.some((channel) => channel.number === 599)).toBe(true)
    const live = visible.filter((channel) => channelMatchesFilter(channel, 'live-world', []))
    expect(live.map((channel) => channel.number)[0]).toBe(850)
    expect(live.at(-1)?.number).toBe(879)
    const news = visible.filter((channel) => channelMatchesFilter(channel, 'news', []))
    expect(news.every((channel) => channel.number >= 900 && channel.number <= 949)).toBe(true)
    expect(news.some((channel) => channel.mediaKind === 'audio')).toBe(false)
    const radio = visible.filter((channel) => channelMatchesFilter(channel, 'radio', []))
    expect(radio.some((channel) => channel.number === 999)).toBe(true)
    expect(radio.every((channel) => channel.number >= 950 && channel.number <= 999)).toBe(true)
    const starred = visible.filter((channel) => channelMatchesFilter(channel, 'favourites', [301, 1001]))
    expect(starred.map((channel) => channel.number).sort((a, b) => a - b)).toEqual([301, 1001])
  })

  it('resolves canonical numbers, keeps 000 for the session channel and refuses 1000', () => {
    expect(channelByNumber(1)?.name).toBe('One')
    expect(channelByNumber(9)?.number).toBe(9)
    expect(channelByNumber(315)?.name).toBe('ESPN')
    expect(channelByNumber(590)?.name).toBe('VEVO')
    expect(channelByNumber(850)?.name).toBe('Live World')
    expect(channelByNumber(920)?.name).toBe('CNN')
    expect(channelByNumber(950)?.name).toBe('Radio One')
    expect(channelByNumber(999)?.name).toBe('Closedown')
    expect(channelByNumber(0)?.origin).toBe('session')
    expect(channelByNumber(1000)).toBeUndefined()
    const numbers = listChannels().map((channel) => channel.number)
    expect(tunerStep('009', numbers)).toBe('commit')
    expect(tunerStep('315', numbers)).toBe('commit')
    expect(tunerStep('000', numbers)).toBe('commit')
    expect(tunerStep('100', numbers)).toBe('wait')
    expect(tunerStep('1000', numbers)).toBe('commit')
    expect(tunerStep('1001', [...numbers, 1001])).toBe('commit')
  })

  it('virtualises a 999-channel guide', () => {
    const range = visibleRowRange(0, 640, 48, 999, 6)
    expect(range.end - range.start).toBeLessThan(30)
    expect(range.end).toBeLessThan(999)
    const deep = visibleRowRange(400 * 48, 640, 48, 999, 6)
    expect(deep.start).toBeGreaterThan(300)
    expect(deep.end - deep.start).toBeLessThan(30)
  })
})
