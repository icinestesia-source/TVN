import { useEffect, useRef } from 'react'
import type { TransitionGrain } from '../state/transitions.ts'

/** The noise field's own resolution; the canvas is scaled up, so fewer pixels read as coarser grain. */
const GRAIN_SIZE: Record<TransitionGrain, [number, number]> = {
  coarse: [96, 54],
  normal: [180, 102],
  fine: [320, 180],
}

export type Rgb = readonly [number, number, number]

/** A `#rrggbb` colour as 0…255 channels; anything else is ignored. */
export function parseHex(hex: string): Rgb | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!match) return null
  const value = Number.parseInt(match[1], 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

/**
 * One grey static pixel as a shade of a chosen colour: black at 0, the colour at 128, white at 255.
 * That is what Colour in Channel change paints — the blocks themselves, not a filter over them.
 */
export function shadeTowards([red, green, blue]: Rgb, level: number): Rgb {
  const amount = Math.max(0, Math.min(255, Math.round(level)))
  if (amount <= 128) {
    const mix = amount / 128
    return [Math.round(red * mix), Math.round(green * mix), Math.round(blue * mix)]
  }
  const mix = (amount - 128) / 127
  return [
    Math.round(red + (255 - red) * mix),
    Math.round(green + (255 - green) * mix),
    Math.round(blue + (255 - blue) * mix),
  ]
}

/** Television snow. `heavy` is brighter, with more tearing: the analogue static transition. */
export function Noise({
  grain = 'normal',
  heavy = false,
  colours = [],
}: {
  grain?: TransitionGrain
  heavy?: boolean
  /** Hex shades for the snow blocks; empty keeps ordinary grey static. */
  colours?: readonly string[]
} = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const paletteKey = colours.join('|')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) return

    const [width, height] = GRAIN_SIZE[grain]
    canvas.width = width
    canvas.height = height
    const image = context.createImageData(width, height)
    const palette = (paletteKey ? paletteKey.split('|') : []).map(parseHex).filter((rgb): rgb is Rgb => rgb !== null)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const tearEvery = heavy ? 5 : 12
    let frame = 0
    let raf = 0

    const paint = (data: Uint8ClampedArray, index: number, level: number) => {
      if (palette.length === 0) {
        data[index] = level
        data[index + 1] = level
        data[index + 2] = level
      } else {
        // Several colours: each block picks one, so the field is a mix of their shades, not a tint over grey.
        const [red, green, blue] = shadeTowards(palette[Math.floor(Math.random() * palette.length)], level)
        data[index] = red
        data[index + 1] = green
        data[index + 2] = blue
      }
      data[index + 3] = 255
    }

    const draw = () => {
      const data = image.data
      const level = heavy ? 205 + Math.random() * 50 : 150 + Math.random() * 40
      for (let index = 0; index < data.length; index += 4) {
        paint(data, index, Math.random() * level)
      }
      if (!reduce && frame % 8 === 0) {
        const y = Math.floor(Math.random() * (height - 2))
        for (let x = 0; x < width; x += 1) {
          paint(data, (y * width + x) * 4, 190 + Math.random() * 50)
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
  }, [grain, heavy, paletteKey])

  return <canvas ref={canvasRef} className="static-noise" />
}
