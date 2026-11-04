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

Audio uses 1 ms grains (`AUDIO_GRAIN_RATE`), video 20 ms (`DEFAULT_GRAIN_RATE`).
`graphLatency.ts` resolves each input's track by walking back to its producer
(`trackForEdge`) and derives grain duration, count and index from
`grainRateForTrack`. Only the Clock pane's top line stays at video rate.
MXL audio is a Continuous ring; the app draws it as an unbroken ring in 1 ms units
(a display simplification, see AI_RULES.md).

## Audio/video alignment

At a sync point with both a video and an audio input, `computeGraphLatency`
attaches `alignmentSpanMs` (the time span of the video grain being read) to the
audio reading. That reader is "video-aligned": its window is blue, its row reads
"1 video grain = N ms · N smp", and blue ticks (`videoGrainSpanOf`) cross the
audio ring. MXL aligns by timestamp, so the ticks are a visual aid.

## Origin tags (Canvas menu, off by default)

Each grain carries `originTs`, set once when a producer spawns it and preserved
through every hold and fan-out, mirroring MXL's Origin Timestamp
(`docs/Timing.md`). Tags show `#<grainIndex> · -<ageMs>ms`; a "writing #idx" flash
marks the instant a node publishes into its ring; a `ref #<idx> kept` tag on a
processing node shows the index is not re-stamped. Readability measures in
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
