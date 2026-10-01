import type { ProgrammeType } from '../../types/programme.ts'

/**
 * Default-network inventory.
 * Every playable id was confirmed on 26 Sep 2026 with YouTube oEmbed
 * (title and author) and the public watch-page duration. Ids that failed
 * that check are not listed. Placeholder sources have no ids.
 */
export interface NetworkSourceDefinition {
  id: string
  provider: 'youtube'
  sourceKind: 'channel' | 'collection'
  displayName: string
  publisher: string
  verifiedOfficial: true | 'unknown'
  enabled: boolean
  categories: string[]
  notes: string
}

export interface NetworkVideoDefinition {
  videoId: string
  title: string
  durationSeconds: number
  author: string
  sourceId: string
  programmeType: ProgrammeType
  subjects: string[]
  topics: string[]
  year?: number
  sport?: string
  teams?: string[]
  /** Confirmed against the public player. Never a guessed id. */
  verified: true
}

export const NETWORK_SOURCES: readonly NetworkSourceDefinition[] = [
  {
    id: 'network:blender',
    provider: 'youtube',
    sourceKind: 'channel',
    displayName: 'Blender open movies',
    publisher: 'Blender',
    verifiedOfficial: true,
    enabled: false,
    categories: ['film', 'animation', 'comedy'],
    notes: 'Removed from ordinary TVN programming. The test card does not use this list.',
  },
  {
    id: 'network:public-domain',
    provider: 'youtube',
    sourceKind: 'channel',
    displayName: 'Public Domain Archive',
    publisher: 'Public Domain Archive',
    verifiedOfficial: 'unknown',
    enabled: false,
    categories: ['film', 'music', 'literature', 'sport'],
    notes: 'Removed from ordinary TVN programming. No replacement inventory was added.',
  },
  {
    id: 'network:football',
    provider: 'youtube',
    sourceKind: 'collection',
    displayName: 'Football',
    publisher: '',
    verifiedOfficial: 'unknown',
    enabled: false,
    categories: ['football'],
    notes: 'No verified match film is configured.',
  },
  {
    id: 'network:nineties',
    provider: 'youtube',
    sourceKind: 'collection',
    displayName: '1990s music',
    publisher: '',
    verifiedOfficial: 'unknown',
    enabled: false,
    categories: ['1990s', 'music'],
    notes: 'No verified 1990s music video is configured.',
  },
  {
    id: 'network:gaming',
    provider: 'youtube',
    sourceKind: 'collection',
    displayName: 'Gaming',
    publisher: '',
    verifiedOfficial: 'unknown',
    enabled: false,
    categories: ['gaming'],
    notes: 'No verified gaming programme is configured.',
  },
]

const blender = 'network:blender'
const domain = 'network:public-domain'

export const NETWORK_VIDEOS: readonly NetworkVideoDefinition[] = [
  video('eRsGyueVLvQ', 'Sintel - Open Movie by Blender Foundation', 888, 'Blender', blender, 'film', ['animation'], 2010),
  video('41hv2tW5Lc4', 'Tears of Steel - 4k version (in HD) - Blender Foundation channel', 734, 'Blender', blender, 'film', ['animation'], 2012),
  video('Y-rmzh0PI3c', 'Cosmos Laundromat - First Cycle. Official Blender Foundation release.', 731, 'Blender', blender, 'film', ['animation', 'comedy'], 2015),
  video('TLkA0RELQ1g', 'Elephants Dream', 654, 'Blender', blender, 'film', ['animation'], 2006),
  video('aqz-KE-bpKQ', 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film', 635, 'Blender', blender, 'film', ['animation', 'comedy'], 2008),
  video('_cMxraX_5RE', 'Sprite Fright - Blender Open Movie', 630, 'Blender Studio', blender, 'film', ['animation', 'horror', 'comedy'], 2021),
  video('YE7VzlLtp-4', 'Big Buck Bunny', 597, 'Blender', blender, 'film', ['animation', 'comedy'], 2008),
  video('WhWc3b3KhnY', 'Spring - Blender Open Movie', 464, 'Blender Studio', blender, 'short', ['animation', 'comedy'], 2019),
  video('l5OZu-IrXpw', 'SINGULARITY - Painterly Space Adventure', 391, 'Blender Studio', blender, 'short', ['animation']),
  video('UXqq0ZvbOnk', 'CHARGE - Blender Open Movie', 263, 'Blender Studio', blender, 'short', ['animation', 'comedy']),
  video('nV_awXI9XJY', 'Project Gold - Blender Stylized Rendering Showcase', 260, 'Blender Studio', blender, 'short', ['animation']),
  video('u9lj-c29dxI', 'WING IT! - Blender Open Movie', 238, 'Blender Studio', blender, 'short', ['animation', 'comedy']),
  video('mN0zPOpADL4', 'Agent 327: Operation Barbershop', 232, 'Blender Studio', blender, 'short', ['animation', 'comedy'], 2017),
  video('lqiN98z6Dak', 'Glass Half - Blender animated cartoon', 193, 'Blender', blender, 'short', ['animation', 'comedy'], 2015),
  video('PVGeM40dABA', 'Coffee Run - Blender Open Movie', 185, 'Blender Studio', blender, 'short', ['animation', 'comedy'], 2021),
  video('SkVqJ1SGeL0', 'Caminandes 3: Llamigos', 150, 'Blender', blender, 'short', ['animation', 'comedy'], 2016),
  video('Z4C82eyhwgU', '"Caminandes 2: Gran Dillama" - Blender Animated Short', 146, 'Blender', blender, 'short', ['animation', 'comedy'], 2013),
  video('39h7ZJbRcsw', 'OVERGROWN - Blender Feature Film (Teaser)', 81, 'Blender Studio', blender, 'trailer', ['animation']),
  video('Va737i4e5T0', '1968: Night Of The Living Dead', 5526, 'Public Domain Archive', domain, 'film', ['horror', 'classic'], 1968),
  video('v9V6fT3-vXk', '1952: Invasion U.S.A.', 4406, 'Public Domain Archive', domain, 'film', ['classic'], 1952),
  video('tyiSw0bmVE8', '1924: The Navigator', 3601, 'Public Domain Archive', domain, 'film', ['classic', 'comedy'], 1924),
  video('EKX4HIevW6A', '1936: Max Schmeling vs Joe Louis, First meeting', 1868, 'Public Domain Archive', domain, 'classic-match', ['boxing'], 1936, 'boxing', ['Max Schmeling', 'Joe Louis']),
  video('7SRkYuIMdnM', '1956: Mr B. Natural', 1572, 'Public Domain Archive', domain, 'film', ['classic'], 1956),
  video('rZnfurVWGQw', '1955: Boy with a Knife', 1223, 'Public Domain Archive', domain, 'film', ['classic'], 1955),
  video('EXb2RrBoedM', '1909: Mazeppa', 924, 'Public Domain Archive', domain, 'film', ['classic'], 1909),
  video('bMMuEHqoLPI', '1922: Little Red Riding Hood', 474, 'Public Domain Archive', domain, 'short', ['animation', 'classic'], 1922),
  video('DRtFxthf9j0', 'Daffy Duck and the Dinosaur', 441, 'Public Domain Archive', domain, 'short', ['animation', 'comedy', 'classic']),
  video('443HrUcbExc', "1915: Rudyard Kipling's Boots read by Taylor Holmes", 186, 'Public Domain Archive', domain, 'short', ['literature', 'culture'], 1915),
  video('IVvhT6aSMj0', '1923: Yes! We have no Bananas, performed by Billy Jones', 173, 'Public Domain Archive', domain, 'music', ['music'], 1923),
  video('k3nzXp2ysx8', '1923: Yes! We have no Bananas, by Eddie Furman and William Nash', 171, 'Public Domain Archive', domain, 'music', ['music'], 1923),
  video('5VNClhi-hXU', '1921: A Dance of Clowns', 171, 'Public Domain Archive', domain, 'short', ['classic'], 1921),
  video('8CH3gZ9_vac', '1921: Hail Chicago!', 173, 'Public Domain Archive', domain, 'short', ['classic'], 1921),
  video('5aF6U6x8Pzg', "1916: Farmer Alfalfa's Revenge", 163, 'Public Domain Archive', domain, 'short', ['animation', 'comedy'], 1916),
  video('bsMi1JBYAco', '1961: The Creature from the Haunted Sea trailer', 93, 'Public Domain Archive', domain, 'trailer', ['horror', 'classic'], 1961),
]

function video(
  videoId: string,
  title: string,
  durationSeconds: number,
  author: string,
  sourceId: string,
  programmeType: ProgrammeType,
  topics: string[],
  year?: number,
  sport?: string,
  teams?: string[],
): NetworkVideoDefinition {
  return {
    videoId,
    title,
    durationSeconds,
    author,
    sourceId,
    programmeType,
    subjects: topics,
    topics,
    year,
    sport,
    teams,
    verified: true,
  }
}
