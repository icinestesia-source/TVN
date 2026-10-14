import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg'
import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'

/**
 * The in-page converter for video no browser decodes (Xvid, DivX, Motion-JPEG…): ffmpeg compiled to
 * WebAssembly, served with TVN and fetched only the first time such a file is imported. It reads the file
 * where it lies and writes an MP4 (H.264 and AAC) in the page; nothing leaves this device.
 */
let loaded: Promise<FFmpeg> | null = null
let queue: Promise<unknown> = Promise.resolve()

function converter(): Promise<FFmpeg> {
  loaded ??= (async () => {
    const ffmpeg = new FFmpeg()
    await ffmpeg.load({ coreURL, wasmURL })
    return ffmpeg
  })().catch((error: unknown) => {
    loaded = null
    throw error
  })
  return loaded
}

/** Converts one file to MP4, one file at a time; null when ffmpeg cannot read or convert it. */
export function convertToMp4(file: File, copyVideo: boolean, onProgress?: (fraction: number) => void): Promise<Blob | null> {
  const run = queue.then(async () => {
    const ffmpeg = await converter()
    const report = ({ progress }: { progress: number }) => onProgress?.(Math.min(1, Math.max(0, progress)))
    ffmpeg.on('progress', report)
    const folder = `/in${Date.now()}`
    try {
      await ffmpeg.createDir(folder)
      await ffmpeg.mount(FFFSType.WORKERFS, { files: [file] }, folder)
      const video = copyVideo ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p']
      const code = await ffmpeg.exec(['-i', `${folder}/${file.name}`, '-map', '0:v:0', '-map', '0:a:0?', ...video, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '/out.mp4'])
      if (code !== 0) return null
      const data = await ffmpeg.readFile('/out.mp4')
      await ffmpeg.deleteFile('/out.mp4')
      return typeof data === 'string' ? null : new Blob([data as Uint8Array<ArrayBuffer>], { type: 'video/mp4' })
    } catch {
      return null
    } finally {
      ffmpeg.off('progress', report)
      await ffmpeg.unmount(folder).catch(() => undefined)
      await ffmpeg.deleteDir(folder).catch(() => undefined)
    }
  })
  queue = run.catch(() => undefined)
  return run
}
