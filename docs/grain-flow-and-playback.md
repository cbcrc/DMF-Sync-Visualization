# Grain-flow visualization and playback

The grain animation is a purely visual layer on top of `graphLatency.ts`'s
latency maths. It never feeds back into ring-buffer evaluation.

## Grain animation (`grainFlow.ts`)

- **Motion:** grains follow the bezier curve React Flow draws, then hold at each
  node for a duration scaled from its `latencyMs`. The hold is the only thing that
  represents added latency.
- **Edge reads are instantaneous.** MXL hand-off is shared memory, not a wire, so
  edge travel is a fixed ~1 ms (`EDGE_TRAVEL_MS`) and the edge pulses for 300 ms
  (`EDGE_PULSE_MS`, `.edge-pulse-active`) when a downstream function reads from
  the upstream ring. No dot travels the edge.
- **Closed-loop pacing:** one grain per producer output is in flight; the Ingress
  injects the next set only after the pipeline drains, so one timestamp can be
  followed end to end.
- **Sync parking:** a grain arriving at a multi-input node parks (dashed ring,
  near its own input handle via `inputAnchor`) until every wired input has a grain,
  then all release together. If a sibling is TOO_LATE, the survivor stays parked
  with a "Sync Stalled" badge until the user changes parameters (which relaunches
  the wave) or presses Restart Wave / Reset. The matching reader marker on the
  ring pulses too (`parkedInputKeys`).
- **Loss and wait:** a TOO_LATE grain shatters (✕) and does not fan out; a
  TOO_EARLY grain passes through pale and wobbling.
- **Stream colour:** `streamIndex` colour-codes video and audio.
- **Adjustable latency:** each function has a slider (`LATENCY_RANGE` in
  `nodeDefaults.ts`).

## Per-track grain rate

Audio is counted in 10 ms commit batches (`AUDIO_GRAIN_RATE`, MXL's default
batch), video in 20 ms grains (`DEFAULT_GRAIN_RATE`).
`graphLatency.ts` resolves each input's track by walking back to its producer
(`trackForEdge`) and derives grain duration, count and index from
`grainRateForTrack`. Only the Clock pane's top line stays at video rate.
MXL audio is a Continuous ring of samples, twice the domain history (rounded up to
a page), of which readers may use the newer half. The app draws it in batches
and judges reads by MXL's continuous rule (`continuousGeometry`; see AI_RULES.md).

## Audio/video alignment

At a sync point with both a video and an audio input, the video input is read
first and the audio input then reads exactly that grain's samples, the way MXL
aligns flows: the grain's timestamp `T_k` and the next one `T_k+1` are converted
to sample indices (`sampleIndexAt`, MXL's `timestampToIndex`), and the reader asks
for `S(T_k)` … `S(T_k+1) - 1` (`AlignedRead` on the buffer). It is judged per
sample: too early while the last sample is past the head, too late once the window
no longer fits in the readable half. At 29.97 fps the window alternates 1602/1601
samples (8008 per 5 grains). Both readings carry `alignmentSpanMs`.

On screen, the pair is blue everywhere:

- **Audio strip and ring:** the exact sample window, drawn at sample precision
  (it can start mid-batch), and ticks where each video grain starts, placed at its
  timestamp's sample index (uneven at 1001-based rates).
- **Video strip and ring:** the grain being read with the audio.
- **Ring Buffers pane:** under the aligned audio reader, the conversion itself:
  `T` (the grain's timestamp), `V fps → grain k`, `A kHz → samples first … last
  (count)`. Simplified labels count samples from simplified grain 100 and wrap
  with it; TAI Time shows the real indices.

## Origin tags (Canvas menu, off by default)

Each grain carries `originTs`, set once when a producer spawns it and preserved
through every hold and fan-out, mirroring MXL's Origin Timestamp
(`docs/Timing.md`). Tags show `#<grainIndex> · -<ageMs>ms`; a "writing #idx" flash
marks the instant a node publishes into its ring; a `ref #<idx> kept` tag on a
processing node shows the index is not re-stamped (only on nodes without a
processing pipe; a Profanity Delay never shows it, since it re-stamps).

## Processing pipe (every function that reads and writes)

Nodes have a fixed size (`nodeSizing.ts`). A function's latency shows as the
grains in flight inside it (`processingPipe.ts`, `ProcessingPipe.tsx`): it
reads grain k, processes it for its latency, and writes it as k. It starts a
new grain every grain period, so while it reads r it is still working on the
grains before it, and its output head shows the last one it finished, w. The
pipe shows `reads #r`, `writes #w` and a chip for each grain w+1 … r, moving
from left (just read) to right (being written) over the latency.

- `r` is the reader marker's index (the lowest synced reader on the output's
  track) and `w` the output head, from the same snapshot as the ring strips, so
  the pipe always matches them at each tick. Between ticks the pipe moves on
  with the simulated clock every frame (`extrapolatePipe`), so chips glide.
- Manual mode: each Step is replayed over about 600 ms per grain
  (`advanceDisplayClock`), so grains are seen entering, crossing and being
  written, even in a 6 ms Colour Corrector. A Step lands on a read, so between
  Steps the newly read grain waits at the pipe's entrance. The ring strips still
  jump on the Step.
- An empty pipe means no grain is in flight at that instant (a short latency
  inside a 20 ms grain); "written as read" appears only at 0 ms.
- Alternate grains use alternate lanes so neighbours don't overlap. Past
  `PIPE_MAX_CHIPS` (6) the newest five and the oldest are drawn and the rest
  counted (`+N`).
- No pipe on a Grain Repeater (writes the oldest grain at once) or a Profanity
  Delay (re-stamps; it keeps its delay bar). Readability measures in
`GrainOverlay.tsx`:

- Grain index modes (Playback pane): **Simplified** (sequential from 100, wrapping
  at 999, `simplifiedGrainIndex`) or **TAI Time** (the real epoch-scaled index,
  last digits shown, `grainIndexLabel`).
- Age rounds to 100 ms steps; tags linger ~220 ms before fading.
- Flashes and tags are event-based and visible at least `FLASH_VISIBLE_MS` (700 ms)
  before fading (`FLASH_FADE_MS` 300 ms), so they stay readable at slow playback.
  In Manual mode they stay until the next Step.
- Tags sit above the node (`TAG_ABOVE_NODE_PX`), one per node per stream, stacked
  (`TAG_STACK_GAP_PX`), clear of `.mf-node__stalled-badge`.
- Video and audio grains from one producer in one tick share `originTs`; the
  "shared origin · V#… · A#…" chip (`.shared-origin-chip`) and
  `.grain-sibling-link` show one clock with two grain sizes.

## Playback modes (`useSimClock.ts`)

One `useSimClock()` instance, created in `App.tsx`, is the only clock read by
`grainFlow`/`useGrainFlow`, `useGameLoop` (ring evaluation and the stability
timer) and `GrainOverlay`. Hooks take an optional `getNow` so they work without it.

- **Manual** (default): frozen; **Step ▶** advances one video grain
  (`MANUAL_STEP_MS`); **◀ Back** restores a snapshot of grains, spawn state and
  clock (up to 200 in `useGrainFlow`; a wave restart clears them).
- **Stepping:** runs at 0.2× real speed (`STEPPING_SPEED`).
- **Normal:** real time.

Driven by `requestAnimationFrame`, accumulating `realDelta * speedForMode`.
`setMode` resets the delta reference so switching never applies a backlog. The
stability fail-timer counts simulated, not real, elapsed time, so a frozen node
doesn't drift toward failure.

This clock is a pedagogical departure from MXL (see AI_RULES.md).
