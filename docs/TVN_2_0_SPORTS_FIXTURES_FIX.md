# TVN Sports — Fixtures and Results diagnostic (pre-deploy)

**Date:** 2026-10-18  
**Scope:** Targeted fix before Phase E completion  
**Push / deploy:** Not performed

---

## 1. Root cause or causes

### Primary — empty published / seed snapshot (data not published)

`public/info/football.json` contained **zero matches and zero tables**, with `unavailableReason` stating the football token / ingest had not produced data.

League navigation still appeared because the Sports UI lists competitions from **`FOOTBALL_COMPETITIONS` configuration**, not from `snapshot.competitions`. That made the UI look “working” while Fixtures and Results had nothing to show.

Pipeline stage: **empty snapshot after seed / missing successful ingest+publish**, not a broken football-data.org adapter when mocked.

### Secondary — incorrect empty-state messaging (UI)

When `loadFootballSnapshot` returned `status: 'unavailable'` **with** an empty snapshot, `FootballPanel` still rendered Fixtures/Results and showed:

> “No fixtures in this selection.” / “No results in this selection.”

That hid **DATA NOT YET PUBLISHED** / provider reasons and looked like a filter bug.

### Minor — postponed matches omitted from Fixtures

`POSTPONED` matches were excluded from both Fixtures and Results lists (now shown under Fixtures).

### Not the cause

- No evidence of incorrect date-range construction in ingest (`dateFrom = today−7`, `dateTo = today+21`).
- `TIMED` / `SCHEDULED` already mapped to fixture-side `scheduled`.
- Normalisation of sample payloads was already correct under tests.
- Live API was **not** called in this pass (no token used locally; no production ingest).

---

## 2. Files changed

| File | Change |
|------|--------|
| `src/info/football/empty-state.ts` | **Added** — classify empty lists |
| `src/info/football/match-lists.ts` | **Added** — fixtures / results / competition filters |
| `src/components/info/FootballPanel.tsx` | Banner + correct empty messages; use match-lists |
| `src/info/football/normalize.ts` | Explicit `TIMED`/`SCHEDULED`; clearer empty reason |
| `src/info/football/teams.ts` | `nextFixture` includes postponed |
| `src/info/football/fixtures/sample-responses.ts` | Extra scheduled PL match + ELC sample |
| `scripts/info/ingest-football.ts` | Clearer unpublished message without token |
| `public/info/football.json` | Explicit **DATA NOT YET PUBLISHED** seed (still empty) |
| `src/tvn-info-football.test.ts` | Regression coverage |
| `docs/TVN_2_0_SPORTS_FIXTURES_FIX.md` | This report |

---

## 3. Corrections implemented

1. Empty-state diagnosis: **not-published** / **competition-unavailable** / **no-matches** / **provider-error**.  
2. Sports UI alert when snapshot has no matches/tables; Fixtures/Results use diagnosed messages.  
3. Fixtures include **postponed** matches.  
4. Seed and ingest copy state clearly that data must be ingested and published.  
5. Regression tests for multi-competition fixtures/results, postponed, unsupported (403) competitions, unpublished messaging.

---

## 4. Tests passed

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Pass |
| `npm run build` | Pass |
| `vitest src/tvn-info-football.test.ts` | **9 passed** |

---

## 5. Local test data

**Yes** — with mocked football-data.org responses, fixtures and results normalise and split correctly (scheduled/timed/in-play/postponed vs finished, multi-competition, scores only when finished).

The shipped static seed remains **empty by design** until a real ingest writes matches (so production is not seeded with invented fixtures).

---

## 6. Live API access

**Not verified.** No `FOOTBALL_DATA_TOKEN` was used in this session; production Blobs were not read or written.

---

## 7. Remaining GitHub Actions / Netlify dependency

Live Fixtures and Results on tvn.lol require:

1. `FOOTBALL_DATA_TOKEN` in GitHub Actions  
2. Successful `npm run info:football` (force or schedule window)  
3. `INFO_PUBLISH_SECRET` + `INFO_PUBLISH_URL` publish to Netlify Blobs  
4. Application deploy that includes the Sports UI fix  

Until publish succeeds, the UI correctly shows **DATA NOT YET PUBLISHED** rather than a silent empty selection.

Post-deploy: run **INFO football verify** and one manual **INFO ingest**.

---

*End of Sports fixtures diagnostic.*
