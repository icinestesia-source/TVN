/**
 * Channels whose identity is an era. A programme qualifies only through its verified original
 * year (never its upload date), the kind of date that year is, and a source the rule names.
 * Naming a dedicated publisher here is its explicit reuse policy for that era channel.
 */
export type OriginalBasis = 'film' | 'recording' | 'performance' | 'episode' | 'event' | 'trailer'
export type OriginalConfidence = 'VERIFIED' | 'HIGH'

export interface OriginalYear {
  year: number
  basis: OriginalBasis
  source: 'title' | 'description' | 'wikidata'
  confidence: OriginalConfidence
  evidence: string
}

interface EraRule {
  channel: number
  from: number
  to: number
  bases: readonly OriginalBasis[]
  sources: ReadonlySet<string>
  title?: RegExp
  minSeconds?: number
}

const GRUNGE = ['src_nirvana_vevo', 'src_stone_temple_pilots', 'src_mudhoney', 'src_screaming_trees_vevo', 'src_mad_season_vevo', 'src_melvins',
  'src_mark_lanegan', 'src_temple_of_the_dog', 'src_l7', 'src_hole_vevo', 'src_chris_cornell', 'src_sub_pop_grunge']
const ALTERNATIVE = [...GRUNGE, 'src_nirvana', 'src_pearl_jam', 'src_soundgarden', 'src_alice_in_chains', 'src_smashing_pumpkins', 'src_rem', 'src_radiohead', 'src_rhcp', 'src_foo_fighters', 'src_blur', 'src_oasis', 'src_the_cure', 'src_sub_pop', 'src_my_bloody_valentine', 'src_slowdive', 'src_nine_inch_nails']
const METAL = ['src_motley_crue', 'src_def_leppard', 'src_kiss', 'src_guns_n_roses', 'src_acdc', 'src_aerosmith', 'src_nine_inch_nails', 'src_alice_in_chains', 'src_soundgarden', 'src_nuclear_blast']
const DISCO = ['src_gloria_gaynor', 'src_bee_gees', 'src_nile_rodgers', 'src_soul_train']
const PUNK = ['src_epitaph']
const INDIE = ['src_arctic_monkeys', 'src_sub_pop', 'src_radiohead', 'src_blur', 'src_sigur_ros', 'src_jimmy_eat_world', 'src_dashboard_confessional', 'src_slowdive', 'src_my_bloody_valentine']
/** Vevo's own curated playlists count only for videos on official VEVO artist channels (checked at acquisition). */
const VEVO_PLAYLISTS = ['src_vevo_classics', 'src_vevo_80s', 'src_vevo_90s', 'src_vevo_2000s']
const VEVO_CLASSIC_ARTISTS = ['abba', 'queen', 'elton_john', 'bob_marley', 'fleetwood_mac', 'stevie_wonder', 'diana_ross', 'ewf', 'blondie', 'carpenters',
  'donna_summer', 'barry_white', 'marvin_gaye', 'temptations', 'smokey_robinson', 'dolly_parton', 'simon_garfunkel'].map((slug) => `src_vevo_${slug}`)
const VEVO_ARTISTS = ['src_vevo', 'src_eminem', 'src_kendrick_lamar', 'src_50_cent', 'src_imagine_dragons', 'src_arctic_monkeys',
  'src_the_who_vevo', 'src_tears_for_fears_vevo', 'src_siouxsie_vevo', 'src_manics_vevo', 'src_the_verve_vevo', 'src_vevo_the_killers',
  'src_vevo_kings_of_leon', 'src_hole_vevo', 'src_nirvana_vevo', 'src_mad_season_vevo', 'src_screaming_trees_vevo', 'src_she_wants_revenge_vevo']
/** VEVO-identity sources acquired for 594–597 feed only the VEVO decade channels, keeping those pools distinct from the general decades. */
const VEVO = [...VEVO_ARTISTS, ...VEVO_PLAYLISTS, ...VEVO_CLASSIC_ARTISTS]
/** Artist and festival publishers added for the genre channels; performance-led, so their verified years may reach the decades. */
const GENRE_ARTISTS = ['src_pulp', 'src_suede', 'src_supergrass', 'src_manics', 'src_duran_duran', 'src_depeche_mode', 'src_talking_heads', 'src_new_order',
  'src_human_league', 'src_bauhaus', 'src_ride', 'src_cocteau_twins', 'src_diiv', 'src_led_zeppelin', 'src_pink_floyd', 'src_the_doors', 'src_jimi_hendrix',
  'src_tom_petty', 'src_bruce_springsteen', 'src_eric_clapton', 'src_joe_bonamassa', 'src_bb_king', 'src_gary_clark_jr', 'src_vulf', 'src_lettuce',
  'src_snarky_puppy', 'src_run_the_jewels', 'src_wu_tang_clan', 'src_public_enemy', 'src_madness', 'src_the_selecter', 'src_the_beat', 'src_toots',
  'src_playing_for_change', 'src_tinariwen', 'src_lollapalooza', 'src_roskilde', 'src_keb_mo', 'src_beth_hart', 'src_the_cult', 'src_songhoy_blues',
  'src_angelique_kidjo', 'src_primavera_sound', 'src_sziget', 'src_bonnaroo']
const LEGACY = ['src_ed_sullivan', 'src_the_beatles', 'src_rolling_stones', 'src_roy_orbison', 'src_beach_boys']
/** Performance-led music publishers: artists, labels, sessions. Instruction, essay, karaoke and awards channels are not music programming. */
const MUSIC = [
  ...new Set([...ALTERNATIVE, ...METAL, ...DISCO, ...PUNK, ...INDIE, ...VEVO_ARTISTS, ...LEGACY,
    'src_afro_nation', 'src_alicia_keys', 'src_audiotree', 'src_blogotheque', 'src_boiler_room', 'src_bon_jovi', 'src_brandy', 'src_cercle',
    'src_coachella', 'src_colors', 'src_fall_out_boy', 'src_hammock', 'src_home_free', 'src_insideout', 'src_jalc', 'src_kexp', 'src_khruangbin',
    'src_kings_singers', 'src_massive_attack', 'src_my_chemical_romance', 'src_ne_yo', 'src_newport_folk', 'src_npr_music', 'src_opry',
    'src_paramore', 'src_paste', 'src_polyphia', 'src_rockpalast', 'src_sofar', 'src_the_specials', 'src_toolroom', 'src_ukf_dnb', 'src_usher',
    'src_vp_records', 'src_zero_7', 'src_animals_as_leaders', 'src_mahogany', 'src_postmodern_jukebox', ...GENRE_ARTISTS]),
]
const FILMS = ['src_popcornflix', 'src_movie_central', 'src_film_detective']
const TRAILERS = ['src_rt_classic_trailers']
const FOOTBALL_CLASSICS = ['src_fifa', 'src_uefa', 'src_premier_league', 'src_england_football']
/** Multi-artist publishers (TV archives, curated playlists): diversity counts the artist named in each title, not the publisher. */
export const MULTI_ARTIST_SOURCES: ReadonlySet<string> = new Set(['src_ed_sullivan', ...VEVO_PLAYLISTS])

const SONG: readonly OriginalBasis[] = ['recording', 'performance']
const RECORDING: readonly OriginalBasis[] = ['recording']
const set = (sources: readonly string[]) => new Set(sources)

/**
 * Earlier rules take a programme first; each programme joins at most two era channels, and
 * only one unless it is music. A dated performance stands for its decade only up to the 1980s:
 * later decades are full of legacy acts replaying older songs, so they need the recording year.
 */
export const ERA_RULES: readonly EraRule[] = [
  { channel: 581, from: 1990, to: 1999, bases: SONG, sources: set(ALTERNATIVE) },
  { channel: 583, from: 1980, to: 1989, bases: SONG, sources: set(METAL) },
  { channel: 584, from: 1990, to: 1999, bases: SONG, sources: set(METAL) },
  { channel: 586, from: 1990, to: 1999, bases: SONG, sources: set(PUNK) },
  { channel: 582, from: 2000, to: 2009, bases: SONG, sources: set(INDIE) },
  { channel: 588, from: 1979, to: 1979, bases: SONG, sources: set(DISCO) },
  { channel: 595, from: 1980, to: 1989, bases: RECORDING, sources: set(VEVO) },
  { channel: 596, from: 1990, to: 1999, bases: RECORDING, sources: set(VEVO) },
  { channel: 597, from: 2000, to: 2009, bases: RECORDING, sources: set(VEVO) },
  { channel: 594, from: 1950, to: 1979, bases: RECORDING, sources: set(VEVO) },
  { channel: 580, from: 1981, to: 1995, bases: RECORDING, sources: set(MUSIC) },
  { channel: 540, from: 1950, to: 1959, bases: SONG, sources: set(MUSIC) },
  { channel: 541, from: 1960, to: 1969, bases: SONG, sources: set(MUSIC) },
  { channel: 542, from: 1970, to: 1979, bases: SONG, sources: set(MUSIC) },
  { channel: 543, from: 1980, to: 1989, bases: SONG, sources: set(MUSIC) },
  { channel: 544, from: 1990, to: 1999, bases: RECORDING, sources: set(MUSIC) },
  { channel: 545, from: 2000, to: 2009, bases: RECORDING, sources: set(MUSIC) },
  { channel: 547, from: 2020, to: 2029, bases: RECORDING, sources: set(MUSIC) },
  { channel: 548, from: 1950, to: 1969, bases: SONG, sources: set(MUSIC) },
  { channel: 171, from: 1920, to: 1929, bases: ['film'], sources: set(FILMS), minSeconds: 3600 },
  { channel: 172, from: 1930, to: 1939, bases: ['film'], sources: set(FILMS), minSeconds: 3600 },
  { channel: 173, from: 1940, to: 1949, bases: ['film'], sources: set(FILMS), minSeconds: 3600 },
  { channel: 175, from: 1960, to: 1969, bases: ['film'], sources: set(FILMS), minSeconds: 3600 },
  { channel: 176, from: 1970, to: 1979, bases: ['film'], sources: set(FILMS), minSeconds: 3600 },
  { channel: 177, from: 1980, to: 1989, bases: ['film'], sources: set(FILMS), minSeconds: 3600 },
  { channel: 178, from: 1990, to: 1999, bases: ['film'], sources: set(FILMS), minSeconds: 3600 },
  { channel: 179, from: 2000, to: 2009, bases: ['film'], sources: set(FILMS), minSeconds: 3600 },
  { channel: 180, from: 2010, to: 2019, bases: ['film'], sources: set(FILMS), minSeconds: 3600 },
  { channel: 141, from: 1920, to: 1979, bases: ['film'], sources: set(FILMS), minSeconds: 3600, title: /\bhorror\b/i },
  { channel: 145, from: 1920, to: 1979, bases: ['film'], sources: set(FILMS), minSeconds: 3600, title: /sci-?fi|science fiction/i },
  { channel: 111, from: 1930, to: 1959, bases: ['film'], sources: set(FILMS), minSeconds: 3600 },
  { channel: 275, from: 1950, to: 1999, bases: ['episode'], sources: set(['src_buzzr']) },
  { channel: 287, from: 1950, to: 1999, bases: ['episode'], sources: set(['src_red_green']) },
  { channel: 288, from: 1950, to: 1999, bases: ['episode'], sources: set(['src_royal_institution', 'src_buzzr', 'src_red_green']) },
  { channel: 303, from: 1930, to: 2015, bases: ['event'], sources: set(FOOTBALL_CLASSICS) },
  { channel: 122, from: 1950, to: 1959, bases: ['trailer'], sources: set(TRAILERS) },
  { channel: 123, from: 1960, to: 1969, bases: ['trailer'], sources: set(TRAILERS) },
  { channel: 124, from: 1970, to: 1979, bases: ['trailer'], sources: set(TRAILERS) },
  { channel: 125, from: 1980, to: 1989, bases: ['trailer'], sources: set(TRAILERS) },
  { channel: 126, from: 1990, to: 1999, bases: ['trailer'], sources: set(TRAILERS) },
  { channel: 127, from: 2000, to: 2009, bases: ['trailer'], sources: set(TRAILERS) },
  { channel: 128, from: 2010, to: 2019, bases: ['trailer'], sources: set(TRAILERS) },
  { channel: 121, from: 1920, to: 1969, bases: ['trailer'], sources: set(TRAILERS) },
]

const ERA_CHANNELS = new Set(ERA_RULES.map((rule) => rule.channel))

export function isEraChannel(channelNumber: number): boolean {
  return ERA_CHANNELS.has(channelNumber)
}

const MIN_ERA_SECONDS = 3 * 3600
const MIN_MUSIC_SOURCES = 3
const MAX_MUSIC_SHARE = 0.6

/**
 * Era channels worth opening: at least three hours of qualifying programmes and, for music,
 * several artists with none above 60% of the hours. Below that the channel stays off air
 * rather than airing a sliver or one artist on repeat.
 */
export function viableEraChannels(programmes: readonly { sourceId?: string; title?: string; durationSeconds: number; eras: readonly number[] }[]): Set<number> {
  const bySource = new Map<number, Map<string, number>>()
  for (const programme of programmes) {
    const artist = artistOf(programme)
    for (const channel of programme.eras) {
      const sources = bySource.get(channel) ?? new Map<string, number>()
      sources.set(artist, (sources.get(artist) ?? 0) + programme.durationSeconds)
      bySource.set(channel, sources)
    }
  }
  const viable = new Set<number>()
  for (const [channel, sources] of bySource) {
    const total = [...sources.values()].reduce((sum, seconds) => sum + seconds, 0)
    if (total < MIN_ERA_SECONDS) continue
    const rule = ERA_RULES.find((candidate) => candidate.channel === channel)!
    const music = rule.bases.some((basis) => basis === 'recording' || basis === 'performance')
    if (music && (sources.size < MIN_MUSIC_SOURCES || Math.max(...sources.values()) > total * MAX_MUSIC_SHARE)) continue
    viable.add(channel)
  }
  return viable
}

/**
 * Era membership with the music share enforced on what airs. A music channel that fails only because one
 * artist holds more than 60% of its hours drops that artist's longest programmes until the artist is within
 * the share; it opens only if the remaining pool still meets every rule above. `dropped` holds, per channel,
 * the indexes of programmes that stay off it.
 */
export function eraMembership(programmes: readonly { sourceId?: string; title?: string; durationSeconds: number; eras: readonly number[] }[]): {
  viable: Set<number>
  dropped: Map<number, Set<number>>
} {
  const viable = viableEraChannels(programmes)
  const dropped = new Map<number, Set<number>>()
  const members = new Map<number, number[]>()
  programmes.forEach((programme, index) => {
    for (const channel of programme.eras) members.set(channel, [...(members.get(channel) ?? []), index])
  })
  for (const [channel, indexes] of members) {
    if (viable.has(channel)) continue
    const rule = ERA_RULES.find((candidate) => candidate.channel === channel)!
    if (!rule.bases.some((basis) => basis === 'recording' || basis === 'performance')) continue
    const byArtist = new Map<string, number[]>()
    for (const index of indexes) {
      const artist = artistOf(programmes[index])
      byArtist.set(artist, [...(byArtist.get(artist) ?? []), index])
    }
    if (byArtist.size < MIN_MUSIC_SOURCES) continue
    const seconds = (list: readonly number[]) => list.reduce((sum, index) => sum + programmes[index].durationSeconds, 0)
    const off = new Set<number>()
    const [dominant, kept] = [...byArtist].sort((a, b) => seconds(b[1]) - seconds(a[1]))[0]
    const longestFirst = [...kept].sort((a, b) => programmes[b].durationSeconds - programmes[a].durationSeconds || a - b)
    const others = seconds(indexes) - seconds(kept)
    let remaining = seconds(kept)
    for (const index of longestFirst) {
      if (remaining <= (remaining + others) * MAX_MUSIC_SHARE) break
      off.add(index)
      remaining -= programmes[index].durationSeconds
    }
    const total = remaining + others
    const shares = [...byArtist].map(([artist, list]) => (artist === dominant ? remaining : seconds(list)))
    if (remaining > 0 && total >= MIN_ERA_SECONDS && Math.max(...shares) <= total * MAX_MUSIC_SHARE) {
      viable.add(channel)
      dropped.set(channel, off)
    }
  }
  return { viable, dropped }
}

/** The publisher, or for a multi-artist publisher the act its title names ("Artist - Song", 'Artist "Song"'). */
export function artistOf(programme: { sourceId?: string; title?: string }): string {
  const source = programme.sourceId ?? ''
  if (!MULTI_ARTIST_SOURCES.has(source) || !programme.title) return source
  const act = programme.title.split(/\s[-–—|]\s|\s["“'‘]/)[0].replace(/\s*[(\[].*$/, '').trim().toLowerCase()
  return act ? `${source}:${act}` : source
}

/**
 * Film-genre channels fed by a publisher's own structured genre field (scripts/film_genres.py).
 * Approved programme-level reuse of dedicated film sources, limited to the sources listed here;
 * every other dedicated source keeps airing on its homes only.
 */
export const FILM_GENRE_CHANNELS: Readonly<Record<string, readonly number[]>> = {
  Action: [34],
  Adventure: [149],
  Thriller: [150],
  Crime: [151],
  Mystery: [152],
  Comedy: [153],
  'Romantic Comedy': [154],
  Drama: [155],
  Western: [157],
}
/**
 * Trailer-genre channels fed by the film's Wikidata genres, matched on exact title and original year
 * (scripts/trailer_genres.py, cached at build time). Listed scarcest first: a trailer joins at most
 * TRAILER_GENRE_LIMIT of them, so the largest pools give way when a film carries many genres.
 */
export const TRAILER_GENRE_CHANNELS: Readonly<Record<string, readonly number[]>> = {
  Animation: [135],
  Fantasy: [138],
  'Science Fiction': [131],
  Horror: [130],
  Thriller: [137],
  Action: [132],
  Drama: [136],
}
export const TRAILER_GENRE_SOURCE = 'src_rt_classic_trailers'
export const TRAILER_GENRE_LIMIT = 3
export const FILM_GENRE_SOURCES: ReadonlySet<string> = new Set(['src_popcornflix', TRAILER_GENRE_SOURCE])

export function genreChannelsFor(programme: { sourceId?: string; durationSeconds: number; genres?: readonly string[] }): number[] {
  const genres = new Set(programme.genres ?? [])
  if (programme.sourceId === TRAILER_GENRE_SOURCE) {
    return Object.entries(TRAILER_GENRE_CHANNELS)
      .filter(([genre]) => genres.has(genre))
      .flatMap(([, channels]) => channels)
      .slice(0, TRAILER_GENRE_LIMIT)
  }
  if (!FILM_GENRE_SOURCES.has(programme.sourceId ?? '') || programme.durationSeconds < 3600) return []
  return [...new Set([...genres].flatMap((genre) => FILM_GENRE_CHANNELS[genre] ?? []))]
}

/** Genre channels with at least three hours of films; below that the channel stays off air. */
export function viableGenreChannels(programmes: readonly { durationSeconds: number; genreChannels: readonly number[] }[]): Set<number> {
  const seconds = new Map<number, number>()
  for (const programme of programmes) {
    for (const channel of programme.genreChannels) seconds.set(channel, (seconds.get(channel) ?? 0) + programme.durationSeconds)
  }
  return new Set([...seconds].filter(([, total]) => total >= MIN_ERA_SECONDS).map(([channel]) => channel))
}

/** Era channels this programme may join. Without a verified or high-confidence original year: none. */
export function eraChannelsFor(programme: {
  sourceId?: string
  title: string
  durationSeconds: number
  original?: OriginalYear | null
}): number[] {
  const original = programme.original
  if (!original || (original.confidence !== 'VERIFIED' && original.confidence !== 'HIGH')) return []
  const limit = original.basis === 'recording' || original.basis === 'performance' || original.basis === 'trailer' ? 2 : 1
  const out: number[] = []
  for (const rule of ERA_RULES) {
    if (out.length >= limit) break
    if (original.year < rule.from || original.year > rule.to) continue
    if (!rule.bases.includes(original.basis)) continue
    if (!rule.sources.has(programme.sourceId ?? '')) continue
    if (rule.minSeconds && programme.durationSeconds < rule.minSeconds) continue
    if (rule.title && !rule.title.test(programme.title)) continue
    out.push(rule.channel)
  }
  return out
}
