import { useEffect, useRef } from 'react'
import type { TransitionGrain } from '../state/transitions.ts'

/** The noise field's own resolution; the canvas is scaled up, so fewer pixels read as coarser grain. */
const GRAIN_SIZE: Record<TransitionGrain, [number, number]> = {
  coarse: [96, 54],
  normal: [180, 102],
  fine: [320, 180],
}

/** Television snow. `heavy` is brighter, with more tearing: the analogue static transition. */
export function Noise({ grain = 'normal', heavy = false }: { grain?: TransitionGrain; heavy?: boolean } = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) return

    const [width, height] = GRAIN_SIZE[grain]
    canvas.width = width
    canvas.height = height
    const image = context.createImageData(width, height)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const tearEvery = heavy ? 5 : 12
    let frame = 0
    let raf = 0

    const draw = () => {
      const data = image.data
      const level = heavy ? 205 + Math.random() * 50 : 150 + Math.random() * 40
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
      if (!reduce && frame % tearEvery === 0) {
        const y = Math.floor(Math.random() * (height - 4))
        const band = context.getImageData(0, y, width, heavy ? 4 : 2)
        const shift = Math.round((heavy ? 12 : 5) * (width / 180))
        context.putImageData(band, Math.random() > 0.5 ? shift : -shift, y)
      }
      frame += 1
      if (!reduce) raf = window.requestAnimationFrame(draw)
    }

    draw()
    return () => window.cancelAnimationFrame(raf)
  }, [grain, heavy])

  return <canvas ref={canvasRef} className="static-noise" />
}
