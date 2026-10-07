import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionImportTools } from './components/GuideAdd.tsx'
import { ProgrammeInfo } from './components/ProgrammeInfo.tsx'
import { channelByNumber } from './data/catalogue.ts'
import { clearManual, onScreen, seekable, selectProgramme } from './player/manual.ts'
import { broadcast } from './services/broadcast.ts'
import { clearSession, LOCAL_MEDIA_NUMBERS, localChannel, replaceSession, sessionProgrammes } from './session/session-channel.ts'
import { guideToolTarget } from './view/guide-tool.ts'
import { editorScope } from './view/channel-edit.ts'
import type { Programme } from './types/programme.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const NOW = new Date('2026-10-06T20:00:00+01:00').getTime()

afterEach(() => {
  clearManual()
  for (const number of LOCAL_MEDIA_NUMBERS) clearSession(number)
})

describe('the time slider in the information bar', () => {
  it('a seek is the programme on screen from that point, carrying on through the running order', () => {
    const channel = channelByNumber(225)!
    const airing = broadcast(channel, NOW).current
    selectProgramme(channel.number, airing.programme, NOW, { startMs: airing.startMs, endMs: airing.endMs }, channel, 90)
    const shown = onScreen(channel, NOW).current
    expect(shown.programme.id).toBe(airing.programme.id)
    expect(shown.elapsedSeconds).toBe(90)
    expect(onScreen(channel, NOW + 10_000).current.elapsedSeconds).toBe(100)
    selectProgramme(channel.number, airing.programme, NOW, undefined, undefined, airing.programme.durationSeconds + 500)
    expect(onScreen(channel, NOW).current.elapsedSeconds).toBe(airing.programme.durationSeconds - 1)
  })

  it('moves only through recorded media: not 000, a live stream or a page', () => {
    const channel = channelByNumber(225)!
    const programme = broadcast(channel, NOW).current.programme
    expect(seekable(channel, programme)).toBe(programme.videoId !== null)
    expect(seekable(channelByNumber(0)!, programme)).toBe(false)
    expect(seekable(channel, { ...programme, liveStream: { url: 'https://example.test/live.m3u8' } } as Programme)).toBe(false)
    expect(seekable(channel, { ...programme, programmeType: 'website', mediaUrl: 'https://example.test' })).toBe(false)
  })

  it('opens from the time, which reads as a control only over the picture', () => {
    const channel = channelByNumber(225)!
    const airing = broadcast(channel, NOW).current
    const props = { channel, programme: airing.programme, startMs: airing.startMs, endMs: airing.endMs, now: NOW }
    expect(renderToStaticMarkup(createElement(ProgrammeInfo, { ...props, onSeek: () => undefined }))).toMatch(/<button type="button" class="info-elapsed"[^>]*aria-expanded="false"/)
    expect(renderToStaticMarkup(createElement(ProgrammeInfo, props))).not.toContain('info-elapsed')
    expect(read('src/components/NowNextOverlay.tsx')).toContain("onSeek={tv.multiviewMode === '1' && seekable(channel, current.programme) ? tv.screenSeek : undefined}")
    const slider = read('src/components/TimeSlider.tsx')
    expect(slider).toContain('type="range"')
    expect(slider).toContain('is-fading')
  })
})

describe('Local Media 991–1000 in the Guide', () => {
  it('E on a Local Media channel is MEDIA for that channel; MEDIA elsewhere goes to 1000', () => {
    expect(editorScope(channelByNumber(993)!)).toBe('local')
    const channels = LOCAL_MEDIA_NUMBERS.map((number) => channelByNumber(number)!)
    expect(guideToolTarget('media', 'all', [], { channelNumber: 225, timeMs: 0 }, channels, NOW).cursor.channelNumber).toBe(1000)
    expect(guideToolTarget('media', 'all', [], { channelNumber: 994, timeMs: 0 }, channels, NOW).cursor.channelNumber).toBe(994)
    expect(guideToolTarget('media', 'all', [], { channelNumber: 225, timeMs: 0 }, channels, NOW, 996).cursor.channelNumber).toBe(996)
    expect(read('src/state/TvProvider.tsx')).toContain("kind = 'media'")
  })

  it('the panel names the channel and lists its files, each removable, with Folder, Files, Watch and Clear', () => {
    replaceSession([{ title: 'Holiday', durationSeconds: 600, url: 'blob:test/holiday', kind: 'video' }], NOW, 994)
    const markup = renderToStaticMarkup(
      createElement(SessionImportTools, { channel: localChannel(994), programmes: sessionProgrammes(994), watching: false, onImport: async () => '' }),
    )
    expect(markup).toContain('<span>994</span><span>Local Media 4</span>')
    expect(markup).toMatch(/<input type="text"[^>]*value="Local Media 4"/)
    expect(markup).toContain('aria-label="Remove Holiday"')
    expect(markup).toContain('aria-label="Move Holiday earlier"')
    expect(markup).toContain('aria-label="Move Holiday later"')
    expect(markup).toContain('draggable="true"')
    for (const label of ['Files', 'Watch', 'Clear']) expect(markup).toMatch(new RegExp(`<button[^>]*>${label}</button>`))
    const empty = renderToStaticMarkup(createElement(SessionImportTools, { channel: localChannel(995), programmes: [], watching: false, onImport: async () => '' }))
    expect(empty).not.toMatch(/>Clear</)
    expect(empty).not.toMatch(/>Watch</)
  })

  it('stays open after an import, so another folder can be added', () => {
    const provider = read('src/state/TvProvider.tsx')
    expect(provider).toContain('if (wasEmpty) showSession(target, guideOpenRef.current)')
    expect(read('src/components/GuideAdd.tsx')).toContain("if (picked === 'refused') folderInput.current?.click()")
  })
})
