import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SourceDetails } from './components/SourceDetails.tsx'
import { NowPlaying, originalLabel } from './credits/CreditsRoll.tsx'
import { EXPORT_FORMAT, provenanceExport } from './credits/export.ts'
import {
  channelLabel,
  creditFor,
  LOCAL_SESSION_NOTE,
  readRegister,
  sourceIdOf,
  watchUrl,
  webUrl,
  youtubeChannelUrl,
  type SourceRegister,
} from './credits/provenance.ts'
import { buildRoll, LINE_HEIGHT, visibleRange, type RollLine } from './credits/roll.ts'
import { cleanSourceInfo, draftOf } from './credits/source-info.ts'
import { channelByNumber, listChannels } from './data/catalogue.ts'
import { installUserCatalogue } from './data/user-overlay.ts'
import { resetDirector } from './director/director.ts'
import { mediaLibrary, setMediaLibrary } from './director/library.ts'
import { liveCams } from './dynamic/providers.ts'
import { acknowledgeNotice, noticeAcknowledged, NOTICE_KEY } from './legal/about-store.ts'
import { AboutPanel } from './legal/AboutPanel.tsx'
import { FirstRunNotice } from './legal/FirstRunNotice.tsx'
import { CONTACT_EMAIL, contactLink, CORRECTION_TEMPLATE, FEEDBACK_TOPICS, GOOGLE_PRIVACY, LEGAL_SECTIONS, YOUTUBE_TERMS } from './legal/legal-text.ts'
import { expandPlayableCatalogue, type PlayableCatalogueV2 } from './library/playable-catalogue.ts'
import { getChannelMedia } from './library/query.ts'
import { refreshAiring } from './network/airing.ts'
import { onScreen } from './player/manual.ts'
import { sourcesOf } from './services/channel-editor.ts'
import type { ChannelSource } from './services/channel-sources.ts'
import type { StoredSource } from './services/channels-import.ts'
import { loadCuratedEdit, saveCuratedEdit } from './services/curated-edits.ts'
import type { Channel } from './types/channel.ts'
import type { Programme } from './types/programme.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const catalogue = JSON.parse(read('public/independent/playable.json')) as PlayableCatalogueV2 & { sources: Record<string, string> }
const register: SourceRegister = readRegister(JSON.parse(read('public/independent/sources.json')))
const poolOf = (number: number) => getChannelMedia(mediaLibrary(), number)
const T = Date.UTC(2026, 9, 1, 19, 0, 0)

function memoryStore() {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) }
}

const ytSource = (over: Partial<ChannelSource> = {}): ChannelSource => ({
  id: 'own-1',
  kind: 'youtube',
  url: 'https://www.youtube.com/@ownmaker',
  label: 'Own Maker',
  ref: 'UCabcdefghijklmnopqrstuv',
  enabled: true,
  videos: [{ id: 'abcdefghijk', title: 'Own video', durationSec: 300 }],
  status: { state: 'ready', checkedAt: 1 },
  ...over,
})

const stored: StoredSource[] = [
  {
    id: 'mine',
    name: 'My Makers',
    videos: [],
    channelNumber: 1001,
    channelSources: [ytSource({ info: { website: 'https://ownmaker.example/', email: 'press@ownmaker.example' } })],
    inLibrary: false,
    automatic: false,
    updatedAt: 1,
  },
  { id: 'unplaced', name: 'Not On Air', videos: [], channelNumber: null, inLibrary: false, automatic: false, updatedAt: 1 },
]

beforeAll(() => {
  const items = expandPlayableCatalogue(catalogue)
  installUserCatalogue([], new Map())
  resetDirector()
  setMediaLibrary(items)
  refreshAiring(items)
}, 60000)

afterAll(() => installUserCatalogue([], new Map()))

/** A shipped channel airing a catalogue programme at T. */
function catalogueAiring(): { channel: Channel; programme: Programme } {
  for (const channel of listChannels()) {
    if (channel.number < 1 || channel.number > 999 || liveCams(channel.number).length) continue
    const programme = onScreen(channel, T).current.programme
    if (!programme.videoId || programme.liveStream) continue
    const item = mediaLibrary().find((entry) => entry.externalId === programme.videoId)
    if (sourceIdOf(item)?.startsWith('src_')) return { channel, programme }
  }
  throw new Error('no catalogue programme on air')
}

describe('CREDITS on the remote', () => {
  const remote = read('src/components/TouchRemote.tsx')
  const provider = read('src/state/TvProvider.tsx')

  it('sits after CLOSE and before PAUSE', () => {
    const foot = remote.slice(remote.indexOf('aria-label="Close remote"'))
    const close = foot.indexOf('Close')
    const credits = foot.indexOf("dispatch({ type: 'credits' })")
    const pause = foot.indexOf("dispatch({ type: 'play-pause' })")
    expect(close).toBeGreaterThanOrEqual(0)
    expect(credits).toBeGreaterThan(close)
    expect(pause).toBeGreaterThan(credits)
    expect(foot).toMatch(/aria-pressed=\{tv\.credits\}[\s\S]*?>\s*Credits\s*</)
  })

  it('toggles on and off from the same command, and Escape closes it', () => {
    expect(provider).toMatch(/case 'credits':\s*setCreditsOn\(!creditsRef\.current\)/)
    expect(provider).toMatch(/else if \(creditsRef\.current\) setCreditsOn\(false\)/)
    expect(read('src/credits/CreditsRoll.tsx')).toMatch(/Escape: close/)
  })

  it('rolls over the continuing programme: no pause, no retune, no hidden picture, nothing locked', () => {
    const body = provider.slice(provider.indexOf('const setCreditsOn'), provider.indexOf('const closeGuide = () =>'))
    for (const touch of ['requestTune', 'commitChannel', 'loadProgramme', 'tokenRef', 'setChannelNumber', 'pause', 'Paused', 'resumeViewing', 'closeGuide']) {
      expect(body).not.toContain(touch)
    }
    expect(provider).not.toContain('CREDITS_COMMANDS')
    expect(provider).toMatch(/if \(!surfing \|\| asleep \|\| guideOpen \|\| screenEdit !== null/)
    const screen = read('src/app/TvScreen.tsx')
    expect(screen).toMatch(/<PlayerStage playerRef/)
    expect(screen).toContain('<MultiviewGrid width={width} />')
    expect(screen).not.toMatch(/tv\.credits \? null/)
    expect(screen).not.toContain('!tv.credits')
    const css = read('src/styles/credits.css')
    expect(css).not.toContain('visibility: hidden')
    expect(css).toMatch(/\.credits \{[^}]*background: rgba\(0, 0, 0, 0\.5\)/)
    expect(remote).toMatch(/aria-pressed=\{tv\.paused\} onClick/)
  })

  it('pausing the roll is the roll’s own state, never the programme’s', () => {
    const roll = read('src/credits/CreditsRoll.tsx')
    expect(roll).toContain("' ': () => setRunning((on) => !on)")
    expect(roll).not.toContain("type: 'play-pause'")
    expect(roll).not.toContain('paused')
  })
})

describe('Now Playing', () => {
  it('comes first and matches the programme actually on screen', () => {
    const { channel, programme } = catalogueAiring()
    const credit = creditFor(channel, programme, { library: mediaLibrary(), register })
    const sourceId = sourceIdOf(mediaLibrary().find((item) => item.externalId === programme.videoId))!
    expect(credit.title).toBe(programme.title)
    expect(credit.creator).toBe(register.sources[sourceId].name)
    expect(credit.provider).toBe('YouTube')
    expect(credit.originalUrl).toBe(`https://www.youtube.com/watch?v=${programme.videoId}`)
    expect(credit.sourceUrl).toBe(register.sources[sourceId].channelUrl ?? undefined)
    const html = renderToStaticMarkup(createElement(NowPlaying, { credit, channel: channelLabel(channel) }))
    expect(html.indexOf('Now Playing')).toBeLessThan(html.indexOf('TVN channel'))
    expect(html).toContain(`href="${credit.originalUrl?.replace(/&/g, '&amp;')}"`)
    expect(html).toContain('Open original on YouTube')
    expect(html).toContain('rel="noopener noreferrer"')
    const roll = buildRoll({ channels: listChannels(), poolOf, register, stored: [], curated: {} })
    expect(roll.lines[0]).toEqual({ kind: 'now' })
  })

  it('says so when no record names a creator', () => {
    const channel = channelByNumber(1)!
    const programme = { id: 'x', title: 'Unknown', videoId: 'zzzzzzzzzzz', durationSeconds: 60 } as Programme
    const credit = creditFor(channel, programme, { library: [], register })
    expect(credit.creator).toBeNull()
    expect(credit.sourceUrl).toBeUndefined()
    expect(renderToStaticMarkup(createElement(NowPlaying, { credit, channel: '001' }))).toContain('Creator not recorded')
  })
})

describe('credits come from canonical records and invent nothing', () => {
  it('the generated register covers every catalogue source with a real link and no invented licence', () => {
    expect(register.format).toBe('tvn-source-register-v1')
    for (const [id, name] of Object.entries(catalogue.sources)) {
      const entry = register.sources[id]
      expect(entry, id).toBeDefined()
      expect(entry.name).toBe(name)
      expect(entry.channelUrl ?? entry.website, id).toBeTruthy()
      // Channel ids and handles, or a legacy /user/ or vanity address exactly as the manifest recorded it.
      if (entry.channelUrl) expect(entry.channelUrl).toMatch(/^https:\/\/www\.youtube\.com\/(channel\/UC[\w-]{22}|@[\w.-]+|user\/[\w.-]+|[\w.-]+)$/)
      if (entry.website) expect(webUrl(entry.website)).toBeTruthy()
      expect(entry).not.toHaveProperty('licence')
    }
  })

  it('builds no address from incomplete identifiers', () => {
    expect(watchUrl('short')).toBeUndefined()
    expect(watchUrl('abcdefghijk')).toBe('https://www.youtube.com/watch?v=abcdefghijk')
    expect(youtubeChannelUrl('Some Channel Name')).toBeUndefined()
    expect(youtubeChannelUrl('yt:UCabcdefghijklmnopqrstuv')).toBe('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv')
    expect(webUrl('javascript:alert(1)')).toBeUndefined()
    expect(webUrl('not a url')).toBeUndefined()
  })

  it('groups each channel’s real programming by source, with counts and only recorded links', () => {
    const roll = buildRoll({ channels: listChannels(), poolOf, register, stored: [], curated: {} })
    const known = new Set<string>()
    for (const entry of Object.values(register.sources)) for (const url of [entry.channelUrl, entry.website]) if (url) known.add(url)
    for (const channel of listChannels()) for (const cam of liveCams(channel.number)) known.add(youtubeChannelUrl(cam.sourceId) ?? '')
    for (const line of roll.lines) if (line.kind === 'source') for (const link of line.links) expect(known.has(link.url), link.url).toBe(true)

    const sample = listChannels().find((channel) => channel.number >= 1 && channel.number <= 999 && poolOf(channel.number).length > 0)!
    const counts = new Map<string, number>()
    for (const item of poolOf(sample.number)) {
      const id = sourceIdOf(item)
      if (id?.startsWith('src_')) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    const at = roll.lines.findIndex((line) => line.kind === 'channel' && line.name === sample.name)
    const block: RollLine[] = []
    for (let index = at + 1; roll.lines[index].kind === 'source'; index += 1) block.push(roll.lines[index])
    const [topId, topCount] = [...counts].sort((a, b) => b[1] - a[1])[0]
    expect(block.some((line) => line.kind === 'source' && line.name === register.sources[topId].name && line.detail.includes(String(topCount)))).toBe(true)
  })

  it('labels other providers as themselves, never as YouTube', () => {
    const user = { ...channelByNumber(1)!, number: 1002, origin: 'user-import' } as Channel
    const stream = creditFor(user, { id: 's', title: 'Radio', durationSeconds: 60, creator: 'Station', liveStream: { url: 'https://radio.example.com/live.mp3', format: 'audio' } } as unknown as Programme, {
      library: [],
      register,
    })
    expect(stream.provider).toBe('Direct stream · radio.example.com')
    expect(originalLabel(stream)).toBe('Open original stream')
    expect(originalLabel(stream)).not.toContain('YouTube')
    const session = creditFor({ ...user, number: 0, origin: 'session' } as Channel, { id: 'f', title: 'holiday.mp4', durationSeconds: 60 } as Programme, { library: [], register })
    expect(session.provider).toBe('Local file on this device')
    expect(session.originalUrl).toBeUndefined()
    const card = creditFor(channelByNumber(1)!, { id: 'c', title: 'TVN', durationSeconds: 60 } as Programme, { library: [], register })
    expect(card).toMatchObject({ kind: 'tvn', provider: 'TVN', creator: null })
    expect(card.originalUrl).toBeUndefined()
  })
})

describe('the viewer’s own sources', () => {
  it('are listed apart from TVN programming, from this browser’s records only', () => {
    const roll = buildRoll({ channels: listChannels(), poolOf, register, stored, curated: {} })
    const tvn = roll.lines.findIndex((line) => line.kind === 'title' && line.text === 'TVN Source Credits')
    const mine = roll.lines.findIndex((line) => line.kind === 'title' && line.text === 'My Channel Sources')
    const own = roll.lines.findIndex((line) => line.kind === 'source' && line.name === 'Own Maker')
    expect(tvn).toBeGreaterThan(0)
    expect(mine).toBeGreaterThan(tvn)
    expect(own).toBeGreaterThan(mine)
    const line = roll.lines[own]
    expect(line.kind === 'source' && line.links.map((link) => link.url)).toEqual(['https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', 'https://ownmaker.example/'])
    expect(roll.lines).toContainEqual({ kind: 'note', text: 'Public contact · press@ownmaker.example' })
    expect(roll.lines.some((entry) => entry.kind === 'channel' && entry.name === 'Not On Air')).toBe(false)
    const user = { ...channelByNumber(1)!, number: 1001, origin: 'user-import' } as Channel
    expect(creditFor(user, { id: 'v', title: 'Own video', videoId: 'abcdefghijk', durationSeconds: 300 } as Programme, { library: [], register, stored }).creator).toBe('Own Maker')
  })

  it('never reach the export or a server', () => {
    const doc = provenanceExport(listChannels(), poolOf, register, 'now')
    expect(doc.format).toBe(EXPORT_FORMAT)
    expect(doc.programmes.length).toBeGreaterThan(1000)
    const text = JSON.stringify(doc)
    expect(text).not.toContain('Own Maker')
    expect(text).not.toContain('"licence"')
    expect(read('src/credits/load.ts').match(/fetch\(/g)).toHaveLength(1)
    expect(read('src/credits/load.ts')).toContain('fetch(REGISTER_PATH)')
  })
})

describe('Channel 1000 Local Media', () => {
  it('states local session media accurately everywhere it appears', () => {
    expect(LOCAL_SESSION_NOTE).toBe('Media selected locally by the viewer. Not uploaded to TVN.')
    const roll = buildRoll({ channels: listChannels(), poolOf, register, stored: [], curated: {} })
    const at = roll.lines.findIndex((line) => line.kind === 'title' && line.text === 'Channel 1000')
    expect(roll.lines[at + 1]).toEqual({ kind: 'channel', number: 'Local Media', name: '' })
    expect(roll.lines[at + 2]).toEqual({ kind: 'note', text: LOCAL_SESSION_NOTE })
    expect(JSON.stringify(LEGAL_SECTIONS.find((section) => section.id === 'channel-1000'))).toContain(LOCAL_SESSION_NOTE)
    expect(read('src/session/session-channel.ts')).toContain('object URL')
  })
})

describe('Channel Editor source information', () => {
  it('is optional, checked, and kept when the channel is saved', () => {
    expect(cleanSourceInfo(draftOf(undefined))).toEqual({})
    expect(cleanSourceInfo({ ...draftOf(undefined), email: 'not-an-email' }).problem).toBeTruthy()
    expect(cleanSourceInfo({ ...draftOf(undefined), website: 'javascript:alert(1)' }).problem).toBeTruthy()
    const { info } = cleanSourceInfo({ website: 'https://maker.example', links: 'https://instagram.com/maker\n', contactPage: '', email: 'hello@maker.example', phone: '+44 20 7946 0000' })
    expect(info).toEqual({ website: 'https://maker.example/', links: ['https://instagram.com/maker'], email: 'hello@maker.example', phone: '+44 20 7946 0000' })

    const store = memoryStore()
    const shipped = channelByNumber(7)!
    saveCuratedEdit(shipped, { name: shipped.name, sources: [ytSource({ info })] }, 1, store)
    expect(loadCuratedEdit(7, store)?.sources.find((source) => source.id === 'own-1')?.info).toEqual(info)
    expect(sourcesOf(stored[0])[0].info?.email).toBe('press@ownmaker.example')
  })

  it('shows what a source is and where it lives, with public details behind a disclosure', () => {
    const html = renderToStaticMarkup(createElement(SourceDetails, { source: ytSource(), number: 1001, disabled: false, onInfo: () => undefined }))
    expect(html).toContain('<dt>Type</dt><dd>YouTube</dd>')
    expect(html).toContain('href="https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv"')
    expect(html).toMatch(/<details class="source-public"><summary>Public information \(optional\)<\/summary>/)
    expect(html).toContain('TVN never looks these up')
    const stream = renderToStaticMarkup(
      createElement(SourceDetails, { source: ytSource({ kind: 'audio', url: 'https://radio.example.com/live.mp3', ref: undefined }), number: 1001, disabled: false, onInfo: () => undefined }),
    )
    expect(stream).not.toContain('<dd>YouTube</dd>')
    expect(read('src/components/ChannelEditor.tsx')).toContain('<SourceDetails source={source}')
  })
})

describe('a large catalogue', () => {
  it('builds the roll quickly and draws only a screenful of it', () => {
    const started = performance.now()
    const roll = buildRoll({ channels: listChannels(), poolOf, register, stored, curated: {} })
    expect(performance.now() - started).toBeLessThan(5000)
    expect(roll.lines.length).toBeGreaterThan(1000)
    expect(roll.offsets).toHaveLength(roll.lines.length + 1)
    const total = roll.offsets[roll.offsets.length - 1]
    for (const top of [0, total / 3, total - 900]) {
      const [from, to] = visibleRange(roll.offsets, top, 1080)
      expect(to - from).toBeLessThanOrEqual(Math.ceil(1080 / Math.min(...Object.values(LINE_HEIGHT))) + 2)
      expect(roll.offsets[from]).toBeLessThanOrEqual(top)
    }
    const component = read('src/credits/CreditsRoll.tsx')
    expect(component).toContain('placed.map(')
    expect(component).toContain('requestAnimationFrame')
    expect(component).toContain("prefers-reduced-motion: reduce")
    expect(read('src/app/TvScreen.tsx')).toContain('{tv.credits ? <CreditsRoll /> : null}')
  })
})

describe('first-run notice and legal', () => {
  it('remembers acknowledgement, and Legal stays reachable afterwards', () => {
    const store = memoryStore()
    expect(noticeAcknowledged(store)).toBe(false)
    acknowledgeNotice(store)
    expect(noticeAcknowledged(store)).toBe(true)
    expect(store.getItem(NOTICE_KEY)).toBeTruthy()
    const remote = read('src/components/TouchRemote.tsx')
    expect(remote).toContain('About · Sources · Legal')
    expect(remote).toContain('openAbout()')
    expect(read('src/app/TvScreen.tsx')).toContain("tv.startupPhase === 'ready' && !noticeSeen ? <FirstRunNotice startNewNetwork={tv.startNewNetwork} networkCustomised={tv.networkCustomised} /> : null")
  })

  it('says what it must, and nothing it must not', () => {
    const notice = renderToStaticMarkup(createElement(FirstRunNotice))
    const about = renderToStaticMarkup(createElement(AboutPanel))
    for (const html of [notice, about]) {
      expect(html).toContain(`href="${YOUTUBE_TERMS}"`)
      expect(html).toContain(`href="${GOOGLE_PRIVACY}"`)
      expect(html.toLowerCase()).not.toContain('infringement intended')
    }
    expect(notice).toContain('independent television and media interface')
    expect(notice).toContain('hosted and delivered by their providers')
    expect(notice).toContain('claims no ownership')
    expect(notice).toContain('direct video, live streams or radio')
    expect(notice).toContain('Channel 1000')
    expect(notice).toContain('CREDITS')
    expect(about).toContain('not all TVN programming comes from YouTube')
    expect(about).toContain('YouTube does not operate, sponsor or endorse TVN')
    expect(about).toContain('never presented as YouTube')
    expect(about).toContain('not a claim of ownership')
    for (const topic of FEEDBACK_TOPICS) expect(CORRECTION_TEMPLATE).toContain(topic)
    expect(LEGAL_SECTIONS.map((section) => section.id)).toEqual([
      'about',
      'programming',
      'youtube',
      'providers',
      'channel-000',
      'channel-1000',
      'user-network',
      'credits',
      'privacy',
      'rights',
      'corrections',
      'independence',
      'version',
    ])
    for (const section of LEGAL_SECTIONS) expect(about).toContain(section.title.replace(/&/g, '&amp;'))
    expect(about).toContain('Google Fonts')
    expect(about).toContain('does not make a programme public domain')
  })

  it('keeps the rights contact out of the About panel until Contact TVN is opened', () => {
    expect(contactLink('x')).toContain(`mailto:${CONTACT_EMAIL}`)
    expect(renderToStaticMarkup(createElement(AboutPanel))).not.toContain('mailto:')
  })
})

describe('Multi View and YouTube', () => {
  it('runs one YouTube player, on the tile being heard; other YouTube tiles show a still; radio tiles are unchanged', () => {
    const tile = read('src/components/BroadcastTile.tsx')
    expect(tile).toContain('const embed = active && tileEmbeds({ focused, ...size })')
    expect(tile).toContain('{!audio && embed && ready ? (')
    expect(tile).toMatch(/<div className="tile-player">\s*<YoutubeStage/)
    expect(tile).toMatch(/const still = !audio && !embed && thumbnail && snap\?\.current\.programme\.videoId \? `https:\/\/i\.ytimg\.com\/vi\/\$\{snap\.current\.programme\.videoId\}\/hqdefault\.jpg`/)
    expect(tile).toContain('{audio ? <RadioFace channel={channel} compact /> : null}')
    expect(read('src/app/TvScreen.tsx')).toContain('<MultiviewGrid width={width} />')
  })
})

describe('the public network', () => {
  it('has no NASA channel, and the starter network is user data rather than part of the curated network', () => {
    expect(listChannels().some((channel) => /\bnasa\b/i.test(channel.name))).toBe(false)
    expect(Object.values(register.sources).some((entry) => /\bnasa\b/i.test(entry.name))).toBe(false)
    expect(read('src/data/user-network/bootstrap.ts')).toContain('Nothing is installed here')
  })
})
