// Catalogue integrity, exclusion, ownership and mechanical identity audit over what 000–999 can actually air.
// Writes docs/catalogue-audit-v43.{json,md}. The exclusion scan uses its own broad pattern, not the runtime filter.
import { readFileSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { channelByNumber } from '../src/data/catalogue.ts'
import { canonicalChannels } from '../src/data/canonical.ts'
import { OWNED_SOURCES } from '../src/director/fit.ts'
import { setMediaLibrary } from '../src/director/library.ts'
import { CATALOGUE_VERSION } from '../src/director/network.ts'
import type { MediaItem } from '../src/director/types.ts'
import { freshFor } from '../src/dynamic/runtime.ts'
import { excludedProgramme, REVIEWED_EXCLUSIONS } from '../src/library/exclusions.ts'
import { schedulingPool } from '../src/library/mode.ts'
import { expandPlayableCatalogue } from '../src/library/playable-catalogue.ts'
import { getChannelMedia } from '../src/library/query.ts'
import { nightPool, originalFormat } from '../src/originals/originals.ts'
import { channelsFromSources, mergeParsedExports, parseChannelsExport, planImport } from '../src/services/channels-import.ts'

const DATE = '2026-09-28'
const EXCLUDED_CHANNELS = [64, 146, 480, 481, 482, 492, 667, 682, 683, 873, 874]
/** Deliberately broader than the runtime filter; every hit is reviewed, not rejected blindly. */
const SPACE = /\b(space|spacecraft|spaceship|astronaut\w*|cosmonaut\w*|nasa|esa|spacex|rocket\w*|satellite\w*|orbit\w*|planet\w*|lunar|moon ?landing|apollo \d+|mars rover|telescope\w*|astronom\w*|cosmolog\w*|cosmos|galax\w*|nebula\w*|black holes?|comet\w*|asteroid\w*|meteor\w*|eclipse\w*|solar system|milky way|iss)\b/i
const AIR = /\b(aircraft|airplanes?|aeroplanes?|aviation|aerospace|airliners?|jetliners?|helicopters?|airports?|air ?shows?|air ?force|raf|spitfires?|concorde|boeing|airbus|pilots? training|fighter jets?|cockpit|airlines?|air ?cargo|air ?crash\w*|air disaster|air war|air superiority|air raids?|warbirds?|fighter aces?|new fighter|supersonic|jumbo jet|super ?jets?|test pilots?|airmen|airborne|paratroop\w*|flying cars?|hot[- ]air balloons?|balloon(ing|ists?)|paraglid\w*|skydiv\w*|seaplanes?|airships?|blimps?|zeppelins?|hindenburg|dam ?busters|red baron|kamikaze|battle of britain|canadair|lockheed|de havilland aircraft|hawker hurricane|runways?|hangars?|flight(s)? (over|to|from|attendant|deck|simulator)|flying (display|boat|club|doctor)|drones? (warriors|unit|company|delivery)|diy drones?|jet suits?|pan am)\b/i
const RELIGION = /\b(church|churches|cathedral\w*|mosque\w*|synagogue\w*|temple|worship\w*|pray\w*|prayer\w*|sermon\w*|preach\w*|bible\w*|gospel\w*|hymn\w*|psalm\w*|scripture\w*|jesus|christ|christian\w*|catholic\w*|pope|vatican|evangel\w*|pastor\w*|priest\w*|bishop\w*|monk\w*|nuns?|quran|koran|islam\w*|muslim\w*|ramadan|hindu\w*|buddh\w*|rabbi\w*|torah|religio\w*|spiritual\w*|faith|holy|divine|god|lord)\b/i
/** Fictional science fiction and non-subject senses reviewed from the first hit list. */
const FICTION_OR_SENSE = /\b(star trek|star wars|doctor who|lost in space|space: 1999|thunderbirds|stingray|captain scarlet|blake'?s 7|red dwarf|hitchhiker|alien|aliens|predator|battlestar|babylon 5|farscape|firefly|dune|flash gordon|buck rogers|space invaders|space ?(age|bar|cadets?|jam|ghost|patrol|oddity)|rocket ?(league|man|power)|rocketman|sputnik|planet (earth|of the apes)|lonely planet|orbital|moonwalk|eclipse of|holy grail|monty python|oh my god|god save|thank god|godfather|good lord|lord of the|house of the lord|lordes?|christmas|easter|temple (bar|run)|shaolin|god of war|faith no more|george michael|holy moly|divine comedy|spiritualized|space ?x?cavator|pilot episode|the pilot|pilot:|jet set|jetpack|red arrows|top gun)\b/i

interface Row { id: string; title: string; seconds: number; source: string; channels: number[]; provenance: string }

it('writes the catalogue audit', () => {
  const doc = JSON.parse(readFileSync('public/independent/playable.json', 'utf8'))
  const rows: Row[] = doc.items.map((r: [string, string, number, string, number[], string]) => ({ id: r[0], title: r[1], seconds: r[2], source: r[3], channels: r[4], provenance: r[5] }))
  const items = expandPlayableCatalogue(doc)
  setMediaLibrary(items)
  const network = schedulingPool(items)
  const rejected = rows
    .filter((row) => excludedProgramme({ title: row.title, externalId: row.id }))
    .map((row) => ({ id: row.id, source: row.source, rule: REVIEWED_EXCLUSIONS.has(row.id) ? 'reviewed-id' : 'title-pattern', title: row.title }))
  const canon = new Map(canonicalChannels().map((channel) => [channel.number, channel]))
  const problems: Record<string, unknown[]> = {
    duplicateRows: [], badDuration: [], longDuration: [], emptyTitle: [], badProviderId: [], unknownSource: [], badChannelRef: [],
    excludedChannelRows: [], unknownRouteIds: [], crossSourceDuplicates: [],
  }
  const seen = new Map<string, Row>()
  for (const row of rows) {
    const prior = seen.get(row.id)
    if (prior) (prior.source === row.source ? problems.duplicateRows : problems.crossSourceDuplicates).push([row.id, prior.source, row.source])
    else seen.set(row.id, row)
    if (!(row.seconds > 0)) problems.badDuration.push([row.id, row.seconds])
    if (row.seconds > 12 * 3600) problems.longDuration.push([row.id, row.seconds, row.title.slice(0, 60)])
    if (!row.title?.trim()) problems.emptyTitle.push(row.id)
    if (!/^[\w-]{11}$/.test(row.id)) problems.badProviderId.push(row.id)
    if (!doc.sources[row.source]) problems.unknownSource.push([row.id, row.source])
    for (const n of row.channels) {
      if (!(n >= 0 && n <= 999) || !canon.has(n)) problems.badChannelRef.push([row.id, n])
      if (EXCLUDED_CHANNELS.includes(n)) problems.excludedChannelRows.push([row.id, n])
    }
  }
  for (const [channel, ids] of Object.entries(doc.programmeRoutes as Record<string, string[]>)) {
    for (const id of ids) if (!seen.has(id)) problems.unknownRouteIds.push([channel, id])
  }

  const airable = new Map<string, Set<number>>()
  const excludedPools: number[] = []
  const ownership: unknown[] = []
  const hits: { id: string; title: string; source: string; channels: number[]; subject: string; verdict: string }[] = []
  for (let n = 0; n <= 999; n += 1) {
    if (!channelByNumber(n)) continue
    const format = originalFormat(n)
    const pool: MediaItem[] = format?.kind === 'night-block' ? nightPool(format, network) : format ? [] : freshFor(n, getChannelMedia(network, n), DATE)
    if (EXCLUDED_CHANNELS.includes(n) && pool.length) excludedPools.push(n)
    for (const item of pool) {
      const set = airable.get(item.externalId) ?? new Set<number>()
      set.add(n)
      airable.set(item.externalId, set)
      const owner = item.sourceId ? OWNED_SOURCES.get(item.sourceId) : undefined
      if (owner !== undefined && owner !== n) ownership.push([item.externalId, item.sourceId, n])
    }
  }
  for (const [id, channels] of airable) {
    const row = seen.get(id)!
    const text = row.title
    const subject = SPACE.test(text) ? 'space' : AIR.test(text) ? 'aviation' : RELIGION.test(text) ? 'religion' : ''
    if (!subject) continue
    hits.push({ id, title: text, source: row.source, channels: [...channels], subject, verdict: FICTION_OR_SENSE.test(text) ? 'fiction-or-other-sense' : 'REVIEW' })
  }
  const closedIdentity = canonicalChannels().filter((channel) => channel.number <= 999 && channel.enabled && /\b(space|astronom\w*|aviation|aircraft|aerospace|religio\w*|faith|church|worship|gospel|bible)\b/i.test(`${channel.name} ${channel.category}`)).map((channel) => [channel.number, channel.name, channelByNumber(channel.number) ? 'enabled' : 'disabled'])

  const merged = mergeParsedExports([
    parseChannelsExport(readFileSync('public/user-network/channels.txt', 'utf8')),
    parseChannelsExport(readFileSync('public/user-network/more-channels.txt', 'utf8')),
  ])
  const built = channelsFromSources(planImport([], merged, { library: true, automatic: true }, [], 1).sources)
  const userIds = new Set([...built.programmes.values()].flat().map((programme) => programme.videoId).filter(Boolean) as string[])
  const userInNetwork = [...userIds].filter((id) => airable.has(id) && !seen.has(id))
  const sharedWithUser = [...userIds].filter((id) => airable.has(id)).length

  const names = new Map<string, number[]>()
  for (const channel of canonicalChannels()) if (channel.number <= 999 && channel.enabled) names.set(channel.name.toLowerCase(), [...(names.get(channel.name.toLowerCase()) ?? []), channel.number])
  const identity = {
    duplicateNames: [...names.entries()].filter(([, numbers]) => numbers.length > 1),
    placeholderNames: canonicalChannels().filter((channel) => channel.number <= 999 && /^(channel \d+|untitled|tbd|tba|placeholder|test)$/i.test(channel.name)).map((channel) => [channel.number, channel.name]),
    emptyNames: canonicalChannels().filter((channel) => channel.number <= 999 && !channel.name.trim()).map((channel) => channel.number),
    runtimeNameMismatch: canonicalChannels().filter((channel) => channel.number <= 999 && channelByNumber(channel.number) && channelByNumber(channel.number)!.name !== channel.name).map((channel) => [channel.number, channel.name, channelByNumber(channel.number)!.name]),
  }
  const review = hits.filter((hit) => hit.verdict === 'REVIEW')
  const out = {
    format: 'retrotv-catalogue-audit',
    catalogue: CATALOGUE_VERSION,
    rows: rows.length,
    uniqueIds: seen.size,
    airableIds: airable.size,
    problems: Object.fromEntries(Object.entries(problems).map(([key, list]) => [key, { count: list.length, sample: list.slice(0, 25) }])),
    excludedChannelPools: excludedPools,
    ownershipViolations: ownership,
    ownedSources: Object.fromEntries(OWNED_SOURCES),
    closedIdentityChannels: closedIdentity,
    exclusion: {
      scanned: airable.size,
      hits: hits.length,
      fictionOrOtherSense: hits.length - review.length,
      review,
      rejected,
      rejectedStillAirable: rejected.filter((row) => airable.has(row.id)).map((row) => row.id),
    },
    userIsolation: { userVideos: userIds.size, userOnlyVideosInNetworkPools: userInNetwork, alsoInNetworkCatalogue: sharedWithUser },
    identity,
  }
  writeFileSync('docs/catalogue-audit-v43.json', JSON.stringify(out, null, 1) + '\n')
  const md = [
    '# Catalogue audit — 000–999',
    '',
    `Catalogue ${CATALOGUE_VERSION}: ${rows.length} rows, ${seen.size} unique programme ids, ${airable.size} airable in some 000–999 runtime pool on ${DATE}.`,
    '',
    '## Integrity',
    '',
    '| Check | Count |',
    '|---|---|',
    ...Object.entries(out.problems).map(([key, value]) => `| ${key} | ${value.count} |`),
    `| excluded channels with a runtime pool | ${excludedPools.length} |`,
    `| owned-source programmes airable off their owner | ${ownership.length} |`,
    `| user-only videos in 000–999 pools | ${userInNetwork.length} |`,
    '',
    '## Exclusion scan (independent pattern, airable programmes only)',
    '',
    `${hits.length} titles matched the broad space, aviation or religion pattern; ${hits.length - review.length} are fiction or another sense of the word; ${review.length} are listed for review below.`,
    '',
    '| Id | Subject | Channels | Source | Title |',
    '|---|---|---|---|---|',
    ...review.map((hit) => `| ${hit.id} | ${hit.subject} | ${hit.channels.join(' ')} | ${hit.source} | ${hit.title.replace(/\|/g, '/').slice(0, 90)} |`),
    '',
    '## Rejected from 000–999 (src/library/exclusions.ts)',
    '',
    `${rejected.length} catalogue rows are factual space, aviation or religious programming and never enter a 000–999 pool; ${out.exclusion.rejectedStillAirable.length} remain airable.`,
    '',
    '| Id | Rule | Source | Title |',
    '|---|---|---|---|',
    ...rejected.map((row) => `| ${row.id} | ${row.rule} | ${row.source} | ${row.title.replace(/\|/g, '/').slice(0, 90)} |`),
    '',
    '## Channel identity (mechanical)',
    '',
    `Duplicate names: ${identity.duplicateNames.map(([name, numbers]) => `${name} (${numbers.join(', ')})`).join('; ') || 'none'}.`,
    `Placeholder names: ${identity.placeholderNames.length}. Empty names: ${identity.emptyNames.length}. Runtime name differs from canonical: ${identity.runtimeNameMismatch.length}.`,
    `Enabled channels whose name or category is a closed subject: ${closedIdentity.map((row) => row.join(' ')).join('; ') || 'none'}.`,
  ]
  writeFileSync('docs/catalogue-audit-v43.md', md.join('\n') + '\n')
  expect(rows.length).toBeGreaterThan(0)
  expect(out.exclusion.rejectedStillAirable).toEqual([])
}, 900_000)
