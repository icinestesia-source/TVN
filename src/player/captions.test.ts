import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commandFromKey, commandFromKeyEvent } from '../input/keyboard.ts'
import { DEFAULT_PREFERENCES, loadPreferences, savePreferences } from '../services/preferences.ts'
import { createStartupRestore } from '../state/startup-channel.ts'
import { CaptionController, subtitlesNotice, type CaptionPlayer } from './captions.ts'
import { pauseViewing } from './viewing.ts'
import type { PlayerHandle } from './types.ts'

const plain = { meta: false, ctrl: false, alt: false }
const key = (value: string, extra: Partial<{ target: unknown; metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) =>
  commandFromKeyEvent({ key: value, target: null, metaKey: false, ctrlKey: false, altKey: false, ...extra }, false)

/** A YouTube player whose video has these caption tracks (none: the programme has no captions). */
function captionPlayer(tracks: { languageCode: string; kind?: string }[] = [{ languageCode: 'en' }]) {
  const calls: string[] = []
  let loaded = false
  let track: object = {}
  const player: CaptionPlayer = {
    loadModule: (name) => {
      calls.push(`load:${name}`)
      loaded = true
    },
    unloadModule: (name) => {
      calls.push(`unload:${name}`)
      loaded = false
      track = {}
    },
    getOptions: () => (loaded ? ['captions'] : []),
    getOption: (_module, option) => (option === 'tracklist' ? (loaded ? tracks : []) : track),
    setOption: (_module, option, value) => {
      calls.push(`set:${option}:${JSON.stringify(value)}`)
      if (option === 'track') track = value as object
    },
  }
  return {
    player,
    calls,
    showing: () => loaded && Boolean((track as { languageCode?: string }).languageCode),
    rememberYouTubeSetting: () => {
      loaded = true
      track = { languageCode: 'en' }
    },
  }
}

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (name: string) => data.get(name) ?? null,
    setItem: (name: string, value: string) => void data.set(name, value),
    removeItem: (name: string) => void data.delete(name),
    clear: () => data.clear(),
  }
}

describe('subtitles toggle', () => {
  beforeEach(() => {
    ;(globalThis as { localStorage?: unknown }).localStorage = memoryStorage()
  })
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage
  })

  it('A: is off on a clean installation, and an off player hides captions YouTube remembered', () => {
    expect(DEFAULT_PREFERENCES.subtitles).toBe(false)
    expect(loadPreferences().subtitles).toBe(false)
    const youtube = captionPlayer()
    youtube.rememberYouTubeSetting()
    const controller = new CaptionController(loadPreferences().subtitles, 'en')
    controller.loadRequested()
    controller.videoPlaying(youtube.player)
    expect(youtube.showing()).toBe(false)
    youtube.rememberYouTubeSetting()
    controller.modulesChanged(youtube.player)
    expect(youtube.showing()).toBe(false)
  })

  it('B/C: plain C toggles off → on → off with a transient notice; S stays Favourite', () => {
    expect(commandFromKey('c', plain, false)).toEqual({ type: 'subtitles' })
    expect(commandFromKey('C', plain, false)).toEqual({ type: 'subtitles' })
    expect(commandFromKey('c', plain, true)).toEqual({ type: 'subtitles' })
    expect(commandFromKey('s', plain, false)).toEqual({ type: 'favourite' })

    const youtube = captionPlayer()
    const controller = new CaptionController(false, 'en')
    controller.videoPlaying(youtube.player)
    controller.setPreference(true, youtube.player)
    expect(youtube.showing()).toBe(true)
    expect(subtitlesNotice(true)).toBe('SUBTITLES ON')
    controller.setPreference(false, youtube.player)
    expect(youtube.showing()).toBe(false)
    expect(subtitlesNotice(false)).toBe('SUBTITLES OFF')

    const provider = readFileSync('src/state/TvProvider.tsx', 'utf8')
    const handler = provider.slice(provider.indexOf("case 'subtitles'"), provider.indexOf("case 'volume-up'"))
    expect(handler).toMatch(/!subtitlesRef\.current/)
    expect(handler).toMatch(/flash\(subtitlesNotice\(nextSubtitles\)\)/)
  })

  it('D: persists through the existing viewer preferences across reloads', () => {
    savePreferences({ ...loadPreferences(), subtitles: true })
    expect(loadPreferences().subtitles).toBe(true)
    savePreferences({ ...loadPreferences(), subtitles: false })
    expect(loadPreferences().subtitles).toBe(false)
    localStorage.setItem('retrotv.preferences.v1', JSON.stringify({ version: 2, subtitles: 'yes' }))
    expect(loadPreferences().subtitles).toBe(false)
  })

  it('E/F: every new video, from a channel change or the schedule advancing, follows the preference', () => {
    const controller = new CaptionController(true, 'en')
    for (const tracks of [[{ languageCode: 'en' }], [{ languageCode: 'fr' }, { languageCode: 'en', kind: 'asr' }]]) {
      const youtube = captionPlayer(tracks)
      controller.loadRequested()
      controller.videoPlaying(youtube.player)
      expect(youtube.showing()).toBe(true)
    }
    const bare = captionPlayer([])
    controller.loadRequested()
    expect(() => controller.videoPlaying(bare.player)).not.toThrow()
    expect(bare.showing()).toBe(false)
    expect(controller.enabled).toBe(true)

    const late = captionPlayer()
    controller.loadRequested()
    controller.videoPlaying({ ...late.player, getOption: () => [] })
    controller.modulesChanged(late.player)
    expect(late.showing()).toBe(true)

    const off = new CaptionController(false, 'en')
    const next = captionPlayer()
    next.rememberYouTubeSetting()
    off.loadRequested()
    off.videoPlaying(next.player)
    expect(next.showing()).toBe(false)

    const provider = readFileSync('src/state/TvProvider.tsx', 'utf8')
    expect(provider.match(/setSubtitles\(/g)).toHaveLength(1)
    const stage = readFileSync('src/player/YoutubeStage.tsx', 'utf8')
    expect(stage).toMatch(/captionsRef\.current!\.loadRequested\(\)\s+player\.loadVideoById/)
    expect(stage).toMatch(/cc_load_policy: captionsRef\.current!\.enabled \? 1 : 0/)
  })

  it('G: pause and play leave the preference alone', () => {
    const youtube = captionPlayer()
    const controller = new CaptionController(true, 'en')
    controller.videoPlaying(youtube.player)
    const handle = { pause: () => {} } as PlayerHandle
    pauseViewing(handle)
    controller.loadRequested()
    controller.videoPlaying(youtube.player)
    expect(controller.enabled).toBe(true)
    expect(youtube.showing()).toBe(true)
    const provider = readFileSync('src/state/TvProvider.tsx', 'utf8')
    const playPause = provider.slice(provider.indexOf("case 'play-pause'"), provider.indexOf("case 'mute'"))
    expect(playPause).not.toMatch(/subtitle/i)
  })

  it('does not fail when the player exposes no caption functions', () => {
    const controller = new CaptionController(true, 'en')
    expect(() => controller.videoPlaying({})).not.toThrow()
    expect(() => controller.modulesChanged({ getOptions: () => { throw new Error('proxy') } })).not.toThrow()
  })

  it('H: C typed into an editable field does not toggle', () => {
    expect(key('c', { target: { tagName: 'INPUT' } })).toBeNull()
    expect(key('C', { target: { tagName: 'TEXTAREA' } })).toBeNull()
    expect(key('c', { target: { tagName: 'DIV', isContentEditable: true } })).toBeNull()
    expect(key('c', { target: { tagName: 'BUTTON' } })).toEqual({ type: 'subtitles' })
  })

  it('I: Cmd, Ctrl and Alt with C or S do not toggle', () => {
    for (const letter of ['c', 'C', 's', 'S']) {
      expect(key(letter, { metaKey: true })).toBeNull()
      expect(key(letter, { ctrlKey: true })).toBeNull()
      expect(key(letter, { altKey: true })).toBeNull()
    }
  })

  it('J: the first Random tune still wins over delayed startup restoration', () => {
    expect(commandFromKey('r', plain, false)).toEqual({ type: 'random-channel' })
    const startup = createStartupRestore()
    startup.noteUserTune()
    const restored = startup.target({ number: 501 } as never, [{ number: 1 }, { number: 501 }] as never)
    expect(restored).toBeUndefined()
  })

  it('K: Space still pauses and plays', () => {
    expect(commandFromKey(' ', plain, false)).toEqual({ type: 'play-pause' })
    expect(key(' ')).toEqual({ type: 'play-pause' })
  })
})
