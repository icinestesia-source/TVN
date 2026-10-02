# TVN editorial manifest and channel curation schema

TVN 1.0.11. JSON is authoritative everywhere; the Markdown channel manifest is a readable copy.

The flow never changes: **SOURCE → FILTER → ELIGIBLE PROGRAMMES → RUNNING ORDER / SCHEDULER**. A source keeps everything its last scan found. Its filter decides which of those programmes are eligible, and its mode decides how far back TVN reaches. The running order arranges the eligible programmes. Editorial notes describe intent and are never read by the scheduler.

## 1. `tvn-editorial-manifest-v1`: one channel, two separate halves

Code: `src/services/editorial-manifest.ts`.

```json
{
  "format": "tvn-editorial-manifest-v1",
  "scope": "central | user",
  "channel": { "number": 1001, "name": "…" },
  "current": {
    "programmeCount": 0,
    "totalSeconds": 0,
    "hours": 0,
    "sourceCount": 0,
    "sources": [{ "id": "s1", "label": "…", "sourceType": "youtube-channel", "enabled": true, "programmes": 0, "seconds": 0, "held": 0, "mode": "recent" }],
    "sourceConcentration": { "largestSource": "s1", "programmeShare": 1, "hoursShare": 1 },
    "programmeTypes": { "episode": 0 },
    "earliestKnownYear": null,
    "latestKnownYear": null,
    "live": false
  },
  "editorial": {
    "purpose": null,
    "include": null,
    "exclude": null,
    "sourceNotes": null,
    "desiredCoverage": null,
    "gaps": null,
    "eras": null,
    "curatorNotes": null,
    "tags": [],
    "targets": { "hours": null, "programmes": null },
    "status": "unreviewed",
    "related": [],
    "artwork": null
  },
  "filters": [{ "source": "s1", "label": "…", "mode": "recent", "filter": null }]
}
```

- **CURRENT FACTS** (`current`) are always calculated from what the channel holds now. `programmes` per source counts eligible programmes, after the filter, once per channel. `held` is everything the source's last scan holds. `sourceConcentration` gives the largest source's share of programmes and of hours.
- **EDITORIAL INTENT** (`editorial`) is only what a person wrote. TVN never generates it, and a field nobody has written is `null`.
- **Configuration** (`filters`) is a third thing. It is neither fact nor intent.
- **Scope.**
  - `central` describes a curated 001–999 channel. The network's own tooling writes the baseline (`scripts/network-editorial.gen.ts`, where every central purpose is `null`); Edit Channel writes one for a channel the viewer has curated, from their local override (section 9).
  - `user` describes a viewer's 1001+ channel and is written from Edit Channel.
  - Edit Channel never changes the shipped catalogue. `applyChannelEdit` refuses every number below 1001; a 001–999 channel's curation lives only in its local override.

## 2. Source filter (`ChannelSource.filter`)

Code: `src/services/channel-curation.ts`. This is a small structured object, not a language.

```json
{
  "include": {
    "terms": ["…"],
    "playlists": ["PL…"],
    "minSeconds": 120,
    "maxSeconds": 3600,
    "yearFrom": 1990,
    "yearTo": 2013,
    "unknownYear": "keep | drop"
  },
  "exclude": { "terms": ["reaction", "teaser"], "shorts": true }
}
```

- **Exclude always wins.**
  - `exclude.terms`: the title contains any of the terms.
  - `exclude.shorts`: the programme is a minute or less, or tagged `#shorts` in its title.
- **Selectors.** When `include.terms` or `include.playlists` is set, a programme must match a term (title contains, ignoring case and accents) or have been found in one of the playlists.
- **Bounds.** `minSeconds` and `maxSeconds` are inclusive. The era bounds apply where the year is known: first a stated year, then a year in the title, then the upload date. A programme whose year is unknown is kept unless `unknownYear` is `drop`.
- **Limits.** At most 20 terms of 80 characters each, and 10 playlists. Malformed values are dropped on save. A file carrying a malformed filter is refused, never guessed at.
- **Changing a filter.** Changing or clearing a filter needs no rescan and loses nothing.

## 3. Source mode (`ChannelSource.mode`)

| Mode | Lookup | Rescan | Arrangement |
|---|---|---|---|
| `recent` (default; not written) | first 60 embeddable uploads | replaces | newest weighted: newest quarter twice per cycle, earlier uploads topped up only while thin |
| `archive` | every embeddable upload the page lists (`&mode=archive`) plus TVN's shipped back catalogue | replaces | spread evenly across the span; each programme once per cycle |
| `all` | as `archive` (`&mode=all`) | adds to what was found before (at most 500 per source) | as `archive` |

- No extra scraping. The keyless lookup reads one public uploads or playlist page, as before. Only the cut at 60 is lifted, and no continuation pages are followed.
- Older history comes from the playlists the filter names and from the shipped back catalogue (`public/user-network/uploaders.json`).
- A curated timeless channel is never held to a recent window.

## 4. Editorial notes (`editorial` on user channels and 001–999 overrides)

```json
{
  "purpose": "…",
  "include": "…",
  "exclude": "…",
  "sourceNotes": "…",
  "desired": "…",
  "gaps": "…",
  "eras": "…",
  "notes": "…",
  "tags": ["…"],
  "targetHours": 8,
  "targetProgrammes": 60,
  "status": "reviewing",
  "related": [112, 1004],
  "artwork": "https://…"
}
```

- Every field is optional. Text fields hold at most 2,000 characters. There are at most 20 tags of 40 characters each.
- `notes` is the curator's freeform research. `status` is `unreviewed` (absent), `reviewing`, `curated` or `revisit`; it is shown only in Edit Channel and in manifests. `related` lists at most 50 TVN channel numbers, with no hierarchy and no merging. `artwork` is an optional https address that nothing displays yet (see section 10).
- The notes are metadata only. They are kept, exported and shown in the manifest, and never consulted by the scheduler.

## 5. `tvn-channel-v1`: one portable user channel

Code: `src/services/channel-file.ts`. It is written by Edit Channel's **EXPORT CHANNEL** and read by **+ → Import channel list**.

```json
{
  "format": "tvn-channel-v1",
  "version": 1,
  "exportedAt": "…",
  "channel": { "number": 1004, "name": "…", "state": "populated", "enabled": true, "edited": true, "runningOrder": ["…"], "editorial": {}, "sources": [{ "sourceType": "youtube-channel", "url": "…", "providerId": "UC…", "label": "…", "enabled": true, "filter": {}, "mode": "archive" }] },
  "facts": { "programmeCount": 0 }
}
```

- **Shape.** `channel` has the same shape as one channel of `tvn-user-network-v1`, without `owner`. `facts` is a read-only snapshot.
- **What it never contains.** No keys, credentials, secret-looking query parameters, watched marks, viewing history, other users or other channels. A file carrying any secret is refused whole.
- **Import.**
  - The channel takes the lowest empty user slot, or else the lowest free user number, for the user whose list it was imported into.
  - Nothing is overwritten. If the same channel is already present, the copy is kept beside it under its own id.
  - YouTube sources are read again through the keyless lookup, at their own mode.

## 6. `tvn-user-network-v1` additions

- **New optional fields.** Each source can carry `filter` and `mode`, and each channel can carry `editorial`. Collection programmes may also carry `published`, `year` and `lists`.
- **Older files.** Files without these fields are unchanged and restore exactly as before. The format name and version stay the same.

## 7. Human-readable manifest

**EXPORT MANIFEST** writes `TVN_Channel_<number>_<name>.md` with these sections: CHANNEL, PURPOSE, CURRENT SOURCES, FILTERS, PROGRAMMES, HOURS, PROGRAMME TYPES, EDITORIAL NOTES, KNOWN GAPS, TARGETS, RELATED CHANNELS, CURATOR NOTES, and RUNNING ORDER when the viewer set one. A status line follows the title. There is no PDF.

## 8. Network baseline

`reports/network-editorial/` contains the following:
- `TVN_FULL_CHANNEL_MANIFEST.{csv,json,md}`: the factual 001–999 baseline, calculated by TVN; Harvester records add only its viability rule and its generation effects.
- `TVN_NETWORK_EDITORIAL_BASELINE.md`: a descriptive summary.
- `gen3/`: byte-for-byte copies of the Generation 3 reports, with their decisions unchanged.

Regenerate with:

```
npx vitest run --config scripts/manifest.config.ts scripts/network-editorial.gen.ts
```

## 9. Local curation of 001–999 (`tvn.channel-edits.v1`, `tvn-central-overrides-v1`)

Code: `src/services/curated-edits.ts` and `src/services/central-curation.ts`.

- **Model.** SHIPPED CHANNEL + LOCAL OVERRIDE = THE VIEWER'S CHANNEL. An override holds only what the viewer changed: name, description, sources (TVN's own programming as a `tvn` source that can be switched off, plus added sources with filter and mode), a running order, TVN programmes left out (`excluded`), and editorial notes. An unchanged channel has no record, and Restore TVN original drops it.
- **Baseline.** Each override records the shipped channel it was made against: `{ name, programmes, fingerprint }`, where the fingerprint is FNV-1a over the shipped programme ids. Edit Channel says when TVN has changed the channel since.
- **Playback.** While TVN programming carries the channel, it keeps TVN's own scheduling unless the viewer reorders or leaves out programmes. In that case it plays the remaining programmes in the viewer's order. Once added sources carry programmes, they take over, as before.
- **Complete export.** `tvn-export-v1` gains an optional `central` section, `{ "format": "tvn-central-overrides-v1", "overrides": [...] }`. It contains overrides only, never the catalogue. Files without it are still valid, and restoring one leaves this browser's overrides alone.
- **Restore.** The whole file is validated first. Overrides then replace the override layer only. Each one is checked against the channel TVN ships now. A channel no longer shipped is skipped, a shipped rename is kept as a note, and programmes that have gone are dropped from the order. Each of these is reported and shown in Edit Channel; nothing is merged.

## 10. Information Overlay V3 (design note, not implemented)

- **Channel artwork.** Show a channel PNG or logo in the overlay, taken from `editorial.artwork` when set and otherwise from the shipped logo.
- **Remote.** Fold the remote's controls into the overlay itself, rather than a separate pad.
- **Skins.** Make the presentation skin-aware: each skin sets its own frame, type and artwork treatment.
- Nothing in TVN 2.0 renders any of this. The `artwork` field exists only so curation can carry it now.

## 11. Viewing Guides (`tvn.guides.v1`, `tvn-guides-v1`)

A Guide is the viewer's own viewing sequence: programmes from any channels, played in order, each from its
beginning, advancing when one ends. It is not a channel and never becomes one automatically.

- **Stored:** `{ current, saved[] }` in `tvn.guides.v1`. Each Guide has a stable `id`, `name`, ordered `items`,
  optional `loop`, `createdAt` and `modifiedAt`. An item keeps `channelNumber`, `channelName` and a programme
  snapshot (`id`, `title`, `videoId`, `durationSeconds`, `source`, plus descriptive fields such as `sourceRef`,
  `creator`, `series` where known). References only: no media, no schedule changes.
- **Played:** through the Guide's manual-pick machinery. Schedules and running orders are untouched. A different
  channel uses the viewer's transition; the same channel uses the plain black cut.
- **Indicator:** GUIDE (header and Information Overlay) is green only while a Guide is choosing what plays.
  A manual pick stays yellow. An open Guide screen changes nothing.
- **Suspended, not lost:** a manual tune, NOW, a Guide pick or MULTI suspends the Guide; RESUME GUIDE replays
  the item it was on. Missing or refused items are shown as unavailable and skipped for that run only, never
  removed or substituted.
- **Complete Export:** `tvn-export-v1` carries `guides` (`tvn-guides-v1`: current and saved Guides). Playback
  position is never exported. Exports without `guides` stay valid and restore none.

Recorded for later, not implemented: create a permanent channel from a Guide, share or export one Guide, Guide
artwork, gap-filling recommendations, themed templates, scheduled starts, collaborative Guides. Information
Overlay V3 (section 10) keeps a GUIDE key with the same states: yellow normally, green while following.
