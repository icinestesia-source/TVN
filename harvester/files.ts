import { createHash } from 'node:crypto'
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs'

/** Write a whole file or nothing: to `<path>.tmp`, flushed, then renamed over the target. */
export function writeAtomic(path: string, data: string | Uint8Array): void {
  const temp = `${path}.tmp`
  const fd = openSync(temp, 'w')
  try {
    writeSync(fd, typeof data === 'string' ? Buffer.from(data, 'utf8') : data)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    renameSync(temp, path)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

export const sha256File = (path: string): string => sha256(readFileSync(path))

/** `YYYY-MM-DD_HHMM` by the local clock, for file names. */
export function stamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`
}
