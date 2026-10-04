import { randomUUID } from 'node:crypto'
import { chmodSync, copyFileSync, constants, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { DEFAULT_CONFIG, withOverrides, type HarvesterConfig } from './config.ts'
import { openDb, type Db } from './db.ts'
import { sha256 } from './files.ts'
import { importMaster, type ImportCounts } from './importer.ts'

export const FOLDERS = ['master', 'checkpoints', 'additions', 'exports', 'reports', 'logs'] as const
export const DB_FILE = 'harvester.db'
export const CONFIG_FILE = 'harvester.config.json'

export interface Workspace {
  dir: string
  db: Db
  config: HarvesterConfig
  path: (folder: (typeof FOLDERS)[number], name?: string) => string
}

export const isWorkspace = (dir: string): boolean => existsSync(join(dir, DB_FILE))

function configOf(dir: string): HarvesterConfig {
  const file = join(dir, CONFIG_FILE)
  if (!existsSync(file)) return DEFAULT_CONFIG
  try {
    return withOverrides(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return DEFAULT_CONFIG
  }
}

function workspaceAt(dir: string, db: Db): Workspace {
  return { dir, db, config: configOf(dir), path: (folder, name) => (name ? join(dir, folder, name) : join(dir, folder)) }
}

/** Open an existing workspace, bringing its database's schema forward if a newer Harvester added to it. */
export function openWorkspace(raw: string): Workspace {
  const dir = resolve(raw)
  if (!isWorkspace(dir)) throw new Error(`No Harvester workspace at ${dir}`)
  for (const folder of FOLDERS) mkdirSync(join(dir, folder), { recursive: true })
  return workspaceAt(dir, openDb(join(dir, DB_FILE)))
}

/**
 * A new workspace from a Complete Export. The export is copied into master/ (never moved, never edited)
 * and made read-only; the copy must hash the same as the original before anything is imported.
 */
export function createWorkspace(raw: string, masterPath: string, now: Date = new Date()): { workspace: Workspace; counts: ImportCounts } {
  const dir = resolve(raw)
  if (isWorkspace(dir)) throw new Error(`${dir} is already a Harvester workspace`)
  if (!existsSync(masterPath) || !statSync(masterPath).isFile()) throw new Error(`No export at ${masterPath}`)
  for (const folder of FOLDERS) mkdirSync(join(dir, folder), { recursive: true })
  const original = readFileSync(masterPath)
  const stored = join(dir, 'master', basename(masterPath))
  copyFileSync(masterPath, stored, constants.COPYFILE_EXCL)
  chmodSync(stored, 0o444)
  const copy = readFileSync(stored)
  const hash = sha256(original)
  if (sha256(copy) !== hash) throw new Error('The master copy does not match the original')
  const db = openDb(join(dir, DB_FILE))
  try {
    const counts = importMaster(db, copy.toString('utf8'), { filename: basename(masterPath), storedPath: stored, sha256: hash, bytes: copy.length, importedAt: now }, randomUUID())
    return { workspace: workspaceAt(dir, db), counts }
  } catch (error) {
    db.close()
    throw error
  }
}

export interface MasterRecord {
  filename: string
  stored_path: string
  imported_at: string
  format: string
  version: number
  exported_at: string
  app_commit: string | null
  app_build: string | null
  sha256: string
  bytes: number
  channels: number
  central: number
  sources: number
  programmes: number
  dated: number
}

export function masterRecord(db: Db): MasterRecord {
  return db
    .prepare('SELECT filename, stored_path, imported_at, format, version, exported_at, app_commit, app_build, sha256, bytes, channels, central, sources, programmes, dated FROM master WHERE id = 1')
    .get() as unknown as MasterRecord
}

/** Whether the master copy in master/ still hashes as it did on import. */
export function masterIntact(db: Db): { ok: boolean; expected: string; actual: string | null } {
  const master = masterRecord(db)
  const actual = existsSync(master.stored_path) ? sha256(readFileSync(master.stored_path)) : null
  return { ok: actual === master.sha256, expected: master.sha256, actual }
}
