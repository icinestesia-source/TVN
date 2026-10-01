import { canonicalByNumber } from '../data/canonical.ts'
import { CHANNEL_ROUTES, channelMayAir } from '../data/independent/network.ts'
import type { ProgrammeType } from '../types/programme.ts'
import { BROADCAST_DAY_START } from './network.ts'
import { REPEAT_RULES } from './repeat.ts'
import type { DayKind } from './time.ts'
import type {
  ContentStrategy,
  DayTemplate,
  Eligibility,
  ProgrammingPolicy,
  ScheduleStyle,
  TemplateBlock,
} from './types.ts'

type Row = [
  id: string,
  title: string,
  start: string,
  programmeType: ProgrammeType,
  strategy?: ContentStrategy,
  hard?: boolean,
  prefer?: ProgrammeType[],
  hook?: string,
  segment?: number,
]

function rows(list: Row[]): TemplateBlock[] {
  return list.map((row) => ({
    id: row[0],
    title: row[1],
    start: row[2],
    programmeType: row[3],
    strategy: row[4] ?? 'feature',
    hardStart: row[5] ?? false,
    preferTypes: row[6],
    eventHook: row[7],
    segmentSeconds: row[8],
    continuityPolicy: 'generated-fill' as const,
  }))
}

function day(id: DayKind, blocks: TemplateBlock[]): DayTemplate {
  return { id, blocks }
}

function allDays(
  blocks: TemplateBlock[],
  sunday?: TemplateBlock[],
  saturday?: TemplateBlock[],
  friday?: TemplateBlock[],
): ProgrammingPolicy['dayTemplates'] {
  return {
    weekday: day('weekday', blocks),
    friday: day('friday', friday ?? blocks),
    saturday: day('saturday', saturday ?? blocks),
    sunday: day('sunday', sunday ?? blocks),
  }
}

const MOVIE_DAYPARTS = [
  { id: 'morning', start: '06:00', end: '12:00', weights: { short: 18, documentary: 10, trailer: 6, film: 0 } },
  { id: 'afternoon', start: '12:00', end: '18:00', weights: { film: 16, documentary: 4 } },
  { id: 'earlyEvening', start: '18:00', end: '20:00', weights: { documentary: 16, film: 6, short: 4 } },
  { id: 'prime', start: '20:00', end: '00:00', weights: { film: 18 } },
  { id: 'late', start: '00:00', end: '02:00', weights: { film: 12 } },
  { id: 'overnight', start: '02:00', end: '06:00', weights: { film: 6, documentary: 6 } },
] satisfies ProgrammingPolicy['dayparts']

function movieBlocks(featureTitle: string, midnightTitle: string): TemplateBlock[] {
  return rows([
    ['morning', 'Morning Pictures', '06:00', 'short', 'feature', false, ['short', 'documentary', 'trailer']],
    ['matinee', 'Matinee', '12:00', 'film', 'feature', false, ['film', 'documentary']],
    ['early', 'Film Documentary', '18:00', 'documentary', 'feature', false, ['documentary', 'short']],
    ['feature', featureTitle, '20:00', 'film', 'feature', true, ['film']],
    ['second', 'SECOND FEATURE', '22:00', 'film', 'feature', false, ['film']],
    ['midnight', midnightTitle, '00:00', 'film', 'feature', true, ['film']],
    ['overnight', 'Overnight Pictures', '02:00', 'film', 'feature', false, ['film', 'documentary']],
  ])
}

function horrorPolicy(channelNumber: number): ProgrammingPolicy {
  const base = movieBlocks('FEATURE PRESENTATION', 'MIDNIGHT HORROR')
  const friday = movieBlocks('FRIDAY NIGHT FILM', 'MIDNIGHT HORROR')
  return {
    channelNumber,
    scheduleStyle: 'movies',
    archetype: 'movies',
    eligibility: {
      includeTopics: ['horror', 'halloween'],
      includeTypes: ['film', 'documentary', 'short', 'trailer'],
      excludeTypes: ['sport', 'music-video', 'classic-match'],
    },
    topics: ['horror', 'halloween'],
    dayTemplates: allDays(base, base, base, friday),
    dayparts: MOVIE_DAYPARTS,
    repetition: REPEAT_RULES.film,
    junctionRules: ['06:00', '20:00', '00:00'],
    specialEventRules: [
      {
        id: 'halloween',
        monthDay: '10-31',
        titleOverrides: { midnight: 'All Hallows Late Feature' },
        weightTopics: { halloween: 40 },
      },
    ],
    fallbackPolicy: 'generated',
    broadcastDayStart: BROADCAST_DAY_START,
    diversityScale: 0.6,
  }
}

function classicFilmPolicy(channelNumber: number): ProgrammingPolicy {
  const base = movieBlocks('CLASSIC FEATURE', 'MIDNIGHT MOVIE')
  const friday = movieBlocks('FRIDAY NIGHT FILM', 'MIDNIGHT MOVIE')
  const sunday = movieBlocks('SUNDAY CLASSICS', 'MIDNIGHT MOVIE')
  return {
    channelNumber,
    scheduleStyle: 'movies',
    archetype: 'movies',
    eligibility: {
      includeTypes: ['film', 'documentary', 'short', 'trailer'],
      excludeTypes: ['sport', 'music-video', 'classic-match', 'news'],
    },
    topics: ['classic', 'film'],
    dayTemplates: allDays(base, sunday, base, friday),
    dayparts: MOVIE_DAYPARTS,
    repetition: REPEAT_RULES.film,
    junctionRules: ['06:00', '20:00', '00:00'],
    specialEventRules: [],
    fallbackPolicy: 'generated',
    broadcastDayStart: BROADCAST_DAY_START,
    diversityScale: 0.7,
  }
}

const MUSIC_BLOCKS = rows([
  ['wake', 'WAKE UP 90s', '06:00', 'music-video', 'segments', true, ['music-video'], undefined, 300],
  ['pop', '90s POP', '09:00', 'music-video', 'segments', false, ['music-video'], undefined, 300],
  ['wonders', 'ONE HIT WONDERS', '11:00', 'music-video', 'segments', false, ['music-video'], undefined, 300],
  ['mix', '90s MIX', '12:00', 'music-video', 'segments', false, ['music-video'], undefined, 300],
  ['britpop', 'BRITPOP', '14:00', 'music-video', 'segments', false, ['music-video'], undefined, 300],
  ['mtv', 'MTV GENERATION', '16:00', 'music-video', 'segments', false, ['music-video'], undefined, 300],
  ['biggest', 'BIGGEST VIDEOS', '18:00', 'music-video', 'segments', false, ['music-video'], undefined, 300],
  ['top40', '90s TOP 40', '20:00', 'music-video', 'segments', true, ['music-video'], undefined, 300],
  ['alternative', 'ALTERNATIVE NATION', '23:00', 'music-video', 'segments', false, ['music-video'], undefined, 300],
  ['after', 'AFTER HOURS', '01:00', 'music-video', 'segments', false, ['music-video'], undefined, 300],
  ['allnight', 'VIDEOS ALL NIGHT', '03:00', 'music-video', 'segments', false, ['music-video'], undefined, 300],
])

function musicSunday(): TemplateBlock[] {
  return MUSIC_BLOCKS.map((block) => (block.id === 'pop' ? { ...block, title: 'SUNDAY 90s' } : block))
}

function ninetiesPolicy(channelNumber: number): ProgrammingPolicy {
  return {
    channelNumber,
    scheduleStyle: 'music',
    archetype: 'music',
    eligibility: {
      includeTopics: ['1990s'],
      includeTypes: ['music-video', 'music-block', 'concert', 'ident', 'continuity', 'promo'],
    },
    topics: ['1990s', 'britpop', 'pop'],
    dayTemplates: allDays(MUSIC_BLOCKS, musicSunday()),
    dayparts: [
      { id: 'morning', start: '06:00', end: '12:00', weights: { 'music-video': 8 } },
      { id: 'afternoon', start: '12:00', end: '18:00', weights: { 'music-video': 8 } },
      { id: 'prime', start: '18:00', end: '23:00', weights: { 'music-video': 10 } },
      { id: 'late', start: '23:00', end: '06:00', weights: { 'music-video': 6 } },
    ],
    repetition: REPEAT_RULES['music-video'],
    junctionRules: ['06:00', '20:00'],
    specialEventRules: [],
    fallbackPolicy: 'generated',
    broadcastDayStart: BROADCAST_DAY_START,
    diversityScale: 0.45,
  }
}

const FOOTBALL_SATURDAY = rows([
  ['archive-am', 'Football Archive', '06:00', 'documentary', 'feature', false, ['documentary', 'sport']],
  ['build', 'MATCHDAY BUILD-UP', '14:00', 'sport', 'feature', false, ['sport'], 'matchday-context'],
  ['matchday', 'MATCHDAY', '15:00', 'sport', 'feature', true, ['sport', 'documentary', 'highlights'], 'matchday'],
  ['results', 'RESULTS / REACTION', '17:00', 'documentary', 'feature', true, ['documentary', 'sport'], 'results'],
  ['classic', 'CLASSIC MATCH', '20:00', 'classic-match', 'feature', true, ['classic-match', 'highlights', 'documentary']],
  ['archive', 'Football Stories', '22:00', 'documentary', 'feature', false, ['documentary', 'sport']],
  ['replay', 'Classic Match Replay', '00:00', 'classic-match', 'feature', false, ['classic-match', 'highlights']],
])

const FOOTBALL_WEEKDAY = rows([
  ['stories', 'Football Archive', '06:00', 'documentary', 'feature', false, ['documentary', 'sport']],
  ['afternoon', 'Afternoon Archive', '15:00', 'documentary', 'feature', false, ['documentary', 'sport']],
  ['evening', 'Evening Documentary', '21:00', 'documentary', 'feature', true, ['documentary']],
  ['overnight', 'Overnight Archive', '00:00', 'documentary', 'feature', false, ['documentary']],
])

function footballPolicy(channelNumber: number): ProgrammingPolicy {
  const archiveEligibility = {
    includeTypes: ['documentary', 'sport'] as ProgrammeType[],
    excludeTypes: ['classic-match' as ProgrammeType],
  }
  const saturday = FOOTBALL_SATURDAY.map((block) => {
    if (block.id === 'archive-am' || block.id === 'results' || block.id === 'archive') {
      return { ...block, eligibility: archiveEligibility }
    }
    if (block.id === 'matchday' || block.id === 'build') {
      return { ...block, eligibility: { excludeTypes: ['classic-match' as ProgrammeType] } }
    }
    if (block.id === 'classic' || block.id === 'replay') {
      return {
        ...block,
        eligibility: { includeTypes: ['classic-match', 'highlights', 'documentary'] as ProgrammeType[] },
      }
    }
    return block
  })
  const weekday = FOOTBALL_WEEKDAY.map((block) =>
    block.id === 'stories' || block.id === 'afternoon'
      ? { ...block, eligibility: archiveEligibility }
      : block,
  )
  return {
    channelNumber,
    scheduleStyle: 'sport',
    archetype: 'sport',
    eligibility: {
      includeTopics: ['football'],
      includeSubjects: ['football'],
      includeTypes: ['sport', 'classic-match', 'highlights', 'documentary', 'live'],
      excludeTypes: ['music-video', 'film', 'gameplay', 'analysis', 'interview'],
      excludeSubjects: ['wrestling', 'basketball', 'boxing', 'american-football', 'gaming'],
    },
    topics: ['football'],
    dayTemplates: {
      weekday: day('weekday', weekday),
      friday: day('friday', weekday),
      saturday: day('saturday', saturday),
      sunday: day('sunday', weekday),
    },
    dayparts: [
      { id: 'morning', start: '06:00', end: '12:00', weights: { documentary: 8, highlights: 6 } },
      { id: 'afternoon', start: '12:00', end: '18:00', weights: { sport: 8, analysis: 6 } },
      { id: 'prime', start: '19:00', end: '23:00', weights: { 'classic-match': 20, documentary: 6 } },
      { id: 'overnight', start: '00:00', end: '06:00', weights: { documentary: 4, 'classic-match': 8 } },
    ],
    repetition: REPEAT_RULES['classic-match'],
    junctionRules: ['15:00', '17:00', '20:00'],
    specialEventRules: [],
    fallbackPolicy: 'generated',
    broadcastDayStart: BROADCAST_DAY_START,
    diversityScale: 0.55,
  }
}

function factualBlocks(morning: string): TemplateBlock[] {
  return rows([
    ['early', 'Morning Archive', '06:00', 'short', 'feature', false, ['short', 'documentary']],
    ['accessible', morning, '08:00', 'documentary', 'feature', false, ['documentary']],
    ['themed', 'Themed Documentary', '10:00', 'documentary', 'feature', false, ['documentary']],
    ['feature', 'History Feature', '12:00', 'documentary', 'feature', false, ['documentary']],
    ['hour', 'Documentary Hour', '14:00', 'documentary', 'feature', false, ['documentary']],
    ['specialist', 'Specialist Archive', '16:00', 'documentary', 'feature', false, ['documentary']],
    ['evening', 'Evening Factual', '18:00', 'documentary', 'feature', false, ['documentary']],
    ['prime', 'PRIME DOCUMENTARY', '20:00', 'documentary', 'feature', true, ['documentary']],
    ['long', 'Themed Long Form', '21:00', 'documentary', 'feature', false, ['documentary']],
    ['late', 'Late Archive', '23:00', 'documentary', 'feature', false, ['documentary']],
    ['overnight', 'Overnight Archive', '01:00', 'documentary', 'feature', false, ['documentary']],
  ])
}

function historyPolicy(channelNumber: number): ProgrammingPolicy {
  const weekday = factualBlocks('Morning Documentary')
  const sunday = factualBlocks('Sunday Archive')
  return {
    channelNumber,
    scheduleStyle: 'history',
    archetype: 'documentary',
    eligibility: {
      includeTopics: ['history', 'ancient', 'medieval', 'modern', 'military', 'geography'],
      includeTypes: ['documentary', 'short', 'interview'],
      excludeTypes: ['sport', 'music-video', 'film', 'classic-match'],
      excludeSubjects: ['wrestling', 'football', 'basketball'],
    },
    topics: ['history', 'ancient', 'medieval', 'modern', 'military'],
    dayTemplates: allDays(weekday, sunday),
    dayparts: [
      { id: 'morning', start: '06:00', end: '12:00', weights: { short: 8, documentary: 10 } },
      { id: 'afternoon', start: '12:00', end: '18:00', weights: { documentary: 10 } },
      { id: 'prime', start: '20:00', end: '23:00', weights: { documentary: 16 } },
      { id: 'overnight', start: '23:00', end: '06:00', weights: { documentary: 4 } },
    ],
    repetition: REPEAT_RULES.documentary,
    junctionRules: ['20:00'],
    specialEventRules: [],
    fallbackPolicy: 'generated',
    broadcastDayStart: BROADCAST_DAY_START,
    diversityScale: 0.35,
  }
}

function generalBlocks(morningTitle: string): TemplateBlock[] {
  return rows([
    ['breakfast', 'Breakfast', '06:00', 'news', 'feature', false, ['news', 'short']],
    ['morning', morningTitle, '09:00', 'episode', 'feature', false, ['episode', 'short']],
    ['lifestyle', 'Lifestyle', '11:00', 'episode', 'feature', false, ['episode', 'documentary']],
    ['midday', 'Documentary', '12:00', 'documentary', 'feature', false, ['documentary']],
    ['drama', 'Drama', '13:00', 'episode', 'feature', false, ['episode', 'film']],
    ['afternoon', 'Afternoon Programme', '15:00', 'episode', 'feature', false, ['episode']],
    ['entertainment', 'Entertainment', '17:00', 'episode', 'feature', false, ['episode']],
    ['news', 'News', '18:00', 'news', 'feature', true, ['news']],
    ['factual', 'Documentary', '19:00', 'documentary', 'feature', false, ['documentary']],
    ['prime', 'Prime Time', '20:00', 'episode', 'feature', true, ['episode', 'film']],
    ['feature', 'Feature', '21:00', 'film', 'feature', false, ['film', 'episode']],
    ['late', 'LATE FILM', '23:00', 'film', 'feature', false, ['film']],
    ['overnight', 'Overnight', '02:00', 'closedown', 'feature', true, ['closedown']],
  ])
}

function generalPolicy(channelNumber: number): ProgrammingPolicy {
  return {
    channelNumber,
    scheduleStyle: 'general',
    archetype: 'general',
    eligibility: {
      includeTypes: ['film', 'episode', 'documentary', 'news', 'short'],
      excludeTypes: ['classic-match', 'webcam'],
    },
    dayTemplates: allDays(generalBlocks('Morning Programme'), generalBlocks('Morning Programme'), generalBlocks('SATURDAY MORNING CARTOONS')),
    dayparts: [
      { id: 'breakfast', start: '06:00', end: '09:00', weights: { news: 8, short: 4 } },
      { id: 'morning', start: '09:00', end: '12:00', weights: { episode: 8, short: 6 } },
      { id: 'afternoon', start: '12:00', end: '18:00', weights: { documentary: 6, episode: 8, film: 4 } },
      { id: 'prime', start: '19:00', end: '23:00', weights: { film: 10, episode: 10, documentary: 6 } },
      { id: 'overnight', start: '23:00', end: '06:00', weights: { film: 8 } },
    ],
    repetition: REPEAT_RULES.episode,
    junctionRules: ['18:00', '20:00'],
    specialEventRules: [],
    fallbackPolicy: 'generated',
    broadcastDayStart: BROADCAST_DAY_START,
    diversityScale: 1,
  }
}

export const LIVE_WORLD_BLOCKS = rows([
  ['sunrise', 'SUNRISE', '06:00', 'webcam', 'hold', true, ['webcam', 'live'], 'live-source'],
  ['europe', 'EUROPE WAKES UP', '08:00', 'webcam', 'hold', false, ['webcam', 'live'], 'live-source'],
  ['around', 'AROUND THE WORLD', '11:00', 'webcam', 'hold', false, ['webcam', 'live'], 'live-source'],
  ['city', 'CITY CAMS', '13:00', 'webcam', 'hold', false, ['webcam', 'live'], 'live-source'],
  ['america', 'AMERICA LIVE', '16:00', 'webcam', 'hold', false, ['webcam', 'live'], 'live-source'],
  ['cities', 'WORLD CITIES', '19:00', 'webcam', 'hold', false, ['webcam', 'live'], 'live-source'],
  ['night', 'NIGHT CAMS', '22:00', 'webcam', 'hold', false, ['webcam', 'live'], 'live-source'],
  ['dark', 'EARTH AFTER DARK', '01:00', 'webcam', 'hold', false, ['webcam', 'live'], 'live-source'],
])

export const RAILCAM_BLOCKS = rows([
  ['morning', 'MORNING RAILCAMS', '06:00', 'webcam', 'hold', true, ['webcam'], 'live-source'],
  ['britain', 'BRITAIN BY RAIL', '09:00', 'webcam', 'hold', false, ['webcam'], 'live-source'],
  ['europe', 'EUROPEAN RAILCAMS', '12:00', 'webcam', 'hold', false, ['webcam'], 'live-source'],
  ['stations', 'STATIONS LIVE', '15:00', 'webcam', 'hold', false, ['webcam'], 'live-source'],
  ['rush', 'EVENING RUSH', '18:00', 'webcam', 'hold', false, ['webcam'], 'live-source'],
  ['night', 'RAILCAMS AT NIGHT', '21:00', 'webcam', 'hold', false, ['webcam'], 'live-source'],
  ['trains', 'NIGHT TRAINS', '00:00', 'webcam', 'hold', false, ['webcam'], 'live-source'],
])

function webcamPolicy(channelNumber: number, blocks: TemplateBlock[]): ProgrammingPolicy {
  return {
    channelNumber,
    scheduleStyle: 'webcam',
    archetype: 'webcam',
    eligibility: { includeTypes: ['webcam', 'live'], excludeTypes: ['film', 'music-video', 'classic-match'] },
    dayTemplates: allDays(blocks),
    dayparts: [{ id: 'day', start: '06:00', end: '06:00', weights: { webcam: 8, live: 8 } }],
    repetition: REPEAT_RULES.webcam,
    junctionRules: ['06:00'],
    specialEventRules: [],
    fallbackPolicy: 'generated',
    broadcastDayStart: BROADCAST_DAY_START,
    diversityScale: 0.2,
  }
}

const RADIO_BLOCKS = rows([
  ['breakfast', 'Breakfast', '06:00', 'radio', 'hold', true, ['radio']],
  ['morning', 'Morning Music', '09:00', 'radio', 'hold', false, ['radio']],
  ['afternoon', 'Afternoon', '12:00', 'radio', 'hold', false, ['radio']],
  ['drive', 'Drive', '16:00', 'radio', 'hold', false, ['radio']],
  ['evening', 'Evening Concert', '19:00', 'radio', 'hold', false, ['radio', 'concert']],
  ['late', 'Late Night', '22:00', 'radio', 'hold', false, ['radio']],
  ['overnight', 'Overnight', '01:00', 'radio', 'hold', false, ['radio']],
])

function radioPolicy(channelNumber: number): ProgrammingPolicy {
  return {
    channelNumber,
    scheduleStyle: 'radio',
    archetype: 'radio',
    eligibility: { includeTypes: ['radio', 'concert', 'music-block'] },
    dayTemplates: allDays(RADIO_BLOCKS),
    dayparts: [
      { id: 'breakfast', start: '06:00', end: '09:00', weights: { radio: 6 } },
      { id: 'day', start: '09:00', end: '19:00', weights: { radio: 6 } },
      { id: 'evening', start: '19:00', end: '06:00', weights: { radio: 4, concert: 8 } },
    ],
    repetition: REPEAT_RULES.radio,
    junctionRules: ['06:00'],
    specialEventRules: [],
    fallbackPolicy: 'generated',
    broadcastDayStart: BROADCAST_DAY_START,
    diversityScale: 0.3,
  }
}

export function newsPolicy(channelNumber: number): ProgrammingPolicy {
  const service = rows([['service', 'LIVE SERVICE', '06:00', 'live', 'hold', true, ['live', 'news'], 'live-service']])
  return {
    channelNumber,
    scheduleStyle: 'news',
    archetype: 'news',
    eligibility: { includeTypes: ['news', 'live'] },
    dayTemplates: allDays(service),
    dayparts: [{ id: 'continuous', start: '06:00', end: '06:00', weights: { live: 10, news: 6 } }],
    repetition: REPEAT_RULES.news,
    junctionRules: ['06:00'],
    specialEventRules: [],
    fallbackPolicy: 'generated',
    broadcastDayStart: BROADCAST_DAY_START,
    diversityScale: 0.2,
  }
}

function openStrand(kind: ProgrammeType): TemplateBlock[] {
  return rows([
    ['morning', 'Morning', '06:00', kind, 'feature', false, [kind]],
    ['mid', 'Midday', '09:00', kind, 'feature', false, [kind]],
    ['afternoon', 'Afternoon', '12:00', kind, 'feature', false, [kind]],
    ['early', 'Early Evening', '15:00', kind, 'feature', false, [kind]],
    ['prime', 'Prime', '18:00', kind, 'feature', false, [kind]],
    ['late', 'Late', '21:00', kind, 'feature', false, [kind]],
    ['overnight', 'Overnight', '00:00', kind, 'feature', false, [kind]],
  ])
}

/** A declarative strand. Subjects and topics use the same names so older topic-only items still match. */
export function strandPolicy(
  channelNumber: number,
  style: ScheduleStyle,
  types: ProgrammeType[],
  subjects?: string[],
  excludeSubjects?: string[],
): ProgrammingPolicy {
  return {
    channelNumber,
    scheduleStyle: style,
    archetype: style,
    eligibility: {
      includeTypes: types,
      includeTopics: subjects,
      includeSubjects: subjects,
      excludeSubjects,
      excludeTypes: style === 'sport' ? ['gameplay', 'music-video', 'film'] : undefined,
    },
    topics: subjects,
    dayTemplates: allDays(openStrand(types[0] ?? 'documentary')),
    dayparts: [
      { id: 'day', start: '06:00', end: '00:00', weights: { [types[0] ?? 'documentary']: 8 } },
      { id: 'overnight', start: '00:00', end: '06:00', weights: { [types[0] ?? 'documentary']: 4 } },
    ],
    repetition: REPEAT_RULES[types[0] ?? 'default'] ?? REPEAT_RULES.default,
    junctionRules: ['18:00'],
    specialEventRules: [],
    fallbackPolicy: 'generated',
    broadcastDayStart: BROADCAST_DAY_START,
    diversityScale: 0.85,
  }
}

/** 001–060 take their identity and routing from the manifest, so no strand is kept there. */
const NETWORK_STRANDS: Array<[number, ScheduleStyle, ProgrammeType[], string[]?]> = [
  [75, 'documentary', ['interview', 'analysis'], ['interview']],
  [76, 'documentary', ['analysis', 'interview', 'episode'], ['talk']],
  [121, 'movies', ['trailer'], ['trailer']],
  [300, 'sport', ['analysis', 'interview', 'sport', 'highlights'], ['sport']],
  [328, 'sport', ['sport', 'analysis', 'documentary', 'interview', 'highlights'], ['wrestling']],
  [331, 'sport', ['sport', 'highlights', 'analysis', 'documentary'], ['mma']],
  [317, 'sport', ['sport', 'classic-match', 'highlights', 'documentary', 'analysis', 'interview'], ['basketball']],
  [318, 'sport', ['sport', 'classic-match', 'highlights', 'documentary', 'analysis', 'interview'], ['american-football']],
  [322, 'sport', ['sport', 'classic-match', 'highlights', 'documentary', 'analysis', 'interview'], ['wnba']],
]

const POLICIES = new Map<number, ProgrammingPolicy>([
  [61, generalPolicy(61)],
  [103, classicFilmPolicy(103)],
  [140, horrorPolicy(140)],
  [301, footballPolicy(301)],
  [400, historyPolicy(400)],
  [544, ninetiesPolicy(544)],
  [850, webcamPolicy(850, LIVE_WORLD_BLOCKS)],
  [960, radioPolicy(960)],
  ...NETWORK_STRANDS.map(([number, style, types, subjects]) => [number, strandPolicy(number, style, types, subjects)] as const),
])

const ROUTED_STRATEGIES: ReadonlySet<string> = new Set([
  'SOURCE_ROUTED',
  'CURATED_AGGREGATE',
  'RETROTV_ORIGINAL_GENERATED',
])

/**
 * A manifest channel without a bespoke policy airs only programmes explicitly routed to it,
 * or, for an aggregate, programmes routed to its sibling channels.
 */
export function routedPolicy(channelNumber: number, siblings?: number[]): ProgrammingPolicy {
  const audio = canonicalByNumber(channelNumber)?.mediaKind === 'audio'
  const base = audio
    ? strandPolicy(channelNumber, 'radio', ['music'])
    : strandPolicy(channelNumber, 'general', ['documentary'])
  const eligibility = siblings?.length ? { routedOnly: true, routedFrom: siblings } : { routedOnly: true }
  return { ...base, eligibility, topics: undefined }
}

const routedByGroup = new Map<string, number[]>()
for (const route of CHANNEL_ROUTES) {
  if (route.strategy !== 'SOURCE_ROUTED' || route.number < 1 || route.number > 999) continue
  const group = canonicalByNumber(route.number)?.group ?? ''
  routedByGroup.set(group, [...(routedByGroup.get(group) ?? []), route.number])
}

for (const route of CHANNEL_ROUTES) {
  if (route.number < 1 || route.number > 999 || POLICIES.has(route.number)) continue
  if (!ROUTED_STRATEGIES.has(route.strategy) || !channelMayAir(route.number)) continue
  const siblings =
    route.strategy === 'CURATED_AGGREGATE'
      ? routedByGroup.get(canonicalByNumber(route.number)?.group ?? '')
      : undefined
  POLICIES.set(route.number, routedPolicy(route.number, siblings))
}

export const DIRECTOR_CHANNELS = [...POLICIES.keys()].sort((a, b) => a - b)

export function policyFor(channelNumber: number): ProgrammingPolicy | undefined {
  return POLICIES.get(channelNumber)
}

export function railcamPolicy(channelNumber: number): ProgrammingPolicy {
  return webcamPolicy(channelNumber, RAILCAM_BLOCKS)
}

export function templateFor(policy: ProgrammingPolicy, kind: DayKind): DayTemplate {
  return policy.dayTemplates[kind] ?? policy.dayTemplates.weekday ?? { id: kind, blocks: [] }
}

export function channelEligibility(channelNumber: number): Eligibility | undefined {
  return policyFor(channelNumber)?.eligibility
}
