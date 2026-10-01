import { readFileSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { canonicalChannels } from '../src/data/canonical.ts'
import { CHANNEL_ROUTES, INDEPENDENT_SOURCES } from '../src/data/independent/network.ts'
import { inNetworkDirectory } from '../src/data/network.ts'
import { resetDirector } from '../src/director/director.ts'
import { channelFitSummary } from '../src/director/fit.ts'
import { setMediaLibrary } from '../src/director/library.ts'
import { expandPlayableCatalogue } from '../src/library/playable-catalogue.ts'
import { channelTier, getChannelMedia, getEligibleMedia } from '../src/library/query.ts'
import type { LibraryMedia } from '../src/library/types.ts'
import { airingReport } from '../src/network/airing.ts'
import { broadcastDateFor } from '../src/director/time.ts'
import { dynamicChannel } from '../src/dynamic/providers.ts'
import { freshFor } from '../src/dynamic/runtime.ts'
import { originalCard, originalSummary, STATUS_CARD_CLASSES } from '../src/originals/originals.ts'

type Status =
  | 'PLAYABLE_STRONG'
  | 'PLAYABLE'
  | 'PLAYABLE_THIN'
  | 'NEEDS_CONTENT'
  | 'NEEDS_LIVE_PROVIDER'
  | 'NEEDS_AUDIO_PROVIDER'
  | 'RETROTV_ORIGINAL'
  | 'GENERATED'
  | 'DELIBERATELY_UNAVAILABLE'
  | 'EXCLUDED'

/** A full broadcast day of distinct programming. */
const STRONG_HOURS = 24
const GENERATED_NAMES = /^(test lab|continuity|idents|retro ad break|teletext|clocks|closedown|generative|experimental)$/i
const GLOBAL_EXCLUSIONS = [
  'religious programming, preaching and worship (major musical, artistic and historical works are not excluded for their terminology)',
  'space programming',
  'aircraft, aviation and aerospace',
  'paid or subscription content',
  'age-restricted, private, non-embeddable or UK-blocked videos',
  'user media (1001+) never feeds 000–999',
]
const CATEGORY_LABEL: Record<string, string> = {
  main: 'main-network',
  film: 'film',
  entertainment: 'entertainment',
  sport: 'sport',
  knowledge: 'knowledge',
  music: 'music',
  'business-tech': 'business & technology',
  lifestyle: 'lifestyle',
  specialist: 'specialist',
  news: 'news',
  radio: 'radio',
  webcams: 'live webcam',
  system: 'system',
}
const TIER_TEXT: Record<string, string> = {
  Owned: 'owned-source channel (claims its publisher first)',
  CategoryHome: 'canonical home of its category (claims inventory before specialists and aggregates)',
  FamilyHome: 'family home (its name heads a family of sibling channels)',
  Specialist: 'specialist channel',
  Aggregate: 'main-network aggregate (differentiated share of the homes it repeats)',
  General: 'general-entertainment mix (split with similar mixes)',
}

function pretty(pattern: string, limit = 8): string {
  if (pattern === '$^') return ''
  const words = pattern
    .replace(/\(\?<!\w+ \)/g, '')
    .replace(/\\b|\\s|\\-|\[\\s-\]\??|\?|\^|\$|\(|\)|\\d\+?|\\/g, ' ')
    .split('|')
    .map((word) => word.replace(/\s+/g, ' ').trim())
    .filter((word) => word.length > 1)
  const unique = [...new Set(words)]
  return unique.slice(0, limit).join(', ') + (unique.length > limit ? ', …' : '')
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0
  let shared = 0
  for (const id of left) if (right.has(id)) shared += 1
  return shared / (left.size + right.size - shared)
}

it('writes the 000–999 channel manifest', () => {
  const playable = JSON.parse(readFileSync('public/independent/playable.json', 'utf8'))
  const items = expandPlayableCatalogue(playable)
  resetDirector()
  setMediaLibrary(items)
  const sourceNames = new Map<string, string>(Object.entries(playable.sources as Record<string, string>))
  for (const source of INDEPENDENT_SOURCES) if (!sourceNames.has(source.id)) sourceNames.set(source.id, source.name)
  const name = (id: string) => sourceNames.get(id) ?? id
  const routes = new Map(CHANNEL_ROUTES.map((route) => [route.number, route]))
  const acquired = new Set(items.map((item) => (item as LibraryMedia).sourceId))
  const queued = new Map<number, { id: string; handle: string; name: string }>()
  for (const match of readFileSync('scripts/add_targeted_sources.py', 'utf8').matchAll(/"id": "(src_\w+)", "handle": "([^"]+)", "name": "([^"]+)", "channels": \[([\d, ]+)\]/g)) {
    if (acquired.has(match[1])) continue
    for (const number of match[4].split(',').map(Number)) queued.set(number, { id: match[1], handle: match[2], name: match[3] })
  }
  const airing = new Map(airingReport().map((row) => [row.number, row]))
  const channels = canonicalChannels()
  const byNumber = new Map(channels.map((channel) => [channel.number, channel]))
  const pools = new Map<number, LibraryMedia[]>()
  const eligible = new Map<number, number>()
  const today = broadcastDateFor(Date.now())
  for (const channel of channels) {
    if (channel.number < 1) continue
    pools.set(channel.number, freshFor(channel.number, getChannelMedia(items, channel.number) as LibraryMedia[], today))
    eligible.set(channel.number, getEligibleMedia(items, channel.number).length)
  }
  const idSets = new Map([...pools].map(([number, pool]) => [number, new Set(pool.map((item) => item.id))]))
  const claimedBy = (number: number): string => {
    const full = new Set(getEligibleMedia(items, number).map((item) => item.id))
    let best = { number: 0, share: 0 }
    for (const [other, ids] of idSets) {
      if (other === number || !ids.size) continue
      let shared = 0
      for (const id of full) if (ids.has(id)) shared += 1
      if (shared / Math.max(1, full.size) > best.share) best = { number: other, share: shared / full.size }
    }
    return best.number ? `${String(best.number).padStart(3, '0')} ${byNumber.get(best.number)?.name}` : ''
  }

  const records = channels.map((channel) => {
    const number = channel.number
    const route = routes.get(number)
    const fit = number >= 1 ? channelFitSummary(number) : undefined
    const pool = pools.get(number) ?? []
    const seconds = pool.reduce((sum, item) => sum + item.durationSeconds, 0)
    const hours = Math.round(seconds / 360) / 10
    const bySource = new Map<string, { programmes: number; hours: number }>()
    for (const item of pool) {
      const entry = bySource.get(item.sourceId ?? '?') ?? { programmes: 0, hours: 0 }
      entry.programmes += 1
      entry.hours += item.durationSeconds / 3600
      bySource.set(item.sourceId ?? '?', entry)
    }
    const ranked = [...bySource].sort((a, b) => b[1].hours - a[1].hours)
    const status = airing.get(number)?.status
    const tier = number >= 1 ? channelTier(number) : 'System'
    const kind = channel.mediaKind === 'audio' || channel.category === 'radio'
    const dynamic = dynamicChannel(number)
    const original = airing.get(number)?.original
    const card = originalCard(number)
    let disposition: Status
    let reason: string
    if (original && status === 'active') {
      disposition = original === 'night-block' ? 'RETROTV_ORIGINAL' : 'GENERATED'
      reason = original !== 'night-block'
        ? originalSummary(number)
        : `RetroTV original: a nightly 00:00–04:00 block drawn from ${Math.round((airing.get(number)?.seconds ?? 0) / 360) / 10} h of verified 1987–1992 recordings, one act per night, seeded by date.`
    } else if (card?.class === 'INTENTIONALLY_UNAVAILABLE' && status !== 'active' && status !== 'thin') {
      disposition = 'DELIBERATELY_UNAVAILABLE'
      reason = `${card.reason} Redundant slot; viewers are pointed to ${String(card.redirect).padStart(3, '0')}.`
    } else if (card && STATUS_CARD_CLASSES.has(card.class) && status !== 'active' && status !== 'thin') {
      disposition = 'NEEDS_CONTENT'
      reason = `${card.subtype}: ${card.reason}`
    } else if (dynamic?.mode === 'UNRESOLVED') {
      disposition = 'NEEDS_CONTENT'
      reason = dynamic.reason ?? 'No verified live stream or rolling pool.'
    } else if (number === 0) {
      disposition = 'DELIBERATELY_UNAVAILABLE'
      reason = 'Reserved system position; not a broadcast channel.'
    } else if (route?.strategy === 'EXCLUDED' || fit?.closed) {
      disposition = 'EXCLUDED'
      reason = route?.strategy === 'EXCLUDED' ? 'Excluded by network policy.' : 'Subject is excluded network-wide (space, aviation/aerospace or religion).'
    } else if (route?.strategy === 'DELIBERATELY_UNAVAILABLE') {
      disposition = 'DELIBERATELY_UNAVAILABLE'
      reason = 'Rights-holder or subscription programming with no free authorised source; kept off air.'
    } else if (status === 'active' && dynamic) {
      disposition = hours >= STRONG_HOURS ? 'PLAYABLE_STRONG' : 'PLAYABLE'
      const rolling = pool.length ? `${pool.length} rolling programmes, ${hours} h, inside a ${dynamic.rolling?.freshnessDays}-day window` : ''
      reason = dynamic.live
        ? `Official live stream: ${dynamic.live.service}${rolling ? `; offline fallback ${rolling}` : '; off air while the stream is down'}.`
        : `${rolling}.`
    } else if (status === 'active') {
      disposition = hours >= STRONG_HOURS ? 'PLAYABLE_STRONG' : 'PLAYABLE'
      reason = `${pool.length} distinct programmes, ${hours} h.`
    } else if (status === 'thin') {
      disposition = 'PLAYABLE_THIN'
      reason = `Only ${hours} h of distinct programming (on air needs 3 h); listed in the Guide, skipped by CH+/CH− and Random.`
    } else if (route?.strategy === 'RETROTV_ORIGINAL_GENERATED') {
      disposition = GENERATED_NAMES.test(channel.name) ? 'GENERATED' : 'RETROTV_ORIGINAL'
      reason = disposition === 'GENERATED' ? 'Network presentation channel generated by RetroTV (cards, idents, continuity); no external programming.' : 'Reserved for RetroTV original programming; no verified free source yet.'
    } else if (route?.strategy === 'FREE_LIVE_DISCOVERY' || fit?.liveOnly || channel.category === 'webcams') {
      disposition = 'NEEDS_LIVE_PROVIDER'
      reason = 'Live-only channel; needs a verified free official live stream or webcam provider. Recordings never air here.'
    } else if (kind) {
      disposition = 'NEEDS_AUDIO_PROVIDER'
      reason = 'Audio channel; needs a verified free audio stream provider.'
    } else {
      disposition = 'NEEDS_CONTENT'
      const full = eligible.get(number) ?? 0
      const holder = full ? claimedBy(number) : ''
      reason = full
        ? `Its ${full} eligible programmes are already the identity of ${holder || 'another channel'}; needs its own distinct source.`
        : 'No verified free programming fits this identity yet.'
    }

    const category = CATEGORY_LABEL[channel.category] ?? channel.category
    const scope: string[] = []
    if (fit?.owner) scope.push(`Exclusively ${name(fit.owner)}; that publisher airs nowhere else.`)
    if (fit?.homeFeeds.length && !fit.owner) scope.push(`Home publishers: ${fit.homeFeeds.map(name).join(', ')} (single-subject; they air only on their home channels).`)
    if (fit?.sports) scope.push(fit.sports.length ? `Strict sport routing: ${fit.sports.join(', ')} only.` : 'Any sport; strict sport routing, no non-sport programming.')
    if (fit?.liveOnly) scope.push('Live streams only; recordings never air.')
    for (const theme of fit?.owner ? [] : fit?.themes ?? []) {
      const words = pretty(theme.title)
      const sources = theme.sources.map(name)
      if (theme.strict && !words) scope.push(`Publisher channel: only ${sources.join(', ')}.`)
      else if (words && sources.length) scope.push(`Programmes about ${words}; native publishers ${sources.join(', ')} air without a title match.`)
      else if (words) scope.push(`Programmes whose titles are about ${words}.`)
      else if (sources.length) scope.push(`Programmes from ${sources.join(', ')}.`)
    }
    if (fit?.mustMatch.length) scope.push(`Every title must match: ${fit.mustMatch.map((pattern) => pretty(pattern)).join('; ')}.`)
    if (fit?.general) scope.push('General-entertainment mix of non-sport, non-news publishers.')
    if (channel.category === 'main' && !fit?.general) scope.push('Main-network aggregate built from its sibling channels.')
    if (!scope.length && number >= 1) scope.push(`Programmes whose titles name "${channel.name}", from routed ${category} publishers.`)

    const exclusions = [...GLOBAL_EXCLUSIONS]
    if (fit?.filmSources) exclusions.push(`non-film publishers (allowed: ${fit.filmSources.map(name).join(', ')})`)
    if (channel.category === 'film' && !/trailer/i.test(channel.name)) exclusions.push('trailers (Trailer TV only)')
    if (fit?.homeFeeds.length) exclusions.push('home-only publishers of other channels')
    if (fit?.sports) exclusions.push('other sports and non-sport programming')
    if (!fit?.owner) exclusions.push('British Pathé (805), KOFA (114) and Orbital Bacon (225) owned catalogues')

    const neighbours = [number - 1, number + 1]
      .filter((other) => byNumber.has(other) && other >= 1)
      .map((other) => ({ other, similarity: jaccard(idSets.get(number) ?? new Set(), idSets.get(other) ?? new Set()) }))
    const overlapping = neighbours.filter((entry) => entry.similarity > 0.1)
    const distinction = number < 1
      ? 'System position.'
      : `${TIER_TEXT[tier] ?? tier}. ` +
        (overlapping.length
          ? overlapping.map((entry) => `Shares ${Math.round(entry.similarity * 100)}% of programmes with ${String(entry.other).padStart(3, '0')} ${byNumber.get(entry.other)?.name}.`).join(' ')
          : pool.length
            ? 'No material programme overlap with neighbouring channels.'
            : 'No programming to overlap.')

    const plan = queued.get(number)
    const decade = /\b(19|20)\d0s\b|^\d0s?$| \d{2}$/i.test(channel.name) || /^(cinema|vevo) (19|20)\d0s$/i.test(channel.name)
    const nextStep = original && status === 'active'
      ? 'None required; deterministic RetroTV original.'
      : card?.class === 'RIGHTS_BLOCKED' && disposition === 'NEEDS_CONTENT'
        ? 'Stays off air until UK rights are established by the rightsholder; US public-domain status is not enough.'
        : disposition === 'DELIBERATELY_UNAVAILABLE' && card
          ? 'None; redundant slot, off air by policy.'
          : dynamic && dynamic.mode !== 'UNRESOLVED'
      ? 'Refresh with python3 scripts/dynamic_refresh.py fetch && build at each release; rolling programmes age out of their window.'
      : dynamic
        ? 'Needs a verified official live stream or enough in-window official programming for this identity.'
      : disposition.startsWith('PLAYABLE_STRONG') || disposition === 'PLAYABLE'
      ? 'None required; keep differentiated.'
      : disposition === 'EXCLUDED' || disposition === 'DELIBERATELY_UNAVAILABLE'
        ? 'None; stays off air by policy.'
        : plan
          ? `Queued: ${plan.name} (${plan.handle}), handle verified. Acquire with python3 scripts/add_targeted_sources.py --only ${plan.id} when the YouTube API quota resets.`
          : disposition === 'NEEDS_LIVE_PROVIDER'
            ? 'Needs a verified free official live stream or webcam.'
            : disposition === 'NEEDS_AUDIO_PROVIDER'
              ? 'Needs a verified free audio stream provider (outside the YouTube catalogue).'
              : disposition === 'GENERATED' || disposition === 'RETROTV_ORIGINAL'
                ? 'Needs RetroTV-produced material; no external source.'
                : decade
                  ? 'Needs programmes with verified release-year metadata; years are never inferred.'
                  : channel.category === 'news'
                    ? 'Needs an official free news publisher for this region or beat.'
                    : disposition === 'PLAYABLE_THIN'
                      ? 'Needs a dedicated official publisher to reach 3 h of distinct programming.'
                      : 'Needs a dedicated official, authorised or creator-owned publisher for this identity.'

    return {
      number,
      displayNumber: String(number).padStart(3, '0'),
      name: channel.name,
      category: channel.category,
      identity: number === 0 ? 'Reserved system position.' : dynamic?.identity || `${channel.name}: the ${category} channel for ${channel.name.toLowerCase()} programming.`,
      scope: scope.join(' ') || 'None.',
      distinction,
      sourceStrategy: number === 0 ? 'NONE' : route?.strategy ?? 'SOURCE_ROUTED',
      anchorSources: ranked.slice(0, 1).map(([id]) => name(id)),
      secondarySources: ranked.slice(1, 6).map(([id]) => name(id)),
      eligibility: scope.join(' ') || 'None.',
      exclusions,
      programmes: pool.length,
      hours,
      sources: Object.fromEntries(ranked.map(([id, entry]) => [id, { programmes: entry.programmes, hours: Math.round(entry.hours * 10) / 10 }])),
      status: disposition,
      reason,
      nextStep,
      inGuide: number >= 1 && inNetworkDirectory(number),
      tier,
      ...(card && STATUS_CARD_CLASSES.has(card.class) && disposition !== 'PLAYABLE' && disposition !== 'PLAYABLE_STRONG' ? { blocker: { class: card.class, subtype: card.subtype, ...(card.redirect ? { redirect: card.redirect } : {}) } } : {}),
      ...(original ? { original } : {}),
      ...(dynamic
        ? {
            dynamic: {
              mode: dynamic.mode,
              ...(dynamic.live ? { live: dynamic.live.service, liveVideoId: dynamic.live.videoId } : {}),
              ...(dynamic.rolling ? { freshnessDays: dynamic.rolling.freshnessDays, rule: dynamic.rolling.rule } : {}),
            },
          }
        : {}),
    }
  })

  const totals: Record<string, number> = {}
  for (const record of records) totals[record.status] = (totals[record.status] ?? 0) + 1
  const manifest = {
    format: 'retrotv-channel-manifest-v1',
    generatedAt: new Date().toISOString(),
    catalogue: { programmes: items.length, hours: Math.round(items.reduce((sum, item) => sum + item.durationSeconds, 0) / 3600) },
    channels: records.length,
    totals,
    queued: queued.size,
    records,
  }
  writeFileSync('docs/channel-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)

  const lines = [
    '# RetroTV 000–999 channel manifest',
    '',
    `Generated from the shipped catalogue (${manifest.catalogue.programmes} programmes, ${manifest.catalogue.hours} h). Full records: \`docs/channel-manifest.json\`.`,
    '',
    '| Status | Channels |',
    '|---|---|',
    ...Object.entries(totals).sort().map(([status, count]) => `| ${status} | ${count} |`),
    '',
    '| Ch | Name | Category | Status | Programmes | Hours | Anchor | Next step |',
    '|---|---|---|---|---|---|---|---|',
    ...records.map((record) => `| ${record.displayNumber} | ${record.name} | ${record.category} | ${record.status} | ${record.programmes} | ${record.hours} | ${record.anchorSources.join(', ')} | ${record.nextStep.replace(/\|/g, '/')} |`),
    '',
  ]
  writeFileSync('docs/channel-manifest.md', lines.join('\n'))
  expect(records).toHaveLength(1000)
  expect(records.every((record) => record.status && record.identity && record.scope)).toBe(true)
})
