import { attachFlv, remuxSupported, type Remux } from '../player/flv.ts'
import type { MediaKind } from '../types/programme.ts'
import { appendSession, localChannel, SESSION_CHANNEL_NUMBER, type SessionItem } from './session-channel.ts'

const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'f4v', 'webm', 'mov', 'qt', 'mkv', 'ogv', 'ogm', '3gp', '3g2', 'flv'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'm4b', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'weba', 'mka', 'aif', 'aiff', 'caf'])
const EXTENSION_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  f4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
  ogm: 'video/ogg',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',
  flv: 'video/x-flv',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  weba: 'audio/webm',
  mka: 'audio/x-matroska',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  caf: 'audio/x-caf',
}
/** Containers TVN repackages itself rather than leave to the browser. */
const REMUX_TYPES: Record<string, Remux> = { 'video/x-flv': 'flv', 'video/flv': 'flv' }

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
  const declared = mimeOf(file)
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

/** The file's type as declared, else as its extension names it; FLV is often declared as nothing at all. */
function mimeOf(file: LocalFile): string {
  const declared = file.type.toLowerCase()
  if (declared && declared !== 'application/octet-stream') return declared
  return EXTENSION_TYPES[extensionOf(file.name)] ?? ''
}

/** Set for a file TVN repackages as it plays, such as FLV. */
export function remuxFor(file: LocalFile): Remux | undefined {
  return REMUX_TYPES[mimeOf(file)]
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
  probe: (url: string, kind: MediaKind, remux?: Remux) => Promise<number | null>
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
      const remux = remuxFor(file)
      let url: string | null = null
      try {
        url = deps.createUrl(file)
        const seconds = await deps.probe(url, kind, remux)
        if (validDuration(seconds) && !deps.cancelled?.()) {
          accepted[index] = { title: titleFromName(file.name), durationSeconds: seconds, url, kind, ...(remux ? { remux } : {}) }
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
 * A finished import is added to the end of a Local Media channel's running order (1000 unless given), and
 * only if it found something to play; an empty or superseded import leaves the channel exactly as it was.
 * Returns the viewer-facing outcome.
 */
export function commitImport(result: ImportResult, nowMs: number, number = SESSION_CHANNEL_NUMBER): string {
  if (result.cancelled) return ''
  if (result.items.length > 0) appendSession(result.items, nowMs, number)
  return importSummary(result, number)
}

/** Plain RetroTV wording for the outcome; never a browser error. */
export function importSummary(result: Pick<ImportResult, 'items' | 'skipped'>, number = SESSION_CHANNEL_NUMBER): string {
  if (result.items.length === 0) return 'NO PLAYABLE MEDIA FOUND'
  const count = `${result.items.length} ${result.items.length === 1 ? 'PROGRAMME' : 'PROGRAMMES'}`
  const channel = `${number} · ${localChannel(number).name.toUpperCase()}`
  return result.skipped > 0 ? `${channel} · ${count} · ${result.skipped} SKIPPED` : `${channel} · ${count}`
}

/** Loads only the file's metadata, locally, and always tears the element down. */
export function probeDuration(url: string, kind: MediaKind, remux?: Remux, timeoutMs = PROBE_TIMEOUT_MS): Promise<number | null> {
  return new Promise((resolve) => {
    const element = document.createElement(kind === 'audio' ? 'audio' : 'video')
    let done = false
    let remuxer: { destroy(): void } | null = null
    const finish = (seconds: number | null) => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      element.removeEventListener('loadedmetadata', onMeta)
      element.removeEventListener('error', onError)
      remuxer?.destroy()
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
    if (!remux) {
      element.src = url
      return
    }
    attachFlv(element, url, () => finish(null)).then(
      (attached) => {
        if (done) attached.destroy()
        else remuxer = attached
      },
      () => finish(null),
    )
  })
}

export function browserCanPlay(mime: string): boolean {
  if (REMUX_TYPES[mime]) return remuxSupported()
  const probe = document.createElement(mime.startsWith('audio/') ? 'audio' : 'video')
  // Matroska is widely playable in Chromium even though it rarely admits it.
  return probe.canPlayType(mime) !== '' || mime === 'video/x-matroska' || mime === 'audio/x-matroska' || mime === 'video/quicktime'
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
 * The native folder picker. Null when the viewer cancels; 'refused' when the browser will not show it,
 * so the caller can offer its ordinary folder input instead. Cancelling is never an error.
 */
export async function pickFolder(picker: DirectoryPicker): Promise<File[] | null | 'refused'> {
  let root: DirectoryHandleLike
  try {
    root = await picker({ mode: 'read' })
  } catch (caught) {
    return caught instanceof Error && caught.name === 'AbortError' ? null : 'refused'
  }
  try {
    return await filesInDirectory(root)
  } catch {
    return null
  }
}
