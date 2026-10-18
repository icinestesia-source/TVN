# TVN 2.0 — Phase B.3 Completion Report

**Date:** 2026-10-18  
**Branch:** `main` (local; **not pushed**, **not deployed**)

---

## 1. Starting and final commits

| | Commit | Subject |
|---|--------|---------|
| **Start** | `82e5c9e` | Record Phase B.2 commit SHAs in the completion report. |
| **End** | `c0b458c` — Phase B.3 complete. | Personalised INFO, football navigation, prefs export |

Logo asset churn remains unstaged.

---

## 2. Files added and modified

**Added:** `src/info/preferences.ts`, `src/info/football/teams.ts`, `src/info/news/personalize.ts`, `src/info/news/custom-feeds.ts`, `src/info/weather/units.ts`, `src/info/weather/met-norway.ts`, `src/tvn-info-b3.test.ts`, `.github/workflows/info-football-verify.yml`, this report.

**Modified:** football competitions/types/adapter/fixtures/FootballPanel; NewsPanel; WeatherPanel; `tvn-export.ts`; `use-channel-library.ts`; football tests.

---

## 3. Football navigation implemented

| Status | Detail |
|--------|--------|
| Implemented | Sections: **My Football \| Today \| Results \| Fixtures \| Tables \| Leagues** |
| Implemented | Region → competition → table/results/fixtures without leaving INFO |
| Implemented | Competition remembered locally; easy switching via filter tabs |
| Implemented | Knockout competitions (CL, WC, EC) show no invented league table |

---

## 4. Competitions available

Configured (all appear in Leagues UI):

`PL`, `ELC`, **`EL1` (League One)**, `CL`, `BL1`, `SA`, `PD`, `FL1`, `DED`, `PPL`, `BSA`, `WC`, `EC`

| Code | Free-plan expected (docs) | Notes |
|------|---------------------------|-------|
| EL1 | No | Shown as option; live data needs token entitlement |
| BSA, WC, EC | Yes (typical free 12) | Configured; verify via Actions workflow |
| Others (PL…PPL) | Yes | Preserved from B.2 |

**Free-tier limit:** football-data.org free allows **12 competitions**. TVN now configures **13** codes so every product option is visible; ingest records per-competition errors when entitlement is missing. Recommended allocation once verified: keep UK ladder **PL + ELC + EL1** if entitled, plus big-five / CL / DED / PPL, and drop WC/EC off-season if the token hard-caps at 12.

---

## 5. Favourite-team functionality

Implemented (local): search clubs from snapshot (provider **team ids**), add/remove, primary favourite, reorder, next fixture, latest result, open league. No accounts.

---

## 6. Favourite-league functionality

Implemented: favourite/unfavourite, reorder, hide (still in All leagues), restore hidden, set default competition, reset football prefs.

---

## 7. News source configuration

**News → Sources:** enable/disable publishers, reorder, category show/hide/reorder, restore defaults. Stories view respects preferences and Top Stories diversity selection.

---

## 8. Custom RSS support and limitations

| | |
|--|--|
| Implemented | URL validation (public http(s), no credentials/private hosts), RSS/Atom detection, preview, save/enable/remove |
| Limitation | Browser **CORS** blocks many publishers; TVN does **not** expose an open SSRF-prone proxy |
| Attribution | Custom headlines labelled **your source** — not presented as central catalogue |

---

## 9. Weather location preferences

Multiple saved locations, reorder, default, remove, reset. Device geolocation never requested automatically.

---

## 10. Weather provider support

| Provider | Status |
|----------|--------|
| Open-Meteo | Default — working from the browser |
| MET Norway | Selectable adapter implemented; often fails in-browser (User-Agent + CORS). Limitation shown in UI |

Units: °C/°F and km/h/mph. Alerts not added (optional; not delayed for core work).

---

## 11. INFO preferences persistence

Unified `tvn.info.preferences.v1` with migration from B.2 football/weather keys. Versioned; malformed sections fall back safely.

---

## 12. Import/export compatibility

`PortableSettings.info` added optionally to `tvn-export-v1`. Older exports without `info` leave INFO prefs unchanged. Range/picked exports still omit settings. Channel manifests untouched.

---

## 13. Tests passed

Executed locally:

```
src/tvn-info-b3.test.ts
src/tvn-info-football.test.ts
src/tvn-info-news.test.ts
src/tvn-info-weather.test.ts
src/tvn-2-0-info-centre.test.ts
src/tvn-2-0.test.ts
```

**Result: 46 passed.**

Live football-data.org verification: **not claimed** (token only in GitHub Actions). Use workflow **INFO football verify** (`workflow_dispatch`) after push.

---

## 14. Known limitations

- EL1 / excess free-tier codes may be absent from published snapshots until entitlement is confirmed.
- Custom RSS depends on CORS-friendly feeds.
- MET Norway unreliable in the browser without a fixed-host proxy.
- Qualification/relegation markers not shown (provider form string stored when present; no invented markers).
- Weather alerts not implemented.

---

## 15. Remaining API requirements

1. Confirm `INFO_PUBLISH_URL` + `INFO_PUBLISH_SECRET` for Blobs publish.
2. After approve-push: run **INFO football verify** and **INFO ingest** (`workflow_dispatch`).
3. Decide free-tier competition allocation if the token hard-limits to 12.
4. Optional: fixed-host MET Norway proxy if that provider is required in production.

---

## 16. Production deployment readiness

| Area | Implemented | Tested | Deployed | Production-verified |
|------|-------------|--------|----------|---------------------|
| Football nav + favourites | Yes | Yes (fixtures) | No | No |
| EL1 in UI | Yes | Yes | No | Live data pending Actions |
| News sources + custom RSS | Yes | Yes | No | No |
| Weather prefs/units/providers | Yes | Yes | No | No |
| INFO prefs + export | Yes | Yes | No | No |

**Delivery:** working software locally. **Do not push or deploy** until the product owner approves.
