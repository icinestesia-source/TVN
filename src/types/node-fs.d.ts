declare module 'node:fs' {
  export function existsSync(path: string): boolean
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function readFileSync(path: string): Uint8Array
  export function readdirSync(path: string): string[]
  export function statSync(path: string): { isDirectory(): boolean }
}
