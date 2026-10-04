import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { classifyChoice, newSource, SOURCE_CHOICES, youTubeLinkType, type ChannelSource } from './services/channel-sources.ts'
import { rescanSources, withWebsiteSlot } from './services/channel-editor.ts'
import { addPodcastChannel } from './services/user-network.ts'
import { channelsFromSources } from './services/channels-import.ts'
import { exportSource } from './services/user-network-export.ts'
import { channelSource } from './services/user-network-restore.ts'
import { playbackCommand } from './player/command.ts'
import { routeFor } from './player/routed.ts'
import { endWebSlot, setWebShown, showableWebUrl, startWebInteraction, stopWebInteraction, webInteraction } from './player/web-interaction.ts'
import { focusedProviderFrame } from './player/picture-shield.ts'
import { surfLabel } from './view/info-shortcuts.ts'

const NOT_EMBEDDABLE = 'SITE CANNOT BE EMBEDDED: it does not allow other sites to show it'
const MIX = 'https://www.youtube.com/watch?v=cUUlzkI4Ivc&list=RDcUUlzkI4Ivc&start_radio=1'
const X_POST = 'https://x.com/OptiJogos/status/2106446792686715186/video/1'

describe('Surf button: the active User Network name', () => {
  it('shows the network name, never a literal T, falling back to USER', () => {
    expect(surfLabel('TVN')).toBe('TVN')
    expect(surfLabel('Ann')).toBe('ANN')
    expect(surfLabel('  Late   Night ')).toBe('LATE NIGHT')
    expect(surfLabel('')).toBe('USER')
    expect(surfLabel(undefined)).toBe('USER')
  })

  it('renders long names smaller instead of overflowing the pad', () => {
    const actions = readFileSync('src/components/InfoActions.tsx', 'utf8')
    const css = readFileSync('src/styles/guide.css', 'utf8')
    expect(actions).toContain('shortcut.labelOf?.(context) ?? shortcut.label')
    expect(css).toMatch(/\.is-random\.is-long\s*\{/)
    expect(css).toMatch(/text-overflow: ellipsis/)
  })
})

describe('Detect: only the types the runtime supports', () => {
  it('the editor keeps the list= of a Mix link so a rescan still finds its seed', () => {
    expect(classifyChoice(MIX, 'youtube-mix')).toEqual({ kind: 'youtube', url: MIX })
    expect(() => classifyChoice(MIX, 'youtube-playlist')).toThrow(/is a Mix, not a playlist/)
    expect(youTubeLinkType(MIX)).toBe('mix')
    expect(youTubeLinkType('https://www.youtube.com/playlist?list=PLFs4vir_WsTwEd-nJgVJCZPNL3HALHHpF')).toBe('playlist')
    expect(youTubeLinkType('https://www.youtube.com/@kurzgesagt')).toBe('channel')
  })
  it('lists Detect first, then each supported type', () => {
    expect(SOURCE_CHOICES[0]).toEqual({ value: 'auto', label: 'Detect' })
    const labels = SOURCE_CHOICES.map((choice) => choice.label).join(' | ')
    for (const word of ['YouTube video', 'YouTube channel', 'YouTube playlist', 'YouTube Mix', 'Podcast / RSS', 'Website', 'X / Twitter post', 'Vimeo', 'Odysee', 'BitChute', 'HLS', 'Direct media']) {
      expect(labels).toContain(word)
    }
  })

  it('a chosen type corrects detection but never forces an address into something it is not', () => {
    expect(classifyChoice('https://example.com/', 'website')).toEqual({ kind: 'website', url: 'https://example.com/' })
    expect(classifyChoice(X_POST, 'auto').kind).toBe('website')
    expect(classifyChoice(X_POST, 'x-post').kind).toBe('website')
    expect(() => classifyChoice('https://x.com/OptiJogos', 'x-post')).toThrow(/one public X post/)
    expect(() => classifyChoice('https://example.com/a', 'vimeo')).toThrow(/not a Vimeo address/)
    expect(classifyChoice('https://vimeo.com/123456', 'vimeo')).toEqual({ kind: 'podcast', url: 'https://vimeo.com/123456' })
    expect(() => classifyChoice('https://example.com/page', 'media-file')).toThrow(/media file/)
    expect(() => classifyChoice('javascript:alert(1)', 'website')).toThrow()
    expect(() => classifyChoice('http://example.com/', 'website')).toThrow()
    expect(newSource([], 'https://example.com/', 'website').kind).toBe('website')
  })
})

describe('Website programmes', () => {
  it('becomes a website programme the player shows in its own frame route', () => {
    const episodes = [{ id: 'web-1', title: 'Open', durationSec: 600, media: 'https://open.example/', web: 'website' as const }]
    const added = addPodcastChannel([], { feedUrl: 'https://open.example/', title: 'Open', episodes }, 1)
    expect(added.sources[0].channelSources?.[0].kind).toBe('website')
    const built = channelsFromSources(added.sources)
    const programme = [...built.programmes.values()][0]![0]!
    expect(programme).toMatchObject({ programmeType: 'website', mediaUrl: 'https://open.example/', videoId: null })
    const command = playbackCommand(programme, 42, null)
    expect(command).toMatchObject({ videoId: null, webUrl: 'https://open.example/', startSeconds: 42 })
    expect(routeFor({ ...command, videoId: null } as never)).toBe('web')
  })

  it('the editor slot is 5, 10, 15 or 30 minutes, or any length from 1 minute to 6 hours', () => {
    const source: ChannelSource = { id: 's1', kind: 'website', url: 'https://open.example/', label: '', enabled: true, status: { state: 'ready', checkedAt: 0 }, videos: [{ id: 'w', title: 'W', durationSec: 600, media: 'https://open.example/', web: 'website' }] }
    expect(withWebsiteSlot(source, 300).videos?.[0].durationSec).toBe(300)
    expect(withWebsiteSlot(source, 42 * 60).videos?.[0].durationSec).toBe(2520)
    expect(withWebsiteSlot(source, 30)).toBe(source)
    expect(withWebsiteSlot(source, 7 * 3600)).toBe(source)
    const exported = exportSource(withWebsiteSlot(source, 900), () => null)
    expect(exported).toMatchObject({ sourceType: 'website', url: 'https://open.example/', slotSeconds: 900 })
    expect(channelSource(exported, 0)).toMatchObject({ kind: 'website', url: 'https://open.example/' })
  })

  it('a rescan marks a refusing site unavailable and keeps what it held when the network fails', async () => {
    const source: ChannelSource = { id: 's1', kind: 'website', url: 'https://closed.example/', label: '', enabled: true, status: { state: 'unchecked', checkedAt: 0 } }
    const refused = await rescanSources([source], { resolveFeed: async () => Promise.reject(new Error(NOT_EMBEDDABLE)) } as never, 5)
    expect(refused[0]?.status?.state).toBe('unavailable')
    const offline = await rescanSources([{ ...source, videos: [{ id: 'w', title: 'W', durationSec: 900, media: 'https://closed.example/', web: 'website' }] }], { resolveFeed: async () => Promise.reject(new Error('That site could not be reached')) } as never, 5)
    expect(offline[0]?.status?.state).toBe('failed')
    expect(offline[0].videos).toHaveLength(1)
  })

  it('shows only https pages (or this computer in development), never TVN itself, a script or credentials', () => {
    const live = { origin: 'https://tvn.lol', hostname: 'tvn.lol' }
    const dev = { origin: 'http://127.0.0.1:5182', hostname: '127.0.0.1' }
    expect(showableWebUrl('https://example.com/', live)).toBe('https://example.com/')
    expect(showableWebUrl('http://example.com/', live)).toBeNull()
    expect(showableWebUrl('javascript:alert(1)', live)).toBeNull()
    expect(showableWebUrl('data:text/html,<script>1</script>', live)).toBeNull()
    expect(showableWebUrl('https://user:pw@example.com/', live)).toBeNull()
    expect(showableWebUrl('https://tvn.lol/', live)).toBeNull()
    expect(showableWebUrl('http://localhost:3000/', live)).toBeNull()
    expect(showableWebUrl('http://localhost:3000/', dev)).toBe('http://localhost:3000/')
  })

  it('INTERACT only while a website is on screen; EXIT returns control; a slot ending mid-use is noted', () => {
    setWebShown(false)
    stopWebInteraction()
    startWebInteraction()
    expect(webInteraction().interacting).toBe(false)
    setWebShown(true)
    startWebInteraction()
    expect(webInteraction().interacting).toBe(true)
    stopWebInteraction()
    expect(webInteraction().interacting).toBe(false)
    startWebInteraction()
    endWebSlot(1234)
    expect(webInteraction()).toMatchObject({ interacting: false, endedAt: 1234 })
    startWebInteraction()
    setWebShown(false, 5678)
    expect(webInteraction()).toMatchObject({ shown: false, interacting: false, endedAt: 5678 })
  })

  it('the frame is sandboxed, under the glass until INTERACT, and Esc / EXIT hand control back', () => {
    const stage = readFileSync('src/player/WebStage.tsx', 'utf8')
    const screen = readFileSync('src/app/TvScreen.tsx', 'utf8')
    const css = readFileSync('src/styles/shell.css', 'utf8')
    expect(stage).toContain('sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-pointer-lock allow-presentation"')
    expect(stage).not.toMatch(/allow-top-navigation/)
    expect(stage).not.toMatch(/srcdoc|dangerouslySetInnerHTML|contentWindow|contentDocument/)
    expect(screen).toContain('{web.interacting ? null : <PictureCatch />}')
    expect(screen).toMatch(/event\.key !== 'Escape'[\s\S]*stopWebInteraction\(\)/)
    expect(screen).toContain('Exit · Esc')
    expect(css).toMatch(/\.stage iframe\.web-host\.is-interacting\s*\{\s*pointer-events: auto;/)
  })

  it('the focus shield lets go only of a website being used', () => {
    const frame = (classes: string[]) => ({ tagName: 'IFRAME', classList: { contains: (name: string) => classes.includes(name) }, closest: () => ({}) })
    expect(focusedProviderFrame({ activeElement: frame(['web-host', 'is-interacting']) } as unknown as Document)).toBeNull()
    expect(focusedProviderFrame({ activeElement: frame(['web-host']) } as unknown as Document)).not.toBeNull()
    expect(focusedProviderFrame({ activeElement: frame([]) } as unknown as Document)).not.toBeNull()
  })
})

describe('SMART remote control', () => {
  it('is a circular on/off control in the remote, still arming numeric entry', () => {
    const remote = readFileSync('src/components/TouchRemote.tsx', 'utf8')
    const css = readFileSync('src/styles/stage2.css', 'utf8')
    expect(remote).toContain('aria-label="Smart"')
    expect(remote).toContain("tv.smart ? 'smart-key is-on' : 'smart-key'")
    expect(remote).toContain('aria-pressed')
    expect(css).toMatch(/\.remote-row \.smart-key\s*\{[^}]*border-radius: 50%/)
  })
})
