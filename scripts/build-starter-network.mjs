#!/usr/bin/env node
/**
 * Builds the shipped starter User Network (public/user-network/starter-network.json) from a TVN User Network
 * export: every channel kept, sorted A–Z by its displayed name, then numbered 1001, 1002, … with no gaps.
 *
 *   node scripts/build-starter-network.mjs "<export.json>" [--check]
 *   node scripts/build-starter-network.mjs --check-shipped   (the shipped file is already in this form)
 *
 * Deterministic: the same export always gives the same file. Nothing but the numbers changes; the file's own
 * numbers decide only the order of channels whose names compare equal.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const OUT = new URL('../public/user-network/starter-network.json', import.meta.url)
const FIRST = 1001

const args = process.argv.slice(2)
const shipped = args[0] === '--check-shipped'
const [input, flag] = shipped ? [fileURLToPath(OUT), '--check'] : args
if (!input) {
  console.error('usage: node scripts/build-starter-network.mjs <export.json> [--check]')
  process.exit(2)
}

const doc = JSON.parse(readFileSync(input, 'utf8'))
if (doc.format !== 'tvn-user-network-v1' || !Array.isArray(doc.channels)) throw new Error('Not a tvn-user-network-v1 file')

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true, ignorePunctuation: false })
const label = (channel) => String(channel.name ?? '').trim()
const sorted = doc.channels
  .map((channel, index) => ({ channel, index }))
  .sort((a, b) => collator.compare(label(a.channel), label(b.channel)) || a.channel.number - b.channel.number || a.index - b.index)
  .map(({ channel }, position) => ({ ...channel, number: FIRST + position }))

const out = { ...doc, channels: sorted }
const text = `${JSON.stringify(out)}\n`

const names = sorted.map(label)
const lower = names.map((name) => name.toLocaleLowerCase('en'))
const duplicates = [...new Set(lower.filter((name, at) => lower.indexOf(name) !== at))]
const videos = (channel) => (channel.sources ?? []).reduce((sum, source) => sum + (source.videos?.length ?? 0), 0)
const invalid = sorted.filter((channel) => !label(channel) || !Array.isArray(channel.sources) || (channel.state !== 'empty' && channel.sources.length === 0))
const empty = sorted.filter((channel) => channel.state === 'empty' || channel.sources.length === 0)
const addressOnly = sorted.filter((channel) => channel.sources.length > 0 && videos(channel) === 0)

console.log(`input channels: ${doc.channels.length}`)
console.log(`assigned: ${FIRST}–${FIRST + sorted.length - 1}`)
console.log(`first 10: ${names.slice(0, 10).join(' · ')}`)
console.log(`last 10: ${names.slice(-10).join(' · ')}`)
console.log(`duplicate names: ${duplicates.length ? duplicates.join(', ') : 'none'}`)
console.log(`invalid channels: ${invalid.length ? invalid.map(label).join(', ') : 'none'}`)
console.log(`empty channels: ${empty.length ? empty.map(label).join(', ') : 'none'}`)
console.log(`channels read from their YouTube address at install (no stored programmes): ${addressOnly.length}`)

if (flag === '--check') {
  const current = readFileSync(OUT, 'utf8')
  if (current !== text) {
    console.error('starter-network.json is not what this export builds')
    process.exit(1)
  }
  console.log('starter-network.json matches')
} else {
  writeFileSync(OUT, text)
  console.log(`wrote ${OUT.pathname}`)
}
