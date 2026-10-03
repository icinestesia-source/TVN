import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { screenFace } from '../app/screen-face.ts'
import { SESSION_CARD_COPY, SessionCard } from '../components/SessionCard.tsx'
import { GuideActions, SessionImportTools, UserNetworkTools } from '../components/GuideAdd.tsx'

const actions = () =>
  renderToStaticMarkup(createElement(GuideActions, { tool: null, picked: false, onNow: () => undefined, onTool: () => undefined }))
const importTools = () => renderToStaticMarkup(createElement(SessionImportTools, { onImport: async () => '' }))
const userTools = () =>
  renderToStaticMarkup(
    createElement(UserNetworkTools, { userChannels: 0, onImportList: async () => '', onLoadTest: async () => '', onRemoveStarter: async () => '', onRemoveAll: async () => '' }),
  )
import { adjacentChannel, channelByNumber, channels, listChannels, programmesFor, randomChannel } from '../data/catalogue.ts'
import { installUserCatalogue, userChannelList } from '../data/user-overlay.ts'
import { resetDirector } from '../director/director.ts'
import { mediaLibrary, setMediaLibrary } from '../director/library.ts'
import { searchGuideChannels } from '../epg/navigation.ts'
import { tunerStep } from '../input/tuner.ts'
import { expandPlayableCatalogue } from '../library/playable-catalogue.ts'
import { firstOnAir, isOnAir, refreshAiring } from '../network/airing.ts'
import { playbackCommand } from '../player/command.ts'
import { routedPlayer, type LocalPlayerHandle, type PlayerRoute } from '../player/routed.ts'
import type { PlayerHandle, PlayerLoadRequest } from '../player/types.ts'
import { broadcast, guideSlots } from '../services/broadcast.ts'
import { channelsFromSources, mergeParsedExports, parseChannelsExport, planImport } from '../services/channels-import.ts'
import { createStartupRestore } from '../state/startup-channel.ts'
import { resolveStartupTuning } from '../state/startup.ts'
import { commitTuned, type Tuned } from '../state/tuning.ts'
import {
  buildSessionItems,
  commitImport,
  importSummary,
  mediaKindOf,
  pickFolder,
  shuffleOnce,
  titleFromName,
  validDuration,
  type ImportDeps,
  type LocalFile,
} from './import.ts'
import {
  clearSession,
  noteLocalSource,
  rebaseSession,
  replaceSession,
  searchSession,
  SESSION_CHANNEL,
  sessionActive,
  sessionBroadcast,
  sessionChoice,
  sessionProgrammes,
  sessionRefresh,
  setUrlRevoker,
  type SessionItem,
} from './session-channel.ts'

const T0 = new Date('2026-09-28T20:00:00+01:00').getTime()
const MIN = 60_000
const revoked: string[] = []
const identity = () => 0.999999
const file = (name: string, type = ''): LocalFile => ({ name, type })
const item = (title: string, minutes: number, url = `blob:test/${title}`): SessionItem => ({ title, durationSeconds: minutes * 60, url, kind: 'video' })
const titles = () => sessionProgrammes().map((programme) => programme.title)
const current = (nowMs: number) => sessionBroadcast(nowMs).current

function deps(durations: Record<string, unknown>, extra: Partial<ImportDeps<LocalFile>> = {}): ImportDeps<LocalFile> & { made: string[]; dropped: string[] } {
  const made: string[] = []
  const dropped: string[] = []
  return {
    canPlay: (mime) => mime !== 'video/x-unplayable',
    createUrl: (picked) => {
      const url = `blob:test/${picked.name}`
      made.push(url)
      return url
    },
    revokeUrl: (url) => dropped.push(url),
    probe: async (url) => {
      const name = url.slice('blob:test/'.length)
      const value = durations[name]
      if (value instanceof Error) throw value
      return value as number | null
    },
    random: identity,
    made,
    dropped,
    ...extra,
  }
}

/** A-B-C-D, 30 minutes each, in that order, starting at T0. */
function fourFilms() {
  replaceSession(['Film A', 'Film B', 'Film C', 'Film D'].map((title) => item(title, 30)), T0)
}

function installUserChannels() {
  const merged = mergeParsedExports([
    parseChannelsExport(readFileSync('public/user-network/channels.txt', 'utf8')),
    parseChannelsExport(readFileSync('public/user-network/more-channels.txt', 'utf8')),
  ])
  const built = channelsFromSources(planImport([], merged, { library: true, automatic: true }, [], 1).sources)
  installUserCatalogue(built.channels, built.programmes)
}

beforeAll(() => {
  setUrlRevoker((url) => revoked.push(url))
  const items = expandPlayableCatalogue(JSON.parse(readFileSync('public/independent/playable.json', 'utf8')))
  installUserCatalogue([], new Map())
  resetDirector()
  setMediaLibrary(items)
  refreshAiring(items)
}, 60000)

beforeEach(() => {
  clearSession()
  noteLocalSource(null)
  revoked.length = 0
})

afterAll(() => {
  clearSession()
  installUserCatalogue([], new Map())
})

describe('1000 Local Media before import', () => {
  it('A: 1000 exists as the session channel, outside the curated catalogue; 000 is TVN', () => {
    expect(channelByNumber(1000)).toBe(SESSION_CHANNEL)
    expect(SESSION_CHANNEL).toMatchObject({ number: 1000, id: 'ch-1000', name: 'Local Media', origin: 'session' })
    expect(listChannels().find((channel) => channel.number > 999)).toBe(SESSION_CHANNEL)
    expect(channels.some((channel) => channel.number === 0 || channel.number === 1000)).toBe(false)
    expect(channelByNumber(0)?.origin).toBe('tvn')
    expect(sessionActive()).toBe(false)
  })

  it('B: empty 000 shows a deliberate import card and a guide entry, never a blank', () => {
    const programme = broadcast(SESSION_CHANNEL, T0).current.programme
    expect(screenFace(SESSION_CHANNEL, programme, 'slate')).toBe('session-empty')
    expect(screenFace(SESSION_CHANNEL, programme, 'playing')).toBe('session-empty')
    const card = renderToStaticMarkup(createElement(SessionCard))
    expect(card).toContain('1000')
    expect(card).toContain('Local Media')
    expect(card).toContain(SESSION_CARD_COPY.title)
    expect(card).toContain('SELECT MEDIA IN THE GUIDE, THEN FOLDER OR FILES, TO PLAY MEDIA FROM THIS DEVICE')
    const slots = guideSlots(SESSION_CHANNEL, T0 - 60 * MIN, T0 + 120 * MIN)
    expect(slots.length).toBeGreaterThan(0)
    expect(slots.every((slot) => slot.programme.title === 'Import media')).toBe(true)
  })

  it('C: MEDIA replaces the obsolete guide key text and reaches 1000 Local Media inside the Guide', () => {
    const guide = readFileSync('src/components/Guide.tsx', 'utf8')
    expect(guide).not.toMatch(/Arrows · Enter · Home · Esc/i)
    expect(guide).not.toContain('guide-help')
    expect(guide).toContain('<SessionImportTools onImport={tv.importSession} />')
    expect(actions()).toMatch(/<button[^>]*>Media<\/button>/)
    expect(importTools()).toMatch(/<button[^>]*>Files<\/button>/)
  })

  it('D: there is no Shuffle control anywhere in the guide', () => {
    for (const path of ['src/components/Guide.tsx', 'src/components/GuideAdd.tsx']) {
      expect(readFileSync(path, 'utf8'), path).not.toMatch(/shuffle/i)
    }
    for (const markup of [actions(), importTools(), userTools()]) expect(markup).not.toMatch(/shuffle/i)
  })
})

describe('building 1000 Local Media', () => {
  it('E: valid media becomes the session channel, on air with a local picture', async () => {
    const files = [file('Alpha.mp4', 'video/mp4'), file('Beta.webm', 'video/webm'), file('Gamma.mkv')]
    const result = await buildSessionItems(files, deps({ 'Alpha.mp4': 1800, 'Beta.webm': 2400, 'Gamma.mkv': 5400 }))
    expect(commitImport(result, T0)).toBe('1000 · LOCAL MEDIA · 3 PROGRAMMES')
    expect(sessionActive()).toBe(true)
    expect(new Set(titles())).toEqual(new Set(['Alpha', 'Beta', 'Gamma']))
    const programme = current(T0 + MIN).programme
    expect(programme.channelId).toBe('ch-1000')
    expect(screenFace(SESSION_CHANNEL, programme, 'playing')).toBe('picture')
    const command = playbackCommand(programme, 60, null)
    expect(command.localUrl).toMatch(/^blob:test\//)
    expect(command.videoId).toBeNull()
  })

  it('F: the order is randomised once, then stays put for the session', async () => {
    const names = Array.from({ length: 8 }, (_, index) => `Film ${index + 1}.mp4`)
    const seq = [0.1, 0.8, 0.3, 0.6, 0.2, 0.9, 0.4]
    let calls = 0
    const result = await buildSessionItems(
      names.map((name) => file(name, 'video/mp4')),
      deps(Object.fromEntries(names.map((name) => [name, 600])), { random: () => seq[calls++ % seq.length] }),
    )
    commitImport(result, T0)
    const order = titles()
    expect(order).not.toEqual(names.map(titleFromName))
    expect(order).toEqual(shuffleOnce(names.map(titleFromName), (() => { let n = 0; return () => seq[n++ % seq.length] })()))
    expect(calls).toBe(7)

    // Guide opened and closed, the viewer surfs away and back, playback runs on: the order never changes.
    guideSlots(SESSION_CHANNEL, T0, T0 + 240 * MIN)
    broadcast(channelByNumber(225)!, T0 + 30 * MIN)
    for (let minute = 0; minute < 200; minute += 7) current(T0 + minute * MIN)
    guideSlots(SESSION_CHANNEL, T0, T0 + 240 * MIN)
    expect(titles()).toEqual(order)
    expect(calls).toBe(7)
  })

  it('G: a new import replaces 1000 Local Media rather than adding to it', async () => {
    commitImport(await buildSessionItems([file('Old One.mp4', 'video/mp4'), file('Old Two.mp4', 'video/mp4')], deps({ 'Old One.mp4': 600, 'Old Two.mp4': 600 })), T0)
    commitImport(await buildSessionItems([file('New.mp4', 'video/mp4')], deps({ 'New.mp4': 900 })), T0 + 5 * MIN)
    expect(titles()).toEqual(['New'])
    expect(programmesFor('ch-1000').map((programme) => programme.title)).toEqual(['New'])
    expect(current(T0 + 5 * MIN).programme.title).toBe('New')
    expect(current(T0 + 5 * MIN).elapsedSeconds).toBe(0)
  })

  it('H: a single file makes a valid 1000 Local Media', async () => {
    commitImport(await buildSessionItems([file('Only Film.mov', 'video/quicktime')], deps({ 'Only Film.mov': 5400 })), T0)
    const snap = sessionBroadcast(T0 + 10 * MIN)
    expect(snap.current.programme.title).toBe('Only Film')
    expect(snap.next.programme.title).toBe('Only Film')
    expect(snap.current.seekSeconds).toBe(600)
  })

  it('I: unsupported and broken files are skipped without stopping the valid ones', async () => {
    const files = [
      file('Good One.mp4', 'video/mp4'),
      file('poster.jpg', 'image/jpeg'),
      file('notes.txt', 'text/plain'),
      file('.DS_Store'),
      file('subtitles.srt'),
      file('odd.xyz', 'video/x-unplayable'),
      file('Broken.mp4', 'video/mp4'),
      file('Throws.mp4', 'video/mp4'),
      file('Good Two.m4a', 'audio/mp4'),
    ]
    const d = deps({ 'Good One.mp4': 1200, 'Broken.mp4': null, 'Throws.mp4': new Error('NotSupportedError: DOMException'), 'Good Two.m4a': 300 })
    const result = await buildSessionItems(files, d)
    expect(result.items.map((entry) => entry.title).sort()).toEqual(['Good One', 'Good Two'])
    expect(result.skipped).toBe(7)
    expect(result.items.find((entry) => entry.title === 'Good Two')?.kind).toBe('audio')
    expect(d.made.sort()).toEqual(['blob:test/Broken.mp4', 'blob:test/Good One.mp4', 'blob:test/Good Two.m4a', 'blob:test/Throws.mp4'])
    expect(d.dropped.sort()).toEqual(['blob:test/Broken.mp4', 'blob:test/Throws.mp4'])
    expect(importSummary(result)).toBe('1000 · LOCAL MEDIA · 2 PROGRAMMES · 7 SKIPPED')
  })

  it('J: NaN, Infinity, zero, negative and sub-second durations never reach the schedule', async () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -5, 0.4, undefined, '90']) expect(validDuration(bad), String(bad)).toBe(false)
    expect(validDuration(1)).toBe(true)
    const names = ['nan.mp4', 'inf.mp4', 'zero.mp4', 'neg.mp4', 'tiny.mp4', 'fine.mp4']
    const result = await buildSessionItems(
      names.map((name) => file(name, 'video/mp4')),
      deps({ 'nan.mp4': Number.NaN, 'inf.mp4': Number.POSITIVE_INFINITY, 'zero.mp4': 0, 'neg.mp4': -5, 'tiny.mp4': 0.4, 'fine.mp4': 61.5 }),
    )
    commitImport(result, T0)
    expect(sessionProgrammes().map((programme) => [programme.title, programme.durationSeconds])).toEqual([['fine', 61.5]])
  })

  it('titles come from the file name without the extension, and the name is not otherwise touched', () => {
    expect(titleFromName('RoboCop (1987).mkv')).toBe('RoboCop (1987)')
    expect(titleFromName('My_Holiday_Video.MP4')).toBe('My Holiday Video')
    expect(titleFromName('folder/sub/Clip.final.webm')).toBe('Clip.final')
    expect(mediaKindOf(file('clip.MP4'), () => true)).toBe('video')
    expect(mediaKindOf(file('photo.png', 'image/png'), () => true)).toBeNull()
  })
})

describe('1000 Local Media as television', () => {
  it('K: has Now/Next and guide entries in running order', () => {
    replaceSession(shuffleOnce([item('Film A', 30), item('Film B', 45), item('Film C', 20)], identity), T0)
    const snap = sessionBroadcast(T0 + 40 * MIN)
    expect(snap.current.programme.title).toBe('Film B')
    expect(snap.current.startMs).toBe(T0 + 30 * MIN)
    expect(snap.next.programme.title).toBe('Film C')
    expect(snap.next.startMs).toBe(T0 + 75 * MIN)
    const slots = guideSlots(SESSION_CHANNEL, T0 - 60 * MIN, T0 + 120 * MIN)
    expect(slots.map((slot) => slot.programme.title)).toEqual(['Film A', 'Film B', 'Film C', 'Film A'])
    expect(slots[0].startMs).toBe(T0)
  })

  it('L: leaving and coming back resumes on the session timeline, not from the top', () => {
    fourFilms()
    const watching = current(T0 + 10 * MIN)
    expect(watching.programme.title).toBe('Film A')
    broadcast(channelByNumber(225)!, T0 + 20 * MIN)
    const back = current(T0 + 47 * MIN)
    expect(back.programme.title).toBe('Film B')
    expect(back.seekSeconds).toBe(17 * 60)
    expect(playbackCommand(back.programme, back.seekSeconds, null).startSeconds).toBe(17 * 60)
  })

  it('M: choosing a programme plays it from the beginning', () => {
    fourFilms()
    const d = sessionProgrammes()[3]
    expect(rebaseSession(d.id, T0 + 47 * MIN)).toBe(true)
    const now = current(T0 + 47 * MIN)
    expect(now.programme.title).toBe('Film D')
    expect(now.seekSeconds).toBe(0)
    expect(playbackCommand(now.programme, now.seekSeconds, null).startSeconds).toBe(0)
  })

  it('N: Play Now rotates the running order around the choice without reshuffling', () => {
    fourFilms()
    expect(current(T0 + 40 * MIN).programme.title).toBe('Film B')
    rebaseSession(sessionProgrammes()[3].id, T0 + 40 * MIN)
    expect(titles()).toEqual(['Film D', 'Film A', 'Film B', 'Film C'])
    expect(current(T0 + 75 * MIN).programme.title).toBe('Film A')
    expect(current(T0 + 75 * MIN).seekSeconds).toBe(5 * 60)
  })

  it('O: the guide shows the rebased schedule', () => {
    fourFilms()
    const rebasedAt = T0 + 40 * MIN
    rebaseSession(sessionProgrammes()[3].id, rebasedAt)
    const slots = guideSlots(SESSION_CHANNEL, T0, T0 + 240 * MIN)
    expect(slots[0].startMs).toBe(rebasedAt)
    expect(slots.slice(0, 5).map((slot) => slot.programme.title)).toEqual(['Film D', 'Film A', 'Film B', 'Film C', 'Film D'])
    expect(slots.some((slot) => slot.startMs < rebasedAt)).toBe(false)
  })

  it('P: guide search finds imported titles on 1000, and only while a session exists', () => {
    const match = (channel: { origin?: string }, needle: string) => channel.origin === 'session' && searchSession(needle).length > 0
    expect(searchGuideChannels(listChannels(), 'robocop', match).some((channel) => channel.number === 1000)).toBe(false)
    replaceSession([item('Brazil', 140), item('RoboCop (1987)', 102), item('Alien', 117)], T0)
    const found = searchGuideChannels(listChannels(), 'ROBOCOP', match)
    expect(found.some((channel) => channel.number === 1000)).toBe(true)
    expect(found.some((channel) => channel.number === 0)).toBe(false)
    expect(searchSession('robocop').map((programme) => programme.title)).toEqual(['RoboCop (1987)'])
    const network = searchGuideChannels(listChannels(), 'closedown', match)
    expect(network.map((channel) => channel.number)).toContain(999)
    expect(network.some((channel) => channel.number === 1000)).toBe(false)
  })

  it('Q: choosing a 1000 search result is Play Now on that title', () => {
    replaceSession([item('Brazil', 140), item('RoboCop (1987)', 102), item('Alien', 117)], T0)
    const underCursor = current(T0 + 5 * MIN).programme
    const chosen = sessionChoice('robocop', underCursor)!
    expect(chosen.title).toBe('RoboCop (1987)')
    rebaseSession(chosen.id, T0 + 5 * MIN)
    expect(current(T0 + 5 * MIN).programme.title).toBe('RoboCop (1987)')
    expect(current(T0 + 5 * MIN).seekSeconds).toBe(0)
    expect(sessionChoice('', underCursor)?.id).toBe(underCursor.id)
    clearSession()
    expect(sessionChoice('', current(T0).programme)).toBeNull()
  })
})

describe('tuning around 1000', () => {
  const numbers = () => listChannels().map((channel) => channel.number)

  it('R: typing 1000 tunes the session channel; 000 is TVN', () => {
    expect(tunerStep('1000', numbers())).toBe('commit')
    expect(tunerStep('100', numbers())).toBe('wait')
    expect(channelByNumber(Number('1000'))).toBe(SESSION_CHANNEL)
    expect(tunerStep('000', numbers())).toBe('commit')
    expect(channelByNumber(0)?.name).toBe('TVN')
  })

  it('S: 1000 then CH+ goes to the User Network, or round to 000 without one', () => {
    expect(isOnAir(channelByNumber(1)!)).toBe(true)
    expect(adjacentChannel(1000, 1).number).toBe(0)
    installUserChannels()
    try {
      expect(adjacentChannel(1000, 1).number).toBe(1001)
    } finally {
      installUserCatalogue([], new Map())
    }
  })

  it('T: 1000 is not stepped onto: 999 then CH+ wraps to 000 with no User Network; 001 then CH- goes to 000 TVN', () => {
    expect(adjacentChannel(999, 1).origin).toBe('tvn')
    expect(adjacentChannel(1, -1).origin).toBe('tvn')
  })

  it('U: 1001+ keeps its numbers; 1000 Local Media stays tunable but CH+/CH- pass from 999 to 1001', () => {
    installUserChannels()
    try {
      expect(channelByNumber(1000)).toBe(SESSION_CHANNEL)
      expect(adjacentChannel(999, 1).number).toBe(1001)
      expect(adjacentChannel(1000, 1).number).toBe(1001)
      expect(adjacentChannel(1000, -1).number).toBe(999)
      expect(adjacentChannel(1001, -1).number).toBe(999)
    } finally {
      installUserCatalogue([], new Map())
    }
  })

  it('V: Previous works between 1000 and ordinary channels', () => {
    const onSession = commitTuned({ channelNumber: 225, previousNumber: null }, 1000)
    expect(onSession).toEqual({ channelNumber: 1000, previousNumber: 225 })
    const back = commitTuned(onSession, onSession.previousNumber!)
    expect(back).toEqual({ channelNumber: 225, previousNumber: 1000 })
    expect(commitTuned(back, back.previousNumber!)).toEqual({ channelNumber: 1000, previousNumber: 225 })
  })

  it('W: Play Now inside 1000 reloads in place and makes no Previous entry', () => {
    fourFilms()
    const watching: Tuned = { channelNumber: 1000, previousNumber: 225 }
    expect(sessionRefresh(1000, false, true)).toBe('in-place')
    expect(sessionRefresh(0, false, true)).toBe('tune')
    rebaseSession(sessionProgrammes()[2].id, T0 + 10 * MIN)
    expect(commitTuned(watching, 1000)).toBe(watching)
    expect(sessionRefresh(225, false, true)).toBe('tune')
    expect(sessionRefresh(1000, true, true)).toBe('tune')
  })

  it('X: Random never lands on 1000 or 000, with or without imported media', () => {
    replaceSession([item('Private Film', 90)], T0)
    for (let step = 0; step < 1000; step += 1) {
      const picked = randomChannel(225, () => step / 1000)
      expect(picked?.number).not.toBe(1000)
      expect(picked?.number).not.toBe(0)
    }
    expect(randomChannel(1000, () => 0)?.number).not.toBe(1000)
  })
})

describe('isolation and privacy', () => {
  it('Y: imported media never reaches the 001–999 network or the Programme Director', () => {
    const libraryBefore = mediaLibrary()
    replaceSession([item('Secret Home Movie', 45, 'blob:test/secret')], T0)
    expect(mediaLibrary()).toBe(libraryBefore)
    expect(mediaLibrary().some((media) => media.title === 'Secret Home Movie')).toBe(false)
    for (const channel of listChannels().filter((entry) => entry.number >= 1 && entry.number <= 999).filter((_, index) => index % 25 === 0)) {
      const snap = broadcast(channel, T0 + 10 * MIN)
      for (const position of [snap.previous, snap.current, snap.next]) {
        expect(position.programme.title, `${channel.number}`).not.toContain('Secret Home Movie')
        expect(position.programme.sourceRef ?? '', `${channel.number}`).not.toContain('local:session')
      }
      expect(programmesFor(channel.id).some((programme) => programme.channelId === 'ch-1000')).toBe(false)
    }
  })

  it('Z: importing does not touch the persistent 1001+ user network', async () => {
    const before = userChannelList()
    commitImport(await buildSessionItems([file('Film.mp4', 'video/mp4')], deps({ 'Film.mp4': 600 })), T0)
    expect(userChannelList()).toBe(before)
    expect(listChannels().filter((channel) => channel.number >= 1001)).toHaveLength(before.length)
    for (const path of ['src/session/session-channel.ts', 'src/session/import.ts']) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).not.toMatch(/from '\.\.\/(library\/store|services\/user-db|services\/preferences|director\/|dynamic\/|data\/user-overlay)/)
      expect(source, path).not.toMatch(/indexedDB|localStorage|fetch\(/)
    }
  })

  it('AA: replaced object URLs are revoked, except the one the player still shows until it lets go', async () => {
    replaceSession([item('One', 10, 'blob:a1'), item('Two', 10, 'blob:a2')], T0)
    noteLocalSource('blob:a1')
    replaceSession([item('Three', 10, 'blob:b1')], T0 + MIN)
    expect(revoked).toEqual(['blob:a2'])
    noteLocalSource('blob:b1')
    expect(revoked).toEqual(['blob:a2', 'blob:a1'])
    clearSession()
    expect(revoked).toEqual(['blob:a2', 'blob:a1'])
    noteLocalSource(null)
    expect(revoked).toEqual(['blob:a2', 'blob:a1', 'blob:b1'])

    let live = true
    const abandoned = deps({ 'A.mp4': 600, 'B.mp4': 600 }, { cancelled: () => !live })
    const pending = buildSessionItems([file('A.mp4', 'video/mp4'), file('B.mp4', 'video/mp4')], abandoned)
    live = false
    const result = await pending
    expect(result.cancelled).toBe(true)
    expect(abandoned.dropped.sort()).toEqual([...abandoned.made].sort())
    expect(commitImport(result, T0)).toBe('')
  })

  it('AB: a cancelled picker and an empty selection change nothing', async () => {
    replaceSession([item('Keep Me', 30)], T0)
    const abort = Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' })
    expect(await pickFolder(async () => Promise.reject(abort))).toBeNull()
    expect(await pickFolder(async () => Promise.reject(new TypeError('not allowed')))).toBeNull()
    const nothing = await buildSessionItems([], deps({}))
    expect(commitImport(nothing, T0 + MIN)).toBe('NO PLAYABLE MEDIA FOUND')
    const junk = await buildSessionItems([file('readme.txt', 'text/plain')], deps({}))
    commitImport(junk, T0 + MIN)
    expect(titles()).toEqual(['Keep Me'])
  })

  it('AC: browser and internal errors never reach the viewer', async () => {
    const errors = [new DOMException('boom', 'NotAllowedError'), new TypeError('Failed to fetch'), new SyntaxError('bad')]
    const names = errors.map((_, index) => `e${index}.mp4`)
    const result = await buildSessionItems(
      [...names.map((name) => file(name, 'video/mp4')), file('ok.mp4', 'video/mp4')],
      deps({ ...Object.fromEntries(names.map((name, index) => [name, errors[index]])), 'ok.mp4': 60 }),
    )
    const outcomes = [importSummary(result), importSummary({ items: [], skipped: 3 }), commitImport(result, T0)]
    for (const text of outcomes) {
      expect(text).toMatch(/^[A-Z0-9 ·]+$/)
      expect(text).not.toMatch(/DOMException|NotAllowedError|AbortError|TypeError|SyntaxError|Failed to fetch/)
    }
    const stage = readFileSync('src/player/LocalStage.tsx', 'utf8')
    expect(stage).not.toMatch(/onStatusRef\.current\('error', (error|String\(|event)/)
  })

  it('AD: startup never waits for, or resumes onto, 1000 Local Media', () => {
    expect(sessionActive()).toBe(false)
    expect(readFileSync('src/state/startup.ts', 'utf8')).not.toMatch(/session\/import|replaceSession|sessionActive/)
    const restore = () => createStartupRestore()
    expect(resolveStartupTuning(restore(), { lastChannelNumber: 1000, previousChannelNumber: 225 })).toEqual({ channelNumber: 225, previousNumber: null })
    expect(resolveStartupTuning(restore(), { lastChannelNumber: 1000, previousChannelNumber: null })?.channelNumber).toBe(0)
    expect(firstOnAir(listChannels())!.number).not.toBe(0)
    expect(firstOnAir(listChannels())!.number).not.toBe(1000)
    expect(resolveStartupTuning(restore(), { lastChannelNumber: 225, previousChannelNumber: 1000 })).toEqual({ channelNumber: 225, previousNumber: null })
  })

  it('AE: local -> network -> local switches players cleanly, one picture and one sound at a time', async () => {
    const log: string[] = []
    const fake = (name: string): LocalPlayerHandle => ({
      load: async (request: PlayerLoadRequest) => {
        log.push(`${name}.load:${request.localUrl ?? request.videoId ?? 'silence'}`)
        return request.videoId || request.localUrl ? 'playing' : 'slate'
      },
      play: () => log.push(`${name}.play`),
      pause: () => log.push(`${name}.pause`),
      seek: (seconds: number) => log.push(`${name}.seek:${seconds}`),
      setAudible: (audible: boolean) => log.push(`${name}.audible:${audible}`),
      currentTime: () => 0,
      actualVideoId: () => (name === 'yt' ? 'VIDEO' : null),
      stop: () => log.push(`${name}.stop`),
    })
    const youtube: PlayerHandle = fake('yt')
    const local = fake('local')
    const routes: PlayerRoute[] = []
    const player = routedPlayer(() => youtube, () => local, (route) => routes.push(route))

    replaceSession([item('Home Film', 30, 'blob:home')], T0)
    const localCommand = playbackCommand(current(T0).programme, 0, null)
    const networkCommand = { videoId: 'VIDEO', startSeconds: 12, loop: false }

    expect(await player.load(networkCommand)).toBe('playing')
    expect(await player.load(localCommand)).toBe('playing')
    expect(log.slice(-2)).toEqual(['yt.load:silence', 'local.load:blob:home'])
    expect(player.actualVideoId()).toBeNull()
    player.setAudible(true, 80, false)
    expect(log.slice(-2)).toEqual(['local.audible:true', 'yt.audible:false'])

    expect(await player.load(networkCommand)).toBe('playing')
    expect(log.slice(-2)).toEqual(['local.stop', 'yt.load:VIDEO'])
    player.setAudible(true, 80, false)
    expect(log.slice(-2)).toEqual(['yt.audible:true', 'local.audible:false'])

    expect(await player.load(localCommand)).toBe('playing')
    expect(log.slice(-4)).toEqual(['local.audible:true', 'yt.audible:false', 'yt.load:silence', 'local.load:blob:home'])
    expect(routes).toEqual(['youtube', 'local', 'youtube', 'local'])
  })
})
