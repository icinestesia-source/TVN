# TVN 2.0 — MKV Support and Converter Audit

**Status:** audit + plan only — no removal or implementation yet  
**Repository paths:** `src/session/`, `src/player/`, `public/tools/`

---

## 1. Local media architecture (confirmed)

| Item | Detail |
|------|--------|
| Channels | **991–1000** Local Media (`session-channel.ts`) |
| Import | `src/session/import.ts` — Folder / Files / handles |
| Playback | Object URLs → `LocalStage` (`HTMLMediaElement` / mpegts for FLV) |
| Persistence | Names/handles may persist; **file bytes are session** unless File System Access reload |

---

## 2. Extension matrix (confirmed from `import.ts`)

### 2.1 Treated as playable (attempt direct play)

| Ext | MIME (mapped) | Notes |
|-----|---------------|-------|
| mp4, m4v, f4v, webm | video/* | Standard |
| mov, qt | video/quicktime | `browserCanPlay` forced true |
| **mkv** | **video/x-matroska** | **Forced canPlay true** — Chromium often plays despite empty `canPlayType` |
| ogv, ogm, 3gp, 3g2, flv | … | FLV may remux via mpegts |
| mp3, m4a, aac, wav, ogg, opus, flac, **mka**, … | audio/* | mka = Matroska audio |

### 2.2 Convert-listed (in-app path expects conversion)

avi, divx, xvid, wmv, asf, mpg, mpeg, vob, ts, m2ts, … — **mkv is not in this set**.

### 2.3 Mac offline tool (`public/tools/tvn-convert-media.command`)

Broader list **including mkv** → `(TVN).mp4` via system ffmpeg. Linked from MEDIA UI when status contains `NEED CONVERTING`.

---

## 3. MKV reality (important)

| Layer | Compatibility |
|-------|----------------|
| **Container** (Matroska) | Chromium family often demuxes; Safari/Firefox historically weaker / inconsistent |
| **Video codec** | H.264 in MKV often works in Chromium; HEVC/AV1/VP9 depend on OS/GPU |
| **Audio codec** | AAC/Opus usually fine; DTS/AC3 often fail in-browser |
| **Subtitles** | Not a first-class Local Media feature today |
| **Mobile** | Expect more failures than desktop Chromium |

**Do not claim universal MKV support.** Current code *tries* MKV; success is browser + codec dependent.

### 3.1 Practical route to “improved MKV”

| Step | Action | Complexity |
|------|--------|------------|
| 1 | Compatibility probe on import (`canPlayType` + short decode test) | Medium |
| 2 | Clear per-file UI: Playable / Likely needs convert / Unsupported codec | Medium |
| 3 | Keep Mac converter for failing MKV (already supports mkv) | Low |
| 4 | Optional: WASM remux **without** re-encode when codecs are already browser-safe | High |
| 5 | Avoid uploading private media to any remote convert service | Policy |

Out of scope unless approved: bundling a full native player engine inside the web app.

---

## 4. Converter functionality inventory

### 4.1 Keep — needed for playback compatibility

| Component | Path | Role |
|-----------|------|------|
| FLV attach | `src/player/flv.ts` + `mpegts.js` | Playback demux |
| AVI→FLV remux | `src/player/avi.ts` | Lossless-ish path when codecs allow |
| mp4-steady | `src/player/mp4-steady.ts` | Fix uneven MP4 indexes for scrubbing |
| Import routing | `avi-convert.ts` orchestration | Decides remux vs WASM |

### 4.2 Candidate to simplify / remove (general-purpose conversion)

| Component | Path | Why removable *if* owner agrees |
|-----------|------|----------------------------------|
| In-page AVI→MP4 WASM | `src/player/avi-ffmpeg.ts` + `@ffmpeg/ffmpeg` + `@ffmpeg/core` | Large dependency; slow; overlaps Mac tool |
| UI download of Mac converter | `CONVERTER_URL` in Guide MEDIA | Owner “no longer requires general-purpose converter” — may mean this UX |
| Mac `.command` tool | `public/tools/tvn-convert-media.command` | Explicit general-purpose folder convert |

**Do not remove** until dependency graph and MKV fallback story are agreed. Removing `@ffmpeg/*` shrinks the install and build, but weakens in-browser rescue for AVI when remux fails.

### 4.3 Proposed removal phases

| Phase | Action | Gate |
|-------|--------|------|
| E1 | Hide converter download note / tool link in UI | Owner confirm |
| E2 | Remove Mac tool from `public/tools` + docs references | After E1 |
| E3 | Feature-flag or delete `avi-ffmpeg.ts` and npm `@ffmpeg/*` | Only if AVI remux-only is acceptable or AVI dropped |
| — | Keep mpegts + avi remux + mp4-steady | Required |

---

## 5. Compatibility matrix (test plan)

| Fixture | Chromium desktop | Firefox | Safari | iOS | Android Chrome |
|---------|------------------|---------|--------|-----|----------------|
| H.264 + AAC `.mkv` | Expect play | Probe | Probe | Probe | Probe |
| H.264 + AC3 `.mkv` | Expect fail/partial | Probe | Probe | Probe | Probe |
| HEVC `.mkv` | OS-dependent | Probe | Often better | Probe | Probe |
| VP9 + Opus `.webm` | Control | Control | Control | Control | Control |
| H.264 `.mp4` | Control | Control | Control | Control | Control |
| Legacy `.avi` H.264 | Remux/WASM path | Probe | Probe | n/a | Probe |

Record results in a short `docs/mkv-compat-results.md` after probes (future work).

**Acceptance for “improved MKV”:** documented matrix + honest UI status; not 100% play rate.

---

## 6. Risks of converter removal

| Risk | Impact | Mitigation |
|------|--------|------------|
| Users with only AVI libraries | Cannot import without external convert | Keep remux; document external ffmpeg one-liner |
| Bundle size regret | Low if ffmpeg removed carefully | Measure before/after |
| Accidental removal of FLV path | Breaks existing libraries | Tests in `tvn-local-flv.test.ts` |
| MKV still fails after “improvement” | Expectation mismatch | Matrix + messaging |

---

## 7. Files affected summary

| Goal | Files |
|------|-------|
| MKV probe UX | `session/import.ts`, Guide MEDIA UI, new helper |
| Hide converter | `GuideAdd.tsx` / SessionImportTools, copy |
| Remove WASM ffmpeg | `avi-ffmpeg.ts`, `avi-convert.ts`, `package.json`, Vite exclude |
| Keep demux | `flv.ts`, `avi.ts`, `mp4-steady.ts` |

---

## 8. Recommendation

1. **Improve MKV** via detection + clearer status + retain Mac path for hard cases.  
2. **Remove general-purpose converter UX** first (E1).  
3. Defer deleting `@ffmpeg/*` until AVI failure rates are measured in real use.  
4. Never route local media through a cloud converter.  
