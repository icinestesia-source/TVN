import { shippedChannel } from '../data/catalogue.ts'
import { appliedCuratedEdits, loadCuratedEdits } from '../services/curated-edits.ts'
import type { StoredSource } from '../services/channels-import.ts'
import { loadStoredSources } from '../services/user-db.ts'
import { EMPTY_REGISTER, readRegister, REGISTER_PATH, type SourceRegister } from './provenance.ts'

let register: Promise<SourceRegister> | null = null
let loaded: SourceRegister | null = null

/** The register if it has already been read. */
export function loadedRegister(): SourceRegister | null {
  return loaded
}

/** The generated source register, fetched once: after the start, or when credits or the editor first need it. */
export function loadRegister(): Promise<SourceRegister> {
  register ??= fetch(REGISTER_PATH)
    .then((response) => (response.ok ? response.json() : null))
    .then((raw) => {
      loaded = readRegister(raw)
      return loaded
    })
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
