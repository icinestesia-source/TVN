import { readFileSync, readdirSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { AddChannelForm, GuideActions, NewUserTools, SessionImportTools, UserNetworkTools } from './components/GuideAdd.tsx'
import { channelByNumber, channels, listChannels } from './data/catalogue.ts'
import { installUserCatalogue } from './data/user-overlay.ts'
import { commandFromKey } from './input/keyboard.ts'
import { clearManual, manualAiring, onScreen, pickTunes, selectProgramme } from './player/manual.ts'
import { liveAiring } from './player/viewing.ts'
import { mediaSeekSeconds } from './player/seek.ts'
import { broadcast, guideSlots } from './services/broadcast.ts'
import { channelsFromSources, mergeParsedExports, parseChannelsExport, type StoredSource } from './services/channels-import.ts'
import { hasPicture, SESSION_CHANNEL_NUMBER } from './session/session-channel.ts'
import { commitTuned } from './state/tuning.ts'
import type { Channel } from './types/channel.ts'
import type { Programme } from './types/programme.ts'
import { guideToolTarget } from './view/guide-tool.ts'

const T0 = Date.UTC(2026, 8, 30, 12, 0, 0)
const HOUR = 3_600_000
const plain = { meta: false, ctrl: false, alt: false }
const guide = readFileSync('src/components/Guide.tsx', 'utf8')
const provider = readFileSync('src/state/TvProvider.tsx', 'utf8')

function userSource(id: string, name: string, number: number): StoredSource {
  return {
    id,
    name,
    videos: Array.from({ length: 6 }, (_, index) => ({ id: `${id.slice(3, 11)}${String(index).padStart(3, '0')}`, title: `${name} ${index + 1}`, durationSec: 1200 + index * 60 })),
    channelNumber: number,
    inLibrary: false,
    automatic: true,
    updatedAt: 1,
  }
}

function installUsers(...sources: StoredSource[]) {
  const built = channelsFromSources(sources)
  installUserCatalogue(built.channels, built.programmes)
  return built.channels
}

/** A programme on this channel that starts later than now, with a picture to play. */
function laterSlot(channel: Channel, nowMs: number) {
  const slot = guideSlots(channel, nowMs, nowMs + 12 * HOUR).find((item) => item.startMs > nowMs)
  if (!slot) return undefined
  return hasPicture(slot.programme) ? slot : { ...slot, programme: { ...slot.programme, videoId: 'pickedvid01' } }
}

function curatedWithLaterPicture(nowMs: number): { channel: Channel; programme: Programme } {
  const channel = channelByNumber(1)!
  const slot = laterSlot(channel, nowMs)
  if (!slot) throw new Error('channel 001 lists nothing later')
  return { channel, programme: slot.programme }
}

const slotKeys = (channel: Channel) => guideSlots(channel, T0 - 6 * HOUR, T0 + 24 * HOUR).map((slot) => `${slot.programme.id}@${slot.startMs}-${slot.endMs}`)

afterEach(() => {
  clearManual()
  installUserCatalogue([], new Map())
})

describe('ADD', () => {
  it('stays a visible Guide action and opens no overlay, menu or prompt', () => {
    const markup = renderToStaticMarkup(createElement(GuideActions, { tool: null, picked: false, onNow: () => undefined, onTool: () => undefined }))
    expect(markup).toMatch(/<button[^>]*>Add<\/button>/)
    expect(markup).not.toMatch(/role="(menu|dialog)"/)
    // The one menu in the Guide is ADD TO GUIDE on a programme (right-click or hold), not ADD.
    const listings = guide.replace(/\nfunction AddToGuideMenu[\s\S]*?\n\}\n/, '\n')
    expect(listings).not.toBe(guide)
    for (const source of [listings, readFileSync('src/components/GuideAdd.tsx', 'utf8')]) {
      expect(source).not.toMatch(/window\.prompt|\bprompt\(|role="menu"|guide-add-menu/)
    }
  })

  it('goes to the foot of the User Network and focuses the ADD CHANNEL input there', () => {
    const users = installUsers(userSource('yt:UCaaaaaaaaaaaaaaaaaaaaaa', 'Alpha', 1001), userSource('yt:UCbbbbbbbbbbbbbbbbbbbbbb', 'Beta', 1002))
    const target = guideToolTarget('add', 'retrotv', [], { channelNumber: 5, timeMs: T0 }, listChannels(), T0)
    expect(target.filter).toBe('user')
    expect(target.cursor.channelNumber).toBe(users[users.length - 1].number)
    expect(guideToolTarget('add', 'all', [], { channelNumber: 5, timeMs: T0 }, listChannels(), T0).filter).toBe('all')
    // The Guide scrolls to its last row and focuses the input when ADD is the active tool.
    expect(guide).toMatch(/tv\.guideTool\?\.kind !== 'add'[\s\S]{0,400}grid\.scrollTop = grid\.scrollHeight[\s\S]{0,300}addInput\.current\?\.focus\(\)/)
    expect(guide).toContain("onTool={(kind) => tv.dispatch({ type: 'guide-tool', tool: kind })}")
  })

  it('shows its progress inline in the row and keeps raw server text away from the viewer', () => {
    const source = readFileSync('src/components/GuideAdd.tsx', 'utf8')
    expect(source).toContain("setNote('FINDING CHANNEL…')")
    const markup = renderToStaticMarkup(createElement(AddChannelForm, { nextNumber: 1055, onAdd: async () => '' }))
    expect(markup).toContain('YouTube link, @handle or podcast for channel 1055')
    expect(markup).not.toMatch(/role="dialog"/)
  })

  it('keeps the rest of the User Network tools in the Guide footer, removal behind a confirmation', () => {
    const markup = renderToStaticMarkup(
      createElement(UserNetworkTools, {
        userChannels: 3,
        onImportList: async () => '',
        onLoadTest: async () => '',
        onRemoveStarter: async () => '',
        onRemoveAll: async () => '',
      }),
    )
    expect(markup).toMatch(/^<footer class="guide-info guide-tool"/)
    expect(markup).toMatch(/>Channel list</)
    expect(markup).toMatch(/>Add starter network</)
    expect(markup).toMatch(/>Remove starter…</)
    expect(markup).toMatch(/>Remove all…</)
    expect(markup).not.toMatch(/Yes, remove/)
  })

  it('ADD keeps RESTORE of a User Network file first in its footer', () => {
    const markup = renderToStaticMarkup(
      createElement(UserNetworkTools, {
        userChannels: 3,
        onImportNetwork: () => undefined,
        onImportList: async () => '',
        onLoadTest: async () => '',
        onRemoveStarter: async () => '',
        onRemoveAll: async () => '',
      }),
    )
    const labels = [...markup.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((match) => match[1])
    expect(labels[0]).toBe('Restore')
    expect(guide).toContain("onImportNetwork={() => tv.dispatch({ type: 'guide-tool', tool: 'network' })}")
  })

  it('the + tab offers a named new user or a channel list imported as a new user', () => {
    const markup = renderToStaticMarkup(
      createElement(NewUserTools, { name: '', note: null, onName: () => {}, onNote: () => {}, onCreate: () => '', onImportList: async () => '', onCancel: () => {} }),
    )
    expect(markup).toMatch(/aria-label="New user"/)
    expect(markup).toMatch(/placeholder="Name of the new user"/)
    expect([...markup.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((match) => match[1])).toEqual(['Add user', 'Import channel list'])
    expect(markup).not.toContain('Restore a User Network file')
    expect(guide).toMatch(/<NewUserTools[\s\S]{0,300}onCreate=\{createUser\}[\s\S]{0,80}onImportList=\{importListAsUser\}/)
  })
})

describe('MEDIA (1000 Local Media from local files)', () => {
  it('is a visible Guide action, after NOW and ADD', () => {
    const markup = renderToStaticMarkup(createElement(GuideActions, { tool: 'media', picked: false, onNow: () => undefined, onTool: () => undefined }))
    const labels = [...markup.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((match) => match[1])
    expect(labels).toEqual(['TVN', 'Guide', 'Options', 'Now', 'Add', 'Media'])
    expect(markup).toMatch(/aria-pressed="true"[^>]*>Media</)
  })

  it('takes the Guide to 1000 Local Media at the current time under a filter that lists it', () => {
    for (const filter of ['retrotv', 'user', 'favourites'] as const) {
      const target = guideToolTarget('media', filter, [], { channelNumber: 12, timeMs: T0 - HOUR }, listChannels(), T0)
      expect(target.filter).toBe('all')
      expect(target.cursor).toEqual({ channelNumber: SESSION_CHANNEL_NUMBER, timeMs: T0 })
    }
    expect(guideToolTarget('media', 'favourites', [1000], { channelNumber: 12, timeMs: T0 }, listChannels(), T0).filter).toBe('favourites')
  })

  it('shows the existing FOLDER / FILES importer inline in the Guide footer, wired to 1000 Local Media', () => {
    const markup = renderToStaticMarkup(createElement(SessionImportTools, { onImport: async () => '' }))
    expect(markup).toMatch(/^<footer class="guide-info guide-tool"/)
    expect(markup).toMatch(/>Files</)
    expect(markup).not.toMatch(/role="dialog"/)
    expect(guide).toContain('<SessionImportTools onImport={tv.importSession} />')
    expect(provider).toMatch(/case 'media':\s+openGuideTool\('media'\)/)
    expect(readdirSync('src/components')).not.toContain('ImportPanel.tsx')
  })
})

describe('programme selection', () => {
  it('starts the exact programme chosen, from its beginning', () => {
    const { channel, programme } = curatedWithLaterPicture(T0)
    selectProgramme(channel.number, programme, T0)
    const shown = onScreen(channel, T0)
    expect(shown.current.programme.id).toBe(programme.id)
    expect(shown.current.elapsedSeconds).toBe(0)
    const airing = liveAiring(channel, T0, null)
    expect(airing.programme.id).toBe(programme.id)
    expect(airing.command.videoId).toBe(programme.videoId)
    expect(airing.command.startSeconds).toBe(mediaSeekSeconds(0, programme))
    // A minute later it has played a minute, not jumped to the schedule.
    expect(onScreen(channel, T0 + 60_000).current.seekSeconds).toBe(60)
  })

  it('leaves the 001–999 schedule exactly as it was', () => {
    const { channel, programme } = curatedWithLaterPicture(T0)
    const before = slotKeys(channel)
    const aired = broadcast(channel, T0 + HOUR).current.programme.id
    selectProgramme(channel.number, programme, T0)
    expect(slotKeys(channel)).toEqual(before)
    expect(broadcast(channel, T0 + HOUR).current.programme.id).toBe(aired)
    clearManual()
    expect(slotKeys(channel)).toEqual(before)
  })

  it('leaves a 1001+ schedule exactly as it was', () => {
    const [user] = installUsers(userSource('yt:UCcccccccccccccccccccccc', 'Gamma', 1001))
    const slot = laterSlot(user, T0)
    expect(slot).toBeDefined()
    const before = slotKeys(user)
    selectProgramme(user.number, slot!.programme, T0)
    expect(onScreen(user, T0).current.programme.id).toBe(slot!.programme.id)
    expect(slotKeys(user)).toEqual(before)
  })

  it('is only this viewing: other channels show their broadcast, and it ends when the programme does', () => {
    const { channel, programme } = curatedWithLaterPicture(T0)
    const other = channels.find((item) => item.number >= 1 && item.number <= 999 && item.number !== channel.number)!
    selectProgramme(channel.number, programme, T0)
    expect(onScreen(other, T0)).toEqual(broadcast(other, T0))
    const after = T0 + programme.durationSeconds * 1000 + 1
    expect(manualAiring(channel.number, after)).toBeNull()
    expect(onScreen(channel, after)).toEqual(broadcast(channel, after))
  })

  it('on the channel being watched plays in place and makes no Previous entry', () => {
    expect(pickTunes(7, 7, false)).toBe(false)
    expect(pickTunes(8, 7, false)).toBe(true)
    // A pick on another channel is an ordinary tune: the channel left becomes Previous.
    expect(commitTuned({ channelNumber: 7, previousNumber: 3 }, 8)).toEqual({ channelNumber: 8, previousNumber: 7 })
    const body = provider.slice(provider.indexOf('const playFromGuide'), provider.indexOf('const activateGuide'))
    expect(body).toMatch(/if \(pickTunes\(target\.number, channelRef\.current, tuningRef\.current\)\) \{\s+requestTune\(target\.number, true\)\s+return\s+\}/)
    expect(body.slice(body.indexOf('return\n    }'))).not.toMatch(/commitChannel|requestTune/)
  })

  it('keeps Play Now for channel 000 and plays any other playable Guide programme from the start', () => {
    const body = provider.slice(provider.indexOf('const activateGuide'), provider.indexOf('const goToSleep = ('))
    expect(body).toMatch(/selected\.origin === 'session'[\s\S]*sessionRef\.current\.play\(chosen\.id\)/)
    expect(body).toMatch(/if \(hasPicture\(slot\.programme\)\) \{\s+playFromGuide\(selected, slot\.programme, slot\)/)
    expect(provider).not.toMatch(/selectProgramme\(SESSION_CHANNEL_NUMBER/)
  })
})

describe('NOW', () => {
  it('clears the pick and restores the programme on air, without changing the schedule', () => {
    const { channel, programme } = curatedWithLaterPicture(T0)
    const before = slotKeys(channel)
    selectProgramme(channel.number, programme, T0)
    expect(clearManual()).toBe(true)
    expect(onScreen(channel, T0 + 5_000)).toEqual(broadcast(channel, T0 + 5_000))
    expect(slotKeys(channel)).toEqual(before)
    expect(clearManual()).toBe(false)
  })

  it('reloads in place and returns the Guide to the current time; no tune, rebuild or history', () => {
    const body = provider.slice(provider.indexOf("case 'guide-now'"), provider.indexOf("case 'hints'"))
    expect(body).toMatch(/if \(clearManual\(\)\) \{[\s\S]*loadProgramme\(current, Date\.now\(\)\)/)
    expect(body).toMatch(/timeMs: now/)
    expect(body).not.toMatch(/requestTune|commitChannel|installSources|saveStoredSources|replaceSession|removeUserChannels/)
  })

  it('answers Home with the Guide open or closed, and is a Guide button', () => {
    expect(commandFromKey('Home', plain, true)).toEqual({ type: 'guide-now' })
    expect(commandFromKey('Home', plain, false)).toEqual({ type: 'guide-now' })
    expect(guide).toContain("onNow={() => tv.dispatch({ type: 'guide-now' })}")
  })
})

describe('tuning', () => {
  it('every channel change ends a pick; only the tune that plays one keeps it', () => {
    expect(provider).toMatch(/const requestTune = \(number: number, keepPick = false\) => \{[\s\S]{0,200}if \(!keepPick\) clearManual\(\)/)
    const keeping = [...provider.matchAll(/requestTune\([^)]*, true\)/g)]
    expect(keeping).toHaveLength(1)
    const dispatch = provider.slice(provider.indexOf("case 'channel-up':"), provider.indexOf("case 'confirm':"))
    expect(dispatch).toMatch(/const target = stepTarget\(tuned\(\), pending, command\.type === 'channel-up' \? 1 : -1, \{ filter: guideFilter, favourites \}\)\s+if \(target === null\) flash\(emptyUniverseNote\(guideFilter\)\)\s+else requestTune\(target\)/)
    expect(dispatch).toMatch(/if \(picked\) requestTune\(picked\.number\)/)
    expect(dispatch).toMatch(/requestTune\(previous\)/)
    const numeric = provider.slice(provider.indexOf('commitNumericRef.current = () =>'), provider.indexOf('bootRef.current = () =>'))
    expect(numeric).toMatch(/requestTune\(number\)/)
    expect(provider.slice(provider.indexOf("case 'multiview': {"), provider.indexOf("case 'focus-move'"))).toContain('clearManual()')
  })

  it('keeps 000 / 001–999 / 1000 / 1001+ apart', () => {
    const [user] = installUsers(userSource('yt:UCdddddddddddddddddddddd', 'Delta', 1001))
    expect(channelByNumber(1000)?.origin).toBe('session')
    expect(channelByNumber(SESSION_CHANNEL_NUMBER)?.origin).toBe('session')
    expect(user.number).toBe(1001)
    const { channel, programme } = curatedWithLaterPicture(T0)
    selectProgramme(channel.number, programme, T0)
    expect(onScreen(user, T0)).toEqual(broadcast(user, T0))
    expect(onScreen(channelByNumber(SESSION_CHANNEL_NUMBER)!, T0)).toEqual(broadcast(channelByNumber(SESSION_CHANNEL_NUMBER)!, T0))
  })
})

describe('test fixture', () => {
  it('ships no NASA channel in the User Network or its optional test set', () => {
    const names = mergeParsedExports(
      ['public/user-network/channels.txt', 'public/user-network/more-channels.txt'].map((path) => parseChannelsExport(readFileSync(path, 'utf8'))),
    ).sources.map((source) => source.name)
    const archive = JSON.parse(readFileSync('public/user-network/uploaders.json', 'utf8')) as {
      collections: Record<string, string>
      uploaders: Record<string, { title: string }>
    }
    for (const name of [...names, ...Object.keys(archive.collections), ...Object.values(archive.uploaders).map((uploader) => uploader.title)]) {
      expect(name).not.toMatch(/\bnasa\b/i)
    }
    expect(listChannels().some((channel) => /\bnasa\b/i.test(channel.name))).toBe(false)
  })

  it('keeps the factual space and aerospace exclusions', () => {
    for (const path of ['src/library/exclusions.ts', 'src/director/fit.ts']) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).toMatch(/nasa/)
      expect(source, path).toMatch(/spaceflight/)
    }
  })
})
