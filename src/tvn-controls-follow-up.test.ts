import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProgrammeInfo } from './components/ProgrammeInfo.tsx'
import { handleOfChannelPage, programmeAttribution, youtubeChannelPage } from './credits/attribution.ts'
import { EMPTY_REGISTER, type SourceRegister } from './credits/provenance.ts'
import type { MediaItem } from './director/types.ts'
import { commandFromKey, commandFromKeyEvent } from './input/keyboard.ts'
import { createSpaceHold } from './input/space-hold.ts'
import { expandPlayableCatalogue } from './library/playable-catalogue.ts'
import { clearManual, manualAiring, resumeProgramme } from './player/manual.ts'
import { lookUpBatch } from './services/add-channel.ts'
import { channelsFromSources, creatorFields, videoCreator, type ImportedVideo, type StoredSource } from './services/channels-import.ts'
import { keepingDates } from './services/channel-curation.ts'
import { setShippedArchive, uploaderArchive } from './services/user-archive.ts'
import { buildUserNetworkExport, validateUserNetworkExport } from './services/user-network-export.ts'
import { recordsFromExport } from './services/user-network-restore.ts'
import type { Channel } from './types/channel.ts'
import type { Programme } from './types/programme.ts'
import { programmeDate } from './view/programme-date.ts'
import { alphabeticalVideos, latestVideos, rebuiltVideos, shuffledVideos } from './view/programme-order.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const provider = read('src/state/TvProvider.tsx')
const plain = { meta: false, ctrl: false, alt: false }
const NOW = Date.UTC(2026, 9, 4, 12)
const TOM = 'UCBa659QWEk1AI4Tg--mrJ2A'

afterEach(() => {
  vi.useRealTimers()
  clearManual()
})

describe('KEYBOARD: P pauses, Space surfs, a held Space switches the surf scope', () => {
  it('P is Pause/Resume through the existing play-pause command; Space is TV Surf through the existing random-channel command', () => {
    expect(commandFromKey('p', plain, false)).toEqual({ type: 'play-pause' })
    expect(commandFromKey('P', plain, true)).toEqual({ type: 'play-pause' })
    expect(commandFromKey(' ', plain, false)).toEqual({ type: 'random-channel' })
    expect(commandFromKey(' ', plain, true)).toBeNull()
    expect(provider.match(/case 'play-pause'/g)).toHaveLength(1)
    expect(provider).toContain("dispatchRef.current({ type: 'random-channel' })")
  })

  it('the remaining keys keep their meaning: S favourite, - = zoom, / multi, , . previous / next, R cycles the Guide tabs', () => {
    expect(commandFromKey('s', plain, false)).toEqual({ type: 'favourite' })
    expect(commandFromKey('-', plain, true)).toEqual({ type: 'guide-zoom', direction: -1 })
    expect(commandFromKey('=', plain, true)).toEqual({ type: 'guide-zoom', direction: 1 })
    expect(commandFromKey('/', plain, false)).toEqual({ type: 'multiview' })
    expect(commandFromKey(',', plain, false)).toEqual({ type: 'history-back' })
    expect(commandFromKey('.', plain, false)).toEqual({ type: 'history-forward' })
    expect(commandFromKey('r', plain, false)).toEqual({ type: 'guide-cycle' })
    expect(commandFromKey(' ', plain, false)).toEqual({ type: 'random-channel' })
  })

  it('typing in an input, a textarea or an editable element reaches no TVN shortcut', () => {
    for (const key of ['p', ' ', 's', '-', '=', '/', ',', '.']) {
      for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'DIV', isContentEditable: true }]) {
        expect(commandFromKeyEvent({ key, metaKey: false, ctrlKey: false, altKey: false, target } as unknown as KeyboardEvent, false)).toBeNull()
      }
    }
  })

  it('a short press surfs once; nothing else', () => {
    vi.useFakeTimers()
    const surf = vi.fn()
    const toggle = vi.fn()
    const space = createSpaceHold({ surf, toggle, delayMs: 500 })
    space.down(false)
    vi.advanceTimersByTime(200)
    space.up()
    vi.advanceTimersByTime(1000)
    expect(surf).toHaveBeenCalledTimes(1)
    expect(toggle).not.toHaveBeenCalled()
  })

  it('a hold switches the scope exactly once, never surfs, and does nothing on release; auto-repeat is ignored', () => {
    vi.useFakeTimers()
    const surf = vi.fn()
    const toggle = vi.fn()
    const space = createSpaceHold({ surf, toggle, delayMs: 500 })
    space.down(false)
    for (let index = 0; index < 20; index += 1) {
      vi.advanceTimersByTime(100)
      space.down(true)
    }
    vi.advanceTimersByTime(3000)
    space.up()
    expect(toggle).toHaveBeenCalledTimes(1)
    expect(surf).not.toHaveBeenCalled()
    space.up()
    expect(surf).not.toHaveBeenCalled()
  })

  it('losing focus mid-press cancels it: no surf, no switch', () => {
    vi.useFakeTimers()
    const surf = vi.fn()
    const toggle = vi.fn()
    const space = createSpaceHold({ surf, toggle, delayMs: 500 })
    space.down(false)
    space.cancel()
    vi.advanceTimersByTime(1000)
    space.up()
    expect(surf).not.toHaveBeenCalled()
    expect(toggle).not.toHaveBeenCalled()
  })

  it('the provider hands Space to the hold, skips text fields, and takes no key while a website is being used', () => {
    const effect = provider.slice(provider.indexOf('const space = createSpaceHold({'), provider.indexOf("window.removeEventListener('keyup'"))
    expect(effect).toContain('toggleSurfScopeRef.current()')
    expect(effect).toContain('isEditableTarget(event.target)')
    expect(effect).toMatch(/if \(webInteraction\(\)\.interacting\) return/)
    expect(effect).toContain('space.down(event.repeat)')
    expect(effect).toContain("window.addEventListener('blur', onBlur)")
  })

  it('the Surf button still shows the User Network name, and the help names Space, P and the hold', () => {
    const hints = read('src/components/Hints.tsx')
    expect(hints).toContain('Space Surf (hold: ALL / network)')
    expect(hints).toContain('P Pause')
    expect(hints).not.toContain('T Surf')
    expect(read('README.md')).toContain('| P | Pause; again to resume')
    expect(read('README.md')).not.toContain('| Space | Pause')
    expect(read('src/components/TouchRemote.tsx')).toContain("title={tv.paused ? 'Resume (P)' : 'Pause (P)'} aria-pressed={tv.paused} onClick")
  })
})

describe('WEBSITE: interaction owns the keys; a paused website resumes where it was', () => {
  const site = { id: 'w', title: 'Site', videoId: null, durationSeconds: 600, programmeType: 'website' } as Programme

  it('resuming carries on from the paused position however long the pause lasted', () => {
    const later = NOW + 3 * 3_600_000
    const airing = resumeProgramme(1001, site, 120, later, { startMs: NOW - 120_000, endMs: NOW + 480_000 })
    expect(airing?.startMs).toBe(later - 120_000)
    expect(airing?.endMs).toBe(later + 480_000)
    expect(manualAiring(1001, later + 60_000)?.programme).toBe(site)
    expect(manualAiring(1001, later + 480_001)).toBeNull()
  })

  it('a programme already at its end is not resumed', () => {
    expect(resumeProgramme(1001, site, 600, NOW)).toBeNull()
  })

  it('pause records a website or post on screen, and resume hands it back through the manual airing', () => {
    const pause = provider.slice(provider.indexOf("case 'play-pause'"), provider.indexOf("case 'mute'"))
    expect(pause).toMatch(/programmeType === 'website' \|\| .*programmeType === 'social-post'/)
    expect(provider).toContain('resumeProgramme(held.channelNumber, held.programme, held.elapsedSeconds, Date.now(), held.slot)')
  })

  it('the bar says how to give the keys back, without a modal', () => {
    const screen = read('src/app/TvScreen.tsx')
    expect(screen).toContain('Interacting · Esc to TVN')
    expect(screen).toContain('stopImmediatePropagation')
  })
})

describe('INFORMATION OVERLAY: the creator after the channel name', () => {
  const channel = { number: 1001, name: 'Science', origin: 'user' } as unknown as Channel
  const base = { id: 'p', title: 'Video', description: '', videoId: 'YrZyJuaBfKA', durationSeconds: 600, channelId: 'c', category: 'User', source: 'imported', kind: 'programme', playbackMode: 'linear' } as Programme
  const markup = (programme: Programme) =>
    renderToStaticMarkup(createElement(ProgrammeInfo, { channel, programme, startMs: NOW, endMs: NOW + 600_000, now: NOW + 1000 }))

  it('shows the real @handle as a small, safe link to the creator\'s channel', () => {
    const html = markup({ ...base, ...creatorFields({ name: 'Tom Scott', channelId: TOM, handle: 'TomScottGo' }) })
    expect(html).toContain('<a class="info-creator" href="https://www.youtube.com/@TomScottGo" target="_blank" rel="noopener noreferrer">@TomScottGo</a>')
    expect(html.indexOf('Science')).toBeLessThan(html.indexOf('@TomScottGo'))
    expect(html).toMatch(/<span>Science<\/span><a class="info-creator"[^>]*>@TomScottGo<\/a><\/p><h2 class="info-title">Video<\/h2>/)
    expect(html).not.toMatch(/<p class="info-kicker"[^>]*onclick|<a[^>]*class="info-kicker"/i)
  })

  it('without a handle it shows the name, linking the channel id page; a handle is never made from the name', () => {
    const html = markup({ ...base, ...creatorFields({ name: 'Tom Scott', channelId: TOM }) })
    expect(html).toContain(`href="https://www.youtube.com/channel/${TOM}"`)
    expect(html).toContain('>Tom Scott</a>')
    expect(html).not.toContain('@Tom')
  })

  it('shows nothing at all when no record names a creator', () => {
    const html = markup(base)
    expect(html).not.toContain('info-creator')
    expect(html).not.toMatch(/UNKNOWN|N\/A|@unknown/i)
  })

  it('TVN catalogue programmes take the creator from the shipped source register, by the catalogue\'s source', () => {
    const library = [{ provider: 'youtube', externalId: 'YrZyJuaBfKA', sourceId: 'src_tom' }] as unknown as MediaItem[]
    const register: SourceRegister = {
      format: 'tvn-source-register-v1',
      sources: {
        src_tom: { name: 'Tom Scott', provider: 'YouTube', channelUrl: 'https://www.youtube.com/@TomScottGo' },
        src_id: { name: 'By Id', provider: 'YouTube', channelUrl: `https://www.youtube.com/channel/${TOM}` },
      },
    }
    expect(programmeAttribution(base, register, library)).toEqual({ text: '@TomScottGo', url: 'https://www.youtube.com/@TomScottGo' })
    const byId = [{ provider: 'youtube', externalId: 'YrZyJuaBfKA', sourceId: 'src_id' }] as unknown as MediaItem[]
    expect(programmeAttribution(base, register, byId)).toEqual({ text: 'By Id', url: `https://www.youtube.com/channel/${TOM}` })
    expect(programmeAttribution(base, EMPTY_REGISTER, library)).toBeNull()
  })

  it('only a YouTube channel address becomes a link; other schemes and hosts are dropped', () => {
    expect(youtubeChannelPage('javascript:alert(1)')).toBeUndefined()
    expect(youtubeChannelPage('https://evil.example/@x')).toBeUndefined()
    expect(youtubeChannelPage('http://www.youtube.com/@TomScottGo')).toBe('https://www.youtube.com/@TomScottGo')
    expect(handleOfChannelPage('https://www.youtube.com/user/tom')).toBeUndefined()
    const programme = { ...base, creator: 'X', creatorUrl: 'javascript:alert(1)' }
    expect(programmeAttribution(programme, EMPTY_REGISTER, [])).toEqual({ text: 'X' })
  })

  it('streams, podcasts and websites carry no YouTube creator line', () => {
    expect(programmeAttribution({ ...base, videoId: null, mediaUrl: 'https://a.example/e.mp3', creator: 'Feed' }, EMPTY_REGISTER, [])).toBeNull()
  })

  it('stored creators are validated: a malformed handle or channel id is dropped, the name kept', () => {
    expect(videoCreator({ name: ' Tom Scott ', channelId: TOM, handle: 'TomScottGo' })).toEqual({ name: 'Tom Scott', channelId: TOM, handle: 'TomScottGo' })
    expect(videoCreator({ name: 'Tom', channelId: 'nope', handle: 'has space' })).toEqual({ name: 'Tom' })
    expect(videoCreator({ name: '' })).toBeUndefined()
    expect(videoCreator(null)).toBeUndefined()
  })

  it('the overlay never looks anything up: the register is read once per visit, after the start', () => {
    expect(read('src/credits/attribution.ts')).not.toMatch(/fetch\(/)
    expect(provider).toMatch(/reached\(3\)\s+void loadRegister\(\)/)
  })
})

describe('LOAD MORE', () => {
  it('LOAD MORE keeps a batch\'s days and creators on the way into the editor', async () => {
    const read = (async () =>
      new Response(JSON.stringify({ videos: [{ id: 'c1AaQdWgP2c', title: 'More', durationSec: 700, published: '2025-05-28', creator: { name: 'Rick Astley', channelId: TOM } }] }), {
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch
    const batch = await lookUpBatch('cursor', read)
    expect(batch.videos[0]).toMatchObject({ published: '2025-05-28', creator: { name: 'Rick Astley', channelId: TOM } })
  })
})

describe('DATES: an upload day survives every step to the overlay', () => {
  const dated: ImportedVideo = { id: 'YrZyJuaBfKA', title: 'Dated', durationSec: 900, published: '2024-07-18', creator: { name: 'Tom Scott', channelId: TOM, handle: 'TomScottGo' } }
  const undated: ImportedVideo = { id: 'NxZOBBenmZM', title: 'Undated', durationSec: 900 }
  const record: StoredSource = {
    id: 'list:Dated',
    name: 'Dated',
    videos: [dated, undated],
    channelNumber: 1001,
    inLibrary: false,
    automatic: true,
    updatedAt: NOW,
    channelSources: [{ id: 's1', kind: 'collection', url: '', label: 'Dated', enabled: true, ref: 'Dated', videos: [dated, undated] }],
  }

  it('a rescan that gives no day keeps the day an earlier read found', () => {
    const [kept] = keepingDates([{ ...dated, published: undefined }], [dated])
    expect(kept.published).toBe('2024-07-18')
  })

  it('the channel built from the source carries the day and the creator onto each programme; an unknown day stays unknown', () => {
    const programmes = [...channelsFromSources([record]).programmes.values()].flat()
    const a = programmes.find((programme) => programme.videoId === dated.id)!
    const b = programmes.find((programme) => programme.videoId === undated.id)!
    expect(a.publishedAt).toBe('2024-07-18')
    expect(a.creatorHandle).toBe('TomScottGo')
    expect(programmeDate(a)).toBe('(18/07/24)')
    expect(b.publishedAt).toBeUndefined()
    expect(b.creator).toBeUndefined()
    expect(programmeDate(b)).toBe('(--/--/--)')
  })

  it('LATEST orders by the day; A–Z, RANDOMISE and REBUILD keep it on each programme', () => {
    const older = { ...dated, id: 'older000000', published: '2020-01-01' }
    expect(latestVideos([older, dated, undated]).map((video) => video.id)).toEqual([dated.id, older.id, undated.id])
    const rows: (ImportedVideo & { from?: string })[] = [undated, dated]
    for (const ordered of [alphabeticalVideos(rows), shuffledVideos(rows), rebuiltVideos(rows)]) {
      expect(ordered.find((video) => video.id === dated.id)?.published).toBe('2024-07-18')
      expect(ordered.find((video) => video.id === undated.id)?.published).toBeUndefined()
    }
  })

  it('export and restore keep each day and creator, and a missing day stays missing', () => {
    const document = buildUserNetworkExport([record], new Date(NOW))
    const json = JSON.parse(JSON.stringify(document))
    expect(validateUserNetworkExport(json).ok).toBe(true)
    const [back] = recordsFromExport(json, NOW)
    const videos = back.channelSources?.[0].videos ?? []
    expect(videos.find((video) => video.id === dated.id)).toMatchObject({ published: '2024-07-18', creator: dated.creator })
    expect(videos.find((video) => video.id === undated.id)?.published).toBeUndefined()
  })

  it('the shipped uploader archive credits each video to the uploader it is filed under', () => {
    setShippedArchive({ collections: {}, uploaders: { [TOM]: { title: 'Tom Scott', videos: [['YrZyJuaBfKA', 'Dated', 900, '2024-07-18']] } } })
    const archive = uploaderArchive({ id: `yt:${TOM}`, name: 'Tom' } as never)
    expect(archive?.videos[0]).toMatchObject({ published: '2024-07-18', creator: { name: 'Tom Scott', channelId: TOM } })
    setShippedArchive(null)
  })

  it('the TVN catalogue reads the Data API upload day the build now keeps, after any rolling-channel time', () => {
    const doc = {
      format: 'retrotv-playable-v2',
      generatedAt: 1,
      sources: { src_a: 'A' },
      items: [
        ['YrZyJuaBfKA', 'One', 900, 'src_a', [1], 'api'],
        ['omYfLDlt-MA', 'Two', 900, 'src_a', [1], 'api'],
        ['NxZOBBenmZM', 'Three', 900, 'src_a', [1], 'api'],
      ],
      published: { 'omYfLDlt-MA': '2026-06-08T10:00:00Z' },
      uploaded: { YrZyJuaBfKA: '2024-07-18', 'omYfLDlt-MA': '2026-01-01' },
    }
    const items = expandPlayableCatalogue(doc)
    const day = (id: string) => items.find((item) => item.externalId === id)?.publishedAt
    expect(day('YrZyJuaBfKA')).toBe('2024-07-18')
    expect(day('omYfLDlt-MA')).toBe('2026-06-08T10:00:00Z')
    expect(day('NxZOBBenmZM')).toBeUndefined()
    const script = read('scripts/add_targeted_sources.py')
    expect(script).toContain('UPLOADED[video["id"]] = snippet["publishedAt"][:10]')
    expect(script).toContain('doc.setdefault("uploaded", {}).update(')
  })
})

describe('FAVOURITES: S confirms what it did', () => {
  it('a small notice says the result: added or removed', () => {
    const favourite = provider.slice(provider.indexOf("case 'favourite'"), provider.indexOf("case 'favourite'") + 900)
    expect(favourite).toContain('const adding = !favouritesRef.current.includes(number)')
    expect(favourite).toContain('★ FAVOURITE')
    expect(favourite).toContain('☆ FAVOURITE REMOVED')
  })

  it('the notice fades in, takes no pointer and no focus', () => {
    const css = read('src/styles/overlays.css')
    expect(css).toMatch(/\.notice \{[^}]*pointer-events: none;[^}]*animation: notice-in/)
    expect(read('src/app/TvScreen.tsx')).toMatch(/<div className="notice"/)
  })
})
