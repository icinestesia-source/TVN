import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { TVN_OWNER, TVN_OWNER_NAME, USER_NETWORK_FALLBACK, userNetworkName } from './data/user-network/users.ts'
import { focusedProviderFrame, guardProviderFocus, shieldProviderFrame } from './player/picture-shield.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const screen = read('src/app/TvScreen.tsx')
const shell = read('src/styles/shell.css')
const stage2 = read('src/styles/stage2.css')
const overlays = read('src/styles/overlays.css')
const youtube = read('src/player/YoutubeStage.tsx')
const catcher = screen.slice(screen.indexOf('function PictureCatch()'), screen.indexOf('function ScreenEditor()'))
const rule = (css: string, selector: string) => {
  const at = css.indexOf(`${selector} {`)
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at))
}
const zIndex = (css: string, selector: string) => Number(/z-index:\s*(\d+)/.exec(rule(css, selector))?.[1])

function fakeFrame(inPicture = true) {
  const attributes = new Map<string, string>()
  return {
    tagName: 'IFRAME',
    tabIndex: 0,
    blur: vi.fn(),
    closest: (selector: string) => (inPicture && selector.includes('.stage') ? {} : null),
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    attributes,
  }
}

function fakeWindow(active: unknown) {
  const listeners = new Map<string, () => void>()
  const timers: (() => void)[] = []
  const docListeners = new Map<string, () => void>()
  const win = {
    document: {
      activeElement: active,
      addEventListener: (type: string, listener: () => void) => docListeners.set(type, listener),
      removeEventListener: (type: string) => docListeners.delete(type),
    },
    focus: vi.fn(),
    addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
    setTimeout: (run: () => void) => timers.push(run),
    clearTimeout: () => {},
  }
  return { win: win as unknown as Window, listeners, docListeners, flush: () => timers.splice(0).forEach((run) => run()) }
}

describe('PLAYER INTERACTION SHIELD', () => {
  it('a picture click reaches TVN: the catch layer sits over every provider picture and handles the click', () => {
    expect(zIndex(shell, '.click-catch')).toBeGreaterThan(zIndex(shell, '.player-slot'))
    expect(zIndex(shell, '.click-catch')).toBeGreaterThan(zIndex(shell, '.local-host'))
    expect(rule(shell, '.click-catch')).toMatch(/inset: 0/)
    expect(catcher).toContain("tv.dispatch({ type: 'info' })")
  })

  it('the provider gets no pointer events, in the single picture and in every multiview tile', () => {
    expect(rule(shell, '.stage iframe,\n.yt-host')).toContain('pointer-events: none')
    expect(rule(shell, '.local-host')).toContain('pointer-events: none')
    expect(rule(stage2, '.tile .yt-host,\n.tile iframe')).toContain('pointer-events: none')
  })

  it('repeated clicks send no pause: nothing on the picture layer pauses or toggles playback', () => {
    expect(catcher).not.toMatch(/pause|play-pause|'pause'/i)
    expect(read('src/components/BroadcastTile.tsx')).not.toMatch(/onClick=\{[^}]*pause/i)
  })

  it('the provider stays shielded with the overlay hidden: the shield is not part of the overlay', () => {
    const stage = screen.slice(screen.indexOf("<div className={face === 'picture' ? 'stage' : 'stage is-card'}>"), screen.indexOf('<MultiviewGrid'))
    expect(stage).toMatch(/\n\s+<PictureCatch \/>\n/)
    expect(stage).not.toMatch(/info \? <PictureCatch|\{info[^}]*PictureCatch/)
    expect(rule(shell, '.stage iframe,\n.yt-host')).not.toMatch(/is-info|info-open/)
  })

  it('controls work with the overlay visible: the information bar sits above the shield', () => {
    expect(zIndex(overlays, '.info-bar')).toBeGreaterThan(zIndex(shell, '.click-catch'))
  })

  it('swipe navigation and the wheel still step channels from the shield', () => {
    expect(catcher).toContain('swipeStep(start')
    expect(catcher).toContain('const step = wheel(event)')
    expect(rule(shell, '.click-catch')).toContain('touch-action: pinch-zoom')
  })

  it('a long press is TVN’s: no browser menu or callout on the picture, and the corner hold still runs', () => {
    expect(catcher).toContain('onContextMenu={(event) => event.preventDefault()}')
    expect(read('src/components/BroadcastTile.tsx')).toContain('onContextMenu={(event) => event.preventDefault()}')
    expect(rule(shell, '.click-catch')).toContain('-webkit-touch-callout: none')
    expect(rule(stage2, '.tile')).toContain('-webkit-touch-callout: none')
    expect(read('src/components/InfoActions.tsx')).toContain('createLongPress(() => holdAction()')
  })

  it('every provider frame is taken out of the tab order and the accessibility tree', () => {
    const frame = fakeFrame()
    shieldProviderFrame(frame as unknown as Element)
    expect(frame.tabIndex).toBe(-1)
    expect(frame.attributes.get('aria-hidden')).toBe('true')
    const div = { ...fakeFrame(), tagName: 'DIV' }
    shieldProviderFrame(div as unknown as Element)
    expect(div.tabIndex).toBe(0)
    expect(() => shieldProviderFrame(null)).not.toThrow()
    expect(youtube).toContain('shieldProviderFrame(event.target.getIframe?.())')
    expect(youtube).toContain("shieldProviderFrame(slot?.querySelector('iframe'))")
  })

  it('focus that lands on a provider frame goes back to TVN, so the keyboard stays with TVN', () => {
    const frame = fakeFrame()
    const { win, listeners, docListeners, flush } = fakeWindow(frame)
    const stop = guardProviderFocus(win)
    listeners.get('blur')?.()
    flush()
    expect(frame.blur).toHaveBeenCalledTimes(1)
    expect(win.focus).toHaveBeenCalledTimes(1)
    stop()
    expect(listeners.has('blur')).toBe(false)
    expect(docListeners.has('focusin')).toBe(false)
    expect(screen).toContain('useEffect(() => guardProviderFocus(), [])')
  })

  it('also takes focus back when only focusin reports it, as in a window without system focus', () => {
    const frame = fakeFrame()
    const { win, docListeners, flush } = fakeWindow(frame)
    guardProviderFocus(win)
    docListeners.get('focusin')?.()
    flush()
    expect(frame.blur).toHaveBeenCalledTimes(1)
  })

  it('leaves focus alone when the viewer switches away, or when it is on a frame outside the picture', () => {
    expect(focusedProviderFrame({ activeElement: { tagName: 'BODY' } } as unknown as Document)).toBeNull()
    const outside = fakeFrame(false)
    const { win, listeners, flush } = fakeWindow(outside)
    guardProviderFocus(win)
    listeners.get('blur')?.()
    flush()
    expect(outside.blur).not.toHaveBeenCalled()
    expect(win.focus).not.toHaveBeenCalled()
  })

  it('keeps IFrame API control: no native controls, keyboard or fullscreen, and every command is still sent', () => {
    expect(youtube).toMatch(/controls: 0,\s+disablekb: 1,\s+fs: 0,/)
    for (const call of ['playVideo()', 'pauseVideo()', 'seekTo(', 'destroy()', 'onError']) expect(youtube).toContain(call)
  })

  it('CONTINUE still enables sound from the same first interaction', () => {
    const provider = read('src/state/TvProvider.tsx')
    expect(provider).toContain("window.addEventListener('pointerdown', early, true)")
    expect(read('src/player/autoplay.ts')).toContain('hasBeenActive')
  })
})

describe('USER-NAMED NETWORK TAB', () => {
  it('names the built-in owner’s network from the user model, a named user by their name, and falls back to USER', () => {
    const users = [{ id: 'u1', name: 'Maya' }]
    expect(userNetworkName(undefined, users)).toBe(TVN_OWNER_NAME)
    expect(userNetworkName(TVN_OWNER, users)).toBe(TVN_OWNER_NAME)
    expect(userNetworkName('u1', users)).toBe('Maya')
    expect(userNetworkName('u9', users)).toBe(USER_NETWORK_FALLBACK)
    expect(userNetworkName('u1', [{ id: 'u1', name: '  ' }])).toBe('User')
  })

  it('the Network Editor and the Guide both take the tab name from the model, not a literal', () => {
    const editor = read('src/components/NetworkEditor.tsx')
    expect(editor).toContain("['user', userNetworkName(undefined, tv.networkUsers)]")
    expect(editor).toContain('userNetworkName(channel.owner, tv.networkUsers)')
    expect(editor).not.toMatch(/\['user', '(User|TVN)'\]|\?\? 'TVN'/)
    expect(read('src/components/Guide.tsx')).toContain("['user', userNetworkName(undefined, tv.networkUsers)]")
  })

  it('the tab lists its own owner’s channels; named users keep theirs, and ordering stays on the one manifest', () => {
    const editor = read('src/components/NetworkEditor.tsx')
    expect(editor).not.toContain("if (list === 'user') return isUser(channel)")
    expect(editor).toContain("list === 'user' ? (")
    expect(editor).toContain("const canMove = list !== 'favourites'")
  })
})
