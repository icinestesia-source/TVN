import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { canonicalChannels } from '../src/data/canonical.ts'
import { CHANNEL_ROUTES, INDEPENDENT_SOURCES } from '../src/data/independent/network.ts'
import { resetDirector } from '../src/director/director.ts'
import { channelFitSummary, PROGRAMME_REUSE } from '../src/director/fit.ts'
import { setMediaLibrary } from '../src/director/library.ts'
import { broadcastDateFor } from '../src/director/time.ts'
import type { MediaItem } from '../src/director/types.ts'
import { dynamicChannel } from '../src/dynamic/providers.ts'
import { freshFor } from '../src/dynamic/runtime.ts'
import { schedulingPool } from '../src/library/mode.ts'
import { expandPlayableCatalogue } from '../src/library/playable-catalogue.ts'
import { getChannelMedia } from '../src/library/query.ts'
import type { LibraryMedia } from '../src/library/types.ts'
import { measureAiring } from '../src/network/airing.ts'
import { originalCard, STATUS_CARD_CLASSES } from '../src/originals/originals.ts'
import { currentFacts, EDITORIAL_MANIFEST_FORMAT, editorialIntent } from '../src/services/editorial-manifest.ts'

/**
 * The factual editorial baseline of TVN's curated network, 001–999: what every channel holds now, computed
 * from the shipped catalogue and the network's own code. Nothing here is intent: purposes are left blank,
 * because TVN holds no human-written purpose for a curated channel. Harvester records add only what TVN
 * cannot know itself (its viability rule per channel, and which programmes each Harvester generation
 * imported or held), each with the file's hash.
 *
 *   npx vitest run --config scripts/manifest.config.ts scripts/network-editorial.gen.ts
 */
const OUT = 'reports/network-editorial'
const HARVESTER = process.env.TVN_HARVESTER ?? '../TVN-Harvester'
const DOMINANT_SHARE = 0.8

type Row = Record<string, string>

function parseCsv(text: string): Row[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += char
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  const [head, ...body] = rows.filter((line) => line.some((value) => value !== ''))
  return body.map((line) => Object.fromEntries(head.map((name, index) => [name, line[index] ?? ''])))
}

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : Array.isArray(value) ? value.join(' ') : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places

interface Input {
  path: string
  sha256: string
  role: string
}

it('writes the 001–999 network editorial baseline', () => {
  const inputs: Input[] = []
  const harvester = (relative: string, role: string): string | null => {
    const path = join(HARVESTER, relative)
    if (!existsSync(path)) return null
    inputs.push({ path: `TVN-Harvester/${relative}`, sha256: sha256(path), role })
    return readFileSync(path, 'utf8')
  }

  const playable = JSON.parse(readFileSync('public/independent/playable.json', 'utf8'))
  inputs.unshift({ path: 'public/independent/playable.json', sha256: sha256('public/independent/playable.json'), role: 'TVN shipped catalogue (authoritative)' })
  const items = expandPlayableCatalogue(playable) as LibraryMedia[]
  resetDirector()
  setMediaLibrary(items)
  const sourceNames = new Map<string, string>(Object.entries(playable.sources as Record<string, string>))
  for (const source of INDEPENDENT_SOURCES) if (!sourceNames.has(source.id)) sourceNames.set(source.id, source.name)
  const name = (id: string) => sourceNames.get(id) ?? id
  const routes = new Map(CHANNEL_ROUTES.map((route) => [route.number, route]))
  const now = Date.now()
  const today = broadcastDateFor(now)
  const airing = new Map(measureAiring(items as unknown as MediaItem[], now).map((row) => [row.number, row]))
  const pool = schedulingPool(items as unknown as MediaItem[]) as unknown as LibraryMedia[]

  // Harvester: the viability rule TVN's channels were assessed against, and what each generation moved.
  const stateRows = parseCsv(harvester('reports/generations/gen3-plan/GEN3_TVN_1_0_8_NETWORK_STATE.csv', 'viability rule and targets per channel (rule assignment, not counts)') ?? '')
  const rules = new Map(stateRows.map((row) => [Number(row.channel), row]))
  const routesOf = (text: string | null) => (text ? (JSON.parse(text).add_routes as Record<string, string[]>) : {})
  const gen2 = routesOf(harvester('manifests/proposed/generation-002/first-tranche/TVN_IMPORT_PLAN.json', 'Generation 2 first tranche 67ae8d4996d36433, imported in TVN 1.0.7'))
  const gen3 = routesOf(harvester('reports/generations/gen3-editorial/import-98e6250f4a58538f/TVN_IMPORT_PLAN.json', 'Generation 3 tranche 98e6250f4a58538f, imported in TVN 1.0.10'))
  const effects = new Map(
    parseCsv(harvester('reports/generations/gen3-editorial/GEN3_EDITORIAL_CHANNEL_EFFECTS.csv', 'Generation 3 editorial decisions per channel') ?? '').map((row) => [Number(row.channel), row]),
  )
  const blocked = new Map<number, Map<string, number>>()
  for (const row of parseCsv(harvester('reports/generations/gen3-editorial/GEN3_CODE_BLOCKED_ANALYSIS.csv', 'Generation 3 code-blocked analysis (not implemented)') ?? '')) {
    const channel = Number(row.proposed_destination)
    const tally = blocked.get(channel) ?? new Map<string, number>()
    tally.set(row.classification, (tally.get(row.classification) ?? 0) + 1)
    blocked.set(channel, tally)
  }
  const fortniteText = harvester('reports/generations/gen3-fortnite/GEN3_FORTNITE_SUMMARY.json', 'Fortnite tranche c956cb12ca8c4ec2 (reviewed, not imported)')
  const fortnite = fortniteText ? (JSON.parse(fortniteText) as { tranche_hash: string; status: string; decisions: Record<string, number>; approved_hours: number }) : null
  const need135Text = harvester('reports/generations/gen3-editorial/GEN3_135_ACQUISITION_REQUIREMENT.json', 'Channel 135 acquisition requirement')
  const need135 = need135Text ? (JSON.parse(need135Text) as { held: { programmes: number; hours: number }; tvn_genre_floor: { remaining: { hours: number; trailers_at_held_mean: number } } }) : null

  const records = canonicalChannels()
    .filter((channel) => channel.number >= 1 && channel.number <= 999)
    .map((channel) => {
      const number = channel.number
      const route = routes.get(number)
      const fit = channelFitSummary(number)
      const status = airing.get(number)
      const dynamic = dynamicChannel(number)
      const card = originalCard(number)
      const programmes = freshFor(number, getChannelMedia(pool as unknown as MediaItem[], number) as unknown as LibraryMedia[], today) as LibraryMedia[]
      const ids = new Set(programmes.map((item) => item.id.replace(/^yt:/, '')))
      const yearOf = (item: LibraryMedia) => (item as LibraryMedia & { original?: { year?: number } }).original?.year ?? item.year ?? null
      const sourceIds = [...new Set(programmes.map((item) => item.sourceId ?? '?'))]
      const facts = currentFacts(
        programmes.map((item) => ({ sourceId: item.sourceId ?? '?', durationSec: item.durationSeconds, programmeType: item.programmeType ?? 'unknown', year: yearOf(item) })),
        sourceIds.map((id) => ({ id, label: name(id), sourceType: 'tvn-source', enabled: true })),
        Boolean(status?.live),
      )
      const ranked = [...facts.sources].sort((a, b) => b.seconds - a.seconds || b.programmes - a.programmes)
      const programmeShare = facts.programmeCount ? Math.max(...facts.sources.map((source) => source.programmes)) / facts.programmeCount : 0
      const hoursShare = facts.totalSeconds ? Math.max(...facts.sources.map((source) => source.seconds)) / facts.totalSeconds : 0

      const onAir = status ? status.status !== 'dormant' : false
      const live = Boolean(status?.live || dynamic?.live || fit.liveOnly || channel.channelType === 'live' || channel.category === 'webcams')
      const audio = channel.mediaKind === 'audio' || channel.category === 'radio'
      const special = Boolean(status?.original) || route?.strategy === 'RETROTV_ORIGINAL_GENERATED'
      const policyOff = route?.strategy === 'EXCLUDED' || route?.strategy === 'DELIBERATELY_UNAVAILABLE' || fit.closed || card?.class === 'INTENTIONALLY_UNAVAILABLE'
      const thin = status?.status === 'thin'
      const empty = facts.programmeCount === 0 && !status?.original && !status?.live
      const healthy = status?.status === 'active'
      const state = onAir ? (thin ? 'THIN' : 'ON_AIR') : policyOff ? 'UNAVAILABLE' : 'HOLDING'
      const type = [channel.channelType, channel.mediaKind].filter(Boolean).join('/')

      const rule = rules.get(number)
      const target = rule && rule.target_hours ? { hours: Number(rule.target_hours), programmes: Number(rule.target_programmes), minHours: Number(rule.min_hours), minProgrammes: Number(rule.min_programmes) } : null
      const targetStatus = !rule
        ? 'NO_RULE'
        : !target
          ? `NOT_MEASURED_${rule.viability_rule}`
          : facts.programmeCount === 0
            ? 'EMPTY'
            : facts.hours >= target.hours && facts.programmeCount >= target.programmes
              ? 'MEETS_TARGET'
              : facts.hours >= target.minHours && facts.programmeCount >= target.minProgrammes
                ? 'VIABLE_BELOW_TARGET'
                : 'BELOW_VIABLE'

      const home = [...new Set([...(fit.owner ? [fit.owner] : []), ...fit.homeFeeds])]
      const reuse = [...(PROGRAMME_REUSE[number] ?? [])]
      const types = Object.entries(facts.programmeTypes)
        .map(([kind, count]) => `${kind}:${count}`)
        .join(' ')

      const effect = (routed: Record<string, string[]>, label: string) => {
        const wanted = routed[String(number)] ?? routed[String(number).padStart(3, '0')] ?? []
        if (!wanted.length) return ''
        const airing = wanted.filter((id) => ids.has(id))
        const seconds = programmes.filter((item) => wanted.includes(item.id.replace(/^yt:/, ''))).reduce((sum, item) => sum + item.durationSeconds, 0)
        return `${label}: ${wanted.length} routed, ${airing.length} in today's pool (${round(seconds / 3600)} h)`
      }
      const g3: string[] = []
      const imported = effect(gen3, 'imported 1.0.10')
      if (imported) g3.push(imported)
      const decided = effects.get(number)
      if (decided && (Number(decided.hold) || Number(decided.reject))) g3.push(`editorial: ${decided.hold} held, ${decided.reject} rejected`)
      const codeBlocked = blocked.get(number)
      if (codeBlocked) g3.push(`code-blocked: ${[...codeBlocked].map(([kind, count]) => `${count} ${kind}`).join(', ')} (not implemented)`)
      if (number === 812 && fortnite) g3.push(`Fortnite tranche ${fortnite.tranche_hash}: ${fortnite.decisions.APPROVE ?? 0} approved / ${fortnite.decisions.HOLD ?? 0} held, ${fortnite.approved_hours} h, ${fortnite.status}`)
      if (number === 135 && need135) g3.push(`${need135.held.programmes} held (${need135.held.hours} h); needs ${need135.tvn_genre_floor.remaining.hours} h (~${need135.tvn_genre_floor.remaining.trailers_at_held_mean} trailers) for the 3 h floor`)
      const editoriallyBlocked = Boolean(codeBlocked) || (decided ? Number(decided.hold) > 0 : false)

      let gap = 'NONE'
      let reason = ''
      if (policyOff) {
        gap = 'OFF_AIR_BY_POLICY'
        reason = route?.strategy === 'EXCLUDED' || fit.closed ? 'Excluded by network policy.' : card?.reason ?? 'No free authorised source; kept off air by policy.'
      } else if (!onAir && card?.class === 'RIGHTS_BLOCKED') {
        gap = 'BLOCKED_RIGHTS'
        reason = `${card.subtype ? `${card.subtype}: ` : ''}${card.reason}`
      } else if (!onAir && card && STATUS_CARD_CLASSES.has(card.class)) {
        gap = 'NEEDS_SOURCE'
        reason = `${card.class}${card.subtype ? ` (${card.subtype})` : ''}: ${card.reason}`
      } else if (!onAir && live) {
        gap = 'NEEDS_LIVE_PROVIDER'
        reason = dynamic?.reason ?? 'Live-only channel with no verified official stream.'
      } else if (!onAir && audio) {
        gap = 'NEEDS_AUDIO_PROVIDER'
        reason = 'Audio channel with no verified audio stream.'
      } else if (!onAir && special) {
        gap = 'NEEDS_ORIGINAL_MATERIAL'
        reason = 'Reserved for RetroTV original or generated material.'
      } else if (empty) {
        gap = 'NEEDS_SOURCE'
        reason = 'No programme in the shipped catalogue fits this channel today.'
      } else if (thin) {
        gap = 'NEEDS_DEPTH'
        reason = `${facts.hours} h of distinct programming; the airing floor is 3 h.`
      } else if (targetStatus === 'BELOW_VIABLE' || targetStatus === 'VIABLE_BELOW_TARGET') {
        gap = 'BELOW_TARGET'
        reason = `${facts.programmeCount} programmes / ${facts.hours} h against the ${rule?.viability_rule} target of ${target?.programmes} / ${target?.hours} h.`
      }
      if (editoriallyBlocked) reason = `${reason}${reason ? ' ' : ''}Generation 3 candidates held by editorial or code decisions.`.trim()

      const notes: string[] = []
      notes.push(`category ${channel.category}; route ${route?.strategy ?? 'SOURCE_ROUTED'}`)
      if (channel.sourcePolicy) notes.push(`source policy ${channel.sourcePolicy}`)
      if (channel.providerHint) notes.push(`provider hint ${channel.providerHint}`)
      if (fit.owner) notes.push(`owned source ${name(fit.owner)}`)
      if (fit.sports) notes.push(fit.sports.length ? `sport routing: ${fit.sports.join(', ')}` : 'sport routing: any sport')
      if (fit.liveOnly) notes.push('live streams only')
      if (fit.general) notes.push('general-entertainment mix')
      if (fit.filmSources) notes.push(`film sources: ${fit.filmSources.map(name).join(', ')}`)
      if (dynamic?.identity) notes.push(`dynamic identity (configured): ${dynamic.identity}`)
      if (dynamic?.live) notes.push(`official live stream: ${dynamic.live.service}`)
      if (status?.original) notes.push(`RetroTV original format: ${status.original}`)
      if (card) notes.push(`status card ${card.class}${card.redirect ? ` → ${String(card.redirect).padStart(3, '0')}` : ''}`)

      return {
        channel_number: number,
        channel_name: channel.name,
        channel_state: state,
        channel_type: type,
        programme_count: facts.programmeCount,
        total_duration_seconds: facts.totalSeconds,
        total_hours: facts.hours,
        source_count: facts.sourceCount,
        source_ids: ranked.map((source) => source.id),
        source_names: ranked.map((source) => source.label),
        largest_source_programme_share: round(programmeShare, 3),
        largest_source_hours_share: round(hoursShare, 3),
        on_air: onAir,
        holding: !onAir,
        live,
        audio,
        special,
        thin,
        healthy,
        empty,
        target_programmes: target?.programmes ?? null,
        target_hours: target?.hours ?? null,
        target_status: targetStatus,
        home_sources: home,
        reuse_sources: reuse,
        programme_types: types,
        earliest_known_year: facts.earliestKnownYear,
        latest_known_year: facts.latestKnownYear,
        known_gap_classification: gap,
        known_gap_reason: reason,
        generation_2_effect: effect(gen2, 'imported 1.0.7'),
        generation_3_effect: g3.join('; '),
        notes_from_existing_configuration: notes.join('; '),
        viability_rule: rule?.viability_rule ?? '',
        editorially_blocked: editoriallyBlocked,
        // The editorial-manifest view of the same channel: facts and intent kept apart, intent left blank.
        manifest: {
          format: EDITORIAL_MANIFEST_FORMAT,
          scope: 'central' as const,
          channel: { number, name: channel.name },
          current: facts,
          editorial: editorialIntent(undefined),
          filters: [],
        },
      }
    })

  const COLUMNS = [
    'channel_number', 'channel_name', 'channel_state', 'channel_type', 'programme_count', 'total_duration_seconds', 'total_hours', 'source_count', 'source_ids',
    'source_names', 'largest_source_programme_share', 'largest_source_hours_share', 'on_air', 'holding', 'live', 'audio', 'special', 'thin', 'healthy', 'empty',
    'target_programmes', 'target_hours', 'target_status', 'home_sources', 'reuse_sources', 'programme_types', 'earliest_known_year', 'latest_known_year',
    'known_gap_classification', 'known_gap_reason', 'generation_2_effect', 'generation_3_effect', 'notes_from_existing_configuration',
  ] as const
  const count = (test: (record: (typeof records)[number]) => boolean) => records.filter(test).length
  const tally = (key: keyof (typeof records)[number]) => {
    const out: Record<string, number> = {}
    for (const record of records) out[String(record[key])] = (out[String(record[key])] ?? 0) + 1
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
  }
  const programmed = records.filter((record) => record.programme_count > 0)
  const totals = {
    channels: records.length,
    programmes_scheduled: records.reduce((sum, record) => sum + record.programme_count, 0),
    seconds_scheduled: records.reduce((sum, record) => sum + record.total_duration_seconds, 0),
    hours_scheduled: round(records.reduce((sum, record) => sum + record.total_duration_seconds, 0) / 3600, 1),
    catalogue_programmes: items.length,
    catalogue_hours: round(items.reduce((sum, item) => sum + item.durationSeconds, 0) / 3600, 1),
    on_air: count((record) => record.on_air),
    holding: count((record) => record.holding),
    healthy: count((record) => record.healthy),
    thin: count((record) => record.thin),
    empty: count((record) => record.empty),
    live: count((record) => record.live),
    audio: count((record) => record.audio),
    special: count((record) => record.special),
    state: tally('channel_state'),
    target_status: tally('target_status'),
    gaps: tally('known_gap_classification'),
    single_source_programmed: count((record) => record.programme_count > 0 && record.source_count === 1),
    dominated: count((record) => record.programme_count > 0 && record.source_count > 1 && record.largest_source_hours_share >= DOMINANT_SHARE),
    programmed_channels: programmed.length,
    editorially_blocked: count((record) => record.editorially_blocked),
  }
  let commit = 'unknown'
  try {
    commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    /* outside git */
  }

  mkdirSync(join(OUT, 'gen3'), { recursive: true })
  const copied: Input[] = []
  for (const [relative, role] of [
    ['reports/generations/gen3-editorial/GEN3_CODE_BLOCKED_ANALYSIS.csv', 'code-blocked analysis of the 46 (not implemented)'],
    ['reports/generations/gen3-editorial/GEN3_BOUNDED_REUSE_PROPOSAL.csv', 'bounded reuse proposal (not implemented)'],
    ['reports/generations/gen3-editorial/GEN3_CODE_BLOCKED_SUMMARY.json', 'code-blocked summary'],
    ['reports/generations/gen3-editorial/GEN3_135_ACQUISITION_REQUIREMENT.json', 'channel 135 acquisition requirement'],
    ['reports/generations/gen3-fortnite/GEN3_FORTNITE_TRANCHE.json', 'Fortnite tranche c956cb12ca8c4ec2 (not imported)'],
    ['reports/generations/gen3-fortnite/GEN3_FORTNITE_REVIEW.csv', 'Fortnite review decisions'],
    ['reports/generations/gen3-fortnite/GEN3_FORTNITE_SUMMARY.json', 'Fortnite summary'],
    ['config/editorial/gen3_fortnite_review.json', 'Fortnite editorial review config (user decisions)'],
  ] as const) {
    const from = join(HARVESTER, relative)
    if (!existsSync(from)) continue
    const to = join(OUT, 'gen3', relative.split('/').pop() as string)
    copyFileSync(from, to)
    copied.push({ path: to, sha256: sha256(to), role: `${role}; byte-for-byte copy of TVN-Harvester/${relative}` })
  }

  const generatedAt = new Date(now).toISOString()
  const document = {
    format: 'tvn-network-editorial-baseline-v1',
    generatedAt,
    broadcastDate: today,
    tvnCommit: commit,
    scope: '001–999 curated network; user channels (1001+) are never included',
    definitions: {
      on_air: 'airing status active or thin (a thin channel still airs, looping what it has)',
      healthy: 'airing status active: at least 3 h of distinct programming, a verified live stream, or a complete RetroTV original',
      thin: 'airing status thin: programmes, but under 3 h of distinct programming',
      empty: 'no programme in today’s pool and no live stream or original format',
      holding: 'not on air (includes UNAVAILABLE by policy)',
      programmes: 'distinct programmes eligible for the channel today (rolling channels measured inside their freshness window)',
      shares: 'largest single-source share of the channel’s programmes and of its hours, computed independently',
      targets: 'Harvester viability rule per channel (rule assignment from TVN-Harvester gen3-plan); counts compared are TVN’s own',
      purpose: 'editorial purpose is null everywhere: TVN holds no human-written purpose for curated channels',
    },
    totals,
    inputs,
    gen3Copies: copied,
    records: records.map(({ manifest: _manifest, ...rest }) => rest),
    manifests: records.map((record) => record.manifest),
  }
  writeFileSync(join(OUT, 'TVN_FULL_CHANNEL_MANIFEST.json'), `${JSON.stringify(document, null, 2)}\n`)
  writeFileSync(
    join(OUT, 'TVN_FULL_CHANNEL_MANIFEST.csv'),
    [COLUMNS.join(','), ...records.map((record) => COLUMNS.map((column) => csvCell(record[column])).join(','))].join('\n') + '\n',
  )

  const pad = (number: number) => String(number).padStart(3, '0')
  const tableRow = (record: (typeof records)[number]) =>
    `| ${pad(record.channel_number)} | ${record.channel_name} | ${record.channel_state} | ${record.programme_count} | ${record.total_hours} | ${record.source_count} | ${Math.round(record.largest_source_hours_share * 100)}% | ${record.target_status} | ${record.known_gap_classification} |`
  const md = [
    '# TVN full channel manifest · 001–999',
    '',
    `Factual baseline generated ${generatedAt} from TVN ${commit} (broadcast date ${today}). Machine-readable: \`TVN_FULL_CHANNEL_MANIFEST.json\` and \`.csv\`. Editorial purposes are blank: TVN holds no human-written purpose for curated channels.`,
    '',
    '| Measure | Value |',
    '|---|---|',
    `| Channels | ${totals.channels} |`,
    `| Programmes scheduled (sum over channels) | ${totals.programmes_scheduled} |`,
    `| Hours scheduled (sum over channels) | ${totals.hours_scheduled} |`,
    `| Shipped catalogue | ${totals.catalogue_programmes} programmes, ${totals.catalogue_hours} h |`,
    `| On air / holding | ${totals.on_air} / ${totals.holding} |`,
    `| Healthy / thin / empty | ${totals.healthy} / ${totals.thin} / ${totals.empty} |`,
    `| Live / audio / special | ${totals.live} / ${totals.audio} / ${totals.special} |`,
    `| Programmed from a single source | ${totals.single_source_programmed} |`,
    `| Multi-source, one source ≥ ${DOMINANT_SHARE * 100}% of hours | ${totals.dominated} |`,
    '',
    '| State | Channels |',
    '|---|---|',
    ...Object.entries(totals.state).map(([key, value]) => `| ${key} | ${value} |`),
    '',
    '| Target status | Channels |',
    '|---|---|',
    ...Object.entries(totals.target_status).map(([key, value]) => `| ${key} | ${value} |`),
    '',
    '| Gap | Channels |',
    '|---|---|',
    ...Object.entries(totals.gaps).map(([key, value]) => `| ${key} | ${value} |`),
    '',
    '| Ch | Name | State | Programmes | Hours | Sources | Largest source (hours) | Target | Gap |',
    '|---|---|---|---|---|---|---|---|---|',
    ...records.map(tableRow),
    '',
  ].join('\n')
  writeFileSync(join(OUT, 'TVN_FULL_CHANNEL_MANIFEST.md'), md)

  const list = (selected: (typeof records)[number][], limit = 1000) =>
    selected.length ? selected.slice(0, limit).map((record) => `${pad(record.channel_number)} ${record.channel_name}`).join(' · ') + (selected.length > limit ? ` · … (${selected.length - limit} more)` : '') : '(none)'
  const by = (test: (record: (typeof records)[number]) => boolean) => records.filter(test)
  const dominated = by((record) => record.programme_count > 0 && record.largest_source_hours_share >= DOMINANT_SHARE)
  const baseline = [
    '# TVN network editorial baseline',
    '',
    `Descriptive only. Generated ${generatedAt} from TVN ${commit} by \`scripts/network-editorial.gen.ts\`; every count is TVN's own. Nothing here proposes or changes programming.`,
    '',
    '## Summary',
    '',
    `- ${totals.channels} curated channels (001–999): ${totals.on_air} on air, ${totals.holding} holding.`,
    `- Healthy ${totals.healthy} · thin ${totals.thin} · empty ${totals.empty}.`,
    `- Live ${totals.live} · audio ${totals.audio} · special (RetroTV original or generated) ${totals.special}.`,
    `- ${totals.programmes_scheduled} programmes and ${totals.hours_scheduled} h scheduled across channels, from a catalogue of ${totals.catalogue_programmes} programmes (${totals.catalogue_hours} h).`,
    '',
    '## Empty channels',
    '',
    list(by((record) => record.empty)),
    '',
    '## Thin channels (on air, under 3 h)',
    '',
    list(by((record) => record.thin)),
    '',
    '## Healthy channels',
    '',
    `${totals.healthy} channels; see \`TVN_FULL_CHANNEL_MANIFEST.csv\` (healthy = true).`,
    '',
    '## Unavailable or holding',
    '',
    `Unavailable by policy (${count((record) => record.channel_state === 'UNAVAILABLE')}): ${list(by((record) => record.channel_state === 'UNAVAILABLE'))}`,
    '',
    `Holding (${count((record) => record.channel_state === 'HOLDING')}): ${list(by((record) => record.channel_state === 'HOLDING'))}`,
    '',
    '## Live, audio and special',
    '',
    `Live (${totals.live}): ${list(by((record) => record.live))}`,
    '',
    `Audio (${totals.audio}): ${list(by((record) => record.audio))}`,
    '',
    `Special (${totals.special}): ${list(by((record) => record.special))}`,
    '',
    '## Channels needing new sources',
    '',
    `No programme fits them today and nothing else carries them (gap NEEDS_SOURCE, ${count((record) => record.known_gap_classification === 'NEEDS_SOURCE')}): ${list(by((record) => record.known_gap_classification === 'NEEDS_SOURCE'))}`,
    '',
    `Live provider needed (${count((record) => record.known_gap_classification === 'NEEDS_LIVE_PROVIDER')}) and audio provider needed (${count((record) => record.known_gap_classification === 'NEEDS_AUDIO_PROVIDER')}) are listed in the CSV.`,
    '',
    '## Channels needing depth',
    '',
    `Thin, under the 3 h airing floor (NEEDS_DEPTH, ${count((record) => record.known_gap_classification === 'NEEDS_DEPTH')}): ${list(by((record) => record.known_gap_classification === 'NEEDS_DEPTH'))}`,
    '',
    `On air but below their Harvester viability target (BELOW_TARGET, ${count((record) => record.known_gap_classification === 'BELOW_TARGET')}): ${list(by((record) => record.known_gap_classification === 'BELOW_TARGET'))}`,
    '',
    '## Channels blocked by editorial or code decisions',
    '',
    'Generation 3 candidates held by the user’s editorial review or by TVN’s source routing (code-blocked); none of these decisions is changed here.',
    '',
    ...by((record) => record.editorially_blocked).map((record) => `- ${pad(record.channel_number)} ${record.channel_name}: ${record.generation_3_effect}`),
    '',
    '## Channels dominated by one source',
    '',
    `Programmed channels where one source supplies at least ${DOMINANT_SHARE * 100}% of the hours (${dominated.length}; ${totals.single_source_programmed} of them have a single source).`,
    '',
    list(dominated),
    '',
    '## Preserved Generation 3 reports',
    '',
    'Byte-for-byte copies in `gen3/`; their decisions are unchanged. The Fortnite tranche is not imported and the bounded reuse proposal is not implemented.',
    '',
    ...copied.map((file) => `- \`${file.path.replace(`${OUT}/`, '')}\` · ${file.role} · sha256 ${file.sha256.slice(0, 16)}…`),
    '',
    '## Inputs',
    '',
    ...inputs.map((input) => `- \`${input.path}\` · ${input.role} · sha256 ${input.sha256.slice(0, 16)}…`),
    '',
  ].join('\n')
  writeFileSync(join(OUT, 'TVN_NETWORK_EDITORIAL_BASELINE.md'), baseline)

  expect(records).toHaveLength(999)
  expect(records.every((record) => record.manifest.editorial.purpose === null)).toBe(true)
})
