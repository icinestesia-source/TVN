/**
 * Feeds the FLV player a file from this device a slice at a time. The player turns whatever it is handed into
 * one media segment, and a picked file streamed whole arrives in pieces of a hundred MB or more, which Safari
 * (and the Mac app) refuses outright: nothing plays. Slices keep every segment small in every browser.
 */

export const FLV_SLICE_BYTES = 2 * 1024 * 1024

const IDLE = 0
const CONNECTING = 1
const BUFFERING = 2
const ERROR = 3
const COMPLETE = 4

interface ByteRange {
  from: number
  to: number
}

/** The loader shape the FLV player asks for: it opens a byte range, may abort it, and is then thrown away. */
export function sliceLoader(file: Blob, sliceBytes = FLV_SLICE_BYTES) {
  return class SliceLoader {
    readonly type = 'tvn-slices'
    readonly needStashBuffer = true
    _status = IDLE
    _needStash = true
    onContentLengthKnown: ((length: number) => void) | null = null
    onURLRedirect: ((url: string) => void) | null = null
    onDataArrival: ((chunk: ArrayBuffer, byteStart: number, receivedLength?: number) => void) | null = null
    onError: ((type: string, info: { code: number; msg: string }) => void) | null = null
    onComplete: ((from: number, to: number) => void) | null = null
    private run = 0

    get status(): number {
      return this._status
    }

    isWorking(): boolean {
      return this._status === CONNECTING || this._status === BUFFERING
    }

    open(_source: unknown, range: ByteRange): void {
      const run = ++this.run
      const from = Math.max(0, range.from)
      const end = range.to >= 0 ? Math.min(file.size, range.to + 1) : file.size
      this._status = CONNECTING
      this.onContentLengthKnown?.(end - from)
      void this.pump(run, from, from, end)
    }

    private async pump(run: number, from: number, at: number, end: number): Promise<void> {
      while (at < end) {
        let chunk: ArrayBuffer
        try {
          chunk = await file.slice(at, Math.min(end, at + sliceBytes)).arrayBuffer()
        } catch (error) {
          if (run !== this.run) return
          this._status = ERROR
          this.onError?.('Exception', { code: -1, msg: error instanceof Error ? error.message : 'file unreadable' })
          return
        }
        if (run !== this.run) return
        this._status = BUFFERING
        at += chunk.byteLength
        this.onDataArrival?.(chunk, at - chunk.byteLength, at - from)
        if (run !== this.run) return
      }
      this._status = COMPLETE
      this.onComplete?.(from, end - 1)
    }

    abort(): void {
      this.run += 1
      if (this.isWorking()) this._status = COMPLETE
    }

    destroy(): void {
      this.run += 1
      this._status = IDLE
      this.onContentLengthKnown = null
      this.onURLRedirect = null
      this.onDataArrival = null
      this.onError = null
      this.onComplete = null
    }
  }
}
