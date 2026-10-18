# TVN 2.0 — INFO Implementation Plan

**Status:** plan only — no implementation  
**Depends on:** `TVN_2.0_ARCHITECTURE_AUDIT.md`

---

## 1. Goal

Add a **top-level INFO** navigation tab in the Guide header:

**Network → INFO → Guide → Options → Now → Add → Media**

INFO is a first-class Guide panel (like Options / Network Editor), not a subtab of the EPG. It must feel native: same typography, tokens, tabs, keyboard patterns, and overlay behaviour. Playback must continue underneath.

---

## 2. Non-goals (Phase B)

- Redesigning the Guide chrome  
- Replacing bookmarks, favourites, or Maps  
- Shipping Chat, Weather, Events, or Teletext mode in the first release  
- Showing disabled placeholder module buttons in production  

---

## 3. Integration design (confirmed pattern to copy)

### 3.1 Code identity

| Layer | Proposal |
|-------|----------|
| Visible label | `INFO` |
| `GuideTool` value | `'infocentre'` (avoid `'info'` — already OverlayMode / TvCommand) |
| Command | `{ type: 'guide-tool', tool: 'infocentre' }` |
| Body component | `src/components/InfoCentre.tsx` (new) |
| Styles | extend `src/styles/guide.css` with `.info-centre*` using existing tokens |

### 3.2 Files to touch (Phase B shell)

| File | Change |
|------|--------|
| `src/types/input.ts` | Add `'infocentre'` to `GuideTool` |
| `src/components/GuideAdd.tsx` | Insert INFO button between Network and Guide |
| `src/components/Guide.tsx` | Mount `<InfoCentre />` when `tool === 'infocentre'`; treat like options/editor for `tool` resolution |
| `src/state/TvProvider.tsx` | Include `'infocentre'` in `panelOpenRef` / `openGuideTool` panel set |
| `src/view/guide-tool.ts` | Cursor target rules if needed |
| `src/components/Hints.tsx` | Document shortcut only after one is chosen |
| `src/input/keyboard.ts` | Optional shortcut — **owner decision** (do not steal `V` or `I` without approval) |
| Tests | `src/tvn-2-0-info-centre.test.ts` (new): order of actions, tool open/close, no player key change |

### 3.3 Mount condition (playback preservation)

Reuse Options path:

```
tool === 'infocentre' ? <InfoCentre /> : …
```

Do **not** change `TvScreen` player tree. Do **not** call `requestTune`, pause, or remount `PlayerStage` when opening INFO.

**Acceptance:** open INFO while a YouTube clip and a radio stream play; audio continues; channel number unchanged; closing INFO returns to prior Guide body.

---

## 4. INFO module architecture

```
InfoCentre
├── module tabs (only modules that are ready)
│   ├── News
│   ├── Sports → Football
│   ├── Messages          (Phase C+)
│   ├── Radio             (Phase C+)
│   ├── Games             (Phase C+)
│   ├── Discoveries       (Phase C+/D — may alias Bookmarks)
│   ├── Weather / Events  (Phase D)
│   └── Chat              (Phase F — hidden until ready)
└── content panel (lazy data load, isolated error boundary)
```

### 4.1 Failure isolation

- Each module fetches its own dataset  
- One module’s error shows an inline status (“News unavailable · last updated …”)  
- Never throw out of `InfoCentre` into Guide/TvProvider  
- Television schedule and player are unaware of INFO data failures  

### 4.2 Hide until ready

Phase B production tabs: **News**, **Sports** only.  
Do not render Chat / Weather / Events / Games buttons until they meet acceptance criteria.

---

## 5. Module plans (summary)

### 5.1 News (Phase B)

See `TVN_2.0_SPORTS_AND_NEWS_DATA_PLAN.md`.  
UI: category chips (UK, World, Technology, …), list of headlines, publisher, time, link out.  
Stale banner when cache age exceeds threshold.

### 5.2 Sports / Football (Phase B)

Same data plan.  
Nav: **SPORTS → FOOTBALL** then **TODAY | FIXTURES | RESULTS | TABLES | COMPETITIONS**.  
Match status chips: Scheduled / Live / Finished / Postponed.  
Always show **last updated**.

### 5.3 Messages (Phase C)

Local + shipped JSON notices. Types: release, maintenance, reminder, editorial.  
No mandatory account. Soft badge on INFO tab optional; never auto-pause playback.

### 5.4 Radio directory (Phase C)

Read `listChannels()` filtered by radio/`mediaKind === 'audio'`.  
Tune via existing `requestTune(number)`. Do not duplicate catalogue storage.

### 5.5 Games directory (Phase C)

See `TVN_2.0_INTERACTIVE_GAMES_PLAN.md`. Directory of approved embeds / channels after numbering approval.

### 5.6 Discoveries (Phase C/D)

Extend **Bookmarks** (`src/view/bookmarks-store.ts`) rather than invent a parallel store.  
Add optional tags / “from INFO” presentation; keep explicit save only.

### 5.7 Teletext-inspired mode (Phase D)

Optional presentation of the **same** INFO datasets with page numbers (100 News, 200 Sports, …).  
Not channel numbers. Not a replacement for Guide.  
Note: curated channel **894 Teletext** is a video identity — do not overload it without owner approval.

### 5.8 Chat (Phase F)

Invitation-only assessment only after hosting + moderation plan. Hidden until then.

---

## 6. Visual language

- Reuse `.tab`, `.options-card`, `.options-head`, `--gold`, `--muted`, `--ink`, `--guide-bg`  
- One composition per module: title, short note, content list — **not** a dashboard of cards/stats  
- No new design system, no purple gradient aesthetics, no emoji icon rows  

---

## 7. Complexity and risks

| Item | Complexity | Risk |
|------|------------|------|
| Header insertion + GuideTool | Low | Shortcut / naming collision with picture Info |
| Module shell + error boundaries | Low–medium | Accidental player remount if routed wrong |
| News/Sports UI | Medium | Depends on data plane |
| Teletext mode | Medium | Second navigation layer confusion |
| Chat | High | Moderation, cost, privacy |

---

## 8. Acceptance criteria — INFO shell (Phase B gate)

1. INFO appears between Network and Guide in GuideActions.  
2. Opening INFO does not change channel, seek, mute, or remount player.  
3. Esc closes INFO panel (same as Options) without leaving television.  
4. No non-functional module buttons shipped.  
5. Existing Network / Guide / Options / Add / Media behaviour unchanged.  
6. Automated test covers action order and tool id ≠ `'info'`.

---

## 9. Tests required

| Test | Purpose |
|------|---------|
| Markup / source test for GuideActions order | Network, INFO, Guide… |
| Provider panelOpen includes infocentre | Esc / toggle |
| Regression: `OverlayMode 'info'` still driven by `V` | No collision |
| Playback smoke (manual / probe) | Audio continues under INFO |

---

## 10. Estimated effort (planning only)

| Slice | Rough effort |
|-------|----------------|
| Shell + empty News/Sports frames | 1–2 focused days |
| Wired News + Football (with data plane) | 1–2 weeks depending on hosting choice |
| Teletext mode | 3–5 days after data exists |  
