# TVN 2.0 — Architecture Audit

**Status:** audit only — no implementation  
**Repository:** `/Users/admin/Documents/GitHub/TVN`  
**Inspected at:** 2026-10-18  
**Git HEAD:** `6aefa9f` (`v2.3`, 2026-10-16) · `git describe`: `v1.0.0-110-g6aefa9f`

---

## 1. Executive summary

TVN is a mature React 19 + Vite + TypeScript single-page television application. The live experience — channel surfing, Guide, User Network, Multi View, transitions, bookmarks, Local Media, and YouTube/local/stream playback — is the product’s proven core and must be preserved.

There is **no** top-level INFO tab today. “Info” already means the **on-picture information bar** (`OverlayMode: 'info'`, key `V`). A new INFO product surface must reuse Guide-panel patterns without colliding with that name in code.

External information services (news headlines, football tables) and scheduled ingestion are **not** implemented. News channel *identities* exist in the catalogue; `news-sources.ts` is an empty stub. Football exists as **video channels**, not as fixtures/results data.

Hosting is **Netlify** (static `dist` + two serverless functions). There is **no Railway** config and **no production cron**. The Harvester is offline operator tooling.

**Recommended order (see §9):** foundations → INFO shell → NEWS + FOOTBALL behind a provider-neutral cache → interactive expansion → MKV/converter tidy → hosting only if ingestion outgrows Netlify.

---

## 2. Confirmed product identity

| Source | Value | Confidence |
|--------|-------|------------|
| `package.json` name / version | `tvsurf` / `0.1.0` | Confirmed |
| Legal copy | `TVN_VERSION = 'Version 1'`, dated 1 Oct 2026 (`src/legal/legal-text.ts`) | Confirmed |
| Runtime build stamps | `BUILD_INFO` from Vite `__TVN_*__` defines (`src/build-info.ts`) | Confirmed |
| Product owner framing | ~1.98 / 2.0 programme | Assumption (owner statement) |
| Latest commit subject | `v2.3` | Confirmed |

Do not treat `package.json` `0.1.0` as the product version shown to viewers.

---

## 3. Application structure (confirmed)

### 3.1 Top-level layout

```
src/
  App.tsx, main.tsx
  app/TvScreen.tsx          # .watch (PlayerStage) + Guide overlay sibling
  components/               # Guide, NetworkEditor, Startup, overlays, options
  state/                    # TvProvider + provider hooks, tuning, startup
  player/                   # YoutubeStage, LocalStage, EmbedStage, WebStage
  data/                     # catalogue, network, canonical, user-network, off-air
  director/                 # Programme Director / fit / policies
  library/                  # playable catalogue, pools, metadata
  session/                  # Local Media 991–1000
  services/                 # import, export, channel editor, feeds client
  input/                    # keyboard, gamepad
  view/                     # guide tools, bookmarks, transitions helpers
  epg/, scheduler/, network/, originals/, dynamic/, tvn/
server/                     # shared handlers for /api/channel and /api/feed
netlify/functions/          # channel.ts, feed.ts
harvester/                  # offline corpus tooling (not production host)
public/                     # independent catalogue, user-network starter, tools
```

Approximate scale: ~2,200 `src` TS/TSX files counted by find includes tests; ~142 `*.test.ts` files under `src`; `TvProvider.tsx` ~2,166 lines after earlier hook extraction.

### 3.2 Playback mount (critical for INFO)

`TvScreen` always mounts `.watch` → `PlayerStage` as a **sibling** of `Guide`. Guide is `position: fixed; z-index: 40` over the picture. Opening Network / Options **does not** remount the player or stop audio/video.

**Implication for INFO:** mirror Options/Network as another Guide body panel (or the same overlay pattern). Do not introduce a route that unmounts `PlayerStage`.

### 3.3 State management

- React context (`TvContext`) fed by `TvProvider`
- Domain hooks under `src/state/provider/` (`use-tv-commands`, `use-channel-library`, `use-channel-editing`, …)
- Pure decisions extracted to `src/view/` (`multiview`, `guide-mode`, `arrange`, …)
- Persistence: `localStorage` / IndexedDB for user network, favourites, bookmarks, off-air, preferences, starter state
- Commands: discriminated union `TvCommand` in `src/types/input.ts`

---

## 4. Navigation architecture (confirmed)

### 4.1 GuideActions order (header)

Exact labels today (`src/components/GuideAdd.tsx`):

**Network → Guide → Options → Now → Add → Media** (+ Close)

Owner requirement for INFO: **Network → INFO → Guide** … preserving items before Network and after Guide.

| Item | Tool / behaviour |
|------|------------------|
| Network | `guide-tool: 'editor'` → `NetworkEditor` |
| Guide | listings / Maps (`guides`) |
| Options | `guide-tool: 'options'` → `GuideOptions` |
| Now | `guide-now` |
| Add | `guide-tool: 'add'` |
| Media | `guide-tool: 'media'` / `{ type: 'media' }` |

### 4.2 GuideTool union (no INFO yet)

```ts
type GuideTool =
  | 'media' | 'network' | 'add' | 'edit' | 'users'
  | 'options' | 'guides' | 'editor' | 'bookmarks' | 'flags'
```

(`src/types/input.ts`)

### 4.3 Naming collision — INFO vs info

| Existing “info” | Meaning |
|-----------------|--------|
| `OverlayMode 'info'` | Picture information bar |
| `TvCommand { type: 'info' }` | Show that bar (`V`, gamepad X, picture tap) |
| `NowNextOverlay` / `ProgrammeInfo` | Bar / Guide footer content |
| Hints copy | “V Info” |

**Plan requirement:** product tab label **INFO**; code should use a distinct tool id (recommended: `'infocentre'` or `'browse'`) so keyboard `V` / overlay `'info'` stay untouched.

### 4.4 Keyboard (selected)

| Key | Command |
|-----|---------|
| `G` | guide |
| `O` | options |
| `I` | **Add** (not Info) |
| `U` | media |
| `V` | picture info overlay |
| `X` | edit |

No free letter is reserved for a new INFO tab yet. Prefer header click + optional new shortcut that does not steal `V` or `I` without an explicit owner decision.

---

## 5. Channel numbering (confirmed)

| Range | Role |
|-------|------|
| 000 | TVN Channel Zero (surfer) |
| 001–999 | Fully named canonical network (`canonical-network.json`, 1000 entries) |
| 991–1000 | Local Media (overrides shipped radio identities at runtime) |
| 1001–100000 | User Network (`USER_NUMBER_START` / `USER_NUMBER_LIMIT`) |

**800–899:** fully occupied (Specialist / Live World / Community). **No free curated numbers** for an 801–809 games block without relocating existing identities (product-owner approval required).

Notable identities:

| Number | Name | Relevance |
|--------|------|-----------|
| 355 | Skateboarding | YouTube sport catalogue (Braille), **not** an HTML5 game |
| 812 | Fortnite | Curated slot, NEEDS_CONTENT |
| 894 | Teletext | Named specialist **video** channel — not the INFO teletext mode |
| 950–999 | Radio band | Mostly NEEDS_AUDIO_PROVIDER; user streams work via ADD |
| 240–249 | Gaming block | Video-about-games, not playable embeds |

Interactive websites today: **User Network only**, `SourceKind: 'website'` → `WebStage` sandboxed iframe after INTERACT.

---

## 6. Player architecture (confirmed)

| Route | Stage | Use |
|-------|-------|-----|
| youtube | `YoutubeStage` | Catalogue / YT |
| local | `LocalStage` | Files, HLS/audio streams |
| embed | `EmbedStage` | Vimeo postMessage |
| web | `WebStage` | Website / X post iframe |

Volume/mute: TVN controls YouTube/local/Vimeo; **website iframe audio is uncontrolled**.

---

## 7. Central vs user network

- **Central:** shipped playable catalogue (`public/independent/`), director fit maps, curated edits overlay
- **User:** IndexedDB/local stored sources, starter network `public/user-network/starter-network.json` (55 channels 1001–1055), Network Editor, export/import
- **Off air:** viewer disable list `tvn.off-air.v1` (`src/data/off-air.ts`) — skips CH+/R/Multi without deleting the channel

---

## 8. APIs and backend (confirmed)

| Endpoint | Handler | Auth | Role |
|----------|---------|------|------|
| `/api/channel` | `server/youtube-channel.ts` via Netlify fn | Keyless scrape | ADD channel lookup |
| `/api/feed` | `server/podcast-feed.ts` | Keyless | Podcast/RSS/URL resolve |

Dev/preview: Vite middleware mirrors the same handlers.  
**No** production scheduled functions.  
**No** sports/news ingestion API.  
`src/data/news-sources.ts`: builds empty `sources: []` from news-category channels.

Offline: `harvester/`, `scripts/youtube_status.py` (may use `YOUTUBE_API_KEY` for status JSON — not browser-delivered).

---

## 9. Test and quality posture (confirmed)

- Vitest, Node environment (no jsdom); UI via `renderToStaticMarkup`
- Large behavioural suite (`tvn-2-0-*.test.ts`, versioned regression files)
- Lint: oxlint  
- Known expected failure class: non-square startup logos in `src/assets/logos` (dimension assertion)
- Secret rule: no `AIza…` keys in shipped `src`/`public`/`dist`

---

## 10. What already covers 2.0 themes (partial)

| Theme | Existing asset | Gap |
|-------|----------------|-----|
| Saved discoveries | Bookmarks (`tvn.bookmarks.v1`, ♡ panel) | Not branded as Discoveries; no website/game save story |
| Radio | Audio channels + `RadioFace` + stream ADD | No INFO radio directory; curated streams thin |
| Games | Website iframe + gaming *video* channels | No game directory; 801–809 free block impossible |
| Teletext | Channel **894** name only | No page-number INFO mode |
| News | News category channels + empty `news-sources` | No headline ingestion |
| Sports data | Football *video* channels 300s | No fixtures/tables API |
| Messages | Flash notes / options status | No message centre |
| Chat | — | Absent (correct) |

---

## 11. Assumptions vs confirmed

| Statement | Status |
|-----------|--------|
| Playback continues under Guide overlays | Confirmed by mount architecture |
| Opaque Guide hides picture while decode continues | Assumed (architecture yes; not re-probed this audit) |
| Production host is Netlify | Confirmed by `netlify.toml` + functions; assumed live domain points there |
| Owner “skateboarding game” = channel 355 | Confirmed as YouTube skate content; **not** a browser game |

---

## 12. Recommended implementation order

1. **Phase A** — this document set; INFO shell design; data plane design; channel placement proposal; MKV/converter audit; hosting decision criteria  
2. **Phase B** — INFO tab + NEWS + FOOTBALL (fixtures/results/tables) with cache + timestamps  
3. **Phase C** — Games catalogue (placement approval first), radio directory, messages  
4. **Phase D** — Teletext mode, weather/events, discoveries polish  
5. **Phase E** — MKV improvements, converter removal (safe slice), performance/a11y  
6. **Phase F** — Chat only after moderation/identity model approved  

**Do not implement until the product owner approves priorities and channel placements.**

---

## 13. Companion documents

1. `TVN_2.0_INFO_IMPLEMENTATION_PLAN.md`  
2. `TVN_2.0_SPORTS_AND_NEWS_DATA_PLAN.md`  
3. `TVN_2.0_INTERACTIVE_GAMES_PLAN.md`  
4. `TVN_2.0_MKV_AND_CONVERTER_AUDIT.md`  
5. `TVN_2.0_HOSTING_COMPARISON.md`  
6. `TVN_2.0_REGRESSION_RISK_REGISTER.md`  
