# TVN 2.0 — Interactive Games Plan

**Status:** plan only — no implementation  
**Depends on:** architecture audit; product-owner approval of channel numbers

---

## 1. Audit findings (confirmed)

### 1.1 There is no curated HTML5 games network today

- No curated channel uses `kind: 'website'` in central edits.  
- Playable browser games would use the **User Network website** path → `WebStage` iframe.  
- Gaming-named curated channels (46, 240–249, 812 Fortnite, etc.) are **video catalogue** identities.

### 1.2 “Skateboarding game” clarification

| Claim | Reality |
|-------|---------|
| Channel **355 Skateboarding** | YouTube / Braille Skateboarding catalogue — **sport video**, not an embedded skate game |
| HTML5 skate game in repo | **Not found** |

If a prior build or external link felt like a “game”, treat expansion as **new** interactive work on the website/embed path — do not assume 355 is a game runtime.

### 1.3 Interactive runtime we already have

`src/player/WebStage.tsx` + `web-interaction.ts`:

- Sandboxed iframe (`allow-scripts`, `allow-same-origin`, `allow-pointer-lock`, …)  
- Glass until **INTERACT**; then input passes through  
- Esc / Exit returns focus to TVN  
- Frame allow checked server-side (`server/web-programmes.ts`) — sites that send `X-Frame-Options` / restrictive CSP are refused  
- **TVN volume does not control iframe audio**

Vimeo uses `EmbedStage` (not suitable for arbitrary games).

---

## 2. Channel numbering — do not use 801–809 as free land

### 2.1 Constraint

Canonical **001–999 is fully named**. Range **800–899 is 100% occupied**. An earlier idea of games on **801–809** would **overwrite existing specialist identities** unless those channels are formally reassigned.

### 2.2 Placement options (for owner decision)

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A. User Network block** | e.g. starter or pack at 1100–1199 or next free after 1055 | No curated collision; matches website source model | Not on classic dial; easy to export |
| **B. Reuse NEEDS_CONTENT slots** | e.g. **812 Fortnite**, 884 Experimental, 886 Generative, others empty | Visible on 001–999 | Requires editorial rename + content; owner approval |
| **C. Relocate band** | Move/retire specific 800s to free a contiguous games block | Contiguous “Games Network” on dial | High regression + ownership risk — **last resort** |
| **D. INFO directory only** | Games listed in INFO → tune/open without new numbers | Zero dial conflict | Weaker “channel surfing” fantasy |

**Recommendation:** **A + D** for Phase C (INFO Games directory + optional User Network pack). Propose any **B** renames individually. Do **not** implement C without explicit written approval listing each number moved.

### 2.3 Proposed User Network pack (example — not installed)

| Number | Working title | Notes |
|--------|---------------|-------|
| 1101+ | Arcade / Puzzle / … | Contiguous pack; exportable JSON |
| — | — | Exact start = `nextUserNumber` at ship time if appending |

Owner will confirm the base number before any channel writes.

---

## 3. Games network product shape

### 3.1 Categories (directory metadata)

Arcade · Platform · Racing · Puzzle · Retro · Sports · Strategy · Experimental · Interactive art · Educational · Multiplayer (where appropriate)

### 3.2 Catalogue record (proposed)

```ts
interface GameEntry {
  id: string
  title: string
  category: string
  description: string
  /** https URL that allows framing, or local /games/… asset */
  launchUrl: string
  channelNumber?: number  // if assigned
  license: string
  embedOk: true
  input: ('keyboard' | 'mouse' | 'touch' | 'gamepad')[]
  audioNote?: string      // “uses its own sound”
}
```

Ship as `public/info/games.json` or User Network export — not scraped ad hoc at runtime.

---

## 4. Content sourcing rules

1. Prefer licenses that allow embedding or local hosting (MIT/Apache/own).  
2. Verify framing with existing `/api` web resolve / `frameAllowed`.  
3. Prefer **local static hosting** under `public/games/<id>/` for flagship titles (predictable CSP, offline pack later).  
4. Do not hotlink sites that prohibit iframes or ToS-ban embedding.  
5. Do not redistribute commercial game assets without rights.

---

## 5. Reliability work (before catalogue expansion)

| Topic | Required investigation / hardening |
|-------|-------------------------------------|
| Focus | INTERACT / Esc already exist — regression tests |
| Channel change while interacting | Exit web interaction on tune (verify) |
| Memory | Destroy iframe on channel leave; check for leaked workers |
| Audio | Document uncontrolled iframe audio; optional “mute tip” |
| Crash recovery | Timeout + “unavailable” card like other sources |
| Mobile | Touch + no gamepad assumptions |
| Fullscreen | Policy with TVN chrome |

Files: `WebStage.tsx`, `web-interaction.ts`, `TvScreen.tsx` WebControls, `server/web-programmes.ts`.

---

## 6. INFO Games module (Phase C)

- Directory browse by category  
- Launch = tune to assigned channel **or** temporary website programme (owner choice)  
- Hide module until ≥ N approved embeddable entries exist  

---

## 7. Acceptance criteria

1. Owner-approved numbering plan documented before any curated renumber.  
2. Every shipped game passes frame allow check in CI or ingest.  
3. Leaving a game channel tears down the iframe (no audio zombie).  
4. Guide CH+ from a game channel behaves like any other channel.  
5. INFO Games shows only approved entries.  
6. License field present for each entry.

---

## 8. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Overwriting 801–809 | High | Refuse without approval |
| Third-party embed breakage | High | Prefer local host |
| Uncontrolled loud game audio | Medium | Tips + Esc exit |
| XSS via website sandbox | High | Keep existing URL allow rules; never load TVN origin in iframe |
| Assuming 355 is a game | Medium | Correct messaging |

---

## 9. Complexity

| Slice | Complexity |
|-------|------------|
| INFO directory over JSON | Low |
| User Network games pack | Medium |
| Local hosting pipeline | Medium |
| Curated dial reassignment | High (process) |
| Gamepad mapping through iframe | Medium–high (browser-limited) |
