import { gameplayOf } from './classify.ts'
import type { LibraryMedia } from './types.ts'
import type { ProgrammeType } from '../types/programme.ts'

export type EditorialConfidence = 'high' | 'medium' | 'low'

export interface SourceEditorial {
  /** What kind of television this collection is. */
  domain: string
  /** Scheduling topics. High-confidence sources may enter the matching channel. */
  subjects: readonly string[]
  programmeType: ProgrammeType
  confidence: EditorialConfidence
  /** Specialist channels this source must not fill. */
  denyChannels?: readonly number[]
}

/**
 * One inspectable map from built-in collection name to RetroTV editorial.
 * User channel schedules do not read this. The Programme Director does.
 */
export const SOURCE_EDITORIAL: Readonly<Record<string, SourceEditorial>> = {
  'Argyle Life | Green': { domain: 'sport', subjects: ['football'], programmeType: 'documentary', confidence: 'high' },
  'The Totally Football Show': { domain: 'sport', subjects: ['football'], programmeType: 'analysis', confidence: 'high' },
  'NBA on ESPN': { domain: 'sport', subjects: ['basketball'], programmeType: 'analysis', confidence: 'high' },
  "Gil's Arena": { domain: 'sport', subjects: ['basketball'], programmeType: 'analysis', confidence: 'high' },
  'Dom Two': { domain: 'sport', subjects: ['basketball'], programmeType: 'analysis', confidence: 'high' },
  Dom2k: { domain: 'sport', subjects: ['basketball'], programmeType: 'analysis', confidence: 'high' },
  'Sporting Logically': { domain: 'sport', subjects: ['basketball'], programmeType: 'analysis', confidence: 'high' },
  "Road Trippin' Show": { domain: 'sport', subjects: ['basketball'], programmeType: 'analysis', confidence: 'high' },
  'Jonny Arnett': { domain: 'sport', subjects: ['basketball'], programmeType: 'analysis', confidence: 'high' },
  'Heat Check': { domain: 'sport', subjects: ['basketball'], programmeType: 'analysis', confidence: 'high' },
  'Andy Hoops': { domain: 'sport', subjects: ['basketball'], programmeType: 'analysis', confidence: 'high' },
  'Mike Korzemba': { domain: 'sport', subjects: ['basketball'], programmeType: 'analysis', confidence: 'high' },
  BBALLBREAKDOWN: { domain: 'sport', subjects: ['basketball'], programmeType: 'analysis', confidence: 'high' },
  'Ringer NBA': { domain: 'sport', subjects: ['basketball'], programmeType: 'analysis', confidence: 'high' },
  AFunkyDiabetic: { domain: 'sport', subjects: ['basketball'], programmeType: 'analysis', confidence: 'high' },
  MJ2KALLDAY: { domain: 'sport', subjects: ['basketball'], programmeType: 'analysis', confidence: 'high' },
  Balludicrous: { domain: 'sport', subjects: ['basketball'], programmeType: 'analysis', confidence: 'high' },
  Oldskoolbball: { domain: 'sport', subjects: ['basketball'], programmeType: 'analysis', confidence: 'high' },
  DflowHoops: { domain: 'sport', subjects: ['basketball'], programmeType: 'analysis', confidence: 'high' },
  'LegendZ Productions': { domain: 'sport', subjects: ['basketball'], programmeType: 'analysis', confidence: 'high' },
  SWISHOUT: { domain: 'sport', subjects: ['basketball'], programmeType: 'analysis', confidence: 'high' },
  'House of Highlights': { domain: 'sport', subjects: ['basketball'], programmeType: 'highlights', confidence: 'high' },
  'The Characters of Sports': { domain: 'sport', subjects: ['basketball'], programmeType: 'analysis', confidence: 'high' },
  'Forgotten Player Profiles': { domain: 'sport', subjects: ['basketball'], programmeType: 'documentary', confidence: 'high' },
  'Solomonster Sounds Off': { domain: 'sport', subjects: ['wrestling'], programmeType: 'analysis', confidence: 'high' },
  F4WOnline: { domain: 'sport', subjects: ['wrestling'], programmeType: 'analysis', confidence: 'high' },
  'Title Match Wrestling': { domain: 'sport', subjects: ['wrestling'], programmeType: 'interview', confidence: 'high' },
  'OSW Review HD': { domain: 'sport', subjects: ['wrestling'], programmeType: 'analysis', confidence: 'high' },
  'BEST OF the KC VAULT': { domain: 'sport', subjects: ['wrestling'], programmeType: 'documentary', confidence: 'high' },
  'WRESTLING SOUP': { domain: 'sport', subjects: ['wrestling'], programmeType: 'analysis', confidence: 'high' },
  'RF Video': { domain: 'sport', subjects: ['wrestling'], programmeType: 'documentary', confidence: 'high' },
  'MMA in SHORT': { domain: 'sport', subjects: ['mma'], programmeType: 'highlights', confidence: 'high' },
  'NFL on ESPN': { domain: 'sport', subjects: ['american-football'], programmeType: 'interview', confidence: 'high' },
  'ESPN College Football': { domain: 'sport', subjects: ['american-football'], programmeType: 'highlights', confidence: 'high' },
  'SportsCenter NEXT': { domain: 'sport', subjects: ['american-football'], programmeType: 'highlights', confidence: 'high' },
  'Boiler Room': { domain: 'music', subjects: ['live-music'], programmeType: 'concert', confidence: 'high' },
  'CC Karaoke': { domain: 'music', subjects: ['karaoke'], programmeType: 'music', confidence: 'high' },
  PlayStation: { domain: 'gaming', subjects: ['gaming'], programmeType: 'trailer', confidence: 'high', denyChannels: [317, 318, 322, 47, 301] },
  'Chris Smoove': { domain: 'gaming', subjects: ['gaming'], programmeType: 'gameplay', confidence: 'high', denyChannels: [317, 318, 322, 47, 301] },
  COLETHEMAN: { domain: 'gaming', subjects: ['gaming'], programmeType: 'gameplay', confidence: 'high', denyChannels: [317, 318, 322, 47, 301] },
  CinemaSins: { domain: 'film', subjects: ['cinema'], programmeType: 'analysis', confidence: 'high', denyChannels: [21, 22] },
  'Screen Junkies': { domain: 'film', subjects: ['cinema'], programmeType: 'analysis', confidence: 'high', denyChannels: [21, 22] },
  RedLetterMedia: { domain: 'film', subjects: ['cinema'], programmeType: 'analysis', confidence: 'high', denyChannels: [21, 22] },
  ScreenRant: { domain: 'film', subjects: ['cinema'], programmeType: 'analysis', confidence: 'high', denyChannels: [21, 22] },
  VintageVerse: { domain: 'film', subjects: ['cinema'], programmeType: 'analysis', confidence: 'high', denyChannels: [21, 22] },
  'This Guy Edits': { domain: 'film', subjects: ['cinema'], programmeType: 'analysis', confidence: 'high', denyChannels: [21, 22] },
  'Isenhart Productions': { domain: 'film', subjects: ['cinema'], programmeType: 'analysis', confidence: 'high', denyChannels: [21, 22] },
  Filmento: { domain: 'film', subjects: ['cinema'], programmeType: 'analysis', confidence: 'high', denyChannels: [21, 22] },
  captainmidnight: { domain: 'film', subjects: ['cinema'], programmeType: 'analysis', confidence: 'high', denyChannels: [21, 22] },
  'Empire Wreckers': { domain: 'film', subjects: ['cinema'], programmeType: 'analysis', confidence: 'high', denyChannels: [21, 22] },
  'Soder Cinema': { domain: 'film', subjects: ['cinema'], programmeType: 'analysis', confidence: 'high', denyChannels: [21, 22] },
  CinemaCopa: { domain: 'film', subjects: ['cinema'], programmeType: 'analysis', confidence: 'high', denyChannels: [21, 22] },
  Fandango: { domain: 'film', subjects: ['cinema'], programmeType: 'interview', confidence: 'high', denyChannels: [21, 22] },
  'Friendly Space Ninja': { domain: 'film', subjects: ['cinema'], programmeType: 'analysis', confidence: 'high', denyChannels: [21, 22] },
  Reaper: { domain: 'film', subjects: ['cinema'], programmeType: 'analysis', confidence: 'high', denyChannels: [21, 22] },
  'Alien Theory': { domain: 'film', subjects: ['cinema'], programmeType: 'analysis', confidence: 'high', denyChannels: [21, 22] },
  'Major Grin': { domain: 'film', subjects: ['cinema'], programmeType: 'analysis', confidence: 'high', denyChannels: [21, 22] },
  "Quinn's Ideas": { domain: 'film', subjects: ['cinema'], programmeType: 'analysis', confidence: 'high', denyChannels: [21, 22] },
  'Reservoir Reels': { domain: 'film', subjects: ['cinema'], programmeType: 'analysis', confidence: 'high', denyChannels: [21, 22] },
  'Rotten Tomatoes Trailers': { domain: 'film', subjects: ['trailer'], programmeType: 'trailer', confidence: 'high', denyChannels: [21, 23] },
  'VintageVerse Vault': { domain: 'film', subjects: ['classic'], programmeType: 'film', confidence: 'high' },
  'Danny Jones': { domain: 'talk', subjects: ['interview'], programmeType: 'interview', confidence: 'high', denyChannels: [3] },
  'Sobering Stories': { domain: 'culture', subjects: ['reported'], programmeType: 'documentary', confidence: 'high', denyChannels: [3] },
  'Who Killed Kurt OFFICIAL': { domain: 'culture', subjects: ['reported'], programmeType: 'documentary', confidence: 'high', denyChannels: [3] },
  'World Wanderings: 4K Walking Tours': { domain: 'travel', subjects: ['travel'], programmeType: 'documentary', confidence: 'high' },
  'Matt Wolfe': { domain: 'technology', subjects: ['technology'], programmeType: 'analysis', confidence: 'high', denyChannels: [3] },
  Chillbooks: { domain: 'culture', subjects: ['literature'], programmeType: 'documentary', confidence: 'high' },
  ReligionForBreakfast: { domain: 'culture', subjects: ['culture'], programmeType: 'analysis', confidence: 'high' },
  'Academy of Ideas': { domain: 'culture', subjects: ['culture'], programmeType: 'analysis', confidence: 'high' },
  'Fiction Beast': { domain: 'culture', subjects: ['culture'], programmeType: 'analysis', confidence: 'high' },
  'Gerald Celente': { domain: 'talk', subjects: ['talk'], programmeType: 'analysis', confidence: 'high', denyChannels: [3] },
  ESPN: { domain: 'sport', subjects: ['sport'], programmeType: 'analysis', confidence: 'medium' },
  Speakeasy: { domain: 'sport', subjects: ['sport'], programmeType: 'analysis', confidence: 'medium' },
  'TYT Sports': { domain: 'sport', subjects: ['sport'], programmeType: 'analysis', confidence: 'medium' },
  'Secret Base': { domain: 'sport', subjects: ['sport'], programmeType: 'analysis', confidence: 'medium' },
  PlayersTV: { domain: 'sport', subjects: ['sport'], programmeType: 'interview', confidence: 'medium' },
  'Bleacher Report': { domain: 'sport', subjects: ['sport'], programmeType: 'highlights', confidence: 'medium' },
  'TNT Sports US': { domain: 'sport', subjects: ['sport'], programmeType: 'analysis', confidence: 'medium' },
  'Matthew McConaughey': { domain: 'talk', subjects: [], programmeType: 'unclassified', confidence: 'low' },
  'Joe Fier': { domain: 'talk', subjects: [], programmeType: 'unclassified', confidence: 'low' },
  'Control Alt History': { domain: 'culture', subjects: [], programmeType: 'unclassified', confidence: 'low' },
}

export function sourceNamesInMap(): string[] {
  return Object.keys(SOURCE_EDITORIAL)
}

function collectionNames(item: Pick<LibraryMedia, 'sourceCollection' | 'memberships'>): string[] {
  const named = (item.memberships ?? []).filter((membership) => membership.present).map((membership) => membership.sourceName)
  if (named.length > 0) return named
  return item.sourceCollection ? [item.sourceCollection] : []
}

function rank(confidence: EditorialConfidence): number {
  if (confidence === 'high') return 3
  if (confidence === 'medium') return 2
  return 1
}

export function editorialForItem(item: Pick<LibraryMedia, 'sourceCollection' | 'memberships'>): SourceEditorial | undefined {
  let best: SourceEditorial | undefined
  for (const name of collectionNames(item)) {
    const mapping = SOURCE_EDITORIAL[name]
    if (!mapping) continue
    if (!best || rank(mapping.confidence) > rank(best.confidence)) best = mapping
  }
  return best
}

function sportFromTitle(title: string): { topic: string; programmeType: ProgrammeType; sport: string } | null {
  if (/\bwnba\b/i.test(title)) return { topic: 'wnba', programmeType: 'analysis', sport: 'wnba' }
  if (/\b(nba|lakers|celtics|lebron|warriors|knicks|nuggets|mavericks|caitlin clark)\b/i.test(title)) {
    return { topic: 'basketball', programmeType: 'analysis', sport: 'basketball' }
  }
  if (/\b(nfl|super bowl|raiders|texans|packers|mahomes|college football|quarterback|cowboys|nfc)\b/i.test(title)) {
    return { topic: 'american-football', programmeType: 'analysis', sport: 'american-football' }
  }
  if (/\b(premier league|argyle|tottenham|arsenal|liverpool|chelsea|manchester|la liga|bundesliga)\b/i.test(title)) {
    return { topic: 'football', programmeType: 'analysis', sport: 'football' }
  }
  if (/\b(wwe|aew|wcw|wrestling|wrestlemania)\b/i.test(title)) {
    return { topic: 'wrestling', programmeType: 'analysis', sport: 'wrestling' }
  }
  if (/\b(ufc|mma|bellator)\b/i.test(title)) return { topic: 'mma', programmeType: 'highlights', sport: 'mma' }
  return null
}

function stamp(
  item: LibraryMedia,
  topic: string,
  programmeType: ProgrammeType,
  sport: string | undefined,
  denyChannels: readonly number[] | undefined,
): LibraryMedia {
  const topics = [topic]
  const excludes = [...(item.explicitChannelExcludes ?? [])]
  for (const number of denyChannels ?? []) {
    if (!excludes.includes(number)) excludes.push(number)
  }
  return {
    ...item,
    programmeType,
    topics,
    subjects: topics,
    sport,
    explicitChannelExcludes: excludes.length > 0 ? excludes : item.explicitChannelExcludes,
    metadataConfidence: 'high',
  }
}

/**
 * Director copy of a library item.
 * A stored user correction wins. A sports game stays in gaming.
 * The stored record itself is not rewritten, so user channels keep their schedules.
 */
export function programmeForDirector(item: LibraryMedia): LibraryMedia {
  const edited = new Set(item.userEditedMetadata ?? [])
  if (edited.has('programmeType') || edited.has('topics') || edited.has('subjects')) return item
  const game = gameplayOf(item.title)
  if (game || item.programmeType === 'gameplay') {
    const subject = game?.subject ?? 'gaming'
    const stamped = stamp(item, 'gaming', 'gameplay', undefined, [317, 318, 322, 47, 301, 328, 331])
    return { ...stamped, topics: ['gaming', subject], subjects: ['gaming', subject] }
  }
  const mapping = editorialForItem(item)
  if (mapping?.confidence === 'low') {
    return { ...item, topics: [], subjects: [], sport: undefined, programmeType: 'unclassified' }
  }
  if (!mapping || mapping.subjects.length === 0) return item
  if (mapping.confidence === 'medium' && mapping.domain === 'sport') {
    const specific = sportFromTitle(item.title)
    if (specific) return stamp(item, specific.topic, specific.programmeType, specific.sport, mapping.denyChannels)
    return stamp(item, 'sport', mapping.programmeType, 'sport', mapping.denyChannels)
  }
  if (mapping.subjects.includes('basketball') && /\bwnba\b/i.test(item.title)) {
    return stamp(item, 'wnba', 'analysis', 'wnba', mapping.denyChannels)
  }
  if (mapping.confidence === 'high' && mapping.subjects.includes('basketball')) {
    const specific = sportFromTitle(item.title)
    if (specific?.topic === 'american-football') {
      return stamp(item, specific.topic, specific.programmeType, specific.sport, mapping.denyChannels)
    }
  }
  const topic = mapping.subjects[0] ?? 'sport'
  const sport = mapping.domain === 'sport' ? topic : undefined
  return stamp(item, topic, mapping.programmeType, sport, mapping.denyChannels)
}
