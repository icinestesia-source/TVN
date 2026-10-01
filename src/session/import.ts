import type { MediaKind } from '../types/programme.ts'
import { replaceSession, type SessionItem } from './session-channel.ts'

const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'webm', 'mov', 'mkv', 'ogv', '3gp'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'weba'])
const EXTENSION_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
  '3gp': 'video/3gpp',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  weba: 'audio/webm',
}

/** Files are scanned up to this many; a folder of a whole disk should not stall the tab. */
export const MAX_SCANNED_FILES = 5000
const PROBE_CONCURRENCY = 4
const PROBE_TIMEOUT_MS = 15_000

/** The accept list for the file picker. */
export const MEDIA_ACCEPT = ['video/*', 'audio/*', ...[...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS].map((ext) => `.${ext}`)].join(',')

export interface LocalFile {
  name: string
  type: string
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * Picture or sound, if the browser says it can at least try this file; null for everything else
 * (images, text, subtitles, unknown formats). The duration probe is the real test.
 */
export function mediaKindOf(file: LocalFile, canPlay: (mime: string) => boolean): MediaKind | null {
  if (file.name.startsWith('.')) return null
  const ext = extensionOf(file.name)
  const declared = file.type.toLowerCase()
  const kind: MediaKind | null = declared.startsWith('video/')
    ? 'video'
    : declared.startsWith('audio/')
      ? 'audio'
      : VIDEO_EXTENSIONS.has(ext)
        ? 'video'
        : AUDIO_EXTENSIONS.has(ext)
          ? 'audio'
          : null
  if (!kind) return null
  const mime = declared || EXTENSION_TYPES[ext] || ''
  return mime && canPlay(mime) ? kind : null
}

/** The file name without its extension, with underscores read as spaces. The file itself is never renamed. */
export function titleFromName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const title = stem.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim()
  return title || 'Untitled'
}

/** Only a real, positive, finite running time may enter the schedule. */
export function validDuration(seconds: unknown): seconds is number {
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 1
}

/** Fisher–Yates over a copy. The session order is decided by one call of this. */
export function shuffleOnce<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const order = [...items]
  for (let index = order.length - 1; index > 0; index -= 1) {
    const pick = Math.floor(random() * (index + 1))
    ;[order[index], order[pick]] = [order[pick], order[index]]
  }
  return order
}

export interface ImportDeps<F extends LocalFile> {
  canPlay: (mime: string) => boolean
  createUrl: (file: F) => string
  revokeUrl: (url: string) => void
  /** Seconds of playable media, or null when the file cannot be played or measured. */
  probe: (url: string, kind: MediaKind) => Promise<number | null>
  random?: () => number
  /** A newer import started; this one's URLs are handed back. */
  cancelled?: () => boolean
}

export interface ImportResult {
  /** Shuffled once, ready to become the session channel. */
  items: SessionItem[]
  scanned: number
  skipped: number
  cancelled: boolean
}

/**
 * Turns picked files into session items: media files only, each probed locally for a real duration,
 * then put into one random order. A file that fails is skipped; it never stops the rest.
 */
export async function buildSessionItems<F extends LocalFile>(files: readonly F[], deps: ImportDeps<F>): Promise<ImportResult> {
  const scanned = Math.min(files.length, MAX_SCANNED_FILES)
  const candidates: { file: F; kind: MediaKind }[] = []
  for (const file of files.slice(0, MAX_SCANNED_FILES)) {
    const kind = mediaKindOf(file, deps.canPlay)
    if (kind) candidates.push({ file, kind })
  }
  const accepted: (SessionItem | null)[] = new Array(candidates.length).fill(null)
  let next = 0
  const worker = async () => {
    while (next < candidates.length) {
      const index = next
      next += 1
      const { file, kind } = candidates[index]
      if (deps.cancelled?.()) return
      let url: string | null = null
      try {
        url = deps.createUrl(file)
        const seconds = await deps.probe(url, kind)
        if (validDuration(seconds) && !deps.cancelled?.()) {
          accepted[index] = { title: titleFromName(file.name), durationSeconds: seconds, url, kind }
          url = null
        }
      } catch {
        // An unreadable file is skipped like any other unplayable one.
      } finally {
        if (url) deps.revokeUrl(url)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, candidates.length) }, worker))
  const items = accepted.filter((item): item is SessionItem => item !== null)
  if (deps.cancelled?.()) {
    for (const item of items) deps.revokeUrl(item.url)
    return { items: [], scanned, skipped: scanned, cancelled: true }
  }
  return { items: shuffleOnce(items, deps.random), scanned, skipped: scanned - items.length, cancelled: false }
}

/**
 * A finished import becomes the session channel only if it found something to play; an empty or
 * superseded import leaves the current channel 000 exactly as it was. Returns the viewer-facing outcome.
 */
export function commitImport(result: ImportResult, nowMs: number): string {
  if (result.cancelled) return ''
  if (result.items.length > 0) replaceSession(result.items, nowMs)
  return importSummary(result)
}

/** Plain RetroTV wording for the outcome; never a browser error. */
export function importSummary(result: Pick<ImportResult, 'items' | 'skipped'>): string {
  if (result.items.length === 0) return 'NO PLAYABLE MEDIA FOUND'
  const count = `${result.items.length} ${result.items.length === 1 ? 'PROGRAMME' : 'PROGRAMMES'}`
  return result.skipped > 0 ? `CHANNEL 000 · ${count} · ${result.skipped} SKIPPED` : `CHANNEL 000 · ${count}`
}

/** Loads only the file's metadata, locally, and always tears the element down. */
export function probeDuration(url: string, kind: MediaKind, timeoutMs = PROBE_TIMEOUT_MS): Promise<number | null> {
  return new Promise((resolve) => {
    const element = document.createElement(kind === 'audio' ? 'audio' : 'video')
    let done = false
    const finish = (seconds: number | null) => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      element.removeEventListener('loadedmetadata', onMeta)
      element.removeEventListener('error', onError)
      element.removeAttribute('src')
      element.load()
      resolve(seconds)
    }
    const onMeta = () => {
      // A video whose picture cannot be decoded reports no frame size; it would air as a black screen.
      if (kind === 'video' && (element as HTMLVideoElement).videoWidth === 0) return finish(null)
      finish(validDuration(element.duration) ? element.duration : null)
    }
    const onError = () => finish(null)
    const timer = window.setTimeout(() => finish(null), timeoutMs)
    element.preload = 'metadata'
    element.muted = true
    element.addEventListener('loadedmetadata', onMeta)
    element.addEventListener('error', onError)
    element.src = url
  })
}

export function browserCanPlay(mime: string): boolean {
  const probe = document.createElement(mime.startsWith('audio/') ? 'audio' : 'video')
  // Matroska is widely playable in Chromium even though it rarely admits it.
  return probe.canPlayType(mime) !== '' || mime === 'video/x-matroska' || mime === 'video/quicktime'
}

interface DirectoryHandleLike {
  kind: 'directory'
  values(): AsyncIterable<FileHandleLike | DirectoryHandleLike>
}
interface FileHandleLike {
  kind: 'file'
  getFile(): Promise<File>
}
type DirectoryPicker = (options?: { mode?: 'read' }) => Promise<DirectoryHandleLike>

export function directoryPicker(scope: object = window): DirectoryPicker | null {
  const picker = (scope as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker
  return typeof picker === 'function' ? picker.bind(scope) : null
}

/** Every file below a picked folder, depth first, up to the scan limit. */
export async function filesInDirectory(root: DirectoryHandleLike): Promise<File[]> {
  const files: File[] = []
  const walk = async (directory: DirectoryHandleLike, depth: number): Promise<void> => {
    for await (const entry of directory.values()) {
      if (files.length >= MAX_SCANNED_FILES) return
      if (entry.kind === 'file') {
        try {
          files.push(await entry.getFile())
        } catch {
          // Unreadable entries are skipped.
        }
      } else if (depth < 8) await walk(entry, depth + 1)
    }
  }
  await walk(root, 0)
  return files
}

/**
 * The native folder picker. Null when the viewer cancels or the browser refuses; the caller then does
 * nothing, so cancelling is never an error.
 */
export async function pickFolder(picker: DirectoryPicker): Promise<File[] | null> {
  try {
    return await filesInDirectory(await picker({ mode: 'read' }))
  } catch {
    return null
  }
}
