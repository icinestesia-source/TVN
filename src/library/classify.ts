import type { ProgrammeType } from '../types/programme.ts'
import type { ClassificationNote, Confidence, FieldOrigin } from './types.ts'

export interface ClassifiedMetadata {
  programmeType: ProgrammeType
  topics: string[]
  subjects: string[]
  sport?: string
  teams?: string[]
  genres: string[]
  era?: string
  year?: number
  moods: string[]
  confidence: Confidence
  origins: Record<string, FieldOrigin>
  notes: ClassificationNote[]
  candidateTopics: string[]
  candidateSubjects: string[]
}

interface RuleHit {
  field: 'programmeType' | 'topics' | 'genres' | 'year' | 'era'
  value: string
  reason: string
  confidence: Confidence
  rule: string
}

const TYPE_RULES: Array<{
  phrase: string
  value: ProgrammeType
  confidence: Confidence
  rule: string
}> = [
  { phrase: 'official music video', value: 'music-video', confidence: 'medium', rule: 'title-official-music-video' },
  { phrase: 'music video', value: 'music-video', confidence: 'medium', rule: 'title-music-video' },
  { phrase: 'full match', value: 'classic-match', confidence: 'medium', rule: 'title-full-match' },
  { phrase: 'highlights', value: 'highlights', confidence: 'medium', rule: 'title-highlights' },
  { phrase: 'documentary', value: 'documentary', confidence: 'medium', rule: 'title-documentary' },
  { phrase: 'interview', value: 'interview', confidence: 'medium', rule: 'title-interview' },
  { phrase: 'trailer', value: 'trailer', confidence: 'medium', rule: 'title-trailer' },
  { phrase: 'concert', value: 'concert', confidence: 'medium', rule: 'title-concert' },
]

const TOPIC_RULES: Array<{ phrase: string; topic: string; rule: string }> = [
  { phrase: 'premier league', topic: 'football', rule: 'keyword-premier-league' },
  { phrase: 'football', topic: 'football', rule: 'keyword-football' },
  { phrase: 'soccer', topic: 'football', rule: 'keyword-soccer' },
  { phrase: 'historical', topic: 'history', rule: 'keyword-historical' },
  { phrase: 'history', topic: 'history', rule: 'keyword-history' },
  { phrase: 'wrestlemania', topic: 'wrestling', rule: 'keyword-wrestlemania' },
  { phrase: 'wrestling', topic: 'wrestling', rule: 'keyword-wrestling' },
  { phrase: 'cooking', topic: 'cooking', rule: 'keyword-cooking' },
  { phrase: 'recipe', topic: 'cooking', rule: 'keyword-recipe' },
  { phrase: 'horror', topic: 'horror', rule: 'keyword-horror' },
]

const CLUBS = ['manchester united', 'arsenal', 'liverpool', 'chelsea', 'tottenham', 'barcelona', 'real madrid', 'bayern']

let classifyMs = 0

/** Milliseconds spent inside classifyMedia since the last read. */
export function takeClassifyMs(): number {
  const spent = classifyMs
  classifyMs = 0
  return spent
}

export function gameplayOf(title: string): { subject: string; rule: string } | null {
  if (/\bnba\s*2k\b/i.test(title) || /\b2k\d{2}\b/i.test(title)) return { subject: 'basketball', rule: 'title-nba-2k' }
  if (/\bmadden\b/i.test(title)) return { subject: 'american-football', rule: 'title-madden' }
  if (/\bfifa\s*(?:1\d|2\d)\b/i.test(title)) return { subject: 'football', rule: 'title-fifa-game' }
  return null
}

interface CollectionSignal {
  test: (name: string) => boolean
  topic: string
  sport?: string
  programmeType?: ProgrammeType
  rule: string
}

const COLLECTION_SIGNALS: readonly CollectionSignal[] = [
  { test: (name) => /argyle/i.test(name), topic: 'football', sport: 'football', programmeType: 'sport', rule: 'collection-argyle' },
  { test: (name) => /totally football/i.test(name), topic: 'football', sport: 'football', programmeType: 'sport', rule: 'collection-totally-football' },
  { test: (name) => /boiler room/i.test(name), topic: 'music', programmeType: 'concert', rule: 'collection-boiler-room' },
  {
    test: (name) => /cinemasins|screen junkies|red\s*letter\s*media/i.test(name),
    topic: 'cinema',
    programmeType: 'analysis',
    rule: 'collection-cinema',
  },
  {
    test: (name) => /nba on espn|bballbreakdown|andy hoops|oldskoolbball|ringer nba/i.test(name),
    topic: 'basketball',
    sport: 'basketball',
    programmeType: 'sport',
    rule: 'collection-basketball',
  },
  {
    test: (name) => /title match wrestling|wrestling soup|osw review/i.test(name),
    topic: 'wrestling',
    sport: 'wrestling',
    programmeType: 'sport',
    rule: 'collection-wrestling',
  },
  {
    test: (name) => /playstation|chris smoove|mj2kallday/i.test(name),
    topic: 'gaming',
    programmeType: 'gameplay',
    rule: 'collection-gaming',
  },
  {
    test: (name) => /\bnfl\b|college football/i.test(name),
    topic: 'american-football',
    sport: 'american-football',
    programmeType: 'sport',
    rule: 'collection-nfl',
  },
]

function phraseIn(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i').test(text)
}

function note(hit: RuleHit): ClassificationNote {
  return { field: hit.field, value: hit.value, reason: hit.reason, confidence: hit.confidence, rule: hit.rule }
}

function inferYear(title: string): RuleHit | null {
  const current = new Date().getFullYear() + 1
  const accept = (year: number) => year >= 1888 && year <= current
  const parenthetical = title.match(/\(((?:18[8-9]\d)|(?:19\d{2})|(?:20[0-2]\d))\)/)
  if (parenthetical) {
    const year = Number(parenthetical[1])
    if (accept(year)) {
      return {
        field: 'year',
        value: String(year),
        reason: `title contains parenthetical year ${year}`,
        confidence: 'medium',
        rule: 'year-parenthetical',
      }
    }
  }
  const bare = /(?:^|[^0-9])((?:18[8-9]\d)|(?:19\d{2})|(?:20[0-2]\d))(?![0-9])/g
  let match: RegExpExecArray | null
  while ((match = bare.exec(title))) {
    const year = Number(match[1])
    const after = title[match.index + match[0].length] ?? ''
    if (/[xp]/i.test(after)) continue
    if (!accept(year)) continue
    return {
      field: 'year',
      value: String(year),
      reason: `title contains year ${year}`,
      confidence: 'low',
      rule: 'year-bare',
    }
  }
  return null
}

/**
 * Local title rules only. Duration never chooses a programme type.
 * A collection name may suggest a topic at low confidence, and that hint
 * stays off the scheduling topic list.
 */
export function classifyMedia(input: {
  title: string
  durationSeconds: number
  collectionNames?: readonly string[]
}): ClassifiedMetadata {
  const started = performance.now()
  const title = input.title.trim()
  const notes: ClassificationNote[] = []
  const origins: Record<string, FieldOrigin> = {
    title: { origin: 'source', confidence: 'high', reason: 'supplied by the import' },
    durationSeconds: { origin: 'source', confidence: 'high', reason: 'supplied by the import' },
  }
  void input.durationSeconds

  let programmeType: ProgrammeType = 'unclassified'
  let typeConfidence: Confidence = 'unknown'
  const gameplay = gameplayOf(title)
  if (gameplay) {
    programmeType = 'gameplay'
    typeConfidence = 'medium'
    const reason = `title matched a sports game (${gameplay.rule})`
    notes.push({ field: 'programmeType', value: 'gameplay', reason, confidence: 'medium', rule: gameplay.rule })
    origins.programmeType = { origin: 'inferred', rule: gameplay.rule, confidence: 'medium', reason }
  }
  for (const rule of TYPE_RULES) {
    if (gameplay) break
    if (!phraseIn(title, rule.phrase)) continue
    programmeType = rule.value
    typeConfidence = rule.confidence
    const hit: RuleHit = {
      field: 'programmeType',
      value: rule.value,
      reason: `title matched "${rule.phrase}"`,
      confidence: rule.confidence,
      rule: rule.rule,
    }
    notes.push(note(hit))
    origins.programmeType = { origin: 'inferred', rule: rule.rule, confidence: rule.confidence, reason: hit.reason }
    break
  }
  if (programmeType === 'unclassified') {
    origins.programmeType = {
      origin: 'inferred',
      rule: 'no-type-rule',
      confidence: 'unknown',
      reason: 'no reliable title rule',
    }
    notes.push({
      field: 'programmeType',
      value: 'unclassified',
      reason: 'no reliable title rule',
      confidence: 'unknown',
      rule: 'no-type-rule',
    })
  }

  const topics: string[] = []
  if (gameplay) {
    topics.push('gaming', gameplay.subject)
    origins[`subject:${gameplay.subject}`] = {
      origin: 'inferred',
      rule: gameplay.rule,
      confidence: 'medium',
      reason: `sports game subject ${gameplay.subject}`,
    }
    origins['subject:gaming'] = {
      origin: 'inferred',
      rule: gameplay.rule,
      confidence: 'medium',
      reason: 'sports game, not a live sport',
    }
  }
  for (const rule of TOPIC_RULES) {
    if (!phraseIn(title, rule.phrase) || topics.includes(rule.topic)) continue
    if (rule.topic === 'history') continue
    if (gameplay && rule.topic !== 'gaming') continue
    if (phraseIn(title, 'american football') && rule.topic === 'football') continue
    topics.push(rule.topic)
    const reason = `title matched "${rule.phrase}"`
    notes.push({ field: 'subjects', value: rule.topic, reason, confidence: 'medium', rule: rule.rule })
    origins[`subject:${rule.topic}`] = { origin: 'inferred', rule: rule.rule, confidence: 'medium', reason }
  }
  if (programmeType === 'documentary' && !topics.includes('wrestling') && phraseIn(title, 'history')) {
    topics.push('history')
    notes.push({
      field: 'subjects',
      value: 'history',
      reason: 'documentary title matched "history"',
      confidence: 'medium',
      rule: 'keyword-history-documentary',
    })
    origins['subject:history'] = {
      origin: 'inferred',
      rule: 'keyword-history-documentary',
      confidence: 'medium',
      reason: 'documentary title matched "history"',
    }
  }
  if (phraseIn(title, 'historical') && programmeType === 'documentary' && !topics.includes('history') && !topics.includes('wrestling')) {
    topics.push('history')
  }
  const clubs = CLUBS.filter((club) => phraseIn(title, club))
  let sport: string | undefined
  let teams: string[] | undefined
  if (!gameplay && (phraseIn(title, 'nfl') || phraseIn(title, 'super bowl') || phraseIn(title, 'american football'))) {
    sport = 'american-football'
    if (!topics.includes('american-football')) topics.push('american-football')
    notes.push({
      field: 'subjects',
      value: 'american-football',
      reason: 'title matched American football',
      confidence: 'medium',
      rule: 'title-american-football',
    })
  } else if (!gameplay && (phraseIn(title, 'wnba') || phraseIn(title, 'nba') || phraseIn(title, 'basketball'))) {
    sport = phraseIn(title, 'wnba') ? 'wnba' : 'basketball'
    const topic = sport === 'wnba' ? 'wnba' : 'basketball'
    if (!topics.includes(topic)) topics.push(topic)
    notes.push({
      field: 'subjects',
      value: topic,
      reason: `title matched ${topic}`,
      confidence: 'medium',
      rule: sport === 'wnba' ? 'title-wnba' : 'title-basketball',
    })
  } else if (!gameplay && (topics.includes('football') || clubs.length >= 2 || phraseIn(title, 'soccer'))) {
    sport = 'football'
    if (!topics.includes('football')) topics.push('football')
    if (clubs.length >= 2) teams = clubs.map((club) => club.replace(/\b\w/g, (letter) => letter.toUpperCase()))
  } else if (!gameplay && (topics.includes('wrestling') || phraseIn(title, 'boxing'))) {
    sport = topics.includes('wrestling') || phraseIn(title, 'wrestling') || phraseIn(title, 'wrestlemania') ? 'wrestling' : 'boxing'
    if (sport === 'boxing' && !topics.includes('boxing')) topics.push('boxing')
  }
  if (/\blive\b/i.test(title)) {
    notes.push({
      field: 'isLive',
      value: 'false',
      reason: 'LIVE in a title does not make a finished video a live source',
      confidence: 'high',
      rule: 'title-live-is-recorded',
    })
  }

  const candidateTopics: string[] = []
  const candidateSubjects: string[] = []
  for (const name of input.collectionNames ?? []) {
    for (const rule of TOPIC_RULES) {
      if (!phraseIn(name, rule.phrase) || topics.includes(rule.topic) || candidateTopics.includes(rule.topic)) continue
      candidateTopics.push(rule.topic)
      candidateSubjects.push(rule.topic)
      const reason = `collection name matched "${rule.phrase}"`
      notes.push({ field: 'candidateTopics', value: rule.topic, reason, confidence: 'low', rule: `${rule.rule}-collection` })
      origins[`candidate:${rule.topic}`] = {
        origin: 'inferred',
        rule: `${rule.rule}-collection`,
        confidence: 'low',
        reason,
      }
    }
    if (gameplay) continue
    for (const signal of COLLECTION_SIGNALS) {
      if (!signal.test(name)) continue
      if (sport && signal.sport && signal.sport !== sport) continue
      if (signal.programmeType && programmeType === 'unclassified') {
        programmeType = signal.programmeType
        typeConfidence = 'medium'
        const reason = `collection ${name} matched ${signal.rule}`
        notes.push({
          field: 'programmeType',
          value: signal.programmeType,
          reason,
          confidence: 'medium',
          rule: signal.rule,
        })
        origins.programmeType = { origin: 'inferred', rule: signal.rule, confidence: 'medium', reason }
      }
      if (!topics.includes(signal.topic)) {
        topics.push(signal.topic)
        const reason = `collection ${name} is evidence for ${signal.topic}`
        notes.push({ field: 'subjects', value: signal.topic, reason, confidence: 'medium', rule: signal.rule })
        origins[`subject:${signal.topic}`] = { origin: 'inferred', rule: signal.rule, confidence: 'medium', reason }
      }
      if (signal.sport && !sport) sport = signal.sport
      break
    }
  }

  const genres: string[] = []
  if (programmeType === 'music-video') {
    genres.push('music')
    notes.push({
      field: 'genres',
      value: 'music',
      reason: 'music-video title rule',
      confidence: typeConfidence,
      rule: 'genre-from-music-video',
    })
    origins['genre:music'] = {
      origin: 'inferred',
      rule: 'genre-from-music-video',
      confidence: typeConfidence,
      reason: 'music-video title rule',
    }
  }

  const yearHit = inferYear(title)
  let year: number | undefined
  let era: string | undefined
  if (yearHit) {
    year = Number(yearHit.value)
    notes.push(note(yearHit))
    origins.year = { origin: 'inferred', rule: yearHit.rule, confidence: yearHit.confidence, reason: yearHit.reason }
    if (year >= 1990 && year <= 1999) {
      era = '1990s'
      notes.push({
        field: 'era',
        value: '1990s',
        reason: `year ${year} falls in the 1990s`,
        confidence: yearHit.confidence,
        rule: 'era-from-year',
      })
      origins.era = {
        origin: 'inferred',
        rule: 'era-from-year',
        confidence: yearHit.confidence,
        reason: `year ${year} falls in the 1990s`,
      }
    }
  }

  classifyMs += performance.now() - started
  return {
    programmeType,
    topics,
    subjects: topics,
    sport,
    teams,
    genres,
    era,
    year,
    moods: [],
    confidence: typeConfidence,
    origins,
    notes,
    candidateTopics,
    candidateSubjects,
  }
}
