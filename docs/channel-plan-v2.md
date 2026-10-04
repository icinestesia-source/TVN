# TVN channel plan v2 (proposal, not applied)

Source: `docs/channel-manifest.json` (generated 2026-09-30). Machine-readable version: `docs/channel-plan-v2.json`.
The app does not read either file. Nothing in this plan has been renumbered, rebuilt or published:
central (001–999) programming only changes when the build pipeline runs, and this pass does not run it.

## 001–100 audit, in brief

- **Strong, deep channels:**

  | Channel | Programmes | Hours |
  | --- | --- | --- |
  | 020 Documentary | 324 | 154 |
  | 023 Nature | 300 | 286 |
  | 024 Culture | 392 | 151 |
  | 057 Travel | 593 | 263 |
  | 060 History Mix | 297 | 144 |
  | 065 Earth | 300 | 533 |
  | 066 Wildlife | 600 | 502 |
  | 076 Talk | 500 | 180 |
  | 085 Festival | 228 | 293 |
  | 095 Slow TV | 465 | 721 |
  | 100 Film | 583 | 320 |

- **Generic mixes that duplicate one another:** One–Nine, Prime, Select, Plus, Variety, Encore, Choice, Mix, Late, Night, After Hours and Midnight. Each holds about 200 programmes drawn from the same roughly 23 sources.
- **Empty or thin slots:**
  - 064 Space is EXCLUDED by policy and has 0 programmes.
  - 073 Business Today, 074 Weather, 087 Public Domain and 098 Showcase each have 0.
  - 097 Test Lab is DELIBERATELY_UNAVAILABLE.
  - 035 Adventure has 5, 037 Fantasy 6 and 048 Screen 3.

## Proposed flagship 001–010 (MAIN / SELECT)

| No. | Channel | Built from |
| --- | --- | --- |
| 001 | TVN One | current 001 One (kept in place) |
| 002 | Documentary | 020 Documentary + 914 News Documentary |
| 003 | Film | 100 Film + 103 Classic Film |
| 004 | Wildlife | 066 Wildlife + 023 Nature |
| 005 | Travel | 057 Travel + 775 Walking Travel |
| 006 | History | 060 History Mix + 400 History |
| 007 | Comedy | 030 Comedy + 207 Sitcom |
| 008 | Culture | 024 Culture + 025 Arts |
| 009 | Sport | 052 Sport Mix + 300 Sport |
| 010 | Talk | 076 Talk |

Specialist channels (Slow TV, Earth, Festival, Anime and the rest) stay in 011–100.
002–010 only take these identities through the migration below. Until then every current number keeps its current channel.

## Specialist channels placed in 011–100

| No. | Channel | Replaces | Distinct from |
| --- | --- | --- | --- |
| 097 | TWITTER / X | Test Lab (off air) | — |
| 073 | VERITAS | Business Today (0) | — (audio; public feed only) |
| 048 | AVANT GARDE | Screen (3) | 116 Experimental Film is its feeder |
| 087 | 3D PRINTING | Public Domain (0) | 687 Makers, 816 Electronics |
| 098 | MASK MAKING | Showcase (0) | 757 Craft, 687 Makers |
| 035 | GAME WALKTHROUGHS | Adventure (5) | 240/241/246 are commentary and history |
| 037 | FORTNITE STW | Fantasy (6) | 812 Fortnite (0) is Battle Royale; STW is PvE only |
| 064 | AI 2 | empty Space slot (space stays excluded) | 640 AI (papers) and 641 ML (tutorials) |
| 074 | ARTISTS | Weather (0) | 563 "Artists" is music: rename it "Musicians" |
| 079 | BRISTOL | Late (generic mix) | — |
| 080 | DEVON | Night (generic mix) | — |
| 081 | CORNWALL | After Hours (generic mix) | — |
| 082 | PLYMOUTH | Midnight (generic mix) | — |

The candidate sources for each channel are listed in the JSON. All of them are unverified: each must pass the pipeline's embeddable, UK-available and policy checks before it airs.

- **097 TWITTER / X:**
  - Runs on editorially supplied public post URLs through X's own public embed. There is no API and no paid access.
  - It cannot be activated as a central channel in this pass: central programmes come from the build.
  - It works today as a User Network channel built with ADD.
  - Video plays only inside X's embed after INTERACT, and TVN cannot time or seek it.

## 510 CHILL

- **510 today:** Shoegaze, PLAYABLE, 136 programmes, 13.9 h, anchor Ride.
- **Replacement prepared:** CHILL, a Balearic, Café del Mar-style downtempo channel. Candidate sources are in the JSON; the target is 200+ programmes and 60+ h.
- **Not applied (blocker):**
  - Replacing a playable channel in place would silently turn every favourite, history entry and last-channel pointer for 510 into CHILL.
  - Central programmes also need the build pipeline, which this pass does not run.
- **Safe path:**
  1. Move Shoegaze to the empty 579 (Rare Tracks, 0 programmes), using the migration below for 510 → 579.
  2. Then build CHILL at 510.

## CENTRAL RENUMBER MIGRATION PLAN

Channel numbers are identities. A move must carry every stored reference with it, at once, on first load of the build that introduces it.

**1. A versioned move table**, shipped with the build: `{ version, moves: [{ from, to, channelId }] }`.
   - Moves are by channel id, so a move applies only when the stored number still names that id in the previous catalogue.
   - The existing `migrateProvisionalOverrides` in `src/services/overrides.ts` is the precedent.

**2. Storage that holds channel numbers.** Each entry is migrated once and stamped with the move-table version.

| Storage | Holds | Migration |
| --- | --- | --- |
| localStorage `retrotv.preferences.v1` | `favourites` (number[]), `history` (number[]), `lastChannelNumber` | map each number through the table |
| localStorage `tvn.channel-edits.v1` | curated edits keyed by `channelNumber` | re-key |
| localStorage `retrotv.channel-overrides.v1` | channel overrides by number | re-key (as `migrateProvisionalOverrides` does) |
| localStorage `tvn.guides.v1` | Maps: each item's `channelNumber` | map; keep the item's programme as stored |
| IndexedDB `retrotv-schedules` / `days` | frozen schedules keyed `scheduleKey(channelNumber, date)` | drop the keys of moved numbers (they rebuild) |
| IndexedDB `retrotv-pools` / `pools` | pool cache by channel number | invalidated by the catalogue fingerprint |
| localStorage `retrotv.builtin-catalogues.v1` | built-in catalogue fingerprint | changes with the build, which triggers the above |
| `src/services/default-favourites.ts` | shipped starter favourites | update in the same build |
| In-memory TVN channel choices (`tvn-channel.ts`) | recent `channelNumber`s | session only; no migration |

**3. Not affected:**
- User Network channels (1001+, IndexedDB `retrotv-user`), channel files and User Network exports: they only carry 1001+ numbers.
- `tvn.embed-refused.v1` (keyed by video id), `tvn.surf.v1` and `tvn.transition.v2`.

**4. Build side** (pipeline only):
- `src/data/canonical-network.json`, `src/data/central-sources.json`, the editorial manifest and `docs/channel-manifest.json` change together.
- A retired number either stays empty for one release with an "X has moved to N" card, or redirects once, so no favourite silently shows a different channel.

**5. Test plan:**
- A fixture profile holding favourites, history, a curated edit, an override and a Map on moved numbers.
- After migration, each still opens the same channel id.
- Re-running is a no-op.
- An unknown or already-migrated version is left alone.
