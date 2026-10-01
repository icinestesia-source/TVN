import { useEffect, useRef } from 'react'
import { channelByNumber } from '../data/catalogue.ts'
import { onScreen } from '../player/manual.ts'
import { useClock } from '../utils/use-clock.ts'
import { padChannel } from '../utils/time.ts'

export function StaticOverlay({ channelNumber }: { channelNumber: number }) {
  const now = useClock(500)
  const channel = channelByNumber(channelNumber)
  const title = channel ? onScreen(channel, now).current.programme.title : 'No channel'

  return (
    <div className="static" role="status" aria-live="polite">
      <Noise />
      <div className="static-ident">
        <p className="static-number">{channel ? padChannel(channel.number) : '———'}</p>
        <p className="static-name">{channel?.name ?? 'NO CHANNEL'}</p>
        <p className="static-title">{title}</p>
      </div>
    </div>
  )
}

export function Noise() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) return

    const width = 180
    const height = 102
    canvas.width = width
    canvas.height = height
    const image = context.createImageData(width, height)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    let raf = 0

    const draw = () => {
      const data = image.data
      const level = 150 + Math.random() * 40
      for (let index = 0; index < data.length; index += 4) {
        const value = Math.random() * level
        data[index] = value
        data[index + 1] = value
        data[index + 2] = value
        data[index + 3] = 255
      }
      if (!reduce && frame % 8 === 0) {
        const y = Math.floor(Math.random() * (height - 2))
        for (let x = 0; x < width; x += 1) {
          const pixel = (y * width + x) * 4
          const value = 190 + Math.random() * 50
          data[pixel] = value
          data[pixel + 1] = value
          data[pixel + 2] = value
        }
      }
      context.putImageData(image, 0, 0)
      if (!reduce && frame % 12 === 0) {
        const y = Math.floor(Math.random() * (height - 4))
        const band = context.getImageData(0, y, width, 2)
        context.putImageData(band, Math.random() > 0.5 ? 5 : -5, y)
      }
      frame += 1
      if (!reduce) raf = window.requestAnimationFrame(draw)
    }

    draw()
    return () => window.cancelAnimationFrame(raf)
  }, [])

  return <canvas ref={canvasRef} className="static-noise" />
}
