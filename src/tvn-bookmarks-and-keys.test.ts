import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProgrammeInfo } from './components/ProgrammeInfo.tsx'
import { commandFromKey } from './input/keyboard.ts'
import type { Channel } from './types/channel.ts'
import type { Programme } from './types/programme.ts'
import { BOOKMARKS_KEY, bookmarkFor, MAX_BOOKMARKS, readBookmarks, toggledBookmarks } from './view/bookmarks-store.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const plain = { meta: false, ctrl: false, alt: false }
const channel = { number: 42, name: 'Science', origin: 'tvn' } as unknown as Channel
const programme = { id: 'p-1', title: 'A Clip', description: '', videoId: 'YrZyJuaBfKA', durationSeconds: 600, channelId: 'c', category: 'Science', source: 'imported', kind: 'programme', playbackMode: 'linear' } as Programme

describe('KEYS: I Add, U Media, E Export ALL, O Options, D Bookmark', () => {
  it('binds each, Guide open or not', () => {
    for (const guideOpen of [false, true]) {
      expect(commandFromKey('i', plain, guideOpen)).toEqual({ type: 'guide-tool', tool: 'add' })
      expect(commandFromKey('U', plain, guideOpen)).toEqual({ type: 'media' })
      expect(commandFromKey('e', plain, guideOpen)).toEqual({ type: 'export-all' })
      expect(commandFromKey('O', plain, guideOpen)).toEqual({ type: 'guide-tool', tool: 'options' })
      expect(commandFromKey('d', plain, guideOpen)).toEqual({ type: 'bookmark' })
    }
    // Edit Channel keeps the menu key, a right-click and a hold.
    expect(commandFromKey('ContextMenu', plain, false)).toEqual({ type: 'guide-tool', tool: 'edit' })
  })

  it('the keyboard on the welcome screen and the hints say so', () => {
    const keys = read('src/legal/entry-keys.ts')
    for (const label of ["letter('I', 'Add')", "letter('U', 'Media')", "letter('E', 'Export ALL')", "letter('O', 'Options')", "letter('D', 'Bookmark')"]) expect(keys).toContain(label)
    const hints = read('src/components/Hints.tsx')
    for (const part of ['D Bookmark', 'I Add · U Media', 'E Export ALL · O Options']) expect(hints).toContain(part)
  })
})

describe('B and N: the channels remembered, then the channel keys', () => {
  it('step through the remembered channels, and with none that way go down (B) or up (N) a channel', () => {
    const provider = read('src/state/TvProvider.tsx')
    const history = provider.slice(provider.indexOf("case 'history-back':"), provider.indexOf("case 'confirm':"))
    expect(history).toMatch(/if \(step && channelByNumber\(step\.channelNumber\)\) \{\s*historyNavRef\.current = step\.index\s*requestTune\(step\.channelNumber\)\s*break\s*\}/)
    expect(history).toContain("const delta = command.type === 'history-back' ? -1 : 1")
    expect(history).toContain('const target = stepTarget(tuned(), pending, delta, { filter: guideFilter, favourites })')
  })
})

describe('BOOKMARKS: clips kept to play again', () => {
  it('one bookmark per clip on a channel, newest first, on and off again', () => {
    const clip = bookmarkFor(channel, programme, 1000)
    expect(clip).toEqual({ key: '42:YrZyJuaBfKA', channelNumber: 42, channelName: 'Science', programmeId: 'YrZyJuaBfKA', title: 'A Clip', durationSeconds: 600, savedAt: 1000 })
    const other = bookmarkFor(channel, { ...programme, videoId: 'other', title: 'B' }, 2000)
    const both = toggledBookmarks(toggledBookmarks([], clip), other)
    expect(both.map((item) => item.title)).toEqual(['B', 'A Clip'])
    expect(toggledBookmarks(both, clip).map((item) => item.title)).toEqual(['B'])
  })

  it('reads only well-formed bookmarks, and never more than the limit', () => {
    const good = bookmarkFor(channel, programme, 1)
    const store = { getItem: () => JSON.stringify([good, { key: 'x' }, 'nonsense']), setItem: () => {} }
    expect(readBookmarks(store)).toEqual([good])
    expect(readBookmarks({ getItem: () => '{oops', setItem: () => {} })).toEqual([])
    expect(BOOKMARKS_KEY).toBe('tvn.bookmarks.v1')
    expect(MAX_BOOKMARKS).toBe(500)
  })

  it('D bookmarks the clip on screen, or the one selected in the Guide', () => {
    const provider = read('src/state/TvProvider.tsx')
    const bookmark = provider.slice(provider.indexOf("case 'bookmark': {"), provider.indexOf("case 'debug':"))
    expect(bookmark).toContain('const number = guideOpenRef.current ? cursorRef.current.channelNumber : channelRef.current')
    expect(bookmark).toContain('const on = toggleBookmark(bookmarkFor(target, programme))')
  })

  it('a 📜 tab after FAV opens the Bookmarks section, each clip with PLAY and REMOVE', () => {
    const guide = read('src/components/Guide.tsx')
    expect(guide.indexOf('            Fav\n')).toBeLessThan(guide.indexOf("tv.dispatch({ type: 'guide-tool', tool: 'bookmarks' })"))
    expect(guide).toContain(") : tool === 'bookmarks' ? (\n        <BookmarksPanel />")
    const panel = read('src/components/BookmarksPanel.tsx')
    expect(panel).toContain('tv.playChannelProgramme(bookmark.channelNumber, bookmark.programmeId)')
    expect(panel).toContain('onClick={() => removeBookmark(bookmark.key)}')
  })
})

describe('INFORMATION OVERLAY: a star after the channel name, a bookmark after the title', () => {
  const markup = (favourite?: { on: boolean; onToggle: () => void }) =>
    renderToStaticMarkup(createElement(ProgrammeInfo, { channel, programme, startMs: 0, endMs: 600_000, now: 1000, favourite }))

  it('the star sits after the channel name and before the creator link, lit for a favourite', () => {
    const html = markup({ on: true, onToggle: () => {} })
    expect(html).toMatch(/<span>Science<\/span><button type="button" class="info-star is-on" aria-pressed="true"[^>]*>★<\/button>/)
    expect(markup({ on: false, onToggle: () => {} })).toContain('class="info-star" aria-pressed="false"')
    expect(markup()).not.toContain('info-star')
  })

  it('the bookmark follows the clip title', () => {
    expect(markup()).toMatch(/<div class="info-title-line"><h2 class="info-title">A Clip<\/h2><button type="button" class="info-bookmark" aria-pressed="false" aria-label="Bookmark this clip"[^>]*>📜<\/button><\/div>/)
  })

  it('the next clip’s title, not the NEXT label, plays it when pressed', () => {
    const next = { title: 'Second Clip', startMs: 600_000, endMs: 1_200_000 }
    const render = (onPlay?: () => void) => renderToStaticMarkup(createElement(ProgrammeInfo, { channel, programme, startMs: 0, endMs: 600_000, now: 1000, next: { ...next, onPlay } }))
    expect(render(() => {})).toMatch(/<span class="info-net">Next<\/span><button type="button" class="info-next-title is-playable" title="Play this next">Second Clip<\/button>/)
    expect(render()).toContain('<span class="info-next-title">Second Clip</span>')
    const overlay = read('src/components/NowNextOverlay.tsx')
    expect(overlay).toContain('...(steps && hasPicture(next.programme) ? { onPlay: () => tv.screenStep(1) } : {})')
    expect(overlay).toContain('following={following ? { ...following, onNext: () => tv.guideStep(1) } : null}')
  })

  it('both the INFO bar and the Guide pass the channel star', () => {
    const star = "favourite={{ on: tv.favourites.includes(channel.number), onToggle: () => tv.dispatch({ type: 'favourite', channelNumber: channel.number }) }}"
    expect(read('src/components/NowNextOverlay.tsx')).toContain(star)
    expect(read('src/components/Guide.tsx')).toContain(star)
  })
})

describe('EDIT CHANNEL stands on the information overlay, which stays up beneath it', () => {
  it('over the picture: the editor and the INFO bar together, the editor above', () => {
    expect(read('src/app/TvScreen.tsx')).toMatch(/<div className="screen-edit-stack">\s*<ScreenEditor \/>\s*<NowNextOverlay \/>\s*<\/div>/)
    const css = read('src/styles/overlays.css')
    expect(css).toMatch(/\.screen-edit-stack \{\s*position: fixed;\s*top: var\(--safe\);[\s\S]{0,200}flex-direction: column;\s*justify-content: flex-end;/)
    expect(css).toContain('.screen-edit-stack > .info-bar.screen-editor > .guide-info { flex: 0 1 auto; min-height: 0; max-height: none; }')
  })

  it('in the Guide: the editor above the programme information bar', () => {
    const guide = read('src/components/Guide.tsx')
    expect(guide).toMatch(/onPlay=\{tv\.playChannelProgramme\}\s*\/>\s*\{programmePanel\}\s*<\/>/)
    expect(read('src/styles/guide.css')).toContain('.guide > .guide-info.guide-editor { flex: 0 1 auto; min-height: 0;')
  })
})
