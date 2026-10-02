import type { Channel } from '../types/channel.ts'
import { cleanEditorial, type ChannelEditorial } from './channel-curation.ts'
import type { StoredSource } from './channels-import.ts'
import { canonicalEdit, shippedBaseline, TVN_SOURCE_ID, type CuratedBaseline, type CuratedEdit } from './curated-edits.ts'
import { checkEditorial, checkSources, exportSource, type ExportSource } from './user-network-export.ts'
import { channelSource } from './user-network-restore.ts'
import type { UploaderOf } from './user-network.ts'
import { checkOriginals, cleanOriginals, reconcileOriginals, type OriginalOverride, type OriginalSource } from './original-sources.ts'

/**
 * The viewer's 001–999 overrides inside a complete export: only what they changed, never the shipped
 * catalogue. Each override names the shipped channel it was made against (its baseline), so a restore
 * into a later TVN can keep what still fits and say plainly what no longer does.
 */
export const CENTRAL_CURATION_FORMAT = 'tvn-central-overrides-v1'

export interface CentralOverride {
  number: number
  name: string
  description?: string
  /** Includes TVN's own programming as a `tvn` source, switched on or off. */
  sources: ExportSource[]
  runningOrder?: string[]
  excluded?: string[]
  editorial?: ChannelEditorial
  /** Decisions about TVN's original sources, by source id: never the sources' programmes themselves. */
  originals?: OriginalOverride[]
  baseline?: CuratedBaseline
  savedAt: string
}

export interface CentralCuration {
  format: typeof CENTRAL_CURATION_FORMAT
  overrides: CentralOverride[]
}

export function buildCentralCuration(edits: readonly CuratedEdit[], uploaderOf: UploaderOf = () => null): CentralCuration {
  const overrides = [...edits]
    .filter((edit) => Number.isInteger(edit.channelNumber) && edit.channelNumber >= 1 && edit.channelNumber <= 999)
    .sort((a, b) => a.channelNumber - b.channelNumber)
    .map((edit): CentralOverride => {
      const editorial = cleanEditorial(edit.editorial)
      const originals = cleanOriginals(edit.originals)
      return {
        number: edit.channelNumber,
        name: edit.name,
        ...(edit.description ? { description: edit.description } : {}),
        sources: edit.sources.map((source) => exportSource(source, uploaderOf)),
        ...(edit.order?.length ? { runningOrder: [...edit.order] } : {}),
        ...(edit.excluded?.length ? { excluded: [...edit.excluded] } : {}),
        ...(editorial ? { editorial } : {}),
        ...(originals ? { originals } : {}),
        ...(edit.baseline ? { baseline: { ...edit.baseline } } : {}),
        savedAt: new Date(Number.isFinite(edit.savedAt) ? edit.savedAt : 0).toISOString(),
      }
    })
  return { format: CENTRAL_CURATION_FORMAT, overrides }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isTextList = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === 'string')
const OVERRIDE_FIELDS = new Set(['number', 'name', 'description', 'sources', 'runningOrder', 'excluded', 'editorial', 'originals', 'baseline', 'savedAt'])

/** The whole section must be valid before any of it is restored. */
export function checkCentralCuration(value: unknown, at: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${at} is not a set of overrides`)
    return
  }
  if (value.format !== CENTRAL_CURATION_FORMAT) errors.push(`${at}.format is not ${CENTRAL_CURATION_FORMAT}`)
  if (!Array.isArray(value.overrides)) {
    errors.push(`${at}.overrides is not a list`)
    return
  }
  const seen = new Set<number>()
  value.overrides.forEach((item, index) => {
    const where = `${at}.overrides[${index}]`
    if (!isRecord(item)) {
      errors.push(`${where} is not an override`)
      return
    }
    for (const name of Object.keys(item)) if (!OVERRIDE_FIELDS.has(name)) errors.push(`${where}.${name} is not an override field`)
    const number = item.number
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 1 || number > 999) errors.push(`${where}.number is not a TVN channel 001–999`)
    else if (seen.has(number)) errors.push(`${where} repeats channel ${number}`)
    else seen.add(number)
    if (typeof item.name !== 'string' || !item.name.trim()) errors.push(`${where}.name is missing`)
    if (item.description !== undefined && typeof item.description !== 'string') errors.push(`${where}.description is not text`)
    if (item.runningOrder !== undefined && !isTextList(item.runningOrder)) errors.push(`${where}.runningOrder is not a list of programme ids`)
    if (item.excluded !== undefined && !isTextList(item.excluded)) errors.push(`${where}.excluded is not a list of programme ids`)
    if (typeof item.savedAt !== 'string' || Number.isNaN(Date.parse(item.savedAt))) errors.push(`${where}.savedAt is not a date`)
    checkEditorial(item.editorial, `${where}.editorial`, errors)
    checkOriginals(item.originals, `${where}.originals`, errors)
    if (item.baseline !== undefined) {
      const base = item.baseline
      const ok =
        isRecord(base) &&
        typeof base.name === 'string' &&
        typeof base.programmes === 'number' &&
        Number.isInteger(base.programmes) &&
        base.programmes >= 0 &&
        typeof base.fingerprint === 'string' &&
        /^[0-9a-f]{8}$/.test(base.fingerprint)
      if (!ok) errors.push(`${where}.baseline is not a shipped channel's identity`)
    }
    if (!Array.isArray(item.sources)) {
      errors.push(`${where}.sources is not a list`)
      return
    }
    checkSources(item.sources, where, errors)
    if (item.sources.filter((source) => isRecord(source) && source.sourceType === 'tvn').length > 1) errors.push(`${where} lists TVN programming twice`)
  })
}

/** The overrides as stored records, before they are checked against the TVN they are restored into. */
export function overridesFromExport(doc: CentralCuration): CuratedEdit[] {
  return doc.overrides.map((override) => ({
    channelNumber: override.number,
    name: override.name,
    sources: override.sources.map((source, index) => {
      const made = channelSource(source, index)
      return made.kind === 'tvn' ? { ...made, id: TVN_SOURCE_ID, status: { state: 'ready' as const, checkedAt: 0 } } : made
    }),
    ...(override.runningOrder?.length ? { order: [...override.runningOrder] } : {}),
    ...(override.excluded?.length ? { excluded: [...override.excluded] } : {}),
    ...(override.description ? { description: override.description } : {}),
    ...(override.editorial ? { editorial: structuredClone(override.editorial) } : {}),
    ...(override.originals?.length ? { originals: structuredClone(override.originals) } : {}),
    ...(override.baseline ? { baseline: { ...override.baseline } } : {}),
    savedAt: Date.parse(override.savedAt),
  }))
}

/** Stand-in records so a restore can read YouTube sources again the way a User Network restore does. */
export function overrideRecord(edit: CuratedEdit): StoredSource {
  return { id: `tvn-${edit.channelNumber}`, name: edit.name, videos: [], channelNumber: edit.channelNumber, inLibrary: false, automatic: true, updatedAt: edit.savedAt, channelSources: edit.sources }
}

/**
 * One restored override against the TVN it lands in. Whatever still fits is kept; a channel TVN no longer
 * ships, a renamed shipped channel, programmes that have gone from it, or an original source it no longer
 * ships (`originals`: its sources now) are reported, never merged.
 */
export function reconcileOverride(
  edit: CuratedEdit,
  shipped: Pick<Channel, 'number' | 'name'> & { description?: string } | undefined,
  programmeIds: readonly string[],
  originals: readonly OriginalSource[] = [],
): { edit: CuratedEdit | null; conflicts: string[] } {
  const label = String(edit.channelNumber).padStart(3, '0')
  if (!shipped) return { edit: null, conflicts: [`${label} is no longer in TVN · its curation was not restored`] }
  const current = shippedBaseline(shipped, programmeIds)
  const was = edit.baseline
  const conflicts: string[] = []
  if (was && was.name !== current.name) conflicts.push(`TVN renamed ${label} from ${was.name} to ${current.name}`)
  const poolIds = originals.flatMap((source) => source.videos.map((video) => video.id))
  const known = new Set([...programmeIds, ...poolIds])
  const ownProgrammes = edit.sources.some((source) => source.kind !== 'tvn' && (source.videos?.length ?? 0) > 0)
  const goneOrder = ownProgrammes ? 0 : (edit.order ?? []).filter((id) => !known.has(id)).length
  const goneExcluded = (edit.excluded ?? []).filter((id) => !known.has(id)).length
  if (goneOrder + goneExcluded > 0) conflicts.push(`${goneOrder + goneExcluded} of ${label}'s arranged programmes are no longer in TVN's channel`)
  else if (was && was.fingerprint !== current.fingerprint) conflicts.push(`TVN has changed ${label}'s programmes since it was curated`)
  const sources = reconcileOriginals(cleanOriginals(edit.originals), originals, label)
  conflicts.push(...sources.conflicts)
  const next = canonicalEdit(shipped, { ...edit, originals: sources.kept }, programmeIds, poolIds)
  return {
    edit: { channelNumber: edit.channelNumber, ...next, savedAt: edit.savedAt, baseline: current, ...(conflicts.length ? { conflicts } : {}) },
    conflicts,
  }
}
