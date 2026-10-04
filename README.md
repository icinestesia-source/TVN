# TVN

TVN (TV Nasty) is a browser television. Channels are on a fixed schedule whether or not anyone is watching. When you tune in, playback starts at the point that programme has already reached.

This is a clean-room V0.1. It borrows the general idea of a cable box and an electronic programme guide. It does not use another service's code, branding, graphics, or channel database.

## What you can do

- Watch a channel from the live point in its schedule
- Change channel with a short analogue static transition
- Open a guide with channels down the side and time across the top
- Tune from the programme that is on now
- Come back later, or refresh, and find the same broadcast has moved on with the clock

There is no account, subscription, or server. Preferences stay in `localStorage`.

## Develop

```bash
npm install
npm run dev
npm test
npm run build
```

`npm run dev` starts Vite. `npm test` runs the schedule tests. Production builds leave the debug panel out.

### Keys

| Key | Watching | Guide open |
| --- | --- | --- |
| ↑ ↓ | Channel up / down | Move between channels |
| ← → | Volume | Move between programmes |
| 0–9, Enter | Tune by number | Tune by number |
| G | Dock the guide beside the picture | Close the guide |
| M | Mute | Mute |
| Enter | Programme information, or expand the focused tile | Tune if that programme is on now |
| I | Programme information | Programme information |
| Esc | Hide overlays; leave a website's INTERACT and give the keys back to TVN | Close the guide |
| Backspace | Previous channel | Previous channel |
| Space | Surf to another channel; hold to switch Surf between ALL and your User Network | — |
| P | Pause; again to resume (a website then carries on where it was) | Pause |
| F | Full screen | Full screen |
| S | Favourite the current channel (a brief ★ notice confirms) | Favourite the highlighted channel |
| − = | Volume | Zoom the timeline out / in, keeping the view where it is (Home returns to now) |
| , . | Previous / next channel watched | Previous / next channel watched |
| / | Cycle multiview (1, dual, 2×2, 3×3) | Cycle multiview |
| V | All / favourites | All / favourites |
| U | Import a channels file | Import a channels file |
| D | Schedule debug (development only) | Schedule debug |

On a phone the guide sits under the picture. A remote button opens channel, number, guide, and multiview controls. Dual view stacks the two pictures. Nine-up is paged as a two-column grid so the tiles stay large enough to see.

Imported channel files stay in this browser (IndexedDB). They are not part of the built-in catalogue. Import them as a media library, as automatic channels numbered from 701, or both. Channels 900–999 are radio. Channel 101 carries a film longer than three hours. The schedule formula is unchanged.

## Architecture

```
src/
  app/           shell
  components/    guide, static, overlays, test card
  data/          demonstration channels and Creative Commons pictures
  epg/           geometry and the row window
  input/         keyboard → commands (a gamepad can emit the same commands)
  player/        YouTube IFrame API and seek mapping
  scheduler/     pure schedule math, no React
  services/      localStorage, broadcast helpers, future import
  state/         television state
  styles/
  types/
```

The scheduler does not import React. The guide asks it which programmes overlap a time window. A later import path can add programmes without changing that calculation.

### Channel

Stable `number`, name, category, generated mark, sources, and a `phaseOffsetSeconds` so neighbouring channels do not share a phase. Favourites are a preference, not part of the catalogue.

### Programme

Title, description, duration, optional YouTube `videoId`, kind (`programme`, `ident`, `bumper`, `continuity`, `retro-commercial`), and optional series, episode, year, and ident hooks. Those ident fields are metadata for a later junction player. V0.1 already schedules ident and bumper items on Continuity as normal programmes.

### Schedule

Every channel loops its list from a fixed epoch (`2020-01-06T00:00:00.000Z`) plus that channel's phase.

```
offset = (now − epoch) / 1000 + phase   modulo cycle length
```

Walk the durations until `offset` falls inside a programme. Elapsed time is the seek position. The same inputs always return the same airing, including across midnight and across decades. Refreshing does not restart the schedule.

### YouTube

Playback uses the official IFrame Player API. Demonstration pictures are Blender Foundation open movies (Creative Commons). They are stand-ins, not the scheduled programmes.

If the film is shorter than the slot, `playbackMode` is `loop-demo`: the guide and the clock still use the full slot, and only the picture repeats. The debug panel shows both the schedule seek and the player seek. If no `videoId` is attached, the receiver shows a generated test card and the schedule keeps running.

Channel changes mute the outgoing picture, show generated static (canvas noise, not a copied asset), and clear it once the next picture is ready, after at least half a second.

### Guide

Time runs horizontally. A 60-minute programme is twice as wide as a 30-minute one. A now line tracks the clock. The channel column does not scroll away with time.

Rows are windowed with `visibleRowRange` in `src/epg/geometry.ts`. Cells come from `slotsOverlapping`, which only builds the hours currently loaded (and a bit more when you scroll or arrow to the edge). That is the place to recycle horizontal cells when the catalogue grows past a hundred channels or many thousands of junctions. Very short items, such as the retro-commercial breaks, are the first pressure point.

Selecting a programme that is on now tunes to its live position. A future or past programme stays in the information panel. It is not played early.

### Persistence

`localStorage` key `retrotv.preferences.v1` stores the last channel, the previous channel, volume, mute, favourites, and the guide filter. The set opens on the last channel.

### Retro breaks

Channel 058 is a sequence of short archival-style items. They are programmes. There is no ad server, no tracking pixel, and no commercial slot for sale.

## Limitations

- Most pictures are short open movies looped inside longer slots. The schedule position is still the real one.
- YouTube can refuse to embed a film, or be slow. The test card stays up and the guide still works.
- There is no catch-up. Pause returns you to the live point.
- Import of a YouTube video, playlist, or channel is only an interface (`src/services/import.ts`). It does not call the network.
- Gamepads are not connected yet. They should emit `TvCommand`.
- The guide will not mount more than about a day and a half of cells in one session.

## Next

Attach full-length media through a permitted public import, play idents as their own pictures, add a gamepad, recycle guide cells horizontally, and optionally sync the preference record. Keep the schedule as the source of truth: the channel is on whether or not the viewer is.
