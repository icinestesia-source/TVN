# TVN 2.0 — Sports Matches, Date Navigation and Typography

**Date:** 2026-10-18  
**Scope:** Unified MATCHES section, day/calendar navigation, responsive competition headings, historical snapshot retention  
**Push / deploy:** Not performed (local commit only)

---

## 1. Files changed

| File | Change |
|------|--------|
| `src/components/info/FootballPanel.tsx` | Replaced Today / Results / Fixtures with **Matches**; date nav; competition tab short names; match row polish |
| `src/components/info/DayCalendar.tsx` | **Added** — lightweight accessible month popover (no dependency) |
| `src/info/football/normalize.ts` | Local-calendar `todayIso` / `kickoffLocalDayIso` / `snapshotLocalDayRange` |
| `src/info/football/match-lists.ts` | `chronologicalMatches`, `daysWithMatches` |
| `src/info/football/empty-state.ts` | Distinct availability messages for Matches + date range |
| `src/info/football/snapshot-safety.ts` | Match-id merge, outside-window history retention, entitlement skip helpers |
| `src/info/football/football-data-org.ts` | Skip competitions with prior entitlement errors (unless forced) |
| `scripts/info/ingest-football.ts` | Pass fetch window into merge; skip entitlement codes on scheduled runs |
| `src/styles/guide.css` | Competition tabs, day nav, calendar, match typography |
| `src/tvn-info-football.test.ts` | Coverage for Matches UI, local days, history merge, empty kinds |
| `docs/TVN_2_0_SPORTS_MATCHES_CALENDAR_REPORT.md` | This report |

**Not changed:** television player, channel scheduler, INFO Centre shell (other modules).

---

## 2. Navigation changes

Previous football sections:

`My Football · Today · Results · Fixtures · Tables · Leagues`

Current:

`My Football · Matches · Tables · Leagues`

- **Matches** shows every status for the selected local calendar day (scheduled, in-play/delayed, finished, postponed, cancelled).
- Competition filter (**All** + leagues) is unchanged and remains active across day changes.
- Default view **Today** opens Matches on the current local day.
- Knockout competitions from Leagues open **Matches** (not the removed Fixtures tab).

Day controls:

`Previous day | selected date | Next day | Today | Calendar`

---

## 3. Calendar implementation

- Custom popover in `DayCalendar.tsx` (CSS + React only).
- Month label with previous/next month controls.
- Grid of days; selected and today highlighted; days with published match data get a subtle mark.
- Any date is selectable (navigation is not limited to cached days).
- Closes on selection, outside click, or Escape.
- Keyboard-focusable buttons; dialog role for the popover.

No date-picker library was added.

---

## 4. Typography improvements

- Competition filter tabs use `clamp()` font size, tighter letter-spacing, ellipsis, and `max-width`.
- Narrow viewports show competition **codes** (`tab-short`) instead of wrapping long names such as PREMIER LEAGUE / CHAMPIONS LEAGUE.
- Table competition headings use `.info-competition-heading` with responsive sizing and ellipsis.
- Match rows: team names ellipsis; status line wraps competition · status · time/score without oversized type.

---

## 5. Historical data strategy

Rolling ingest window remains **today − 7 … today + 21** (provider-side fetch).

On each successful ingest, `mergeFootballSnapshots` now:

1. Keeps prior rows for competitions whose requests failed (unchanged safety).
2. Deduplicates by stable provider match **id** (incoming wins for status/score updates).
3. Retains prior matches whose local kickoff day falls **outside** the fetch window.
4. Prunes retained history older than **120 days** to bound snapshot growth.
5. Still refuses empty blob overwrites via `shouldWriteFootballBlob`.

There is **no** browser-side football-data.org access and **no** on-demand historical API from the client. Broader history accumulates only through scheduled/forced ingest merges of successive rolling windows.

---

## 6. API usage implications

- Scheduled ingest still uses the free-tier paced competition loop.
- Competitions that previously returned entitlement/403 match errors (e.g. League One / EL1) are **skipped** on subsequent scheduled runs so they are not re-requested every slot; errors are carried forward for UI labelling.
- **Forced** ingest (`FOOTBALL_INGEST_FORCE=1` / workflow_dispatch) retries all competitions, including previously skipped ones.
- Token remains server/CI-only (`FOOTBALL_DATA_TOKEN`); never exposed to the browser.
- No new paid API calls or polling loops in the UI.

---

## 7. Tests passed

| Check | Result |
|-------|--------|
| `npx tsc -p tsconfig.app.json --noEmit` | Pass |
| `npx vitest run src/tvn-info-football.test.ts src/tvn-info-phase-e.test.ts src/tvn-info-b3.test.ts` | Pass (25) |
| `npm run build` | Pass |

Covered behaviours include local day arithmetic, Matches section presence, calendar dialog markup, historical merge/dedupe, date empty kinds, and EL1 entitlement skip signalling.

---

## 8. Remaining provider limitations

- League One (EL1) remains unavailable when the football-data.org token lacks that competition; UI labels **COMPETITION NOT INCLUDED IN CURRENT API PLAN** and does not invent fixtures.
- Free tier is delayed — UI continues to show **Delayed** rather than **Live** unless `liveReliable` is true.
- Dates before the retained snapshot range show **HISTORICAL DATA NOT AVAILABLE**; dates after the published fixture window show **DATA NOT YET PUBLISHED** for that day.
- Empty days inside the range show **NO MATCHES ON THIS DATE**.
- Client cannot fetch arbitrary historical ranges on demand without a server-side ingest/publish cycle.

---

## 9. Deployment requirements

1. Commit is local only — push/deploy only with explicit approval.
2. After deploy, ensure scheduled INFO football ingest + publish continues so the rolling window and retained history stay fresh.
3. To retry League One after entitlement changes: run a **forced** football ingest, then publish Blobs.
4. No new environment variables; existing `FOOTBALL_DATA_TOKEN` and publish secrets remain required for live data.
5. `public/info/football.json` seed may still be empty until the next successful ingest/publish — Matches will correctly report **DATA NOT YET PUBLISHED**.
