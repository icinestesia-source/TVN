import { LOCAL_SESSION_NOTE } from '../credits/provenance.ts'

export const TVN_VERSION = 'Version 1'
export const LEGAL_DATE = '1 October 2026'

/**
 * The rights and attribution contact, for creators, rights holders and source representatives. Shown only
 * inside Rights & attribution, once the viewer opens Contact TVN; never as a general contact address.
 */
export const CONTACT_EMAIL: string | null = 'tvnlol@pm.me'

export const CONTACT_HEADING = 'Rights & attribution contact'
export const CONTACT_INTRO =
  'If you are a creator, rights holder or source representative and believe TVN contains incorrect attribution, an incorrect source link, or programming that requires our attention, you can contact TVN here.'
export const CONTACT_INCLUDE = 'Please identify the TVN channel, programme/source and the nature of your request.'

export const YOUTUBE_TERMS = 'https://www.youtube.com/t/terms'
export const GOOGLE_PRIVACY = 'https://policies.google.com/privacy'
export const YOUTUBE_COPYRIGHT = 'https://support.google.com/youtube/answer/2807622'

export type LegalPart = string | { text: string; href: string }

export interface LegalSection {
  id: string
  title: string
  paragraphs: LegalPart[][]
}

/** A prefilled message for the contact route; the viewer's mail program sends it, not TVN. */
export function contactLink(subject: string, body = ''): string | null {
  if (!CONTACT_EMAIL) return null
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ''}`
}

/** What creators, rights holders and viewers can raise; one route, no ticket system. */
export const FEEDBACK_TOPICS = [
  'Attribution correction',
  'Incorrect creator information',
  'Broken source link',
  'Source concern',
  'Playback concern',
  'Rights-holder contact',
] as const

export const CORRECTION_TEMPLATE = [
  `Type of request (${FEEDBACK_TOPICS.join(' / ')}):`,
  'Programme or source link:',
  'TVN channel number:',
  'What should change:',
  'Your relationship to the work (creator, rights holder, representative, viewer):',
].join('\n')

export const LEGAL_SECTIONS: readonly LegalSection[] = [
  {
    id: 'about',
    title: 'About TVN',
    paragraphs: [
      ['TVN is an independent television and media interface. It arranges programmes from supported sources into channels with a schedule, a Guide and a remote.'],
      ['Where a channel is set up for them, TVN presents YouTube programmes through YouTube’s embedded player, direct video, live video streams, radio and other audio streams, media from your own device on Channel 1000, and sources you add to your own User Network. YouTube is one of these providers; not all TVN programming comes from YouTube.'],
    ],
  },
  {
    id: 'programming',
    title: 'Third-party programming',
    paragraphs: [
      ['Third-party programmes are hosted and delivered by their providers: YouTube programmes from YouTube, streams from their own hosts. TVN does not host or download them, and claims no ownership of them. Each remains attributable to its creator and provider.'],
      ['Being publicly available does not make a programme public domain, and TVN does not suggest otherwise. A licence is shown only where one has been recorded.'],
    ],
  },
  {
    id: 'youtube',
    title: 'YouTube',
    paragraphs: [
      ['YouTube-hosted programmes play through YouTube’s own embedded player. By watching them on TVN you agree to the ', { text: 'YouTube Terms of Service', href: YOUTUBE_TERMS }, '. In Multi View only the tile you are listening to runs a YouTube player; the other YouTube tiles show a still image until you move to them.'],
      ['YouTube and Google handle information about that playback under the ', { text: 'Google Privacy Policy', href: GOOGLE_PRIVACY }, '. YouTube may set its own cookies when its player loads. YouTube does not operate, sponsor or endorse TVN.'],
    ],
  },
  {
    id: 'providers',
    title: 'Other providers',
    paragraphs: [
      ['Direct video, live video (including HLS) and audio or radio streams are played by your browser’s own media player, straight from the provider’s address. They are labelled with that address, never presented as YouTube, and are subject to that provider’s terms.'],
    ],
  },
  {
    id: 'channel-000',
    title: 'TVN · Channel 000',
    paragraphs: [['Channel 000 is TVN’s own channel. It plays a programme airing elsewhere on TVN, from the channel that carries it, and then chooses another. It copies nothing and learns nothing about you; what it chose is forgotten when you close TVN.']],
  },
  {
    id: 'channel-1000',
    title: 'Local media · Channel 1000',
    paragraphs: [[`Local Media. ${LOCAL_SESSION_NOTE} It plays from your device for this session only.`]],
  },
  {
    id: 'user-network',
    title: 'Your User Network (1001 and up)',
    paragraphs: [
      ['Channels from 1001 up are yours. They are saved in this browser only, are not shared with other viewers, and are not part of TVN’s programming.'],
      ['When you add or rescan a YouTube channel or playlist, the address you entered is sent to TVN’s own server, which asks YouTube for that public list of videos and returns it. Nothing else from your network leaves your browser.'],
      ['Any public contact details you add to a source are kept only in this browser.'],
    ],
  },
  {
    id: 'credits',
    title: 'Credits and provenance',
    paragraphs: [
      ['CREDITS on the remote rolls over the programme you are watching, which carries on playing. It shows what is playing, then the sources behind every TVN channel, generated from TVN’s own records. Where a programme has no individual credit, it is credited to the source it comes from; where no creator is recorded, it says so. Your own channels are listed separately, from this browser.'],
      ['Credits record provenance. They are not a claim of ownership, and do not mean a source has granted TVN any licence beyond its provider’s own playback.'],
      ['The source register can be downloaded from the credits as machine-readable JSON.'],
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy and external playback',
    paragraphs: [
      ['TVN itself has no accounts, advertising or analytics, and sets no cookies. Your settings, favourites, channels and this notice’s acknowledgement are stored in your browser.'],
      ['Playing a programme connects your browser to its provider (YouTube, including its player and preview images, or the stream’s own host), which may exchange information with it. TVN loads its typefaces from Google Fonts, so your browser also contacts Google for those. TVN’s web host serves the site and may keep standard request logs.'],
    ],
  },
  {
    id: 'rights',
    title: 'Rights & attribution',
    paragraphs: [
      ['If you are a creator or rights holder and want a programme or source removed from TVN or credited differently, TVN will act promptly.'],
      ['Removing a programme from TVN does not remove it from its provider. For that, use the provider’s process, such as ', { text: 'YouTube’s copyright tools', href: YOUTUBE_COPYRIGHT }, '.'],
    ],
  },
  {
    id: 'corrections',
    title: 'Corrections',
    paragraphs: [
      ['Credits come from TVN’s records and can be wrong or incomplete. Creators, rights holders and source representatives can raise attribution corrections, incorrect creator information, broken or incorrect source links, and source concerns through Contact TVN under Rights & attribution.'],
    ],
  },
  {
    id: 'independence',
    title: 'Independence',
    paragraphs: [
      ['TVN is independent. It is not operated, affiliated with, endorsed or sponsored by YouTube, Google, or any provider or creator whose programmes appear. Names and trademarks belong to their owners.'],
    ],
  },
  {
    id: 'version',
    title: 'Version',
    paragraphs: [[`TVN ${TVN_VERSION} · ${LEGAL_DATE}`]],
  },
]
