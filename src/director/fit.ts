import { canonicalByNumber } from '../data/canonical.ts'
import { DYNAMIC_CHANNELS, dynamicChannel } from '../dynamic/providers.ts'
import { excludedChannelName, excludedProgramme } from '../library/exclusions.ts'
import { FILM_GENRE_SOURCES } from '../library/metadata-channels.ts'
import type { MediaItem } from './types.ts'

/**
 * Source routing only nominates candidates. A routed programme airs when its
 * identity (source sport or genre, title) suits the channel's identity (name).
 */

const BLOCKED_TITLE = new RegExp(
  [
    'space[\\s-]race|spaceflight|space[\\s-]flight|space[\\s-]station|spacex|astronom(y|ers?)|cosmology|nasa|',
    'astronauts?|cosmonauts?|satellites?|solar[\\s-]system|outer[\\s-]space|milky[\\s-]way|from space|galax(y|ies)|',
    'telescopes?|rockets?|moon[\\s-]landing|apollo \\d+|mars rover|',
    'sermons?|worship|bible|quran|koran|church service|gospel|hymns?|prayers?|jesus|scripture|psalms?|',
    'religio(n|us)|ramadan|mosque|synagogue|buddhis[mt]|hindu(ism)?|christianity|islam(ic)?|',
    'aircraft|airplanes?|aeroplanes?|airliners?|aviation|aviators?|aerospace|aeronautic(s|al)|jetliners?|helicopters?|',
    'boeing|airbus|concorde|spitfires?|biplanes?|flying boats?|warplanes?|fighter jets?|jet engines?|air ?shows?|',
    'airports?|aerodromes?|airfields?|airships?|(?<!led\\s)zeppelins?|gliders?|gliding|air ?force|raf|luftwaffe|bombers?|',
    'fighter (wing|pilots?)|jet pilots?|flying aces?|air ?races?|parachut\\w*|cockpit|planes?|plane crash\\w*|',
    'flight simulator|transpacific flight|jets? revolution',
  ].join(''),
)
const BLOCKED = new RegExp(`\\b(${BLOCKED_TITLE.source})\\b`, 'i')

/** Channels whose subject is itself excluded from the network. */
const CLOSED_CHANNEL = /aviation|aircraft|airports?|aerospace|\bspace\b|astronomy|religio/i
/** Channels whose identity is their dedicated publishers and curated programmes alone; broad rows that nominate them do not air there. */
const HOME_ONLY_CHANNELS = new Set([
  163, 166, 196, 288, 289, 688, 801, 848, 914,
  49, 76, 96, 197, 219, 228, 230, 231, 232, 234, 238, 239, 242, 254, 275, 497,
  454, 455, 456, 457, 458, 463, 636, 643, 685, 686, 690, 691, 795, 798, 815, 818, 843, 844, 849, 891, 892,
  37, 85, 111, 116, 118, 129, 141, 145, 188, 189, 190, 654, 143, 184, 187, 192, 233, 290, 304, 306, 390, 391, 397, 407, 418, 424, 434, 440, 449, 563, 628, 469, 610, 612, 624, 625, 626, 662, 675, 697, 717, 725, 726, 749, 764, 767, 778, 819, 837, 838, 882,
  27, 84, 88, 89, 90, 292, 139,
  19, 61, 78, 564, 800,
  769,
  ...DYNAMIC_CHANNELS,
])

interface Sport {
  key: string
  channel: RegExp
  title: RegExp
  sources?: string[]
}

const SPORTS: Sport[] = [
  { key: 'american-football', channel: /american football|\bnfl\b/i, title: /\bnfl\b|super bowl|american football|heisman/i, sources: ['src_nfl', 'src_nfl_films'] },
  { key: 'football', channel: /football|\bfifa\b|\buefa\b|soccer/i, title: /football|soccer|\bfifa\b|world cup|fa cup|\buefa\b|premier league|champions league|\bgoals?\b/i, sources: ['src_fifa'] },
  { key: 'rugby', channel: /rugby/i, title: /rugby|\bsvns\b|six nations/i, sources: ['src_world_rugby'] },
  { key: 'cricket', channel: /cricket/i, title: /cricket|\bashes\b|\bt20\b|\bodi\b|test match|wicket/i, sources: ['src_icc'] },
  { key: 'ice-hockey', channel: /ice hockey|\bnhl\b/i, title: /ice hockey|\bnhl\b|stanley cup|#iihf|iihf world/i, sources: ['src_iihf'] },
  { key: 'field-hockey', channel: /field hockey/i, title: /(?<!ice )hockey/i, sources: ['src_fih'] },
  { key: 'volleyball', channel: /volleyball/i, title: /volleyball/i, sources: ['src_fivb_archive'] },
  { key: 'table-tennis', channel: /table tennis/i, title: /table tennis|ping[\s-]?pong/i, sources: ['src_wtt'] },
  { key: 'tennis', channel: /^tennis$/i, title: /(?<!table )tennis|wimbledon/i, sources: ['src_wimbledon'] },
  { key: 'boxing', channel: /boxing/i, title: /boxing|boxers?\b/i, sources: ['src_top_rank'] },
  { key: 'mma', channel: /\bmma\b/i, title: /\bmma\b|\bufc\b|muay thai|kickbox|one championship|one friday fights/i, sources: ['src_one'] },
  { key: 'wrestling', channel: /wrestl/i, title: /wrestl|\bwwe\b|smackdown|wrestlemania/i, sources: ['src_wwe'] },
  { key: 'horse-racing', channel: /horse racing|equestrian/i, title: /horse rac|\bderby\b|grand national|racecourse|equestrian|show jumping/i },
  { key: 'motorsport', channel: /motorsport|motor mix|formula|rally|motorcycle racing/i, title: /grand prix|formula (one|1)|\brally\b|motor ?racing|motorsport|le mans|speedway|\btt races?\b/i },
  { key: 'basketball', channel: /basketball|\bnba\b|\bwnba\b/i, title: /basketball|\bnba\b/i },
  { key: 'baseball', channel: /baseball|\bmlb\b/i, title: /baseball|\bmlb\b/i },
  { key: 'golf', channel: /golf/i, title: /\bgolf/i },
  { key: 'snooker', channel: /snooker|^pool$/i, title: /snooker|billiards/i },
  { key: 'darts', channel: /darts/i, title: /\bdarts\b/i, sources: ['src_pdc'] },
  { key: 'bowling', channel: /bowling/i, title: /bowling|tenpin/i },
  { key: 'cycling', channel: /cycling/i, title: /cycling|cyclists?|tour de france|bicycle race/i },
  { key: 'athletics', channel: /athletics|running$/i, title: /athlet|marathon|sprint|\brelay\b|hurdles|high jump|long jump|javelin|olympic/i },
  { key: 'swimming', channel: /swimming|diving/i, title: /swim|\bdiv(ing|ers?)\b/i },
  { key: 'gymnastics', channel: /gymnastics/i, title: /gymnast/i },
  { key: 'rowing', channel: /rowing/i, title: /rowing|boat race|regatta/i },
  { key: 'sailing', channel: /sailing/i, title: /sailing|yacht|regatta/i },
  { key: 'skateboarding', channel: /skate/i, title: /skate/i },
  { key: 'snow', channel: /snow sports|skiing/i, title: /\bski(ing|er|s)?\b|snowboard|bobsleigh|toboggan|winter olympic/i },
  { key: 'climbing', channel: /climbing/i, title: /climb|mountaineer/i },
  { key: 'surfing', channel: /surfing/i, title: /surf/i },
  { key: 'strength', channel: /strength$|weightlifting|bodybuilding/i, title: /weightlift|bodybuild|strongman/i },
  { key: 'fishing', channel: /fishing/i, title: /fishing|angling|anglers?/i },
]
const COMBAT = ['boxing', 'mma', 'wrestling']

/** Distinctive catalogues that are the identity of one channel: they air there and nowhere else, and that channel airs only them. */
export const OWNED_SOURCES: ReadonlyMap<string, number> = new Map([
  ['src_british_pathe', 805],
  ['src_kofa', 114],
  ['src_orbital_bacon', 225],
])
const OWNER_CHANNELS = new Set(OWNED_SOURCES.values())
const OUTDOOR = ['climbing', 'surfing', 'skateboarding', 'snow', 'sailing', 'cycling', 'fishing']
const SPORT_FEEDS = new Map(SPORTS.flatMap((sport) => (sport.sources ?? []).map((source) => [source, sport.key] as const)))

/** General entertainment channels that may carry any non-sport, non-news feed. */
const GENERAL = /^(one|two|three|four|five|six|seven|eight|nine|prime|select|plus|encore|choice|mix|classics?|retro|variety|archive|late|night|after hours|midnight|showcase|preview|festival|entertainment( one| two| extra)?|daytime|late night|tv archive|retro television)$/i

interface Feed {
  sources: string[]
  channel: RegExp
  categories?: string[]
  /** Channels the feed never reaches, even through its categories. */
  except?: RegExp
  general: boolean
}

/** Single-subject publishers. Their programmes stay on channels about that subject. */
const FEEDS: Feed[] = [
  { sources: ['src_kexp', 'src_vevo'], channel: /\bmusic\b|concert|festival|performance|radio visual|ambient|sessions|mtv|vevo|podcast|talent|\blive$/i, categories: ['music'], general: true },
  { sources: ['src_tms_anime', 'src_its_anime'], channel: /anime|manga|animation|cartoon|\bkids\b|\bteen\b|family|geek|fandom|saturday|sci-fi|fantasy|superheroes|screen|\baction\b|adventure|young adult|comics|pop culture/i, general: true },
  { sources: ['src_atk'], channel: /food|cook|kitchen|baking|bread|dessert|vegetarian|vegan|barbecue|seafood|chefs|restaurant|meals|drinks|coffee|recipe|nutrition|^home$|^life$|lifestyle|magazine/i, general: true },
  { sources: ['src_hasfit', 'src_yoga_adriene'], channel: /fitness|strength|cardio|mobility|yoga|pilates|walking|running|health|wellbeing|mindfulness|ageing|sleep|^life$|lifestyle/i, general: false },
  { sources: ['src_sesame_street'], channel: /\bkids\b|preschool|family|children|cartoon|animation|saturday|puppet|learning|education/i, general: true },
  { sources: ['src_hollyoaks'], channel: /drama|soap|\bteen\b|young adult/i, general: true },
  { sources: ['src_noclip'], channel: /gam(e|es|ing)\b|arcade|console|esports|geek|pop culture|internet|digital culture|creators|video essays|behind the (screen|scenes)|documentary|software history/i, general: true },
  { sources: ['src_chm', 'src_computerphile', 'src_numberphile'], channel: /comput|software|hardware|programming|open source|internet|\bweb\b|cyber|networks|\bai\b|machine learning|robotics|automation|\bdata\b|cloud|semiconductor|mobile|tech|digital|inventions|electronics|science|mathematics|lectures|learning|ideas|interviews/i, general: false },
  { sources: ['src_hagerty', 'src_motorweek'], channel: /\bcars?\b|motor|automotive|vehicles|trucks|road|driving/i, general: false },
  { sources: ['src_practical_engineering', 'src_b1m'], channel: /engineering|construction|infrastructure|megaprojects|architecture|cities|urban|industrial design|inventions|industry|energy|renewables|transport technology|future tech/i, general: false },
  { sources: ['src_kofa'], channel: /film|cinema|movie|asian|korea|world|culture|\barts\b|drama|classic|screen|matinee|feature|midnight|^late$|^night$/i, categories: ['film'], general: true },
  { sources: ['src_national_rail_scenic'], channel: /rail|train|travel|journey|slow tv|ambient|places|outdoor|scenic|landscape|countryside|^stations$|^trams$/i, general: false },
  { sources: ['src_nbc_news_now', 'src_livenow_fox'], channel: /news|current affairs|world report|headlines|information|press review|affairs|politics|economy today|markets today|newsroom|weather/i, categories: ['news'], except: /archive/i, general: false },
  { sources: ['src_jalc'], channel: /\bjazz\b/i, general: false },
  { sources: ['src_hr_symphony'], channel: /classical|orchestra|symphon/i, general: false },
  { sources: ['src_operavision'], channel: /\bopera\b/i, general: false },
  { sources: ['src_opry'], channel: /\bcountry\b/i, general: false },
  { sources: ['src_shows_must_go_on'], channel: /musical/i, general: false },
  { sources: ['src_rt_trailers'], channel: /trailer/i, general: false },
  { sources: ['src_timeline'], channel: /^history$|ancient|\brome\b|greece|egypt|medieval|renaissance|victorian|world war|cold war|military history|modern history|british history|european history/i, general: false },
  { sources: ['src_ww2'], channel: /world war ii|military history|^history$/i, general: false },
  { sources: ['src_geography_now'], channel: /^geography$/i, general: false },
  { sources: ['src_lonely_planet'], channel: /travel|city breaks|road trips/i, general: false },
]
/**
 * Publishers acquired for particular channels. Their programmes are those channels' own,
 * whatever else the channel inherits, and they air nowhere else.
 */
export const DEDICATED: Readonly<Record<string, readonly number[]>> = {
  src_dw_documentary: [108],
  src_omeleto: [107],
  src_dust: [144],
  src_alter: [140],
  src_bfi: [161],
  src_rockpalast: [501],
  src_soul_train: [516],
  src_cercle: [521],
  src_vp_records: [529],
  src_boiler_room: [554],
  src_athletic_fc: [305],
  src_wsl: [310],
  src_copa90: [314],
  src_mark_wiens: [710],
  src_preppy_kitchen: [711],
  src_bake_with_jack: [712],
  src_rainbow_plant_life: [715],
  src_chuds_bbq: [716],
  src_royal_ballet_opera: [283],
  src_sadlers_wells: [283],
  src_cirque: [286],
  src_nuclear_blast: [504],
  src_epitaph: [505],
  src_insideout: [511],
  src_ukf_dnb: [535],
  src_npr_music: [556],
  src_colors: [557],
  src_sofar: [576],
  src_fender: [568],
  src_bassbuzz: [569],
  src_drumeo: [570],
  src_pianote: [571],
  src_afro_nation: [533],
  src_gcn: [333],
  src_fia_wec: [340],
  src_sailgp: [353],
  src_bbc_earth: [485],
  src_pbs_eons: [488],
  src_langfocus: [496],
  src_ted: [491],
  src_jamie_oliver: [701],
  src_made_with_lau: [706],
  src_adam_ragusea: [718],
  src_tasting_history: [719],
  src_how_to_drink: [727],
  src_james_hoffmann: [728],
  src_this_old_house: [753],
  src_stumpy_nubs: [755],
  src_exploring_alternatives: [766],
  src_defcon: [638],
  src_mkbhd: [649],
  src_gaming_historian: [246],
  src_studiobinder: [193],
  src_corridor_crew: [167],
  src_8bit_guy: [810],
  src_british_museum: [846],
  src_national_gallery: [847],
  src_toolroom: [522],
  src_sing_king: [574],
  src_coachella: [559],
  src_latin_grammys: [532],
  src_filmmaker_iq: [170],
  src_kermode_mayo: [195],
  src_every_frame: [194],
  src_lessons_screenplay: [164],
  src_soundworks: [169],
  src_oscars: [182],
  src_foil_arms_hog: [206],
  src_lgr: [241],
  src_lol_esports: [248],
  src_nerdwriter: [293],
  src_bluey: [236],
  src_met_office: [444],
  src_amoeba_sisters: [473],
  src_pasta_grannies: [705],
  src_chef_jean_pierre: [721],
  src_move_with_nicole: [737],
  src_bernadette_banner: [758],
  src_verypink_knits: [759],
  src_freecodecamp: [634],
  src_two_minute_papers: [640],
  src_asianometry: [646],
  src_ycombinator: [606],
  src_art_assignment: [845],
  src_filmrise_movies: [101],
  src_dry_bar: [205],
  src_gundam: [229],
  src_english_heritage: [415],
  src_schmidt_ocean: [439],
  src_geologyhub: [443],
  src_legaleagle: [467],
  src_overly_sarcastic: [493],
  src_sub_pop: [503],
  src_audiotree: [552],
  src_blogotheque: [553],
  src_polyphonic: [561],
  src_produce_like_a_pro: [565],
  src_plain_bagel: [603],
  src_ben_eater: [631],
  src_linus_tech_tips: [633],
  src_statquest: [641],
  src_james_bruton: [642],
  src_efficient_engineer: [651],
  src_electroboom: [652],
  src_jay_leno: [672],
  src_best_ever_food: [703],
  src_rick_bayless: [709],
  src_sugar_geek: [713],
  src_manjulas_kitchen: [714],
  src_eater: [720],
  src_tom_merrick: [735],
  src_blondihacks: [756],
  src_huw_richards: [763],
  src_kraig_adams: [782],
  src_ta_outdoors: [783],
  src_vogue: [790],
  src_ham_radio_crash_course: [817],
  src_sams_trains: [825],
  src_cruising_the_cut: [834],
  src_doctor_who: [216],
  src_mr_bean: [237],
  src_popeye: [224],
  src_stan_winston: [168],
  src_digital_foundry: [243],
  src_braille_skate: [355],
  src_city_beautiful: [435],
  src_chubbyemu: [475],
  src_school_of_life: [476],
  src_nutrition_made_simple: [740],
  src_newport_folk: [527],
  src_rick_beato: [566],
  src_great_british_chefs: [704],
  src_flo_chinyere: [707],
  src_running_channel: [739],
  src_architectural_digest: [751],
  src_home_renovision: [754],
  src_two_cents: [617],
  src_ben_felix: [619],
  src_networkchuck: [639],
  src_alex_the_analyst: [644],
  src_fortnine: [674],
  src_casual_navigation: [681],
  src_modern_mba: [693],
  src_ali_abdaal: [698],
  src_pearl_jam: [506],
  src_alice_in_chains: [506],
  src_soundgarden: [506],
  src_nirvana: [506],
  src_nirvana_vevo: [506],
  src_stone_temple_pilots: [506],
  src_mudhoney: [506],
  src_screaming_trees_vevo: [506],
  src_mad_season_vevo: [506],
  src_melvins: [506],
  src_mark_lanegan: [506],
  src_temple_of_the_dog: [506],
  src_l7: [506],
  src_hole_vevo: [506],
  src_chris_cornell: [506],
  src_sub_pop_grunge: [506],
  src_much_grunge: [506],
  src_mtv_grunge: [506],
  src_pulp: [507],
  src_suede: [507],
  src_the_verve_vevo: [507],
  src_supergrass: [507],
  src_manics: [507],
  src_manics_vevo: [507],
  src_duran_duran: [508],
  src_depeche_mode: [508],
  src_talking_heads: [508],
  src_new_order: [508],
  src_human_league: [508],
  src_tears_for_fears_vevo: [508],
  src_siouxsie_vevo: [509],
  src_bauhaus: [509],
  src_ride: [510],
  src_cocteau_twins: [510],
  src_diiv: [510],
  src_led_zeppelin: [512],
  src_pink_floyd: [512],
  src_the_doors: [512],
  src_jimi_hendrix: [512],
  src_tom_petty: [512],
  src_bruce_springsteen: [512],
  src_eric_clapton: [512],
  src_the_who_vevo: [512],
  src_joe_bonamassa: [514],
  src_bb_king: [514],
  src_gary_clark_jr: [514],
  src_vulf: [517],
  src_lettuce: [517],
  src_snarky_puppy: [517],
  src_run_the_jewels: [520],
  src_wu_tang_clan: [520],
  src_public_enemy: [520],
  src_1xtra_hiphop: [520],
  src_hot97: [520],
  src_madness: [530],
  src_the_selecter: [530],
  src_the_beat: [530],
  src_toots: [530],
  src_playing_for_change: [531],
  src_tinariwen: [531],
  src_tomorrowland: [534],
  src_anjunabeats: [534],
  src_lollapalooza: [559],
  src_roskilde: [559],
  src_pitchfork_classic: [562],
  src_mix_with_the_masters: [567],
  src_moog: [572],
  src_loopop: [572],
  src_korg: [572],
  src_vevo_the_killers: [592],
  src_vevo_kings_of_leon: [592],
  src_keb_mo: [514],
  src_beth_hart: [514],
  src_the_cult: [509],
  src_she_wants_revenge_vevo: [509],
  src_songhoy_blues: [531],
  src_angelique_kidjo: [531],
  src_primavera_sound: [559],
  src_sziget: [559],
  src_bonnaroo: [559],
  src_blur: [507],
  src_oasis: [507],
  src_the_cure: [509],
  src_nile_rodgers: [518],
  src_gloria_gaynor: [518],
  src_bee_gees: [518],
  src_resident_advisor: [523],
  src_mixmag: [523],
  src_the_specials: [530],
  src_massive_attack: [536],
  src_zero_7: [536],
  src_nine_inch_nails: [537],
  src_my_chemical_romance: [538],
  src_fall_out_boy: [538],
  src_paramore: [538],
  src_jimmy_eat_world: [538],
  src_dashboard_confessional: [538],
  src_sigur_ros: [539],
  src_seth_meyers: [266],
  src_colbert: [266],
  src_team_coco: [264],
  src_fallon: [266],
  src_the_office: [207],
  src_parks_and_rec: [207],
  src_friends: [207],
  src_whose_line: [209],
  src_taskmaster: [273],
  src_radiohead: [502],
  src_rem: [502],
  src_smashing_pumpkins: [502],
  src_rhcp: [502],
  src_foo_fighters: [502],
  src_acdc: [513],
  src_guns_n_roses: [513],
  src_aerosmith: [513],
  src_def_leppard: [513],
  src_kiss: [513],
  src_bon_jovi: [513],
  src_motley_crue: [513],
  src_usher: [519],
  src_alicia_keys: [519],
  src_brandy: [519],
  src_ne_yo: [519],
  src_home_free: [573],
  src_kings_singers: [573],
  src_polyphia: [575],
  src_animals_as_leaders: [575],
  src_postmodern_jukebox: [577],
  src_hammock: [524],
  src_popcornflix: [102],
  src_movie_central: [106],
  src_filmrise_documentaries: [160],
  src_adult_swim: [223],
  src_vanity_fair: [279],
  src_entertainment_tonight: [279],
  src_epic_history: [416],
  src_historia_civilis: [416],
  src_toldinstone: [416],
  src_history_guy: [417],
  src_american_battlefield_trust: [417],
  src_kings_and_generals: [419],
  src_shawn_willsey: [487],
  src_sam_the_cooking_guy: [708],
  src_kenji: [724],
  src_madfit: [734],
  src_heather_robertson: [734],
  src_grow_with_jo: [738],
  src_outdoor_boys: [781],
  src_kevin_powell: [637],
  src_web_dev_simplified: [637],
  src_techworld_nana: [645],
  src_be_a_better_dev: [645],
  src_eevblog: [816],
  src_greatscott: [816],
  src_bigclive: [816],
  src_modern_vintage_gamer: [813],
  src_cartoon_network_uk: [222],
  src_nickelodeon_uk: [222],
  src_pc_gamer: [244],
  src_mock_the_week: [265],
  src_eminem: [593],
  src_kendrick_lamar: [593],
  src_50_cent: [593],
  src_khruangbin: [575],
  src_economics_explained: [614],
  src_imagine_dragons: [592],
  src_arctic_monkeys: [592],
  src_mahogany: [558],
  src_paste: [555],
  src_this_morning: [267],
  src_loose_women: [267],
  src_slowdive: [510],
  src_my_bloody_valentine: [510],
  src_screen_junkies: [251],
  src_dead_meat: [256],
  src_court_tv: [468],
  // No home: these air only where a verified original year routes a programme (ERA_RULES).
  src_rt_classic_trailers: [],
  src_ed_sullivan: [],
  src_the_beatles: [],
  src_rolling_stones: [],
  src_roy_orbison: [],
  src_beach_boys: [],
  src_vevo_classics: [],
  src_vevo_80s: [],
  src_vevo_90s: [],
  src_vevo_2000s: [],
  src_vevo_abba: [],
  src_vevo_queen: [],
  src_vevo_elton_john: [],
  src_vevo_bob_marley: [],
  src_vevo_fleetwood_mac: [],
  src_vevo_stevie_wonder: [],
  src_vevo_diana_ross: [],
  src_vevo_ewf: [],
  src_vevo_blondie: [],
  src_vevo_carpenters: [],
  src_vevo_donna_summer: [],
  src_vevo_barry_white: [],
  src_vevo_marvin_gaye: [],
  src_vevo_temptations: [],
  src_vevo_smokey_robinson: [],
  src_vevo_dolly_parton: [],
  src_vevo_simon_garfunkel: [],
  src_vevo_live: [598],
  src_vevo_dscvr: [599],
  src_spinnin: [578],
  src_ultra: [578],
  src_armada: [578],
  src_monstercat: [578],
  src_hs2: [665],
  src_jago_hazzard: [678],
  src_nrm: [679],
  src_all_the_stations: [774],
  src_severn_valley: [821],
  src_bluebell: [821],
  src_kwvr: [821],
  src_network_rail: [822],
  src_rail_relaxation: [823],
  src_railcowgirl: [95],
  src_j_utah: [95],
  src_prowalk: [775],
  src_rambalac: [775],
  src_wind_walk: [775],
  src_kara_and_nate: [57],
  src_lost_leblanc: [57],
  src_wolters_world: [772],
  src_free_documentary_nature: [23],
  src_real_wild: [66],
  src_brave_wilderness: [66],
  src_terra_mater: [784],
  src_the_dodo: [787, 788],
  src_nick_zentner: [65],
  src_usgs: [431],
  src_iris_earthquake: [431],
  src_pbs_terra: [483],
  src_premier_league: [307],
  src_uefa: [308],
  src_bundesliga: [308],
  src_england_football: [311],
  src_concacaf: [311],
  src_coaches_voice: [313],
  src_wwe_vault: [329],
  src_wcw: [329],
  src_fis_alpine: [356],
  src_tgr: [356],
  src_ecb: [360],
  src_cricket_au: [360],
  src_bbc_archive_broadcasting: [893],
  src_tv_academy_interviews: [893],
  src_paley_center: [893],
  src_thames_tv: [288],
  src_bbc_archive: [288],
  src_johnny_carson: [289],
  src_carol_burnett: [289],
  src_us_national_archives: [808],
  src_iwm: [808],
  src_national_archives_uk: [808],
  src_yorkshire_film_archive: [808],
  src_frontline: [914],
  src_abc_news_indepth: [914],
  src_cna_insider: [914],
  src_bi_manufacturing: [622],
  src_insider_manufacturing: [622],
  src_cnbc_manufacturing: [622],
  src_stanford_gsb: [600],
  src_hbr: [600],
  src_cnbc_make_it: [600],
  src_company_man: [615],
  src_business_casual: [615],
  src_logically_answered: [615],
  src_bloomberg_originals: [629],
  src_cnbc_documentary: [629],
  src_economist: [629],
  src_megaprojects: [663],
  src_the_build: [663],
  src_nature_relaxation_films: [94],
  src_scenic_nature_relaxation: [94],
  src_balu_nature: [94],
  src_relaxation_film: [94],
  src_arte_travel: [448],
  src_free_documentary_travel: [448],
  src_kombi_life: [773],
  src_itchy_boots: [773],
  src_travel_tiny_budget: [777],
  src_older_backpacker: [777],
  src_holiday_expert: [777],
  src_hopscotch: [777],
  src_nomadic_matt: [777],
  src_our_changing_climate: [489],
  src_just_have_a_think: [489],
  src_unep: [489],
  src_climate_town: [489],
  src_ninja_nerd_anatomy: [747],
  src_kenhub: [747],
  src_anatomyzone: [747],
  src_ninja_nerd_physiology: [748],
  src_armando_physiology: [748],
  src_osmosis_physiology: [748],
  src_khan_medicine_physiology: [748],
  src_paul_sellers: [688],
  src_steve_ramsey: [688],
  src_jimmy_diresta: [688],
  src_laura_kampf: [688],
  src_budget_bytes: [723],
  src_miguel_barclay: [723],
  src_weissman_budget: [723],
  src_fitness_blender: [732],
  src_body_coach: [732],
  src_ps_fit: [732],
  src_belgrave_villa: [765],
  src_restoring_number_four: [765],
  src_chateau_diaries: [765],
  src_wendover: [623],
  src_engineering_rosie: [669],
  src_eric_strebel: [659],
  src_design_museum: [658],
  src_bof: [627],
  src_starter_story: [613],
  src_lbs: [608],
  src_bank_of_england: [618],
  src_chief_makoi: [657],
  src_oceanliner_designs: [832],
  src_road_guy_rob: [835],
  src_huntley_industrial: [809],
  src_huntley_transport: [839],
  src_ap_archive: [945],
  src_british_movietone: [945],
  src_comic_tropes: [252],
  src_strip_panel_naked: [252],
  src_button_poetry: [842],
  src_poetry_foundation: [842],
  src_hay_festival: [92],
  src_josh_revell: [345],
  src_goodwood: [344],
  src_clints_reptiles: [478],
  src_ben_g_thomas: [478],
  src_li_ziqi: [789],
  src_dianxi_xiaoge: [789],
  src_wsl_surf: [359],
  src_steve_wallis: [780],
  src_headspace: [743],
  src_tracey_marks: [742],
  src_huntley_motoring: [836],
  src_huntley_sailing: [833],
  src_huntley_architecture: [848],
  src_huntley_social: [422],
  src_huntley_events: [429],
  src_travel_film_archive: [779],
  src_chicago_film_archives: [801],
  src_gresham_law: [451],
  src_gresham_crime: [462],
  src_gresham_medicine: [746],
  src_gresham_politics: [423],
  src_rai: [494],
  src_lse_sociology: [495],
  src_sag_foundation: [163],
  src_ace_editors: [166],
  src_patrick_willems: [196],
  src_thomas_flight: [196],
  src_comicstorian: [253],
  src_trash_theory: [560],
  src_linux_foundation: [635],
  src_brick_immortar: [653],
  src_mellow: [384],
  src_indigo_traveller: [776],
  src_eva_zu_beck: [776],
  src_brad_stanfield: [744],
  src_clutterbug: [768],
  src_cannes_lions: [611],
  src_patrick_boyle: [694],
  src_92ny_books: [840],
  // pass 17: entertainment, television and culture; anime is homed per series
  src_dick_cavett: [76],
  src_hot_ones: [76],
  src_gerry_anderson: [219],
  src_degrassi: [238],
  src_pemberley: [239],
  src_lizzie_bennet: [239],
  src_kindatv: [239],
  src_wheel_of_fortune: [275],
  src_rsc: [49],
  src_stratford: [49],
  src_royal_court: [49],
  src_lincoln_center: [49],
  src_vanguard: [228],
  src_beyblade: [228],
  src_crunchyroll_action: [228],
  src_crunchyroll_fantasy: [230],
  src_crunchyroll_drama: [231],
  src_crunchyroll_comedy: [232],
  src_viz_manga: [234],
  src_rsl: [497],
  src_british_library_lit: [497],
  src_atlas_obscura: [96],
  // pass 18: law, technology, archive and culture; archive homes take archival material only
  src_intl_criminal_court: [457],
  src_uksc_constitutional: [458],
  src_uksc_human_rights: [456],
  src_harvard_law_constitutional: [458],
  src_harvard_law_international: [457],
  src_harvard_law_human_rights: [456],
  src_harvard_law_criminal: [454],
  src_harvard_law_civil: [455],
  src_oxford_law_international: [457],
  src_oxford_law_human_rights: [456],
  src_oxford_law_constitutional: [458],
  src_oxford_law_criminal: [454],
  src_oxford_law_civil: [455],
  src_un_human_rights: [456],
  src_huntley_police: [463],
  src_huntley_radio: [818],
  src_bbc_archive_radio: [818],
  src_bvws: [818],
  src_arrl_history: [818],
  src_ripe_ncc: [636],
  src_ietf: [636],
  src_realpars: [643],
  src_ieee_spectrum: [685],
  src_long_now: [685],
  src_royal_society_future: [685],
  src_henry_ford: [686],
  src_nihf: [686],
  src_science_museum: [686],
  src_oii: [690],
  src_berkman_klein: [690],
  src_internet_historian: [690],
  src_folding_ideas: [690],
  src_chm_interviews: [691],
  src_chm_internet: [815],
  src_dwarkesh: [691],
  src_cch: [691],
  src_christies: [795],
  src_sothebys: [795],
  src_strong_museum: [795],
  src_ifixit: [798],
  src_british_red_cross: [798],
  src_chrisfix: [798],
  src_lannan: [843],
  src_american_theatre_wing: [844],
  src_va_design: [849],
  src_cooper_hewitt: [849],
  src_vitra: [849],
  src_eames_office: [849],
  src_trailers_from_hell: [891],
  src_gbh_archives: [892],
  src_film_detective: [103],
  src_nfb_experimental: [116],
  src_icheme: [654],
  src_dogwoof: [139],
  // pass 21: rolling news, weather and business publishers air only where scripts/dynamic_refresh.py routes a programme
  src_abc_news: [],
  src_abc_news_au: [],
  src_africanews: [],
  src_aljazeera_english: [],
  src_bbc_news: [],
  src_bloomberg_tv: [],
  src_cbs_news: [],
  src_channel4_news: [],
  src_cna: [],
  src_cnbc: [],
  src_cnbc_international: [],
  src_dw_news: [],
  src_euronews: [],
  src_fox_weather: [],
  src_france24_english: [],
  src_guardian_news: [],
  src_hollywood_reporter: [],
  src_itv_news: [],
  src_nbc_news: [],
  src_new_scientist: [],
  src_newsnation: [],
  src_npr: [],
  src_nyt: [],
  src_pbs_newshour: [],
  src_reuters: [],
  src_sabc_news: [],
  src_scripps_news: [],
  src_sky_news: [],
  src_trt_world: [],
  src_wion: [],
  src_yahoo_finance: [],
}

const EARTH_REUSE = [
  'src_free_documentary_nature', 'src_real_wild', 'src_terra_mater', 'src_nick_zentner', 'src_usgs', 'src_iris_earthquake',
  'src_pbs_terra', 'src_geologyhub', 'src_shawn_willsey', 'src_bbc_earth', 'src_just_have_a_think', 'src_unep',
]
const LAW_REUSE = [
  'src_gresham_law', 'src_gresham_crime', 'src_historia_civilis', 'src_timeline', 'src_legaleagle', 'src_ted',
  'src_us_national_archives', 'src_hay_festival', 'src_thames_tv', 'src_dw_documentary', 'src_frontline',
]
/**
 * Approved programme-level reuse: channel -> dedicated sources whose individually chosen programmes
 * (programmeRoutes, scripts/programme_reuse.py) may air there. The rest of each source stays on its homes.
 */
const CURATED_REUSE: Readonly<Record<number, readonly string[]>> = {
  824: ['src_jago_hazzard', 'src_all_the_stations'],
  437: EARTH_REUSE,
  438: EARTH_REUSE,
  441: EARTH_REUSE,
  442: EARTH_REUSE,
  197: [
    'src_doctor_who', 'src_bbc_archive', 'src_bbc_archive_broadcasting', 'src_abc_news_indepth', 'src_bbc_earth', 'src_terra_mater',
    'src_stan_winston', 'src_studiobinder', 'src_shows_must_go_on', 'src_oscars', 'src_soundworks', 'src_vanity_fair',
    'src_architectural_digest', 'src_ed_sullivan', 'src_british_movietone', 'src_bfi',
  ],
  234: ['src_british_museum', 'src_comic_tropes', 'src_strip_panel_naked'],
  242: [
    'src_modern_vintage_gamer', 'src_8bit_guy', 'src_digital_foundry', 'src_gaming_historian', 'src_lgr', 'src_modern_mba',
    'src_james_bruton', 'src_jimmy_diresta',
  ],
  254: [
    'src_doctor_who', 'src_bfi', 'src_bbc_archive', 'src_nerdwriter', 'src_lessons_screenplay', 'src_soundworks', 'src_oscars',
    'src_vanity_fair', 'src_comic_tropes', 'src_tv_academy_interviews', 'src_polyphonic', 'src_ace_editors',
    'src_british_movietone', 'src_johnny_carson', 'src_screen_junkies', 'src_studiobinder',
  ],
  454: LAW_REUSE,
  455: LAW_REUSE,
  456: LAW_REUSE,
  457: LAW_REUSE,
  458: LAW_REUSE,
  463: [
    'src_gresham_crime', 'src_timeline', 'src_nfb', 'src_british_movietone', 'src_huntley_social', 'src_huntley_events',
    'src_chicago_film_archives', 'src_thames_tv', 'src_us_national_archives',
  ],
  815: ['src_chm', 'src_computerphile', 'src_bbc_archive', 'src_company_man', 'src_logically_answered', 'src_ripe_ncc', 'src_oii'],
  818: ['src_oceanliner_designs', 'src_bbc_archive_broadcasting'],
  843: ['src_thames_tv', 'src_bbc_archive', 'src_dick_cavett', 'src_nfb', 'src_us_national_archives'],
  844: ['src_dick_cavett', 'src_us_national_archives', 'src_chicago_film_archives', 'src_ap_archive'],
  // pass 19: curated programme-level reuse
  407: ['src_bernadette_banner', 'src_british_museum', 'src_christies', 'src_english_heritage', 'src_national_gallery', 'src_sothebys', 'src_tasting_history', 'src_time_team', 'src_timeline'],
  418: ['src_ap_archive', 'src_british_museum', 'src_dw_documentary', 'src_free_documentary_travel', 'src_huntley_events', 'src_lse_sociology', 'src_thames_tv', 'src_timeline', 'src_toldinstone', 'src_travel_film_archive'],
  424: ['src_british_museum', 'src_business_casual', 'src_company_man', 'src_dw_documentary', 'src_economics_explained', 'src_economist', 'src_huntley_events', 'src_kings_and_generals', 'src_megaprojects', 'src_nfb', 'src_patrick_boyle', 'src_plain_bagel', 'src_school_of_life', 'src_thames_tv', 'src_timeline', 'src_toldinstone', 'src_two_cents'],
  469: ['src_berkman_klein', 'src_defcon', 'src_oii'],
  819: ['src_bbc_archive', 'src_british_movietone', 'src_chicago_film_archives', 'src_chm', 'src_huntley_events', 'src_huntley_industrial', 'src_thames_tv'],
  290: ['src_berkman_klein', 'src_bloomberg_originals', 'src_company_man', 'src_internet_historian', 'src_lgr', 'src_logically_answered', 'src_nerdwriter', 'src_oii', 'src_polyphonic'],
  837: ['src_all_the_stations', 'src_bbc_archive', 'src_huntley_architecture', 'src_huntley_events', 'src_huntley_transport', 'src_jago_hazzard', 'src_jay_leno', 'src_nrm', 'src_road_guy_rob', 'src_thames_tv'],
  838: ['src_all_the_stations', 'src_city_beautiful', 'src_huntley_architecture', 'src_huntley_motoring', 'src_huntley_transport', 'src_jago_hazzard', 'src_nrm', 'src_rail_relaxation'],
  882: ['src_thames_tv'],
  626: ['src_b1m', 'src_bloomberg_originals', 'src_business_casual', 'src_cnbc_documentary', 'src_cnbc_make_it', 'src_copa90', 'src_economics_explained', 'src_hbr', 'src_logically_answered', 'src_modern_mba'],
  610: ['src_bi_manufacturing', 'src_bloomberg_originals', 'src_bof', 'src_business_casual', 'src_cannes_lions', 'src_cnbc_documentary', 'src_cnbc_make_it', 'src_company_man', 'src_hbr', 'src_lbs', 'src_stanford_gsb', 'src_starter_story', 'src_ycombinator'],
  612: ['src_bof', 'src_business_casual', 'src_cnbc_documentary', 'src_company_man', 'src_hbr', 'src_logically_answered', 'src_modern_mba', 'src_plain_bagel', 'src_two_cents', 'src_wendover'],
  624: ['src_business_casual', 'src_climate_town', 'src_cnbc_documentary', 'src_dw_documentary', 'src_economics_explained', 'src_just_have_a_think', 'src_logically_answered', 'src_megaprojects', 'src_plain_bagel', 'src_thames_tv', 'src_wendover'],
  625: ['src_bloomberg_originals', 'src_bof', 'src_business_casual', 'src_cannes_lions', 'src_cnbc_documentary', 'src_cnbc_make_it', 'src_company_man', 'src_economics_explained', 'src_hbr', 'src_lbs', 'src_logically_answered', 'src_megaprojects', 'src_modern_mba', 'src_stanford_gsb', 'src_thames_tv'],
  697: ['src_alex_the_analyst', 'src_be_a_better_dev', 'src_cnbc_make_it', 'src_hbr', 'src_networkchuck', 'src_techworld_nana', 'src_ted', 'src_two_cents', 'src_ycombinator'],
  304: ['src_bundesliga', 'src_cna_insider', 'src_copa90', 'src_dw_documentary', 'src_england_football', 'src_premier_league'],
  306: ['src_bbc_archive', 'src_british_movietone', 'src_bundesliga', 'src_copa90', 'src_fifa', 'src_premier_league', 'src_thames_tv'],
  390: ['src_gcn', 'src_khan_medicine_physiology', 'src_running_channel'],
  391: ['src_gcn', 'src_nfl_films', 'src_royal_institution', 'src_running_channel', 'src_tom_merrick', 'src_uefa'],
  397: ['src_bundesliga', 'src_copa90', 'src_fifa', 'src_nfl_films', 'src_one', 'src_premier_league', 'src_top_rank', 'src_uefa'],
  717: ['src_adam_ragusea', 'src_atk', 'src_chef_jean_pierre', 'src_chuds_bbq', 'src_dianxi_xiaoge', 'src_eater', 'src_flo_chinyere', 'src_great_british_chefs', 'src_jamie_oliver', 'src_kenji', 'src_li_ziqi', 'src_made_with_lau', 'src_pasta_grannies', 'src_rick_bayless', 'src_sam_the_cooking_guy', 'src_tasting_history'],
  725: ['src_adam_ragusea', 'src_atk', 'src_chef_jean_pierre', 'src_chuds_bbq', 'src_eater', 'src_flo_chinyere', 'src_great_british_chefs', 'src_jamie_oliver', 'src_kenji', 'src_li_ziqi', 'src_made_with_lau', 'src_pasta_grannies', 'src_rainbow_plant_life', 'src_rick_bayless', 'src_sam_the_cooking_guy', 'src_tasting_history'],
  726: ['src_eater', 'src_great_british_chefs', 'src_jamie_oliver', 'src_kenji', 'src_made_with_lau', 'src_manjulas_kitchen', 'src_pasta_grannies', 'src_rick_bayless', 'src_tasting_history'],
  749: ['src_abc_news_indepth', 'src_cna_insider', 'src_cnbc_documentary', 'src_dw_documentary', 'src_frontline'],
  764: ['src_balu_nature', 'src_free_documentary_nature', 'src_kraig_adams', 'src_national_rail_scenic', 'src_nature_relaxation_films', 'src_rail_relaxation', 'src_relaxation_film', 'src_terra_mater'],
  778: ['src_architectural_digest', 'src_arte_travel', 'src_indigo_traveller', 'src_kara_and_nate', 'src_lost_leblanc'],
  767: ['src_bbc_archive', 'src_ben_felix', 'src_bloomberg_originals', 'src_city_beautiful', 'src_cnbc_documentary', 'src_economics_explained', 'src_exploring_alternatives', 'src_home_renovision', 'src_modern_mba', 'src_plain_bagel', 'src_this_old_house', 'src_two_cents'],
  440: ['src_bbc_earth', 'src_cna_insider', 'src_dw_documentary', 'src_free_documentary_nature', 'src_geologyhub', 'src_nick_zentner', 'src_pbs_terra', 'src_rai', 'src_real_wild', 'src_shawn_willsey', 'src_terra_mater', 'src_travel_film_archive', 'src_usgs'],
  449: ['src_british_museum', 'src_cna_insider', 'src_dw_documentary', 'src_eva_zu_beck', 'src_free_documentary_travel', 'src_lost_leblanc', 'src_timeline', 'src_travel_film_archive'],
  662: ['src_b1m', 'src_brick_immortar', 'src_casual_navigation', 'src_city_beautiful', 'src_engineering_rosie', 'src_hs2', 'src_network_rail', 'src_practical_engineering', 'src_road_guy_rob', 'src_wendover'],
  675: ['src_defcon', 'src_hagerty', 'src_huntley_transport', 'src_jay_leno', 'src_wendover'],
  192: ['src_movie_central'],
  187: ['src_movie_central'],
  143: ['src_filmrise_movies', 'src_movie_central', 'src_popcornflix'],
  184: ['src_mst3k'],
  129: ['src_rt_trailers'],
  233: ['src_gundam', 'src_tms_anime'],
  434: ['src_geography_now'],
  141: ['src_film_detective'],
  145: ['src_film_detective'],
  116: ['src_nfb'],
  109: ['src_film_detective'],
  110: ['src_film_detective'],
  188: ['src_film_detective'],
  189: ['src_film_detective'],
  190: ['src_film_detective'],
  628: ['src_atk', 'src_bi_manufacturing', 'src_business_casual', 'src_cna_insider', 'src_cnbc_documentary', 'src_cnbc_make_it', 'src_company_man', 'src_dw_documentary', 'src_james_hoffmann', 'src_logically_answered', 'src_modern_mba', 'src_two_cents'],
  85: ['src_blogotheque', 'src_boiler_room', 'src_cercle', 'src_coachella', 'src_newport_folk', 'src_paste', 'src_rockpalast', 'src_toolroom', 'src_vp_records'],
  118: ['src_filmrise_movies', 'src_movie_central', 'src_popcornflix'],
  563: ['src_rick_beato'],
  37: ['src_movie_central', 'src_popcornflix'],
  // pass 20: curated front doors
  90: ['src_gresham_crime', 'src_gresham_law', 'src_gresham_medicine', 'src_gresham_politics', 'src_harvard_chan', 'src_lbs', 'src_royal_institution', 'src_school_of_life', 'src_ted'],
  27: ['src_bbc_archive', 'src_bfi', 'src_epic_history', 'src_national_gallery', 'src_nfb', 'src_timeline'],
  84: ['src_alter', 'src_dust', 'src_nfb', 'src_omeleto'],
  292: ['src_cruising_the_cut', 'src_exploring_alternatives', 'src_mark_wiens', 'src_nerdwriter', 'src_patrick_boyle', 'src_tasting_history', 'src_wendover'],
  88: ['src_bbc_archive'],
  89: ['src_bbc_archive', 'src_british_movietone', 'src_huntley_events', 'src_huntley_social', 'src_thames_tv', 'src_travel_film_archive'],
  // pass 22: the remaining front doors
  19: ['src_bbc_archive', 'src_dick_cavett', 'src_johnny_carson', 'src_thames_tv'],
  61: ['src_arte_travel', 'src_city_beautiful', 'src_free_documentary_travel', 'src_geography_now', 'src_geologyhub', 'src_schmidt_ocean', 'src_usgs'],
  78: ['src_bbc_archive', 'src_this_morning'],
  800: ['src_8bit_guy', 'src_92ny_books', 'src_american_theatre_wing', 'src_british_museum', 'src_chicago_film_archives', 'src_cruising_the_cut', 'src_eevblog', 'src_huntley_architecture', 'src_huntley_industrial', 'src_huntley_motoring', 'src_huntley_transport', 'src_national_gallery', 'src_network_rail', 'src_oceanliner_designs', 'src_severn_valley', 'src_tv_academy_interviews', 'src_us_national_archives'],
  564: ['src_aerosmith', 'src_arctic_monkeys', 'src_beach_boys', 'src_bee_gees', 'src_blur', 'src_bon_jovi', 'src_def_leppard', 'src_foo_fighters', 'src_guns_n_roses', 'src_imagine_dragons', 'src_insideout', 'src_jimmy_eat_world', 'src_khruangbin', 'src_kiss', 'src_motley_crue', 'src_my_bloody_valentine', 'src_my_chemical_romance', 'src_nine_inch_nails', 'src_nirvana', 'src_nuclear_blast', 'src_oasis', 'src_pearl_jam', 'src_rem', 'src_rhcp', 'src_rolling_stones', 'src_sigur_ros', 'src_smashing_pumpkins', 'src_soundgarden', 'src_the_beatles', 'src_the_cure', 'src_the_specials', 'src_vevo_2000s', 'src_vevo_80s', 'src_vevo_90s', 'src_vevo_abba', 'src_vevo_blondie', 'src_vevo_bob_marley', 'src_vevo_classics', 'src_zero_7'],
  // TVN 1.0.8: Indian Cooking takes Manjula's Kitchen's Indian dishes (scripts/indian_cooking_routes.py); the rest stays on 714
  769: ['src_manjulas_kitchen'],
  // pass 21: each rolling channel takes the publishers its provider config names
  ...Object.fromEntries(DYNAMIC_CHANNELS.flatMap((number) => {
    const sources = dynamicChannel(number)?.rolling?.sources
    return sources ? [[number, sources]] : []
  })),
}

/**
 * First Harvester import (TVN 1.0.7): each pair was reviewed against the programmes it admits. Like every reuse
 * entry it admits only the programmes individually routed to that channel, never the rest of the publisher.
 */
export const HARVESTER_REUSE: Readonly<Record<number, readonly string[]>> = {
  37: ['src_filmrise_movies'],
  149: ['src_popcornflix'],
  152: ['src_filmrise_movies', 'src_popcornflix'],
  157: ['src_movie_central', 'src_popcornflix'],
  218: ['src_filmrise_movies'],
  404: ['src_bloomberg_originals'],
  450: ['src_harvard_law_international'],
  471: ['src_gresham_medicine'],
  609: ['src_bloomberg_originals'],
  675: ['src_chrisfix'],
  695: ['src_gresham_medicine'],
  696: ['src_bbc_archive'],
  916: ['src_abc_news_indepth', 'src_berkman_klein'],
}

export const PROGRAMME_REUSE: Readonly<Record<number, readonly string[]>> = Object.fromEntries(
  [...new Set([...Object.keys(CURATED_REUSE), ...Object.keys(HARVESTER_REUSE)].map(Number))].map((number) => [
    number,
    [...new Set([...(CURATED_REUSE[number] ?? []), ...(HARVESTER_REUSE[number] ?? [])])],
  ]),
)
const FEED_BY_SOURCE = new Map(FEEDS.flatMap((feed) => feed.sources.map((source) => [source, feed] as const)))

function feedAllows(source: string, channel: { name: string; category: string }): boolean {
  const feed = FEED_BY_SOURCE.get(source)
  if (!feed) return true
  if (feed.except?.test(channel.name)) return false
  return feed.channel.test(channel.name) || Boolean(feed.categories?.includes(channel.category)) || (feed.general && GENERAL.test(channel.name))
}

interface Theme {
  channel: RegExp
  title: RegExp
  sources?: string[]
  categories?: string[]
  /** Only this theme decides; other matching themes cannot admit the item. */
  strict?: boolean
}

const THEMES: Theme[] = [
  { channel: /^nbc news now$/i, title: /$^/, sources: ['src_nbc_news_now'], strict: true },
  { channel: /^livenow from fox$/i, title: /$^/, sources: ['src_livenow_fox'], strict: true },
  { channel: /^rome$/i, title: /\brom(e|an|ans)\b|caesar|pompeii|gladiator|hadrian|colosseum|legion/i, strict: true },
  { channel: /greece/i, title: /\bgreek|greece|athens|sparta|alexander the great|trojan|\btroy\b|minoan|mycenae/i, strict: true },
  { channel: /^egypt$/i, title: /egypt|pharaoh|pyramid|tutankhamun|\bnile\b|cleopatra|sphinx|\bgiza\b/i, strict: true },
  { channel: /^medieval$/i, title: /medieval|middle ages|castles?\b|knights?\b|viking|norman|plantagenet|black death|crusader|anglo-saxon|\bsaxons?\b/i, strict: true },
  { channel: /victorian/i, title: /victorian|queen victoria|19th century|industrial revolution|dickens|jack the ripper/i, strict: true },
  { channel: /world war ii/i, title: /world war (ii|2|two)|\bww2\b|\bwwii\b|nazis?\b|hitler|d-day|\bblitz\b|holocaust|churchill|stalingrad|normandy|dunkirk|\b19(39|4[0-5])\b/i, sources: ['src_ww2'], strict: true },
  { channel: /cold war/i, title: /cold war|soviet|\bkgb\b|cuban missile|berlin wall|iron curtain|\bstasi\b|khrushchev|gorbachev|nuclear|korean war|vietnam|\b19(4[6-9]|[5-8]\d)\b/i, strict: true },
  { channel: /anime|manga/i, title: /\banime\b/i, sources: ['src_tms_anime', 'src_its_anime'], strict: true },
  { channel: /animation|cartoon/i, title: /animat|cartoon|puppet/i, sources: ['src_tms_anime', 'src_its_anime', 'src_glitch', 'src_clover_chaos', 'src_sesame_street'] },
  { channel: /\bkids\b|preschool|family|children|\bteen\b|young adult|saturday (cartoons|matinee)/i, title: /children|\bkids?\b|animat|cartoon|family|puppet|sesame/i, sources: ['src_sesame_street', 'src_tms_anime', 'src_its_anime'] },
  { channel: /^dance$/i, title: /ballet|\bdanc|choreograph/i, sources: ['src_royal_ballet_opera', 'src_sadlers_wells'] },
  { channel: /^circus$/i, title: /circus|acrobat|juggl|trapeze|clowns?\b/i, sources: ['src_cirque'] },
  { channel: /theatre|\bstage\b|musical|performance/i, title: /theat(re|er)|\bstage\b|\bplays?\b|playwright|opera|ballet|musical|shakespeare|actors?\b|actress|perform|dance|puppet|mime|circus|cabaret|vaudeville|pantomime/i, sources: ['src_national_theatre', 'src_shakespeares_globe', 'src_shows_must_go_on'] },
  { channel: /comedy|stand-up|sketch|sitcom|improv|^panel$/i, title: /comedy|comic|funny|laugh|humou?r|sketch|sitcom|jokes?\b/i, sources: ['src_lol_network', 'src_red_green', 'src_mst3k'] },
  { channel: /drama|detective|mystery|thriller|crime|noir/i, title: /drama|detective|mystery|murder|crime|criminal|police|thriller|noir|gangster|killer/i, sources: ['src_hollyoaks'] },
  { channel: /horror|gothic|grindhouse/i, title: /horror|monsters?\b|vampire|zombie|ghost|haunt|terror|creature|dracula|frankenstein|witch/i, sources: ['src_mst3k'] },
  { channel: /sci-fi|science fiction/i, title: /sci-?fi|science fiction|robots?\b|aliens?\b|invaders|future/i, sources: ['src_mst3k'] },
  { channel: /\bwar\b|military|world war/i, title: /\bwars?\b|wartime|military|army|navy|soldiers?|battle|troops|d-day|blitz|home guard|soviet|nuclear|\bspy\b/i, sources: ['src_ww2'] },
  { channel: /western/i, title: /western|cowboy|frontier|outlaw|sheriff/i, categories: ['film'] },
  { channel: /martial arts/i, title: /kung fu|karate|martial|samurai|sword/i, categories: ['film'] },
  { channel: /romantic|romance/i, title: /\blove\b|romance|romantic|marriage|bride|wedding/i, categories: ['film'], strict: true },
  { channel: /fantasy/i, title: /fantasy|magic|dragon|fairy|legend|myth/i },
  { channel: /disaster/i, title: /disaster|flood|earthquake|storm|wreck|catastroph/i },
  { channel: /action|adventure/i, title: /action|adventure|chase|escape|treasure|heist/i, categories: ['film'] },
  { channel: /gaming|video games|arcade|console|esports|indie games|game design|game history|^games$|software history/i, title: /\bgam(e|es|ing)\b|arcade|console|nintendo|sega|atari|playstation|xbox|video ?game/i, sources: ['src_noclip'] },
  { channel: /game shows|^quiz$|^competition$/i, title: /quiz|game show|contest|panel game/i, sources: ['src_buzzr'] },
  { channel: /^street food$/i, title: /$^/, sources: ['src_mark_wiens'], strict: true },
  { channel: /^baking$/i, title: /$^/, sources: ['src_preppy_kitchen'], strict: true },
  { channel: /^bread$/i, title: /$^/, sources: ['src_bake_with_jack'], strict: true },
  { channel: /^vegan$/i, title: /$^/, sources: ['src_rainbow_plant_life'], strict: true },
  { channel: /^barbecue$/i, title: /$^/, sources: ['src_chuds_bbq'], strict: true },
  { channel: /food|cook|kitchen|baking|bread|desserts|vegetarian|vegan|barbecue|seafood|chefs|restaurants|meals|drinks|coffee|recipe/i, title: /food|cook|recipe|kitchen|bak(e|ed|ing)|bread|chefs?\b|meals?\b|dinner|restaurant|cuisine|dish|coffee|\btea\b|wine|beer|cheese|cake/i, sources: ['src_atk'] },
  { channel: /\bmusic\b|concert|jazz|opera|songs?\b/i, title: /music|concert|songs?\b|band\b|orchestra|jazz|opera|symphony|singer|sings|guitar|piano|live on kexp|album|choir/i, sources: ['src_kexp', 'src_vevo'] },
  { channel: /^coaching$/i, title: /coach|training|drills?\b|skills|technique|how to|masterclass/i, categories: ['sport'] },
  { channel: /^tactics$/i, title: /tactic|analysis|breakdown|explained|formation|strategy/i, categories: ['sport'] },
  { channel: /^stadiums$/i, title: /stadium|arena|venue|\bground\b/i, categories: ['sport'] },
  { channel: /fitness|strength|cardio|mobility|yoga|pilates|running life|^walking$/i, title: /workout|exercise|fitness|yoga|pilates|training|stretch/i, sources: ['src_hasfit', 'src_yoga_adriene'] },
  { channel: /health|medic|anatomy|physiology|nutrition|sleep|wellbeing|mindfulness|ageing/i, title: /health|medic|doctor|hospital|nurse|disease|nutrition|sleep|brain|body|diet/i, sources: ['src_harvard_chan', 'src_hasfit', 'src_yoga_adriene', 'src_royal_institution'] },
  { channel: /craft|sewing|knitting|quilt/i, title: /craft|sew|knit|quilt|weav|pottery/i, sources: ['src_missouri_star'] },
  { channel: /antiques|collecting/i, title: /antique|collect|auction/i, sources: ['src_antiques_roadshow_pbs'] },
  { channel: /archaeolog|ancient|\brome\b|greece|egypt|medieval/i, title: /archaeolog|ancient|roman|\brome\b|greek|egypt|medieval|castle|\bdig\b|excavat|viking|saxon|celtic|iron age|bronze age|stone age|tudor|norman/i, sources: ['src_time_team'] },
  { channel: /computing|software|hardware|programming|home computers|internet history|tech history|computers?\b/i, title: /computer|software|programm|internet|digital|\bchips?\b|\btech/i, sources: ['src_chm', 'src_computerphile'] },
  { channel: /mathematics/i, title: /math|numbers?\b/i, sources: ['src_numberphile'] },
  { channel: /photography|cinematography/i, title: /photo|camera|lens|film-?making|cinematograph/i, sources: ['src_bh_photo'] },
  { channel: /travel|city breaks|road trips/i, title: /travel|tour\b|journey|visit|holiday|trip\b|guide to/i, sources: ['src_rick_steves', 'src_national_rail_scenic', 'src_lonely_planet'] },
  { channel: /wildlife|animals|natural history|nature/i, title: /wildlife|animals?\b|birds?\b|nature|\bzoo\b|fish|insect|bears?\b|lions?\b|elephants?|whales?|dogs?\b|cats?\b|horses?\b/i, sources: ['src_wild_commons'] },
  { channel: /railway|trains|steam railways|rail (journeys|travel|technology)|^stations$|trams/i, title: /rail|trains?\b|locomotive|steam|station|trams?\b/i, sources: ['src_national_rail_scenic'] },
  { channel: /\bcars?\b|automotive|motorcycles|trucks|road transport|buses|electric vehicles/i, title: /\bcars?\b|motor|automobile|vehicle|\bbus(es)?\b|lorr(y|ies)|trucks?|driving|roads?\b/i, sources: ['src_motorweek', 'src_hagerty'] },
  { channel: /maritime|sailing archive|ocean liners|marine engineering/i, title: /ships?\b|sail|boats?\b|navy|\bsea\b|harbour|liners?\b|yacht|\bport\b/i },
  { channel: /garden|plants|allotment/i, title: /garden|plants?\b|flowers?|allotment|horticult/i, sources: ['src_rhs'] },
  { channel: /engineering|construction|infrastructure|megaprojects|architecture/i, title: /engineer|bridges?|construct|building|\bdams?\b|tunnels?|skyscraper|architect/i, sources: ['src_practical_engineering', 'src_b1m'] },
  { channel: /physics|chemistry|biology|neuroscience|genetics|evolution|psychology/i, title: /science|scient|physics|chemi|biolog|experiment|research|brain|genes?\b|genetic|evolution|laboratory|atoms?\b/i, sources: ['src_royal_institution', 'src_harvard_chan'] },
]

const FILM_SOURCES = ['src_kofa', 'src_nfb', 'src_mst3k', 'src_british_pathe', 'src_rt_trailers', 'src_dw_documentary', 'src_omeleto', 'src_dust', 'src_alter', 'src_bfi']
const FEATURES = ['src_kofa', 'src_nfb']

/** Film channels: features by default, narrowed by the channel's era, region or craft. */
const FILM_RULES: Theme[] = [
  { channel: /asian|korean/i, title: /$^/, sources: ['src_kofa'] },
  { channel: /trailer/i, title: /$^/, sources: ['src_rt_trailers'] },
  { channel: /world cinema|independent|experimental/i, title: /$^/, sources: FEATURES },
  { channel: /short film/i, title: /\bshort\b/i, sources: ['src_nfb', 'src_omeleto'] },
  { channel: /documentary/i, title: /documentary/i, sources: ['src_nfb', 'src_dw_documentary'] },
  { channel: /^sci-fi cinema$/i, title: /$^/, sources: ['src_dust'] },
  { channel: /^horror$/i, title: /$^/, sources: ['src_alter'] },
  { channel: /british/i, title: /brit(ain|ish)|england|english|london|scotland|scottish|wales|welsh/i },
  { channel: /european/i, title: /europe|france|french|german|ital|spain|spanish|paris|rome|berlin/i },
  { channel: /american/i, title: /america|hollywood|\bu\.?s\.?a?\b|new york/i },
  { channel: /silent/i, title: /silent|\b19[0-2]\d\b/i },
  { channel: /classic|golden age/i, title: /\b19[0-6]\d\b/ },
  { channel: /cult|b-movies|drive-in|grindhouse|midnight movies|double feature/i, title: /$^/, sources: ['src_mst3k'] },
  { channel: /deleted & rare|cinema archive/i, title: /$^/, sources: [...FEATURES, 'src_british_pathe'] },
  { channel: /making movies|directors|actors|screenwriters|cinematography|film editing|visual effects|practical effects|film school|film essays|film reviews|movie culture|oscar stories|behind the scenes/i, title: /making of|director|actors?\b|actress|screenwrit|cinematograph|editing|visual effects|special effects|behind the scenes|film school|film-?mak|reviews?\b|oscars?\b/i },
  { channel: /^making movies$/i, title: /$^/, sources: ['src_bfi'] },
]
const TRAILER = /trailers?\b|teaser/i

/**
 * Indian Cooking (769): the title names an Indian dish or regional cuisine and is not a Western or fusion recipe.
 * Keep identical to scripts/indian_cooking_routes.py, which chooses 769's programmes with it.
 */
const NOT_INDIAN = String.raw`\b(?:pizzas?|pasta|enchiladas?|tacos?|mexican|falafel|tapas|bruschetta|(?<!milk )(?<!lentil )cakes?|cheesecakes?|mousse|cookies?|brownies?|muffins?|pies?|lemonade|krispies|baklava|scalloped|sandwich(?:es)?|burgers?|tofu|bowls?|noodles|avocado|jalapenos?|ricotta|tots|fusion|truffles?)\b`
const INDIAN_DISH = String.raw`\b(?:indian|punjabi|gujarati|rajasthani|maharashtrian|bengali|hyderabadi|sindhi|bihari|mumbai|kashmiri|samosas?|parathas?|paranthas?|puris?|poori|kachori|chaat|chat|dal|daal|dosas?|idli|uttapam|vadas?|wada|pakoras?|pakoda|bhaji|pav|naan|roti|kulcha|bhatura|battura|chole|chana|rajma|paneer|kofta|korma|biryani|briyani|pulao|khichdi|kadhi|sambar|rasam|chutney|raita|halwa|burfi|barfi|ladoo|laddu|peda|jalebi|jamun|rasgulla|ras ?malai|kheer|phirni|kulfi|falooda|malpua|gujiy?a|kalakand|mithai|chum chum|cham cham|mathri|namak (?:para|pare|paare)|shakk?ar para|gur para|chakli|chivda|poha|bhel|dhokla|muthia|khandvi|thepla|bhakarwadi|litti|chokha|sabzi|sabji|aloo|alu|gobi|gobhi|matt?ar|palak|methi|bhindi|baingan|bharta|karela|arbi|saag|masala|tikki|tikka|makhani|makhana|thandai|lassi|panjiri|mohan thal|puran poli|khaja|chiroti|frankie|kathi|upma|sheera|sooji|suji|rava|besan|nimki|namkeen|gatte|dahi|chawal|cheela|curry|kokum|shakar kandi|sev|boondi|balu ?shahi|handvo|modak)\b`
export const INDIAN_COOKING_TITLE = new RegExp(`^(?!.*${NOT_INDIAN}).*${INDIAN_DISH}`, 'i')

/**
 * Subject channels whose name alone is ambiguous ("\bcat" matches Catching, Cathedral, Catskinner). The title must
 * be about the subject for every source, dedicated or not. Cats means domestic cats: not big cats, the musical,
 * Cat's Eye, Doja Cat, "Save the Cat" or cat-shaped antiques. Fortnite means programmes about Fortnite, not news
 * round-ups or titles that only mention it. Indian Cooking means Indian dishes, not every recipe a cook publishes.
 */
export const SUBJECT_TITLES: readonly { channel: RegExp; title: RegExp }[] = [
  {
    channel: /^cats$/i,
    title: /^(?!.*(?:\bbig cats?\b|\bwild cats?\b|\b(?:lions?|tigers?|leopards?|jaguars?|cheetahs?|cougars?|pumas?|lynx|ocelots?|langurs?|servals?|pallas'?s cat)\b|\btiger cub|cats the musical|cats musical|\bcats\s*\(19|jellicle|cat'?s eye|doja cat|save the cat|cat in the hat|cat'?s meow|\bbronze\b|figurines?|porcelain|appraisal|\bca\. ?1\d{3}\b)).*\b(?:cats?|kittens?|kitty|kitties|felines?)\b/i,
  },
  { channel: /^indian cooking$/i, title: INDIAN_COOKING_TITLE },
  { channel: /^fortnite$/i, title: /^(?!.*(?:\band more\b|\bnews\b|fortnite kid|fortnite\?|\bfrom fortnite\b)).*\bfortnite\b/i },
]

function decadeTitle(name: string): RegExp | undefined {
  const decade = /\b(19|20)(\d)0s\b/.exec(name)
  return decade ? new RegExp(`\\b${decade[1]}${decade[2]}\\d\\b`) : undefined
}

const GENERIC_MUSIC = /^(music|music tv|live music|live|concerts|sessions|unplugged|festivals|new music|artists|bands|songwriters|acoustic|cover versions|rare tracks)$/i
const KEXP_MUSIC = /^(alternative|indie|indie sessions|unsigned)$/i
const VEVO_MUSIC = /^(chart|vevo|vevo pop|vevo discover|vevo live & performance|retro hits)$/i
/** Genre channels whose own publisher needs no genre word in every title. */
const GENRE_SOURCES: Record<string, string[]> = {
  jazz: ['src_jalc'],
  classical: ['src_hr_symphony'],
  opera: ['src_operavision'],
  country: ['src_opry'],
  rock: ['src_rockpalast'],
  soul: ['src_soul_train'],
  electronic: ['src_cercle'],
  reggae: ['src_vp_records'],
  'dj sets': ['src_boiler_room'],
}
const MUSIC_FILLER = new Set(['music', 'vevo', 'radio', 'and', 'the', '&'])
const NAME_FILLER = new Set(['and', 'the', '&', 'tv', 'extra', 'today', 'archive'])

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Words of a channel name, as a title pattern. */
function namePattern(name: string): RegExp {
  const words = name.toLowerCase().split(/[\s/]+/).filter((word) => word.length > 2 && !NAME_FILLER.has(word))
  if (!words.length) return /$^/
  return new RegExp(words.map((word) => `\\b${escape(word.replace(/(ies|s)$/, ''))}`).join('|'), 'i')
}

/** A genre, decade or instrument music channel needs that word in the title. */
function musicTheme(name: string): Theme {
  const sources = GENERIC_MUSIC.test(name) ? ['src_kexp', 'src_vevo'] : KEXP_MUSIC.test(name) ? ['src_kexp'] : VEVO_MUSIC.test(name) ? ['src_vevo'] : GENRE_SOURCES[name.toLowerCase()] ?? []
  const words = name.toLowerCase().split(/[\s/]+/).filter((word) => word && !MUSIC_FILLER.has(word))
  const patterns = words.map((word) => {
    const decade = /^(?:19|20)?(\d)0s$/.exec(word) ?? /^(\d)0$/.exec(word)
    if (decade) return `\\b(19|20)?${decade[1]}0'?s\\b|\\b(19|20)${decade[1]}\\d\\b`
    if (/^\d+$/.test(word)) return `\\b(19)?${word}\\b`
    if (word === 'hip-hop') return 'hip[\\s-]?hop|\\brap\\b'
    return `\\b${escape(word.replace(/s$/, ''))}`
  })
  return { channel: /./, title: patterns.length ? new RegExp(patterns.join('|'), 'i') : /$^/, sources }
}

interface ChannelFit {
  name: string
  category: string
  words: RegExp
  closed: boolean
  /** Live and webcam channels; a recording would pass itself off as live. */
  liveOnly: boolean
  /** Every pattern must match the title (trailers, decades). */
  must: RegExp[]
  /** Film channels take only film publishers. */
  sources?: Set<string>
  /** undefined: not a sport channel. Empty set: any sport. */
  sports?: Set<string>
  themes: Theme[]
}

const channelFits = new Map<number, ChannelFit>()

function channelFit(channelNumber: number): ChannelFit {
  const cached = channelFits.get(channelNumber)
  if (cached) return cached
  const channel = canonicalByNumber(channelNumber)
  const name = channel?.name ?? ''
  const category = channel?.category ?? ''
  const liveOnly = category === 'webcams' || (/\blive$/i.test(name) && (category === 'sport' || category === 'news'))
  const fit: ChannelFit = { name, category, words: namePattern(name), closed: CLOSED_CHANNEL.test(name) || excludedChannelName(name), liveOnly, must: [], themes: [] }
  const keys = new Set<string>()
  if (/fight|combat/i.test(name)) COMBAT.forEach((key) => keys.add(key))
  else if (/outdoor sport|adventure sport/i.test(name)) OUTDOOR.forEach((key) => keys.add(key))
  else {
    const specific = SPORTS.find((sport) => sport.channel.test(name))
    if (specific) keys.add(specific.key)
  }
  let themes = category === 'music'
    ? [musicTheme(name)]
    : THEMES.filter((theme) => theme.channel.test(name) && (!theme.categories || theme.categories.includes(category)))
  if (category === 'film') {
    const film = [...themes, ...FILM_RULES.filter((rule) => rule.channel.test(name))]
      .map((theme) => ({ ...theme, sources: theme.sources?.filter((source) => FILM_SOURCES.includes(source)) }))
    themes = film.length ? film : [{ channel: /./, title: /$^/, sources: FEATURES }]
    fit.sources = new Set([...FEATURES, 'src_mst3k', ...themes.flatMap((theme) => theme.sources ?? [])])
    const decade = decadeTitle(name)
    if (/trailer/i.test(name)) fit.must.push(TRAILER)
    if (decade) fit.must.push(decade)
  }
  for (const subject of SUBJECT_TITLES) {
    if (!subject.channel.test(name)) continue
    fit.must.push(subject.title)
    themes = [{ channel: subject.channel, title: subject.title, strict: true }]
  }
  const strict = themes.find((theme) => theme.strict)
  const sportTopic = themes.filter((theme) => theme.categories?.includes('sport'))
  if (keys.size) fit.sports = keys
  else if (sportTopic.length) {
    fit.sports = new Set()
    fit.themes = sportTopic
  } else if (category === 'sport' && !themes.length) fit.sports = new Set()
  else if (/\bsports?\b|olympic|great matches|great athletes/i.test(name) && !themes.length) fit.sports = new Set()
  else fit.themes = strict ? [strict] : themes
  if (HOME_ONLY_CHANNELS.has(channelNumber)) fit.sources = new Set()
  channelFits.set(channelNumber, fit)
  return fit
}

interface ProgrammeFit {
  blocked: boolean
  feed?: string
  sports: Set<string>
  source: string
  title: string
}

const programmeFits = new WeakMap<MediaItem, ProgrammeFit>()

function programmeFit(item: MediaItem): ProgrammeFit {
  const cached = programmeFits.get(item)
  if (cached) return cached
  const source = (item as { sourceId?: string }).sourceId ?? ''
  const title = item.title ?? ''
  const feed = SPORT_FEEDS.get(source)
  const sports = new Set<string>(feed ? [feed] : [])
  if (item.sport) sports.add(item.sport)
  for (const sport of SPORTS) if (sport.title.test(title)) sports.add(sport.key)
  const fit: ProgrammeFit = { blocked: BLOCKED.test(title) || excludedProgramme(item), feed, sports, source, title }
  programmeFits.set(item, fit)
  return fit
}

export interface ChannelFitSummary {
  closed: boolean
  liveOnly: boolean
  owner?: string
  /** Film channels: publishers allowed at all. */
  filmSources?: string[]
  /** undefined: not a sport channel; empty: any sport. */
  sports?: string[]
  mustMatch: string[]
  themes: { title: string; sources: string[]; strict: boolean }[]
  /** Single-subject publishers whose home includes this channel. */
  homeFeeds: string[]
  general: boolean
}

/** The channel's eligibility rules, for manifests and diagnostics. */
export function channelFitSummary(channelNumber: number): ChannelFitSummary {
  const fit = channelFit(channelNumber)
  return {
    closed: fit.closed,
    liveOnly: fit.liveOnly,
    owner: [...OWNED_SOURCES].find(([, number]) => number === channelNumber)?.[0],
    filmSources: fit.sources ? [...fit.sources] : undefined,
    sports: fit.sports ? [...fit.sports] : undefined,
    mustMatch: fit.must.map((pattern) => pattern.source),
    themes: fit.themes.map((theme) => ({ title: theme.title.source, sources: theme.sources ?? [], strict: Boolean(theme.strict) })),
    homeFeeds: [
      ...FEEDS.filter((feed) => !feed.general && feed.channel.test(fit.name)).flatMap((feed) => feed.sources),
      ...Object.entries(DEDICATED).filter(([, homes]) => homes.includes(channelNumber)).map(([source]) => source),
    ],
    general: GENERAL.test(fit.name),
  }
}

/** Channels whose subject the network excludes; they never carry programming. */
export function isClosedChannel(channelNumber: number): boolean {
  return channelFit(channelNumber).closed
}

/** General entertainment channels are deliberate mixes; they may share inventory with specialist channels. */
export function isGeneralChannel(channelNumber: number): boolean {
  return GENERAL.test(channelFit(channelNumber).name)
}

/** The channel's own name as a title pattern, used to narrow a channel that duplicates another. */
export function channelNameMatches(item: MediaItem, channelNumber: number): boolean {
  return channelFit(channelNumber).words.test(item.title ?? '')
}

/** The channel's identity names this publisher as its own: an owned source, or a sport, theme or film rule's native source. */
export function isNativeSource(sourceId: string, channelNumber: number): boolean {
  if (OWNED_SOURCES.get(sourceId) === channelNumber || DEDICATED[sourceId]?.includes(channelNumber)) return true
  const { name, category } = channelFit(channelNumber)
  if (category === 'music' && (musicTheme(name).sources ?? []).includes(sourceId)) return true
  return [...SPORTS, ...THEMES, ...FILM_RULES].some((rule) => rule.channel.test(name) && (rule.sources ?? []).includes(sourceId))
}

/** A publisher acquired for this channel: an owned or dedicated source. */
export function isDedicatedSource(sourceId: string, channelNumber: number): boolean {
  if (OWNED_SOURCES.get(sourceId) === channelNumber) return true
  return Boolean(DEDICATED[sourceId]?.includes(channelNumber))
}

/** Whether a routed programme belongs on this channel. Unthemed, broad channels accept any non-sport feed. */
export function programmeSuitsChannel(item: MediaItem, channelNumber: number): boolean {
  const routed = item as { sourceId?: string; userEditedMetadata?: string[] }
  if (!routed.sourceId?.startsWith('src_') || routed.userEditedMetadata?.includes('explicitChannelIncludes')) return true
  const programme = programmeFit(item)
  if (programme.blocked) return false
  const owner = OWNED_SOURCES.get(programme.source)
  if (owner !== undefined || OWNER_CHANNELS.has(channelNumber)) return owner === channelNumber
  const channel = channelFit(channelNumber)
  if (channel.closed) return false
  if (channel.liveOnly && item.playbackKind !== 'live' && !item.live) return false
  if (item.eraChannels?.includes(channelNumber)) return true
  if (item.genreChannels?.includes(channelNumber) && FILM_GENRE_SOURCES.has(programme.source)) return true
  if (item.curatedChannels?.includes(channelNumber) && PROGRAMME_REUSE[channelNumber]?.includes(programme.source)) return true
  if (channel.must.some((pattern) => !pattern.test(programme.title))) return false
  const homes = DEDICATED[programme.source]
  if (homes) return homes.includes(channelNumber)
  if (item.curatedChannels?.includes(channelNumber)) return true
  if (channel.sources && !channel.sources.has(programme.source)) return false
  if (channel.sports) {
    if (programme.feed && !feedAllows(programme.source, channel)) return false
    if (channel.sports.size === 0) {
      return programme.sports.size > 0 && (!channel.themes.length || channel.themes.some((theme) => theme.title.test(programme.title)))
    }
    if (programme.feed) return channel.sports.has(programme.feed)
    return [...programme.sports].some((key) => channel.sports!.has(key))
  }
  if (programme.feed) return false
  if (!feedAllows(programme.source, channel)) return false
  const inherited = !item.explicitChannelIncludes?.includes(channelNumber)
  if (!channel.themes.length) return !inherited || GENERAL.test(channel.name) || channel.words.test(programme.title)
  return channel.themes.some((theme) => theme.sources?.includes(programme.source) || theme.title.test(programme.title))
}
