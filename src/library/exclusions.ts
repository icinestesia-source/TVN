/**
 * Factual space, aviation and religious programming never airs on 000–999. The title pattern catches the
 * recurring phrasing, including rolling feeds; the reviewed list pins programmes whose titles are
 * ambiguous on their own ("black hole", "Red Planet", "Silent Night") and which share wording with
 * fiction, songs or trailers that remain permitted. Reviewed items: docs/catalogue-audit-v43.md.
 */
const TITLE = new RegExp(
  [
    '\\b(',
    'space[\\s-]race|spaceflight|space[\\s-]flight|astronomy|astronomer|cosmology|nasa|astronauts?|satellites?|',
    'solar[\\s-]system|outer[\\s-]space|milky[\\s-]way|from space|earth from space|',
    'astrophysic\\w*|astrobiolog\\w*|cosmologists?|cosmic inflation|galactic cosmic|dark energy|exoplanets?|',
    'extraterrestrial life|life on another planet|planets beyond our sun|exploration of the planets|',
    'mars exploration|living on mars|coloni[sz]ing mars|apollo program(me)?|re-?entry engineering|',
    'eclipse of the sun|chasing eclipses|space travel|deep space exploration|astronautical|',
    'space (industry|economy|agency|tourism|start-?ups?|firms?|programs?|programmes?|weather|missions?|',
    'exploration|month|disasters?|firsts|pioneers?|pilots?|foods?|farmers?|camp|orbit)|',
    'origins? of the universe|end of the universe|universe (began|come from)|made our universe|',
    'sermon|worship service|bible study|quran|faith[\\s-]based|faith movie|christian drama|',
    "nun'?s life|wants to be a nun|living with \\w+ monks|stayed with monks|",
    'hot[\\s-]air balloons?|paraglid\\w*|flying cars?|air cargo|air superiority|air war|kamikaze pilots?|',
    'dam ?busters|hindenburg disaster|red baron|supersonic (jets?|fighters?|age)|fighter aces?|zero fighter|',
    'airline industry|economics of airlines|cabin crew|test pilots|airborne division|jet suits?|',
    'drone (warriors|unit|company|delivery)|diy drones?',
    ')\\b',
  ].join(''),
  'i',
)

export const REVIEWED_EXCLUSIONS: ReadonlySet<string> = new Set([
  // Space, astronomy, spaceflight
  'roM1QPr8lNo', '4t8CJGnViNY', '3k5R3_b4eDU', 'zju1nq3Eoqo', '2Ye-1VOeCgs', '861coSFLOvk', 'tKfxjeLVBCA',
  'PLc0BCjbFcg', '0Xkr3IGEpsk', 'X__kbLv25uU', 'ZmkHQ9zNm8k', 'BiwhCucM470', 'vIHKUB0QmA4', '5X7vqLYoE_s',
  'jXIeywVd4KM', 'IF4UhElRUFg', 'AJt2mhwUlq4', 'V3FWWwuTlVM', 'B4duk3RiQzA', 'GFxPMMkhHuA', 'aom5SiHakGM',
  'vU-g6mC1F0g', 'lpj0E0a0mlU', 'L_a16VNCmg4', 'p6cIzpEZWLQ', 'mTdjZG-eiak', 'ZtvG4davmbQ', 'esCRnu8B1JU',
  'dZzY8-nxabA', '_ds8_IFDp1o', 'G4iEE9KhdBc', 'vBEMdGs-5B8', 'g1MYNuH8rBQ', 'vS0ob0_byb4', '9fUmxvzLoE4',
  '0ay7qoz2FD4', 'CABR_V1t1Ps', '8TndKZgrrNQ', 'c6r-sfm-okY', 'DvGAb-OycL4', 'W8wZ3ISBSUU', 'oW54Ub2kDTE',
  'z-CjrZfbthg', 'peUyizgG-mM', '19pcpcqQG3k', 'IP4m6ibriKo', '70dK0LyXu-0', 'A9JDkiYEhfY', 'VzcNPKTrC90',
  'qTulYqP6vkI', 'Cu8peMBN0fM', '4A95t8BJNtI', 'QHVAERH4yzc', 'Z9KAIm6zUQk', 'w5LCl2SRbkM', 'iJQdny3-T2Q',
  'W9olSzNOh8s', '3jT_Zui1Am8', 'ii1aMY-vU70', 'APOT0GqtJXI', '_2rkRDg0d60', '9gpjRy3uDUM', '9TVCs9Zv4TE',
  '9_C5RTTKOw8', '4mmlKLmF99A', 'nXrCtC-KYCc', 'QJKc4WsIkvw', '7spe1FBlLYQ', 'lBAElIfmlLk', '55Jas5HrzcQ',
  '1gNCT1lAlBw', 'hDQefy5WADM', 'YWhMCXo4lkQ',
  // Religious programming, worship music and devotional drama
  'CA9Byt_aQk4', '10agmU9yHWU', 'PijTERClaEk', '9QL07ep7HA0', 'RoibU3gpNVI', 'L9sMmGRqemQ', 'fpKPyaqPLoI',
  'ZTFWvOKvOcM', 'eRr6bBiUrLE', 'y5Ru2p4C31Y', 'HfRadOSj2qU', 'GRB0AIpg4rs', '1_NiGHa8-Lg', 'G_QsXaTWyqE',
  'uZDjA619EyI', 'nn4ZrO7WO8k', 'iSJoOKxt0Hs', 'Vq7Ld-2BDiI', 'CimQOh-1DqM', '_EX--pCuNdk',
  '0Oq3iHJF15c', 'JOWFPTzK7D4', '0dZnBQfe2D8', '0NMbU7I8YP4', '3p3xHVnK5o4', 'FEzqUxT8ALc', 'L--UxAClJGY',
  'zx2yjuGwbt4', '7A_KV5XB0Ys', 'EhL4ahkP00w', 'DZyZm5XgDhc', 'BZdsIti3lfo', '_yY4BnPMTNk', 'FsjGoEFYXCc',
  '1pv3FNLTVhw',
  // Aircraft, aviation, airlines and air warfare
  'zEvgbpQgNnE', 'ZvbQMqd0kEY', 'sohuixlaowU', 'HTs7h3rR7DU', 'QzS2_AFvR6E', 'byAj35QlGbs', 'M1KFg6edqro',
  'eSm93rME8Rs', 'MvmfyO8GvTE', 'SjTOVR339Ck', 'XTh6-7A9BEk', 'Oi6cmg2RoLk', 'rslcr774JXM', '6se8TltCOoc',
  'Dba1RqmzOjo', 'OWZ9HgLckrQ', 'ZEdUqn-Yudo', 'yXlKVghVQbo', 'umzta3uraoA', 'A2_Z9rZUjVw', 'PAn61yU-wG0',
  'ZVVEym0suvc', '0ef0vmx0Bow', 'b7YgXassC3c', 'zs5cQ6b_ZeY', 'mP-E6IfsndE', 'eGtKK0oxj2M', 'JrWb9jj3IsU',
  'ZJqY1WLX4zA', 'PHDnZtFElK8', 'p9eSogiYNJ8', 'UPGqUza0H58', 'hVoRXdcCOjw', 'ifI_fwg55k8', 'NuvV4RlGuRE',
  'oDsk173y7Tk', 'cV6uyuTWMaA', 'W6dsLthcvzU', 'UiHFtubW4JM', 'DeSDjjicGWY', '3dArEoLOvzI', 'WvvBm5gZoy4',
  'NKAS96UPeJs', '0yOvHz60HaQ', 'J05Wywg5cy0', 'cMoI_RPf0rw', 'F8LTifOiISM', '70JnwZLArK8', '3lWWH1zfl38',
  'KqSG8_2KbDg', 'WSQOz5vTvZw', '0ijSSikbkrM', 'd1gSW9VgyEs', 'YsT_7sums4M', '7SpRXU3RJ7Q', 'g0reauv6c-g',
  '6rzjqLTxjsk', 'r2oPk20OHBE', 'U0IlVEaxWVY', 'c1cy9olnvsQ', '8vQYn7IDzvo', 'Dlr_HNasxZY', 'yn9huAoV3R0',
  '0bSo4SVl2JQ', 'pkT48OTGaSs', 'c9AZk-4n7Ns', 'y_kuN4EdvOo', 'T9p42wOyf0Y', 'IB-Jwys_KjE',
  // British Pathé, Movietone, AP and travel-film aviation newsreels
  'B5PNp_RvqKo', 'z_toVuwZdD8', 'VSLWy0qvTSE', 'di48OrjTf10', 'uvEF9zu21XE', 'S1k6C8T8yEo', 'yfTcZSzjvUs',
  '6TLhaEg8IO8', 'wTNWpy7m4ww', 'vaO7fiO41wQ', 'zWyxLWf1d90', 'WvGxmTEu6kg', 'n4w7YaAWoCY', 'jr7oBRf19Zw',
  'KwNAkagDuKQ', 'VTgFetAh6tg', '-F3jq2EugvM', 'Vnbljjwt-aU', '0Z3vdFDSKN8', 's-Jf8Y1HUp4', 'sz6YlqrqIgI',
  'n23XaBZPEMg', 'o0O7tkAqYTs', 'WwxsBPtRy8U', '9t4PAFAGXsc', '1bTAmI87zw0', '-dJ3-0YDLo8', 'JsVdOdtNI1Q',
  'fURATK5Yt30', 'LV__lltmsys', 'J-X729bTi6Y', 'BAlbuc06dcs', 'sTu_usbmL_I', 't_5-VFd-41I', 'uwo5uqOywFI',
  'NPeh5luV2FM', 'swuHFQPkJpc', '1mpwbTSdLpE', 'IbpcxRrj1YY', 'JFwzMvFJYik',
])

/** Channel identities about an excluded subject that the director's closed-channel pattern does not name. */
const CHANNEL = /\bflight deck\b/i

export function excludedChannelName(name: string): boolean {
  return CHANNEL.test(name)
}

export function excludedTitle(title: string | undefined): boolean {
  return TITLE.test(title ?? '')
}

export function excludedProgramme(item: { title?: string; externalId?: string | null; videoId?: string | null }): boolean {
  const id = item.externalId ?? item.videoId
  return Boolean(id && REVIEWED_EXCLUSIONS.has(id)) || excludedTitle(item.title)
}
