## Goal

Turn the editor timeline from a visual mock into a working, CapCut-style multi-track editor. Every tool in the toolbar and every gesture on a clip must produce a real, persisted change that shows up in the AI render.

## What will work after this

Per clip, the user can:
- **Select** (click / tap)
- **Trim** — drag the left or right edge of a clip to set an in / out point
- **Split** at the playhead (S) — one clip becomes two clips sharing the same source but with different in/out
- **Delete** (Del / ⌫ or toolbar) — removes the selected clip from the timeline (source file preserved when it's a split half)
- **Duplicate** (⌘D) — clones the clip right after itself
- **Drag to reorder** across A-Roll and B-Roll (already partly there — extended to both rolls and to cross-track moves)
- **Scrub** — click / drag the ruler or track area to move the playhead

Global:
- **Space** = play/pause, **←/→** = 1 frame, **Shift+←/→** = 1 second, **Home/End** = start/end
- **Zoom slider** actually changes the pixel-per-second density (clip widths + ruler ticks scale)
- **Magnetic snap** toggle snaps trim/drop edges to the playhead and to adjacent clip boundaries
- **Undo / Redo** for timeline edits (in-memory stack, last 50 actions)
- Autosave badge reflects a real pending-write state

## Data model changes (Lovable Cloud)

Add three columns to `clips`:

- `trim_in_ms  int  not null default 0`  — offset into the source file
- `trim_out_ms int  null`                — null = end of source
- `parent_clip_id uuid null references clips(id) on delete set null`  — set when a clip was produced by a Split (so we know it shares a source)

Migration also:
- backfill existing rows with `trim_in_ms = 0, trim_out_ms = null`
- keeps existing GRANT / RLS policies

## Server functions (new + changed)

New under `src/lib/projects.functions.ts`:
- `updateClipTrim({ id, trim_in_ms, trim_out_ms })`
- `splitClip({ id, at_ms })` — atomically inserts a sibling clip after the source, splits trim points, shifts ordinals of everything after
- `duplicateClip({ id })` — inserts a copy just after the source, shifts ordinals

Changed:
- `attachClip` accepts optional `trim_in_ms / trim_out_ms / parent_clip_id`
- `getProject` returns the new trim fields so the timeline can render real widths

## Render worker

`render-worker/server.js` currently concatenates whole clips. Update the ffmpeg step so that per input it applies `-ss <trim_in> -to <trim_out>` before the concat/filter graph, so trims and splits actually shorten the final MP4. No API surface change — the worker already gets the clip list from the project fetch.

## Client rewrite (`projects.$projectId.tsx`)

Replace the current `TimelineTracks` with a real pixel-per-second timeline:

```text
 +--track header--+-------- tracks area (scroll x) --------+
 |  V1  A-Roll   |  [clip 00:04] [clip 00:07] [clip …]    |
 |  V2  B-Roll   |             [clip 00:03]               |
 |  A1  Audio    |  ~~~~~~~~ real waveform stub ~~~~~~~~  |
 +---------------+----------------------------------------+
                  ^ ruler with playhead + snap guides
```

Key pieces:
- `pxPerSec` state (default 40, min 8, max 240) — zoom slider drives it
- Every clip's rendered width = `((trim_out ?? source_duration) - trim_in) * pxPerSec / 1000`
- Trim handles: pointer-down on the 6px edge → live drag → on pointer-up, call `updateClipTrim`
- Split (S): read `currentTime`, find clip under playhead, call `splitClip({ id, at_ms })`
- Delete (⌫/Del): call `removeClip` and clear selection
- Duplicate (⌘D): call `duplicateClip`, keep selection on new clip
- Drag reorder: unchanged mechanics, but works across V1/V2 and updates both rolls
- Snap: when dragging a trim handle or clip, snap to playhead and to any clip boundary within 6px
- Undo/redo stack of `{ action, inverse }` — inverse also hits the server

React Query cache is invalidated after every mutation so the preview stays truthful.

## Toolbar wiring

Every button in the toolbar becomes real:

| Button | Action |
|---|---|
| Select | current mode (default) |
| Undo / Redo | pop/push from the timeline history stack |
| Split | `splitClip` at playhead |
| Duplicate | `duplicateClip` on selection |
| Delete | `removeClip` on selection |
| Snap | toggles snap behavior above |
| Zoom -/+ and slider | drive `pxPerSec` |
| Mic, Crop, Mirror, AI clean | hidden until backed by real logic — no dead buttons |

## Testing pass

- Import 2 clips, drag one to reorder — order persists on reload.
- Trim a clip — final render is shorter by exactly the trimmed amount.
- Split at 00:03, delete the first half — render starts at 00:03.
- Duplicate a clip — render plays it twice.
- Zoom in to 240 px/s, scrub — playhead lines up with the clip edges.
- Space toggles play; ⌘Z reverses the last trim.

## Out of scope for this pass

- Multi-select and rubber-band selection
- Per-clip speed / reverse / effects
- Real audio waveform rendering (still a stubbed bar row — but drawn to real clip duration)
- Beat-detect snapping

Those are straightforward follow-ups once the trim/split model exists.
