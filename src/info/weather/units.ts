import type { TempUnit, WindUnit } from '../preferences.ts'

export function convertTemp(celsius: number, unit: TempUnit): number {
  return unit === 'fahrenheit' ? (celsius * 9) / 5 + 32 : celsius
}

export function formatTemp(celsius: number, unit: TempUnit): string {
  return `${Math.round(convertTemp(celsius, unit))}°${unit === 'fahrenheit' ? 'F' : 'C'}`
}

export function convertWindKmh(kmh: number, unit: WindUnit): number {
  return unit === 'mph' ? kmh * 0.621371 : kmh
}

export function formatWind(kmh: number, unit: WindUnit): string {
  return `${Math.round(convertWindKmh(kmh, unit))} ${unit === 'mph' ? 'mph' : 'km/h'}`
}
