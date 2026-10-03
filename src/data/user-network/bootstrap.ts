import { takeClassifyMs } from '../../library/classify.ts'
import { ingestParsed } from '../../library/store.ts'
import {
  mergeParsedExports,
  parseChannelsExport,
  planImport,
  type ImportPlan,
  type ParsedExport,
  type StoredSource,
} from '../../services/channels-import.ts'
import { loadShippedRefusals } from '../../services/embed-refusals.ts'
import { loadShippedArchive } from '../../services/user-archive.ts'
import { loadStoredSources } from '../../services/user-db.ts'
import type { UserNetworkExport } from '../../services/user-network-export.ts'
import { readUserNetworkFile } from '../../services/user-network-restore.ts'

export const BUILT_IN_CATALOGUE_ID = 'retrotv-user-network'
export const BUILT_IN_CATALOGUE_VERSION = '2.4'
const FINGERPRINT_KEY = 'retrotv.builtin-catalogues.v1'

export const BUILT_IN_CATALOGUE_FILES = [
  { id: 'channels-txt', version: '2.4', path: '/user-network/channels.txt' },
  { id: 'more-channels', version: '2.4', path: '/user-network/more-channels.txt' },
] as const

export interface BootstrapTimings {
  read: number
  parse: number
  normalize: number
  classify: number
  reconcile: number
  persist: number
  channelPlanning: number
  total: number
  skipped: boolean
}

export let lastBootstrapTimings: BootstrapTimings | null = null

export interface BootstrapResult {
  sources: StoredSource[]
  fingerprint: string
  timings: BootstrapTimings
  skipped: boolean
  plan: ImportPlan | null
}

export function catalogueFingerprint(texts: readonly string[]): string {
  let hash = 2166136261
  for (const text of texts) {
    hash = Math.imul(hash ^ text.length, 16777619)
    for (let index = 0; index < text.length; index += 1) {
      hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
    }
  }
  return `${BUILT_IN_CATALOGUE_ID}|${BUILT_IN_CATALOGUE_VERSION}|${(hash >>> 0).toString(16)}`
}

function emptyTimings(total: number, skipped: boolean): BootstrapTimings {
  return {
    read: 0,
    parse: 0,
    normalize: 0,
    classify: 0,
    reconcile: 0,
    persist: 0,
    channelPlanning: 0,
    total,
    skipped,
  }
}

/**
 * Parse, reconcile, and plan user channels from catalogue text.
 * A matching fingerprint with an existing catalogue does not ingest again.
 */
export async function applyBuiltInCatalogues(input: {
  texts: readonly string[]
  existing: readonly StoredSource[]
  storedFingerprint: string | null
  now: number
  reserved: readonly number[]
  ingest?: (parsed: ParsedExport) => Promise<void>
}): Promise<BootstrapResult> {
  const started = performance.now()
  const fingerprint = catalogueFingerprint(input.texts)
  if (input.storedFingerprint === fingerprint && input.existing.length > 0) {
    return {
      sources: input.existing.slice(),
      fingerprint,
      timings: emptyTimings(performance.now() - started, true),
      skipped: true,
      plan: null,
    }
  }

  const parseStarted = performance.now()
  const parsed = input.texts.map((text) => parseChannelsExport(text))
  const parse = performance.now() - parseStarted
  const normalizeStarted = performance.now()
  const merged = mergeParsedExports(parsed)
  const normalize = performance.now() - normalizeStarted

  takeClassifyMs()
  let classify = 0
  let reconcile = 0
  let persist = 0
  const ingestStarted = performance.now()
  let mark = ingestStarted
  const ingest =
    input.ingest ??
    ((next: ParsedExport) =>
      ingestParsed(next, {
        filename: BUILT_IN_CATALOGUE_ID,
        now: input.now,
        onPhase(phase) {
          const at = performance.now()
          if (phase === 'RECONCILING') {
            classify = takeClassifyMs()
            reconcile = Math.max(0, at - mark - classify)
          }
          if (phase === 'COMPLETE') persist = at - mark
          mark = at
        },
      }).then(() => undefined))
  await ingest(merged)
  if (classify === 0) classify = takeClassifyMs()
  if (reconcile === 0 && persist === 0) reconcile = performance.now() - ingestStarted

  const planStarted = performance.now()
  const plan = planImport(input.existing, merged, { library: true, automatic: true }, input.reserved, input.now)
  const channelPlanning = performance.now() - planStarted
  return {
    sources: plan.sources,
    fingerprint,
    timings: {
      read: 0,
      parse,
      normalize,
      classify,
      reconcile,
      persist,
      channelPlanning,
      total: performance.now() - started,
      skipped: false,
    },
    skipped: false,
    plan,
  }
}

/** The shipped starter User Network: a TVN User Network export, numbered as it is to be installed. */
export const STARTER_NETWORK_FILE = '/user-network/starter-network.json'

/** Starter networks TVN shipped before this one: still read so Remove starter finds the channels they installed. */
export const PREVIOUS_STARTER_FILES = ['/user-network/starter-network-2026-10-02.json', '/user-network/starter-network-2026-10-03.json'] as const

/** The starter network as shipped, read fresh each time and never written to. */
export async function readStarterNetwork(path: string = STARTER_NETWORK_FILE): Promise<UserNetworkExport> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`Could not read ${path}`)
  const read = readUserNetworkFile(await response.text())
  if (!read.ok) throw new Error(`${path} is not a TVN User Network file`)
  return read.value
}

/**
 * The starter network TVN shipped before 1.0.13 (1001–1081), read fresh each time and never written to.
 * Still read so Remove starter finds the channels it installed in browsers that have them.
 */
export async function readStarterTemplate(): Promise<ParsedExport> {
  return mergeParsedExports((await readCatalogueTexts()).texts.map((text) => parseChannelsExport(text)))
}

async function readCatalogueTexts(): Promise<{ texts: string[]; read: number }> {
  const started = performance.now()
  const texts: string[] = []
  for (const file of BUILT_IN_CATALOGUE_FILES) {
    const response = await fetch(file.path)
    if (!response.ok) throw new Error(`Could not read ${file.path}`)
    texts.push(await response.text())
  }
  return { texts, read: performance.now() - started }
}

function readStoredFingerprint(): string | null {
  try {
    return localStorage.getItem(FINGERPRINT_KEY)
  } catch {
    return null
  }
}

/**
 * The User Network is the viewer's own. Whatever this browser has stored is loaded exactly as it is,
 * including channels an earlier TVN installed from the bundled catalogues. Nothing is installed here:
 * the starter network reaches each viewer only through the provider, once, after startup is ready.
 */
export async function bootstrapUserNetwork(): Promise<BootstrapResult> {
  const started = performance.now()
  const [existing] = await Promise.all([loadStoredSources(), loadShippedRefusals(), loadShippedArchive()])
  const timings = emptyTimings(performance.now() - started, true)
  lastBootstrapTimings = timings
  return { sources: existing, fingerprint: readStoredFingerprint() ?? '', timings, skipped: true, plan: null }
}
