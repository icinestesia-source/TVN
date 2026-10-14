import { aviRoute, aviToFlv, parseAviHeader } from './avi.ts'
import { remuxSupported } from './flv.ts'

const stem = (name: string) => name.replace(/\.[^.]+$/, '')
let running: Promise<unknown> = Promise.resolve()

/**
 * The AVI as a file TVN can play: an FLV repackaged here when its picture is H.264 (seconds, nothing to
 * download), otherwise an MP4 from the in-page converter. Null when neither can read it. One at a time.
 */
export function convertAvi(file: File, onNote?: (note: string) => void): Promise<File | null> {
  const run = running.then(async () => {
    const header = parseAviHeader(new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer()))
    if (!header || header.video < 0) return null
    const percent = (fraction: number) => `${Math.round(fraction * 100)}%`
    if (aviRoute(header) === 'flv' && remuxSupported()) {
      try {
        const flv = await aviToFlv(file, header, (fraction) => onNote?.(`REPACKAGING ${file.name} · ${percent(fraction)}`))
        return new File([flv], `${stem(file.name)}.flv`, { type: 'video/x-flv' })
      } catch {
        // An H.264 AVI the repackager cannot follow still goes to the converter.
      }
    }
    onNote?.(`LOADING THE CONVERTER FOR ${file.name}…`)
    const { convertToMp4 } = await import('./avi-ffmpeg.ts')
    const video = header.streams[header.video]
    const copy = /^(h264|x264|avc1)$/i.test(video?.codec ?? '')
    const mp4 = await convertToMp4(file, copy, (fraction) => onNote?.(`CONVERTING ${file.name} · ${percent(fraction)}`))
    return mp4 ? new File([mp4], `${stem(file.name)}.mp4`, { type: 'video/mp4' }) : null
  })
  running = run.catch(() => undefined)
  return run
}
