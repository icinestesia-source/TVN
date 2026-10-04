import { DatabaseSync } from 'node:sqlite'

/** The working database's own schema version, separate from the export's. */
export const SCHEMA_VERSION = 2

/**
 * Each migration takes the schema from the version before it to its own. A newer Harvester adds one at
 * the end; an existing workspace is brought forward on open, inside one transaction per step.
 */
export const MIGRATIONS: readonly { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

      -- The supplied Complete Export, as read once. Its file lives untouched in master/.
      CREATE TABLE master (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        filename TEXT NOT NULL, stored_path TEXT NOT NULL, imported_at TEXT NOT NULL,
        format TEXT NOT NULL, version INTEGER NOT NULL, exported_at TEXT NOT NULL,
        app_commit TEXT, app_build TEXT, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL,
        channels INTEGER NOT NULL, central INTEGER NOT NULL, sources INTEGER NOT NULL,
        programmes INTEGER NOT NULL, dated INTEGER NOT NULL,
        -- Everything outside the channels (favourites, settings, guides, users, numbering), kept to export faithfully.
        rest TEXT NOT NULL
      );

      -- A user channel (1001+) or a 001–999 override, with its editorial fields exactly as exported.
      CREATE TABLE channels (
        id INTEGER PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        scope TEXT NOT NULL CHECK (scope IN ('user', 'central')),
        number INTEGER NOT NULL,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        position INTEGER NOT NULL,
        body TEXT NOT NULL
      );
      CREATE INDEX channels_number ON channels (number);

      CREATE TABLE sources (
        id INTEGER PRIMARY KEY,
        channel_id INTEGER NOT NULL REFERENCES channels (id),
        position INTEGER NOT NULL,
        key TEXT NOT NULL UNIQUE,
        source_type TEXT NOT NULL,
        url TEXT NOT NULL,
        provider_id TEXT,
        label TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        -- How Harvester can refresh it: youtube, collection (via its uploader), podcast, website, stream, or none.
        reader TEXT NOT NULL,
        -- The exported source without its programmes, and whether the master carried a programme list for it at all.
        body TEXT NOT NULL,
        has_videos INTEGER NOT NULL,
        status TEXT,
        status_detail TEXT,
        last_attempt_at TEXT,
        last_success_at TEXT,
        failures INTEGER NOT NULL DEFAULT 0,
        not_found_runs INTEGER NOT NULL DEFAULT 0,
        refused INTEGER,
        audited_run INTEGER,
        UNIQUE (channel_id, position)
      );

      -- A source's pool, one row per programme, in the source's own order (ord ascending).
      CREATE TABLE programmes (
        source_id INTEGER NOT NULL REFERENCES sources (id),
        video_id TEXT NOT NULL,
        ord REAL NOT NULL,
        body TEXT NOT NULL,
        published TEXT,
        duration_sec INTEGER NOT NULL,
        pending INTEGER NOT NULL DEFAULT 0,
        playability TEXT NOT NULL DEFAULT 'unknown' CHECK (playability IN ('unknown', 'playable', 'unavailable')),
        origin TEXT NOT NULL CHECK (origin IN ('master', 'harvest')),
        first_run INTEGER,
        last_seen_run INTEGER,
        PRIMARY KEY (source_id, video_id)
      );
      CREATE INDEX programmes_video ON programmes (video_id);

      CREATE TABLE runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mode TEXT NOT NULL CHECK (mode IN ('audit', 'incremental')),
        status TEXT NOT NULL CHECK (status IN ('running', 'stopped', 'interrupted', 'completed')),
        started_at TEXT NOT NULL,
        ended_at TEXT,
        heartbeat_at TEXT,
        elapsed_ms INTEGER NOT NULL DEFAULT 0,
        note TEXT
      );

      -- A run's queue: what it will visit, in order, and how each visit ended. RESUME carries on from the first pending.
      CREATE TABLE run_queue (
        run_id INTEGER NOT NULL REFERENCES runs (id),
        seq INTEGER NOT NULL,
        channel_id INTEGER NOT NULL,
        source_id INTEGER,
        state TEXT NOT NULL CHECK (state IN ('pending', 'done', 'failed', 'skipped')),
        depth TEXT,
        outcome TEXT,
        detail TEXT,
        known INTEGER, added INTEGER, enriched INTEGER, dates_added INTEGER, refused INTEGER, unavailable INTEGER,
        started_at TEXT, finished_at TEXT,
        PRIMARY KEY (run_id, seq)
      );

      -- The change journal: every addition or enrichment, attributable to its run, channel and source.
      CREATE TABLE changes (
        id INTEGER PRIMARY KEY,
        run_id INTEGER NOT NULL,
        channel_id INTEGER NOT NULL,
        source_id INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('added', 'date', 'metadata', 'unavailable', 'status')),
        video_id TEXT,
        detail TEXT,
        at TEXT NOT NULL
      );
      CREATE INDEX changes_run ON changes (run_id);

      CREATE TABLE log (id INTEGER PRIMARY KEY, run_id INTEGER, at TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL);

      CREATE TABLE checkpoints (id INTEGER PRIMARY KEY, run_id INTEGER, at TEXT NOT NULL, kind TEXT NOT NULL, path TEXT NOT NULL);

      -- Each channel's latest health, for reports and the Source Desk queue.
      CREATE TABLE health (
        channel_id INTEGER PRIMARY KEY REFERENCES channels (id),
        computed_at TEXT NOT NULL,
        class TEXT NOT NULL,
        metrics TEXT NOT NULL
      );

      -- Source Desk (a later phase): the curator's own state per channel. Created now, written by nothing yet.
      CREATE TABLE desk (
        channel_id INTEGER PRIMARY KEY REFERENCES channels (id),
        state TEXT NOT NULL DEFAULT 'queued',
        note TEXT,
        updated_at TEXT
      );
    `,
  },
  {
    // Phase 2: the shipped 001–999 network as a baseline layer, provenance on every source and programme,
    // channel-range and Source Desk runs, deep (resumable) enumeration, and the Source Desk's own state.
    version: 2,
    sql: `
      -- 'master': from the Complete Export (exported as it was). 'shipped': a 001–999 channel TVN ships, read as baseline.
      ALTER TABLE channels ADD COLUMN layer TEXT NOT NULL DEFAULT 'master';
      -- Identity independent of number: the export's channel id, or the shipped catalogue's channel id.
      ALTER TABLE channels ADD COLUMN stable_id TEXT;
      UPDATE channels SET stable_id = json_extract(body, '$.id') WHERE scope = 'user';

      -- master (the export), shipped (TVN's catalogue), desk (added at the Source Desk).
      ALTER TABLE sources ADD COLUMN provenance TEXT NOT NULL DEFAULT 'master';
      ALTER TABLE sources ADD COLUMN added_run INTEGER;
      ALTER TABLE sources ADD COLUMN added_at TEXT;
      -- Where a deep enumeration stopped (TVN's own batch cursor), and whether the provider's list has been read to its end.
      ALTER TABLE sources ADD COLUMN continuation TEXT;
      ALTER TABLE sources ADD COLUMN complete INTEGER NOT NULL DEFAULT 0;

      -- master, shipped, auto (Harvester AUTO) or desk (a Source Desk scan).
      ALTER TABLE programmes ADD COLUMN provenance TEXT NOT NULL DEFAULT 'master';
      UPDATE programmes SET provenance = 'auto' WHERE origin = 'harvest';

      -- auto (AUTO runs, resumable), channel (AUTO REFRESH CHANNEL) or desk (SCAN SOURCES); a channel range for AUTO.
      ALTER TABLE runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'auto';
      ALTER TABLE runs ADD COLUMN range_from INTEGER;
      ALTER TABLE runs ADD COLUMN range_to INTEGER;

      CREATE TABLE changes_v2 (
        id INTEGER PRIMARY KEY,
        run_id INTEGER NOT NULL,
        channel_id INTEGER NOT NULL,
        source_id INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('added', 'date', 'metadata', 'unavailable', 'status', 'source')),
        video_id TEXT,
        detail TEXT,
        at TEXT NOT NULL,
        provenance TEXT NOT NULL DEFAULT 'auto'
      );
      INSERT INTO changes_v2 (id, run_id, channel_id, source_id, kind, video_id, detail, at) SELECT id, run_id, channel_id, source_id, kind, video_id, detail, at FROM changes;
      DROP TABLE changes;
      ALTER TABLE changes_v2 RENAME TO changes;
      CREATE INDEX changes_run ON changes (run_id);

      ALTER TABLE desk ADD COLUMN reviewed_at TEXT;
      ALTER TABLE desk ADD COLUMN skipped_at TEXT;
      ALTER TABLE desk ADD COLUMN enriched_at TEXT;
      ALTER TABLE desk ADD COLUMN sources_added INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE desk ADD COLUMN programmes_added INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE desk ADD COLUMN seconds_added INTEGER NOT NULL DEFAULT 0;

      -- Addresses pasted at the Source Desk and not yet scanned (or scanned, with their result).
      CREATE TABLE desk_pending (
        id INTEGER PRIMARY KEY,
        channel_id INTEGER NOT NULL REFERENCES channels (id),
        url TEXT NOT NULL,
        kind TEXT,
        type_label TEXT NOT NULL,
        status TEXT NOT NULL,
        note TEXT,
        result TEXT,
        source_id INTEGER,
        added_at TEXT NOT NULL
      );

      -- The shipped catalogue read as the 001–999 baseline, and the build it must match.
      CREATE TABLE baseline (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        app_commit TEXT NOT NULL,
        app_build TEXT,
        checked_head TEXT,
        catalogue_sha256 TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        channels INTEGER NOT NULL,
        sources INTEGER NOT NULL,
        programmes INTEGER NOT NULL
      );
    `,
  },
]

export type Db = DatabaseSync

export function schemaVersionOf(db: Db): number {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get()
  if (!table) return 0
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined
  return row ? Number(row.value) : 0
}

/** Open (or create) a working database and bring its schema up to date. A newer schema than this Harvester knows is refused. */
export function openDb(path: string, migrations: readonly { version: number; sql: string }[] = MIGRATIONS): Db {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  const target = migrations.at(-1)?.version ?? 0
  const current = schemaVersionOf(db)
  if (current > target) {
    db.close()
    throw new Error(`This workspace was made by a newer Harvester (schema ${current}; this one knows ${target})`)
  }
  for (const step of migrations.filter((migration) => migration.version > current)) {
    transaction(db, () => {
      db.exec(step.sql)
      db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(String(step.version))
    })
  }
  return db
}

export function transaction<T>(db: Db, work: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function getMeta(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row ? row.value : null
}

export function setMeta(db: Db, key: string, value: string): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value)
}
