import type { Channel } from '../types/channel.ts'
import type { MediaKind, Programme, ProgrammeKind, ProgrammeType } from '../types/programme.ts'
import { reconcileWithCanonical } from './reconcile.ts'
import { categoryIdFor } from './network.ts'
import { isOnAir } from '../network/airing.ts'
import { curatedEditList, curatedProgrammesFor, userChannelList, userProgrammesFor } from './user-overlay.ts'
import { DEMO_FILMS } from './media.ts'
import { SESSION_CHANNEL, sessionProgrammes } from '../session/session-channel.ts'

interface Seed {
  number: number
  name: string
  shortName: string
  category: string
  description: string
  picture: boolean
  series?: string
  titles: string[]
  minutes: number[]
  kinds?: ProgrammeKind[]
  years?: number[]
  mediaKind?: MediaKind
  programmeType?: ProgrammeType
}

const PALETTE = [
  '#1d4e89',
  '#0f5f5a',
  '#6b3f1d',
  '#3d4c1e',
  '#5c2d4a',
  '#1e3d6e',
  '#7a2e2e',
  '#2c4a3e',
  '#4a3f1f',
  '#243e63',
  '#3e4a22',
  '#5a3a28',
]

function seed(
  number: number,
  name: string,
  shortName: string,
  category: string,
  description: string,
  titles: string[],
  minutes: number[],
  options?: {
    picture?: boolean
    series?: string
    kinds?: ProgrammeKind[]
    years?: number[]
    mediaKind?: MediaKind
    programmeType?: ProgrammeType
  },
): Seed {
  return {
    number,
    name,
    shortName,
    category,
    description,
    picture: options?.picture ?? true,
    series: options?.series,
    titles,
    minutes,
    kinds: options?.kinds,
    years: options?.years,
    mediaKind: options?.mediaKind,
    programmeType: options?.programmeType,
  }
}

const OPENERS: Array<(title: string, category: string) => string> = [
  (title, category) => `${title} is on the ${category.toLowerCase()} schedule.`,
  (title) => `This listing is ${title}.`,
  (title, category) => `${title} holds its usual place on ${category.toLowerCase()}.`,
  (title) => `The channel continues with ${title}.`,
]

function describe(category: string, title: string, minutes: number, index: number): string {
  const opener = OPENERS[index % OPENERS.length](title, category)
  const length =
    minutes >= 75
      ? 'It runs long enough to carry an evening.'
      : minutes <= 8
        ? 'It is a short junction between longer programmes.'
        : 'The duration is fixed, so the station stays in step with the clock.'
  return `${opener} ${length}`
}

function logoFor(shortName: string): string {
  const compact = shortName.replace(/[^A-Za-z0-9]/g, '')
  return compact.slice(0, 2).toUpperCase()
}

/**
 * Original demonstration listings. These are not taken from any broadcaster
 * or from another virtual-television service.
 */
const SEEDS: Seed[] = [
  seed(1, 'World News', 'WORLD', 'News', 'Continuous international headlines and desk briefings.', ['The Day So Far', 'Desk Briefing', 'Correspondence', 'Headline Cycle', 'Regional Roundup', 'Night Lead', 'Wire Check'], [30, 15, 22, 8, 28, 45, 12]),
  seed(2, 'UK News', 'UK NEWS', 'News', 'Domestic bulletins, politics, and a late desk.', ['Morning Bulletin', 'Westminster Hour', 'Nations and Regions', 'Lunchtime Desk', 'Six at the Hour', 'Late Politics', 'Paper Review'], [25, 40, 18, 12, 30, 50, 15]),
  seed(3, 'Current Affairs', 'AFFAIRS', 'News', 'Reported programmes and studio discussions.', ['The Long Interview', 'Briefing Room', 'Field Report', 'Counterpoint', 'Notebook', 'Open Desk', 'Sunday Essay'], [48, 24, 36, 52, 16, 28, 44]),
  seed(4, 'Documentaries', 'DOCS', 'Documentary', 'Single films and short observed pieces.', ['Harbour Winter', 'The Night Shift', 'Paper Town', 'A Year on the Line', 'Classroom', 'After the Fair', 'Low Tide'], [58, 26, 74, 42, 18, 63, 33]),
  seed(5, 'History', 'HISTORY', 'History', 'Narrative history from the last few centuries.', ['Parish Records', 'The Canal Age', 'Letters Home', 'Mill Town', 'A Quiet Revolution', 'Border Stones', 'The Last Tram'], [52, 44, 28, 61, 36, 47, 22], { series: 'Footpaths' }),
  seed(6, 'Ancient History', 'ANCIENT', 'History', 'Antiquity, archaeology, and early empires.', ['River Kingdoms', 'The Forum', 'Bronze and Salt', 'Library Ash', 'Road Makers', 'Island Graves', 'A Coin Hoard'], [46, 38, 55, 24, 64, 33, 41], { series: 'Old Ground' }),
  seed(7, 'Military History', 'MILITARY', 'History', 'Campaigns, logistics, and first-hand accounts.', ['Supply Lines', 'Winter Quarters', 'The Signal Corps', 'Harbour Guns', 'Maps and Mud', 'Home Front Kitchens', 'Ceasefire Morning'], [49, 35, 62, 27, 43, 18, 54]),
  seed(8, 'Science', 'SCIENCE', 'Science', 'Experiments, explainers, and lab visits.', ['Bench Notes', 'The Control Group', 'Cold Room', 'Field Samples', 'A Question of Scale', 'Night Lab', 'Peer Review'], [28, 42, 16, 35, 50, 22, 45]),
  seed(9, 'Space', 'SPACE', 'Science', 'Missions, observatories, and the outer planets.', ['Pad Walkdown', 'Deep Field', 'Coast of the Moon', 'Probe Diary', 'Radio Silence', 'The Long Coast', 'Recovery Ship'], [32, 48, 70, 20, 40, 56, 18], { series: 'Outer Coast' }),
  seed(10, 'Nature', 'NATURE', 'Nature', 'Habitats, seasons, and animal behaviour.', ['Hedgerow Year', 'Estuary Dawn', 'Pine Martens', 'Chalk Stream', 'Frost on the Moor', 'Nest Box', 'After Rain'], [40, 24, 52, 36, 44, 14, 30], { series: 'Local Wild' }),
  seed(11, 'Engineering', 'ENGINES', 'Engineering', 'How large things are designed and maintained.', ['Bridge Inspection', 'The Dry Dock', 'Load Test', 'Tunnel Boring', 'A Spare Part', 'Night Possession', 'Hand Calculations'], [46, 34, 22, 68, 16, 38, 28]),
  seed(12, 'Technology', 'TECH', 'Technology', 'Tools, networks, and the people who run them.', ['Exchange Visit', 'The Patch Window', 'Firmware', 'A Small Antenna', 'Desk of Parts', 'Latency', 'Shutdown Procedure'], [26, 44, 18, 36, 22, 50, 14]),
  seed(13, 'Computing', 'COMPUTE', 'Technology', 'Machines, languages, and computer history.', ['Mainframe Night', 'A Compiler', 'Home Built', 'The Manual', 'Terminal Room', 'Bug Hunt', 'Backup Sunday'], [54, 30, 24, 42, 16, 38, 20]),
  seed(14, 'Cars', 'CARS', 'Motoring', 'Workshops, road tests, and automotive history.', ['Ramp Time', 'The Long Drive', 'Carburettor', 'Salt Flats Notes', 'Family Hatch', 'Night Recovery', 'Service Book'], [22, 48, 16, 36, 28, 42, 12]),
  seed(15, 'Aviation', 'AVIATION', 'Transport', 'Airfields, cockpits, and the work around aircraft.', ['Circuit Practice', 'Hangar Three', 'A Crosswind', 'Dispatcher', 'The Old Radio', 'Holding Point', 'Freight Door'], [34, 52, 18, 40, 26, 45, 14]),
  seed(16, 'Railways', 'RAIL', 'Transport', 'Tracks, timetables, and the people who keep them.', ['Possession Night', 'Signal Box', 'Branch Line', 'The Timetable', 'Coal Siding', 'Level Crossing', 'Last Connection'], [48, 28, 62, 20, 36, 16, 44]),
  seed(17, 'Maritime', 'MARINE', 'Transport', 'Ports, ships, and coastal work.', ['Pilot Cutter', 'The Container', 'Fog Horn', 'Chart Table', 'Dry Cargo', 'Harbour Lights', 'A Short Sea'], [42, 30, 18, 55, 24, 38, 66]),
  seed(18, 'Architecture', 'ARCH', 'Design', 'Buildings, drawings, and how rooms are used.', ['Stair Study', 'The Civic Hall', 'A Terrace', 'Concrete Care', 'Plan Chest', 'Evening Use', 'Roof Line'], [32, 58, 22, 40, 16, 36, 48]),
  seed(19, 'Cities', 'CITIES', 'Places', 'Streets, systems, and city life after dark.', ['Night Bus', 'Market Close', 'Under the Bypass', 'A New District', 'Water Pressure', 'Late Libraries', 'The Ring Road'], [26, 44, 18, 52, 30, 38, 22]),
  seed(20, 'Travel', 'TRAVEL', 'Places', 'Journeys taken slowly, without a rush to the sights.', ['Second Class', 'Platform Coffee', 'A Border Town', 'Walking In', 'The Ferry Queue', 'Local Map', 'Stay Over'], [40, 14, 50, 28, 36, 18, 46]),
  seed(21, 'Film', 'FILM', 'Film', 'Feature-length pictures from the demonstration schedule.', ['North Platform', 'The Quiet Engine', 'Glasshouse', 'Low Winter Sun', 'A Private Signal'], [96, 84, 110, 78, 102], { years: [1978, 1986, 1994, 1972, 2001] }),
  seed(22, 'Classic Film', 'CLASSIC', 'Film', 'Older feature slots with interval timing.', ['Lampblack', 'The Courier', 'Sunday Matinee', 'Harbour Waltz', 'Paper Moon Station'], [108, 92, 88, 100, 76], { years: [1954, 1962, 1948, 1959, 1968] }),
  seed(23, 'Film Essays', 'ESSAYS', 'Film', 'Criticism, restorations, and close readings.', ['Opening Shot', 'The Insert', 'Sound and Room', 'A Missing Reel', 'Credit Roll', 'Second Viewing', 'Grain'], [28, 42, 18, 55, 12, 36, 24]),
  seed(24, 'Television', 'TV', 'Television', 'Programmes about programmes, studios, and schedules.', ['Gallery Talk', 'The Announcer', 'Rehearsal', 'Network Clock', 'A Regional Opt', 'Floor Manager', 'Closedown'], [34, 22, 46, 10, 28, 40, 16]),
  seed(25, 'Comedy', 'COMEDY', 'Comedy', 'Half hours, shorts, and the occasional special.', ['Two Chairs', 'The Back Room', 'Warm Up', 'A Running Joke', 'Late Call', 'Panel of Sorts', 'Encore'], [28, 24, 8, 32, 18, 44, 14]),
  seed(26, 'Animation', 'ANIM', 'Animation', 'Short films and longer animated works.', ['Pencil Test', 'The Kite', 'Background Paint', 'Night Window', 'A Small Giant', 'Line Test', 'Saturday Reel'], [12, 22, 8, 48, 36, 6, 64]),
  seed(27, 'Gaming', 'GAMING', 'Games', 'Play sessions, design talk, and long plays.', ['One More Life', 'Speedrun Notes', 'The Manual', 'Co-op Hour', 'Attract Mode', 'Patch Day', 'Final Level'], [40, 22, 16, 55, 8, 30, 70]),
  seed(28, 'Retro Gaming', 'RETRO', 'Games', 'Older machines, cartridges, and cathode-ray play.', ['Cartridge Blow', 'CRT Desk', 'High Score', 'Two Player', 'Loading Screen', 'Magazine Tips', 'The Last Life'], [24, 36, 12, 48, 6, 28, 42]),
  seed(29, '1980s', '1980s', 'Decade', 'A decade strand: pictures, music, and domestic life.', ['Living Room', 'Top Loader', 'The Mix Tape', 'Saturday Rentals', 'Neon Precinct', 'School Disco', 'End of the Night'], [30, 18, 44, 26, 52, 22, 38]),
  seed(30, '1990s', '1990s', 'Decade', 'A later decade strand, from dial-up to closing time.', ['Dial Up', 'The Forum', 'Disposable Camera', 'Indie Disco', 'A Shared PC', 'Late Licence', 'Millennium Eve'], [22, 36, 16, 48, 28, 40, 60]),
  seed(31, 'Music', 'MUSIC', 'Music', 'Songs, sessions, and the occasional long concert.', ['Single Play', 'B-Side', 'Studio Session', 'Three Tracks', 'Interval', 'Hall Concert', 'Encore Tape', 'Closing Theme'], [4, 3, 28, 12, 6, 74, 5, 8]),
  seed(32, 'Live Music', 'LIVE', 'Music', 'Concerts and shorter stage recordings.', ['Soundcheck', 'Support Act', 'Main Set', 'Acoustic Corner', 'Festival Field', 'Last Song', 'Load Out'], [18, 32, 86, 14, 64, 8, 22]),
  seed(33, 'Hip-Hop', 'HIP-HOP', 'Music', 'Verses, breaks, and long-form performances.', ['Sixteen Bars', 'The Break', 'Cipher', 'LP Side', 'Freestyle Hour', 'Scratch', 'Encore'], [5, 8, 22, 44, 36, 6, 18]),
  seed(34, 'Electronic', 'ELECTRO', 'Music', 'Club-length sets and shorter machine studies.', ['Warm Up Set', 'Sequence', 'All Night', 'A Single Patch', 'Warehouse', 'Dawn', 'Test Tone'], [40, 12, 90, 8, 55, 24, 4]),
  seed(35, 'Jazz', 'JAZZ', 'Music', 'Small groups, standards, and late sets.', ['First Set', 'Ballad', 'The Drummer', 'After Hours', 'A Standard', 'Second Set', 'Last Call'], [38, 7, 16, 52, 9, 44, 12]),
  seed(36, 'Classical', 'CLASSICAL', 'Music', 'Recitals, overtures, and full works.', ['Overture', 'String Quartet', 'Interval Talk', 'Symphony', 'Encore Piece', 'Organ', 'Late Recital'], [8, 32, 12, 78, 6, 24, 46]),
  seed(37, 'Punk', 'PUNK', 'Music', 'Short songs and longer club nights.', ['Three Chords', 'The Flyer', 'Basement', 'A Fast One', 'All Ages', 'Feedback', 'Last Train'], [3, 14, 36, 4, 28, 6, 22]),
  seed(38, 'Alternative', 'ALT', 'Music', 'Albums, sessions, and mid-length features.', ['Album Side', 'Session', 'B-Side Show', 'Support', 'Long Song', 'Demo Tape', 'Headline'], [22, 34, 16, 28, 11, 18, 60]),
  seed(39, 'Music Documentaries', 'MUS DOCS', 'Music', 'Films about scenes, rooms, and records.', ['The Rehearsal Room', 'Sleeve Notes', 'Van Life', 'A Local Scene', 'The Desk', 'One Club', 'Tape Archive'], [50, 24, 42, 66, 18, 38, 30]),
  seed(40, 'Art', 'ART', 'Arts', 'Studios, exhibitions, and slow looking.', ['Life Room', 'The Hang', 'Pigment', 'A Public Work', 'Sketchbook', 'Opening Night', 'Conservation'], [28, 46, 14, 36, 18, 52, 24]),
  seed(41, 'Photography', 'PHOTO', 'Arts', 'Darkrooms, assignments, and contact sheets.', ['Contact Sheet', 'Available Light', 'The Brief', 'Fixer', 'Street Walk', 'Archive Box', 'One Lens'], [22, 40, 16, 12, 34, 48, 20]),
  seed(42, 'Literature', 'BOOKS', 'Arts', 'Readings, interviews, and books at length.', ['Opening Chapter', 'The Interview', 'A Short Story', 'Marginalia', 'Reading Aloud', 'Second Draft', 'Bookshop Close'], [18, 36, 26, 14, 44, 22, 30]),
  seed(43, 'Philosophy', 'PHILOS', 'Ideas', 'Arguments, close reading, and public lectures.', ['The Example', 'Office Hour', 'A Dialogue', 'Lecture', 'Counterexample', 'Seminar', 'Walking Argument'], [20, 28, 42, 55, 16, 36, 24]),
  seed(44, 'Food', 'FOOD', 'Lifestyle', 'Kitchens, markets, and meals with a running time.', ['Market List', 'One Pot', 'Service', 'The Bakery', 'Leftovers', 'A Long Lunch', 'Close the Pass'], [16, 28, 42, 24, 12, 50, 18]),
  seed(45, 'DIY', 'DIY', 'Lifestyle', 'Repairs, workshops, and jobs that take the time they take.', ['The Leaky Tap', 'Shelf Day', 'Rewire', 'Paint', 'A Stuck Window', 'Workshop', 'Snagging'], [14, 32, 48, 22, 18, 40, 26]),
  seed(46, 'Cycling', 'CYCLING', 'Sport', 'Club runs, workshops, and longer rides.', ['Club Run', 'The Hill', 'Workshop', 'A Stage', 'Commute', 'Punctures', 'Long Ride'], [36, 22, 16, 58, 12, 8, 74]),
  seed(47, 'Football', 'FOOTBALL', 'Sport', 'Matches, analysis, and the build-up.', ['Build Up', 'First Half', 'Half Time', 'Second Half', 'The Whistle', 'Phone In', 'Midweek Replay'], [20, 48, 15, 50, 10, 35, 70]),
  seed(48, 'Motorsport', 'MOTOR', 'Sport', 'Practice, qualifying, and race distance.', ['Practice', 'Qualifying', 'Grid Walk', 'Race', 'Paddock', 'Debrief', 'Highlights'], [30, 25, 12, 90, 18, 22, 40]),
  seed(49, 'Weather', 'WEATHER', 'News', 'Forecasts, charts, and the longer seasonal look.', ['Morning Chart', 'Coastal Update', 'The Front', 'Regional', 'Overnight', 'Season Ahead', 'Marine Cast'], [8, 12, 22, 10, 6, 28, 16]),
  seed(50, 'Business', 'BUSINESS', 'News', 'Markets, companies, and the working day.', ['Opening Bell', 'The Floor', 'A Small Firm', 'Lunch Numbers', 'Close of Play', 'Founders', 'The Ledger'], [15, 28, 36, 12, 20, 44, 24]),
  seed(51, 'Culture', 'CULTURE', 'Arts', 'Reviews, visits, and the weekly essay.', ['First Night', 'The Essay', 'A Museum Hour', 'Critics', 'Matinee', 'Late Review', 'Archive Visit'], [26, 18, 42, 30, 55, 22, 36]),
  seed(52, 'Field Notes', 'FIELD', 'Documentary', 'Reported stories told at the length they need.', ['The Case File', 'A Return Visit', 'Notebook', 'The Neighbour', 'Follow Up', 'Recording', 'Sign Off'], [46, 28, 14, 38, 22, 52, 10]),
  seed(53, 'Oceans', 'OCEANS', 'Nature', 'Coasts, decks, and what happens under the surface.', ['Deck Watch', 'The Shelf', 'Tide Table', 'A Research Cruise', 'Rock Pool', 'Night Trawl', 'Landfall'], [24, 40, 12, 68, 16, 34, 28], { series: 'Soundings' }),
  seed(54, 'Gardens', 'GARDENS', 'Lifestyle', 'Plots, seasons, and the jobs that repeat.', ['Seed Tray', 'The Allotment', 'Pruning', 'A Wet Sunday', 'Glasshouse', 'Harvest', 'Leaf Mould'], [12, 34, 20, 16, 28, 42, 18]),
  seed(55, 'Design', 'DESIGN', 'Design', 'Objects, posters, and how decisions get made.', ['The Brief', 'Type Study', 'A Chair', 'Critique', 'Print Check', 'The Mockup', 'In Use'], [18, 26, 40, 22, 10, 34, 30]),
  seed(56, 'Sessions', 'SESSIONS', 'Music', 'Performance strands recorded as if live.', ['Tune Up', 'First Number', 'Request', 'Instrumental', 'Guest', 'Last Number', 'Sign Off'], [6, 18, 8, 14, 32, 10, 5]),
  seed(57, 'After Dark', 'AFTER', 'Variety', 'The late schedule: longer talk, shorter oddities.', ['Open Mic', 'The Night Desk', 'A Repeated Film', 'Switchboard', 'Insomnia Hour', 'Short Wave', 'Almost Dawn'], [16, 44, 90, 12, 36, 22, 28]),
  seed(
    58,
    'Retro Commercials',
    'ADVERTS',
    'Archive',
    'Short archival-style breaks treated as programmes, not as an advertising platform.',
    ['Bright Window Polish', 'Harbour Tonic', 'Northline Coaches', 'Kitchen Timer', 'County Biscuits', 'Lamp Oil', 'Sunday Gravy', 'Pocket Radio'],
    [0.5, 1, 0.75, 0.33, 1.5, 0.5, 1, 0.66],
    {
      picture: false,
      kinds: [
        'retro-commercial',
        'retro-commercial',
        'retro-commercial',
        'retro-commercial',
        'retro-commercial',
        'retro-commercial',
        'retro-commercial',
        'retro-commercial',
      ],
    },
  ),
  seed(
    59,
    'Continuity',
    'CONTINUITY',
    'Presentation',
    'Idents, bumpers, and junction announcements as ordinary schedule items.',
    ['Station Ident', 'Opening Bumper', 'You Are Watching', 'Junction', 'Ident Reprise', 'Closedown', 'Menu Board', 'Morning Open'],
    [0.25, 0.2, 0.5, 8, 0.25, 2, 0.4, 1],
    {
      picture: false,
      kinds: ['ident', 'bumper', 'continuity', 'programme', 'ident', 'continuity', 'bumper', 'ident'],
    },
  ),
  seed(
    60,
    'Test Card',
    'TEST',
    'Engineering',
    'A receiver check. No picture master is attached, so the card stays up.',
    ['Colour Bars', 'Black Level', 'Pulse and Bar', 'Station Clock', 'Grey Scale', 'Identification'],
    [30, 15, 10, 45, 20, 25],
    { picture: false },
  ),
  seed(
    101,
    'Late Feature',
    'FEATURE',
    'Film',
    'A long-form picture. The slot is the film, not a playlist of clips.',
    ['The Night Crossing', 'Harbour Light', 'After the Last Train', 'Winter Platform'],
    [195, 112, 88, 46],
    { programmeType: 'film', years: [1979, 1984, 1991, 1974] },
  ),
  seed(
    950,
    'Radio One',
    'RADIO',
    'Radio',
    'Speech and longer evening pieces. Audio only.',
    ['Evening Essay', 'Interval', 'Concert', 'Late Talk'],
    [55, 12, 84, 40],
    { picture: false, mediaKind: 'audio', programmeType: 'radio' },
  ),
  seed(
    992,
    'Concert Hall',
    'CONCERT',
    'Radio',
    'A music radio service with full works and short links.',
    ['Overture', 'Symphony', 'Interval Talk', 'Chamber Piece'],
    [8, 72, 15, 38],
    { picture: false, mediaKind: 'audio', programmeType: 'radio' },
  ),
  seed(
    991,
    'Night Music',
    'NIGHT',
    'Radio',
    'Quiet music through the small hours.',
    ['After Close', 'Piano', 'A Long Set', 'Dawn Chorus'],
    [25, 40, 90, 18],
    { picture: false, mediaKind: 'audio', programmeType: 'radio' },
  ),
  seed(
    999,
    'Closedown',
    'CLOSE',
    'Radio',
    'The end of the dial. A closedown sequence on the clock.',
    ['Epilogue', 'National Anthem', 'Tone', 'Night Carrier'],
    [12, 4, 30, 45],
    { picture: false, mediaKind: 'audio', programmeType: 'closedown' },
  ),
]

function build(): { channels: Channel[]; programmes: Programme[] } {
  const channels: Channel[] = []
  const programmes: Programme[] = []

  for (const entry of SEEDS) {
    if (entry.titles.length !== entry.minutes.length) {
      throw new Error(`Channel ${entry.number} lineup length mismatch`)
    }
    if (entry.kinds && entry.kinds.length !== entry.titles.length) {
      throw new Error(`Channel ${entry.number} kind length mismatch`)
    }
    if (entry.years && entry.years.length !== entry.titles.length) {
      throw new Error(`Channel ${entry.number} year length mismatch`)
    }

    const id = `ch-${String(entry.number).padStart(3, '0')}`
    channels.push({
      id,
      number: entry.number,
      name: entry.name,
      shortName: entry.shortName,
      description: entry.description,
      logo: logoFor(entry.shortName),
      color: PALETTE[(entry.number * 3) % PALETTE.length],
      category: entry.category,
      categoryId: categoryIdFor(entry.category),
      origin: 'default',
      mediaKind: entry.mediaKind ?? 'video',
      enabled: true,
      sources: [{ kind: 'demo', id: `demo-${id}`, label: 'Local demonstration catalogue' }],
      scheduleMode: 'loop',
      phaseOffsetSeconds: ((entry.number * 83) % 360) * 60 + entry.number * 17,
    })

    entry.titles.forEach((title, index) => {
      const minutes = entry.minutes[index]
      const durationSeconds = Math.round(minutes * 60)
      const kind = entry.kinds?.[index] ?? 'programme'
      // Demonstration films are the Test Card picture only. Other seed listings stay untitled.
      const demonstration = entry.number === 60
      const film = demonstration ? DEMO_FILMS[(entry.number * 5 + index) % DEMO_FILMS.length] : undefined
      const playbackMode: Programme['playbackMode'] =
        film && film.mediaDurationSeconds + 1 < durationSeconds ? 'loop-demo' : 'linear'
      const listed = entry.number === 60 || entry.number === 101 ? title : 'No programming available'

      programmes.push({
        id: `${id}-p${index + 1}`,
        title: listed,
        description: listed === title ? describe(entry.category, title, minutes, index) : 'No programming available',
        videoId: film?.videoId ?? null,
        durationSeconds,
        mediaDurationSeconds: film?.mediaDurationSeconds,
        thumbnail: film ? `https://i.ytimg.com/vi/${film.videoId}/hqdefault.jpg` : undefined,
        channelId: id,
        category: entry.category,
        source: 'demo',
        publishedAt: new Date(Date.UTC(2024, 0, 1 + index)).toISOString(),
        year: entry.years?.[index],
        series: entry.series,
        episode: entry.series ? String(index + 1) : undefined,
        tags: [entry.category.toLowerCase(), kind],
        identBefore: kind === 'ident' ? 'station-ident' : undefined,
        identAfter: kind === 'bumper' ? 'programme-bumper' : undefined,
        kind,
        playbackMode,
        programmeType:
          entry.programmeType ??
          inferProgrammeType(entry.category, kind, entry.mediaKind ?? 'video', minutes),
        mediaKind: entry.mediaKind ?? 'video',
        sourceRef: film ? `youtube:${film.videoId}` : `generated:${id}-p${index + 1}`,
      })
    })
  }

  return reconcileWithCanonical(channels, programmes)
}

const built = build()

export const channels: readonly Channel[] = built.channels

const programmesByChannel = new Map<string, Programme[]>()
for (const programme of built.programmes) {
  const list = programmesByChannel.get(programme.channelId)
  if (list) list.push(programme)
  else programmesByChannel.set(programme.channelId, [programme])
}

function inferProgrammeType(
  category: string,
  kind: ProgrammeKind,
  mediaKind: MediaKind,
  minutes: number,
): ProgrammeType {
  if (mediaKind === 'audio') return 'radio'
  if (kind === 'ident') return 'ident'
  if (kind === 'retro-commercial') return 'advert'
  if (kind === 'continuity' || kind === 'bumper') return 'continuity'
  if (category === 'Film' && minutes >= 75) return 'film'
  if (category === 'Documentary') return 'documentary'
  if (category === 'News') return 'news'
  if (category === 'Sport') return 'sport'
  if (category === 'Music') return 'music'
  if (minutes < 8) return 'short'
  return 'episode'
}

/**
 * Defaults plus any imported channels. Defaults win if a number collides; only the viewer's own change to
 * a curated channel (kept in this browser) is laid over the shipped one, at that channel's number.
 */
let listed:
  | { users: readonly Channel[]; curated: readonly Channel[]; list: readonly Channel[]; byNumber: ReadonlyMap<number, Channel> }
  | undefined

/** Rebuilt only when a layer is replaced; `enabled` is still read live by callers. */
function merged(): NonNullable<typeof listed> {
  const users = userChannelList()
  const curated = curatedEditList()
  if (listed?.users === users && listed.curated === curated) return listed
  const byNumber = new Map<number, Channel>()
  byNumber.set(SESSION_CHANNEL.number, SESSION_CHANNEL)
  for (const channel of users) byNumber.set(channel.number, channel)
  for (const channel of channels) byNumber.set(channel.number, channel)
  for (const channel of curated) {
    const shipped = byNumber.get(channel.number)
    if (shipped && shipped.origin === 'default' && shipped.id === channel.id) byNumber.set(channel.number, channel)
  }
  listed = { users, curated, list: [...byNumber.values()].sort((left, right) => left.number - right.number), byNumber }
  return listed
}

/** The curated channel exactly as TVN ships it, whatever the viewer has changed in this browser. */
export function shippedChannel(number: number): Channel | undefined {
  return channels.find((channel) => channel.number === number)
}

export function listChannels(): readonly Channel[] {
  return merged().list
}

export function programmesFor(channelId: string): readonly Programme[] {
  if (channelId === SESSION_CHANNEL.id) return sessionProgrammes()
  return curatedProgrammesFor(channelId) ?? userProgrammesFor(channelId) ?? programmesByChannel.get(channelId) ?? []
}

/** The programmes a curated channel ships with, whatever the viewer has laid over it. */
export function shippedProgrammes(channelId: string): readonly Programme[] {
  return programmesByChannel.get(channelId) ?? []
}

export function channelByNumber(number: number): Channel | undefined {
  const channel = merged().byNumber.get(number)
  return channel?.enabled ? channel : undefined
}

export function channelById(id: string): Channel | undefined {
  return listChannels().find((channel) => channel.id === id)
}

/**
 * Any other on-air channel, curated or user; the current one only when it is the sole choice.
 * The session channel is private media, so surfing never lands on it.
 */
export function randomChannel(
  current: number,
  random: () => number = Math.random,
  among: readonly Channel[] = listChannels(),
): Channel | undefined {
  const onAir = among.filter((channel) => channel.enabled && channel.origin !== 'session' && !channel.emptySlot && isOnAir(channel))
  const choices = onAir.length > 1 ? onAir.filter((channel) => channel.number !== current) : onAir
  return choices[Math.floor(random() * choices.length)]
}

export function adjacentChannel(number: number, delta: number): Channel {
  const enabled = listChannels().filter((channel) => channel.enabled && !channel.emptySlot && isOnAir(channel))
  if (enabled.length === 0) {
    const fallback = listChannels().filter((channel) => channel.enabled)
    const index = fallback.findIndex((channel) => channel.number === number)
    const start = index < 0 ? 0 : index
    return fallback[(start + delta + fallback.length) % fallback.length] ?? fallback[0]
  }
  const index = enabled.findIndex((channel) => channel.number === number)
  if (index < 0 && delta !== 0) {
    // Tuned to a channel that is not on air: step to the nearest on-air neighbour in that direction.
    const ahead = delta > 0 ? enabled.findIndex((channel) => channel.number > number) : enabled.findLastIndex((channel) => channel.number < number)
    const first = ahead >= 0 ? ahead : delta > 0 ? 0 : enabled.length - 1
    const next = (((first + delta - Math.sign(delta)) % enabled.length) + enabled.length) % enabled.length
    return enabled[next]
  }
  const start = index < 0 ? 0 : index
  const next = (start + delta + enabled.length) % enabled.length
  return enabled[next]
}
