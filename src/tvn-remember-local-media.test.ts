import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { pickFiles, pickFolder } from './session/import.ts'
import { arrangeRemembered, loadRememberMedia, nextRecord, REMEMBER_MEDIA_KEY, rememberSupported } from './session/remembered-media.ts'

const memory = (value: string | null) => ({ getItem: (key: string) => (key === REMEMBER_MEDIA_KEY ? value : null), setItem: () => {} })
const titled = (...titles: string[]) => titles.map((title) => ({ title }))

describe('REMEMBER LOCAL MEDIA (Options), off by default', () => {
  it('is off until the viewer turns it on', () => {
    expect(loadRememberMedia(memory(null))).toBe(false)
    expect(loadRememberMedia(memory('off'))).toBe(false)
    expect(loadRememberMedia(memory('on'))).toBe(true)
    expect(loadRememberMedia(null)).toBe(false)
  })

  it('is offered only where the browser can keep folder and file handles', () => {
    expect(rememberSupported({})).toBe(false)
    expect(rememberSupported({ showDirectoryPicker: () => {} })).toBe(false)
  })

  it('remembers the running order, and what was taken out stays out until imported again', () => {
    const start = { number: 991, handles: [], order: ['A', 'B', 'C'], removed: [] }
    const moved = nextRecord(start, ['C', 'A'])
    expect(moved).toMatchObject({ order: ['C', 'A'], removed: ['B'] })
    expect(nextRecord(moved, ['C', 'A', 'B'])).toMatchObject({ removed: [] })
  })

  it('a reloaded channel comes back as it was left, with anything new in its folders at the end', () => {
    const items = titled('A', 'New', 'B', 'C')
    expect(arrangeRemembered(items, { order: ['C', 'A'], removed: ['B'] }).map((item) => item.title)).toEqual(['C', 'A', 'New'])
    expect(arrangeRemembered(titled('A', 'A'), { order: ['A'], removed: [] })).toHaveLength(2)
  })

  it('the pickers hand back what they opened, and cancelling is never an error', async () => {
    const root = { kind: 'directory' as const, async *values() {} }
    let seen: unknown = null
    expect(await pickFolder(async () => root, (handle) => (seen = handle))).toEqual([])
    expect(seen).toBe(root)
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' })
    expect(await pickFiles(async () => Promise.reject(abort))).toBeNull()
    expect(await pickFiles(async () => Promise.reject(new TypeError('no')))).toBe('refused')
    const file = new File(['x'], 'Clip.mp4')
    const handle = { kind: 'file' as const, getFile: async () => file }
    expect(await pickFiles(async () => [handle])).toEqual({ files: [file], handles: [handle] })
  })

  it('the session channel and importer still keep nothing; the setting lives in Options and the panel offers RELOAD PREVIOUS', () => {
    for (const path of ['src/session/session-channel.ts', 'src/session/import.ts']) expect(readFileSync(path, 'utf8')).not.toMatch(/indexedDB|localStorage/)
    expect(readFileSync('src/components/GuideOptions.tsx', 'utf8')).toContain('<Card title="Local Media">')
    expect(readFileSync('src/components/GuideAdd.tsx', 'utf8')).toContain('Reload previous')
    expect(readFileSync('src/session/remembered-media.ts', 'utf8')).not.toMatch(/arrayBuffer|createWritable|blob\(/i)
  })
})
