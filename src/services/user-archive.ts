import type { ImportedVideo } from './channels-import.ts'

/**
 * Each User Network collection is one YouTube uploader. The shipped archive names that uploader and
 * lists its earlier uploads that play embedded, newest first, so a quiet channel is deepened with its
 * own back catalogue. It is prepared at acquisition time; nothing here needs a key.
 */
export const ARCHIVE_PATH = '/user-network/uploaders.json'

export interface UploaderArchive {
  uploader: string
  title: string
  videos: ImportedVideo[]
}

/** A channel added by link carries its YouTube channel id; a bundled collection is matched by name. */
export type ArchiveLookup = (source: { id: string; name: string }) => UploaderArchive | null

let owners = new Map<string, string>()
let archives = new Map<string, UploaderArchive>()

export function setShippedArchive(value: unknown): void {
  owners = new Map()
  archives = new Map()
  if (!value || typeof value !== 'object') return
  const record = value as { collections?: unknown; uploaders?: unknown }
  if (record.collections && typeof record.collections === 'object') {
    for (const [name, uploader] of Object.entries(record.collections)) if (typeof uploader === 'string') owners.set(name, uploader)
  }
  if (record.uploaders && typeof record.uploaders === 'object') {
    for (const [uploader, entry] of Object.entries(record.uploaders as Record<string, unknown>)) {
      const { title, videos } = (entry ?? {}) as { title?: unknown; videos?: unknown }
      if (!Array.isArray(videos)) continue
      const list: ImportedVideo[] = []
      for (const row of videos) {
        if (!Array.isArray(row)) continue
        const [id, name, durationSec] = row as unknown[]
        if (typeof id === 'string' && typeof name === 'string' && typeof durationSec === 'number' && durationSec > 0) {
          list.push({ id, title: name, durationSec: Math.round(durationSec) })
        }
      }
      archives.set(uploader, { uploader, title: typeof title === 'string' ? title : '', videos: list })
    }
  }
}

/** A missing or unreadable archive leaves every channel with its own collection alone. */
export async function loadShippedArchive(read: typeof fetch = fetch): Promise<void> {
  try {
    const response = await read(ARCHIVE_PATH)
    if (response.ok) setShippedArchive(await response.json())
  } catch {
    /* offline or not shipped */
  }
}

export const uploaderArchive: ArchiveLookup = (source) => {
  const uploader = source.id.startsWith('yt:') ? source.id.slice(3) : owners.get(source.name)
  return uploader ? (archives.get(uploader) ?? null) : null
}

export function uploaderIdFor(collectionName: string): string | null {
  return owners.get(collectionName) ?? null
}

export function resetArchiveForTests(): void {
  owners = new Map()
  archives = new Map()
}
