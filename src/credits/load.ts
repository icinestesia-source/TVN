import { shippedChannel } from '../data/catalogue.ts'
import { appliedCuratedEdits, loadCuratedEdits } from '../services/curated-edits.ts'
import type { StoredSource } from '../services/channels-import.ts'
import { loadStoredSources } from '../services/user-db.ts'
import { EMPTY_REGISTER, readRegister, REGISTER_PATH, type SourceRegister } from './provenance.ts'

let register: Promise<SourceRegister> | null = null

/** The generated source register, fetched once and only when credits or the editor first need it. */
export function loadRegister(): Promise<SourceRegister> {
  register ??= fetch(REGISTER_PATH)
    .then((response) => (response.ok ? response.json() : null))
    .then((raw) => readRegister(raw))
    .catch(() => {
      register = null
      return EMPTY_REGISTER
    })
  return register
}

export interface ViewerRecords {
  stored: StoredSource[]
  curated: ReturnType<typeof loadCuratedEdits>
}

/** The viewer's own channels and edits, read from this browser only. Nothing here is sent anywhere. */
export async function loadViewerRecords(): Promise<ViewerRecords> {
  const stored = await loadStoredSources().catch(() => [] as StoredSource[])
  return { stored, curated: appliedCuratedEdits(shippedChannel) }
}
