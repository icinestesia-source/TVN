import { readdirSync, readFileSync } from 'node:fs'

const MODULES = 'src/state/provider'

/**
 * The TV provider's source as one text: each hook module in src/state/provider is read in where the provider
 * calls it, so a test reads the provider's code in the order it runs, wherever a part of it is kept.
 */
export function providerSource(): string {
  let text = readFileSync('src/state/TvProvider.tsx', 'utf8')
  const rest: string[] = []
  for (const file of readdirSync(MODULES).sort()) {
    const module = readFileSync(`${MODULES}/${file}`, 'utf8')
    const hook = module.match(/export function (use\w+)\(/)?.[1]
    const call = hook ? new RegExp(`^[^\\n]*\\b${hook}\\(\\{[\\s\\S]*?\\}\\)$`, 'm') : null
    if (hook && call?.test(text)) text = text.replace(call, () => module.slice(module.indexOf(`export function ${hook}(`)))
    else rest.push(module)
  }
  return [text, ...rest].join('\n')
}
