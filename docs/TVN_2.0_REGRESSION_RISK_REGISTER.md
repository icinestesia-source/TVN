# TVN 2.0 — Regression Risk Register

**Status:** living register for the 2.0 programme  
**Rule:** every substantial change must name risks from this list and run the matching gates.

---

## 1. Sacred behaviours (do not break)

These are owner-validated strengths. Treat regressions as release blockers.

| ID | Behaviour | Primary areas |
|----|-----------|---------------|
| S1 | Stable playback / recovery | `player/*`, `use-player-events`, startup |
| S2 | Channel surfing (CH+/−, R, surf) | `tuning.ts`, `catalogue.ts`, off-air |
| S3 | Content discovery via dial + Guide | director, catalogue, Guide grid |
| S4 | Mixed media (TV / radio / local / web) | stages, `screen-face`, session |
| S5 | User Network edit/export/import | NetworkEditor, user-db, export |
| S6 | Guide overlays without killing A/V | `TvScreen` mount order |
| S7 | Keyless production client | no API keys in bundles |

---

## 2. Risk register

| ID | Change area | Risk | Severity | Likelihood | Detection | Mitigation / gate |
|----|-------------|------|----------|------------|-----------|-------------------|
| R1 | INFO tab / GuideTool | Steal or break OverlayMode `'info'` / key `V` | High | Medium | Hints + keyboard tests; manual V | Use tool id `'infocentre'`; never alias `'info'` |
| R2 | INFO tab | Remount player / pause on open | Critical | Low if pattern copied | Probe: audio continues | Mount only inside Guide body |
| R3 | GuideActions order | Wrong order vs Network→INFO→Guide | Medium | Medium | Markup test | Snapshot action labels |
| R4 | News/Sports fetch | Startup blocked / jank | High | Medium | Performance: Guide open < budget | Lazy fetch on module open |
| R5 | Sports API key | Key in client bundle | Critical | Medium | `rg` AIza/token scan | Server/CI only |
| R6 | Sports UI | “Live” on delayed data | High | High | UI flag `liveReliable` | Badge rules + tests |
| R7 | Games on 801–809 | Overwrite curated channels | Critical | High if naive | Canonical diff | Owner-approved numbers only |
| R8 | Website games | Iframe audio zombie after tune | High | Medium | Manual + leave-channel test | Tear down WebStage |
| R9 | Website games | XSS / origin escape | Critical | Low | Existing URL rules | Keep `showableWebUrl` |
| R10 | MKV changes | Break MP4/FLV local import | High | Medium | `tvn-local-*.test.ts` | Don’t touch flv/mpegts casually |
| R11 | Remove @ffmpeg | AVI imports fail hard | Medium | High if removed early | Import suite + note in UI | Phased removal (see MKV audit) |
| R12 | Hosting migrate | `/api/channel` or feed down | Critical | Medium on cutover | Smoke checklist | Hybrid first; rollback Netlify |
| R13 | Off-air / export / favourites | Recent editor work regresses | Medium | Medium | `tvn-off-air`, `tvn-picked-export` | Run on Guide/Network PRs |
| R14 | Multi View / volume | Return from MULTI loud | Medium | Low | Prior probe pattern | Keep `setAudible` on ready |
| R15 | Starter 55 channels | Auto-install / Remove starter broken | Medium | Low | starter tests | Don’t rewrite bootstrap lightly |
| R16 | Chat (future) | Abuse / cost / ToS | Critical | n/a until F | Design review | Invitation-only; optional |
| R17 | Teletext mode | Second nav confuses Guide | Medium | Medium | UX review | Optional mode; same data plane |
| R18 | Bookmarks→Discoveries | Duplicate stores diverge | Medium | Medium | Single store extension | Extend `bookmarks-store` |
| R19 | Logo folder →99 | Bundle/size or test flakes | Low | Medium | startup logo tests | URL-only glob (already) |
| R20 | Documentation drift | README says 701 imports etc. | Low | High | Audit | Prefer code over README |

---

## 3. Phase gates (minimum)

### Phase A — Foundations

- [ ] Owner accepts document set  
- [ ] INFO tool id chosen  
- [ ] Football competitions list constrained to licensed coverage  
- [ ] Games numbering option chosen (A/B/C/D)  
- [ ] Hosting option H1/H2/H3 chosen  

### Phase B — INFO + News + Football

- [ ] `tsc -b` clean  
- [ ] Targeted: Guide tool tests, info loaders, secret scan  
- [ ] Manual: playback under INFO; Esc; Network/Guide still work  
- [ ] Stale/live labelling verified on football free tier  

### Phase C — Games / Radio / Messages

- [ ] No curated renumber without written list  
- [ ] WebStage teardown test  
- [ ] Radio tune from INFO uses `requestTune` only  

### Phase E — MKV / converter

- [ ] Local FLV/MP4 tests green  
- [ ] Converter removal behind explicit owner OK  
- [ ] MKV matrix rows filled for Chromium at minimum  

### Phase F — Chat

- [ ] Separate security/moderation design signed off  
- [ ] Cost cap  
- [ ] Television works with chat fully disabled  

---

## 4. Suggested regression commands (no change to policy)

```bash
# Secrets
rg -l "AIza[0-9A-Za-z_-]{30}" src public dist scripts docs server; echo exit:$?

# Core television / guide (adjust as suites evolve)
npx vitest run src/tvn-2-0-channel-guide.test.ts src/tvn-2-0-interaction.test.ts \
  src/tvn-off-air.test.ts src/tvn-picked-export.test.ts src/tvn-local-flv.test.ts

# After INFO lands
npx vitest run src/tvn-2-0-info-centre.test.ts src/tvn-info-news.test.ts src/tvn-info-football.test.ts
```

Full suite remains ~minutes; expect known logo dimension failures until assets are square.

---

## 5. Incident severity guide

| Severity | Meaning | Response |
|----------|---------|----------|
| Critical | Playback dead, wrong channel wipe, key leak, catalogue overwrite | Stop feature; rollback |
| High | Surfing/Guide broken, false live scores, iframe stuck | Fix before merge |
| Medium | Module-only failure, copy/order glitch | Fix in phase |
| Low | Docs/hints drift | Track |

---

## 6. Open owner decisions (blockers for implementation)

1. INFO keyboard shortcut (if any) — must not silently take `V` or `I`.  
2. Football: free delayed only vs €12 live.  
3. Competitions beyond free tier (League One/Two, FA Cup, Scottish).  
4. Games placement option A/B/C/D.  
5. Hosting H1 vs H2 for ingest.  
6. Converter: hide UI only vs delete `@ffmpeg`.  
7. Whether Discoveries is a rename of Bookmarks or a separate INFO view onto the same store.  

**No implementation until these are answered for the slice being built.**
