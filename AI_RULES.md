# AI Rules

_Read this first when resuming work._

## Status

README "Future development" item #10 ("Visualisation of grains and
alignment Improvements") is **complete** — all sub-deliverables (D0 research,
D1 per-track grain rate + audio visualization, D2 alignment highlight, D3
origin-timestamp viz, D4 reference-time invariance demo) are implemented and
verified (`npm run lint` + `npm run build` both clean as of the last session).
See "Grain-flow visualization" below for what each one does. Item #8 was
folded into this work.

Item #1 ("Visualize the Egress parking signal... distinctly visible") is
also **complete** — parked siblings no longer stack on the node's dead
center; see "Sync parking" below.

No open threads/in-progress edits — safe to start a new deliverable from
scratch next session (see README's "Future development" for remaining
numbered items, and this file's "Known simplifications" for follow-on ideas
like a literal Continuous ring-buffer model).

## Core model — read this before touching timing logic

The app models MXL timing with **preserved grain indices**: a Media Function
that reads grain T writes its processed result back as grain T, into slot
`T mod grainCount` of its own output ring buffer. Processing never renumbers
grains — it only makes a flow's published head lag real time by the path's
accumulated latency. Do not replace this with a model where nodes "re-time"
grains, and do not reduce it to a continuous-milliseconds-only approximation.

Consequence that drives the whole game: a purely serial chain never overruns
(every node reads at its upstream's head). A **too-late** read only happens at
a sync point (multi-input node), on the *fast* branch, whose requested grain
aged out while it waited for a slower sibling branch to publish the same
index. Evaluation is therefore **per input edge**, not per node.

- **OK (green):** requested grain is still retained.
- **Too early (yellow):** requested index is newer than the published head —
  the reader waits; no data lost.
- **Too late (red):** requested index is older than the writer-reserved
  boundary (`~head - grainCount + 2`) — unrecoverable loss.

## Architecture

```
src/
  types.ts                 Signal, MediaFunction, RingBuffer, SyncGroup, MXLDomain
  engine/
    ringBufferEngine.ts     evaluateRingBuffer (OK/TOO_EARLY/TOO_LATE), gaugeZone
    syncGroupEngine.ts       sync-group delay padding for aligned signals
    mxlGrainIndex.ts          MXL-accurate GrainIndex/RingBufferIndex math
  components/
    canvas/                  FlowCanvas (editable graph + starter/level topologies),
                             MediaFunctionNode (node render, latency slider, internal
                             processing-path dot), nodeSizing, nodeDefaults (palette +
                             adjustable-latency ranges), GrainOverlay (traveling/holding/
                             parked/dropped dot rendering), RingBufferBadgeOverlay
                             (per-node compact status + slot strip)
    ui/                      RingBufferGauge, RingBufferRing (MXL-accurate dial),
                             RingBufferPanel (full per-node inspector), GrainSlotStrip
                             (grain-slot timeline w/ write/read head markers),
                             GameHud, InfoPanel (short explainer)
  game/                      graphLatency (tick runner + per-input buffer evaluation),
                             stabilityMonitor, useGameLoop, levels (4 challenges),
                             grainFlow/useGrainFlow (grain animation + spawn/sync logic)
```

## Grain-flow visualization

Purely visual layer on top of `graphLatency.ts`'s latency math — it does not
feed back into ring-buffer evaluation. Implemented in `grainFlow.ts`:

- **Motion:** grains travel edges along the exact bezier curve React Flow
  draws (`bezierControls`/`cubicPoint`/`pointAlongCurve`, arc-length
  parameterized for constant visual speed), then hold at each node for a
  duration scaled from its `latencyMs`.
- **Closed-loop pacing:** exactly one grain per producer output is in flight
  at a time. The Ingress only injects the next set once the pipeline has
  fully drained (`DRAIN_KEY` sentinel + `RESPAWN_GAP_MS` pause) — this keeps
  a single timestamp followable end to end instead of a continuous stream.
- **Per-node processing path:** each Media Function with an input and output
  renders an internal dotted track; the traveling dot hands off to a path
  dot keyed on arrival time (`processingStartedAt`), so the same grain the
  user watched arrive is visibly the one being processed, at a speed set by
  the node's `latencyMs`.
- **Sync parking:** a grain arriving at a multi-input node (e.g. Egress)
  parks (paused, non-aging, dashed ring) until every wired input has a grain
  waiting, then all release together with the same start time/duration —
  this is what shows synchronization being achieved. If any required sibling
  flow suffers an overrun drop (TOO_LATE), the surviving sibling remains parked
  in a stalled alert state (pulsing red hazard ring and a "Sync Stalled" badge
  on the node) until the user adjusts parameters to fix the timing (which
  automatically flushes and relaunches the wave) or clicks "Restart Wave" / "Reset".
  Parked grains are positioned close to the node's actual per-input handle
  spot (`inputAnchor`, only slightly blended toward center), not the node's
  dead center, so two or more siblings waiting at once (e.g. video + audio at
  Egress) render as visibly distinct dots right where their edge connects to
  the box — instead of stacking on top of one another — making it obvious
  which input is the one being delayed (`getGrainPosition` in `grainFlow.ts`).
- **Canvas ↔ telemetry correlation:** the on-canvas "parked" dot and the Ring
  Buffer Telemetry panel below are two views of the same wait: `FlowCanvas`
  derives `parkedInputKeys` (keyed `${nodeId}:${inputIndex}`, same keying as
  `statusByInputKey`) from the live grain list and reports it up via
  `onParkedInputsChange`; `App` passes it to `RingBufferPanel`, which
  highlights the matching reader row (`.rb-panel__entry--parked` pulse) and,
  for audio inputs, pulses the `ContinuousBufferTrack` read marker
  (`.cb-track__marker--parked`) too — so a player sees the canvas parking and
  the buffer's "waiting" telemetry light up together as one correlated event.
- **Stream color:** each grain carries a `streamIndex` (its producer's output
  branch index) end to end, purely for color-coding distinct flows (video vs.
  audio) as they diverge/reconverge.
- **Loss/wait rendering:** a grain arriving on a TOO_LATE input shatters (✕)
  and does not fan out (real data loss). A grain on a TOO_EARLY input holds
  and passes through as normal but renders pale/wobbling.
- **Adjustable latency:** Media Functions expose a range slider
  (`nodeDefaults.ts`'s `LATENCY_RANGE`, per kind) so players can retune a
  node's "efficiency" live and watch downstream ring-buffer status react.
- **Per-track grain rate (D1):** audio flows use their own, much finer grain
  rate than video (`mxlGrainIndex.ts`'s `AUDIO_GRAIN_RATE`, 1ms grains vs.
  video's 20ms `DEFAULT_GRAIN_RATE`, following AES67's default 1ms packet
  time) — modelling MXL's documented distinction between video/data's
  Discrete ring buffers and audio's Continuous ring buffer, without building
  full Continuous (per-sample, half-buffer writer/reader split) semantics;
  see Known Simplifications. `graphLatency.ts` resolves each input's track by
  walking back to its originating producer's output handle (`trackForEdge`)
  and derives that reading's grain duration/count/index from
  `grainRateForTrack`, so every per-input ring-buffer display already
  reflects the right rate for its own track automatically. Only
  `RingBufferPanel`'s top-level "Domain clock" line stays video-rate, since
  it has no single input to key off of.
- **Audio-specific visualization (`ContinuousBufferTrack.tsx`):** video/data
  inputs keep the discrete `GrainSlotStrip`/`RingBufferRing` slot views, but
  audio inputs render this component instead — a smooth, time-based strip
  with no discrete cells (matching MXL's Continuous, not Discrete, ring
  buffer), a fill meter that grows from empty-at-the-head to full-at-the-
  retention-boundary as `occupancyRatio` rises (the single "how close to
  TOO_LATE" signal), and a read marker that is *always* rendered — clamped
  to the strip and pinned with a direction arrow when the real position is
  actually out of bounds, rather than scrolling off and disappearing the way
  a fixed-width discrete-cell strip does once a track's grains get much
  finer than the window can show. (`GrainSlotStrip` itself also gained a
  similar never-vanishes fallback — a compressed, dashed "still retained but
  off-window" cell — as a safety net for video in extreme cases.)
- **Audio/video alignment highlight (D2):** at a true sync point (a reader
  node with both a video and an audio input), `computeGraphLatency` works
  out the absolute time span of the one video grain being read at the
  aligned instant and attaches it to the audio sibling's `InputReading` as
  `alignmentSpanMs`. `ContinuousBufferTrack` draws that span as a bordered
  highlight band on the audio strip (plus a legend line) — a direct, literal
  answer to "which audio grains line up with this video frame," since
  audio's 1ms grains make that span visibly many grains wide against
  video's single one (item #10.ii).
- **Origin-timestamp visualization (HUD toggle "Show origin timestamps",
  off by default):** each grain carries `originTs`, a real (`Date.now()`-
  based) capture timestamp set once when a producer spawns it and preserved
  unchanged through every travel/hold/fan-out derived from it — mirroring
  MXL's Origin Timestamp (OTS) concept (`docs/Timing.md`): a media function
  that processes a grain does not re-stamp it with a new capture time. When
  enabled, `GrainOverlay` tags each grain with `#<grainIndex> ·
  -<ageMs>ms` (its origin-derived MXL grain index, and how far
  `Date.now() - originTs` has fallen behind real time), and flashes a brief
  "writing #index" ring at a node's output anchor the instant a grain
  embarks on an outgoing edge — the moment that node published it into its
  own output ring buffer.
- **Reference-time invariance demo:** while a Technical/Editorial/Repeater
  node holds a grain (same toggle), it shows a `ref #<idx> kept` tag with
  the same origin-derived grain index as the `writing #<idx>` flash that
  follows when it departs — proof the node doesn't re-stamp the grain with
  a new capture time as it "creates" its processed output (item #10.iii).

## Level 4 — A/V Sync Overrun

A single **Ingress Function** writes flows V1 (video) and A1 (audio) sharing
a timestamp origin. Video is processed twice (V1 → V1a → V1b, 82ms total),
audio once (A1 → A1a, 2ms). The **Egress Function** must re-pair them by
reading the same *point in time* from both (video and audio keep their own
per-track grain index for that instant — see "Per-track grain rate" above);
by the time the slow video branch publishes that instant, the audio flow
(only 2ms behind real time) has moved 80ms past it and recycled that slot.
In the level's 100ms domain, both tracks retain the same ~60ms of usable
history (`WRITER_RESERVED_MS` pins the writer-reserved safety margin to a
fixed *time* budget, re-derived into each track's own grain count, so the
reserved margin stays worth the same real time for fine-grained audio as for
video — see Known Simplifications), so the audio input goes TOO_LATE while
video stays OK. Verified fixes: grow the domain to 110ms, delete the Slow
Video MF and reconnect, insert a Grain Repeater in the audio branch, or drag
the Slow Video MF's latency slider down.

## Known simplifications

- Clock is `Date.now()`, not a PTP/TAI implementation.
- Reads are evaluated instantaneously, not via deadline-based blocking/retry.
- Grain Repeater capacity is simplified to "one extra domain window per
  repeater on the branch."
- Invalid-grain publication, per-slice validity are not modelled. Audio is
  approximated as a very fine-grained Discrete ring buffer (1ms grains,
  AES67's default packet time) rather than MXL's true Continuous ring buffer
  (per-sample, half-buffer writer/reader split) — see "Per-track grain rate"
  above.
- The writer-reserved slot margin (real MXL: always exactly 2 physical
  slots, regardless of a flow's grain rate) is instead pinned to a fixed
  *time* budget (`WRITER_RESERVED_MS`, anchored to video's 2-grain/40ms
  margin) and re-derived into each track's own grain count. This keeps
  existing levels' pass/fail balance consistent across video's coarse and
  audio's fine grain rate, at the cost of diverging from MXL's literal
  fixed-slot-count reader behavior (which would make a fine-grained audio
  flow's real safety margin negligible in time).

## General agent behavior

- Think before coding. State assumptions out loud. If a request is
  ambiguous, ask — don't silently pick an interpretation.
- Simplicity first. Write the minimum code that solves the problem. No
  speculative abstractions or unrequested flexibility.
- Surgical changes. Touch only what the task requires; don't refactor
  unrelated code.
- Keep docs in sync. When you add or change a feature, update this file and
  `README.md` to match.

## Project conventions

- Stack: React + TypeScript + Vite, [React Flow](https://reactflow.dev/) for
  the canvas. Node 18 is the supported runtime — avoid dependency bumps that
  require Node ≥20 (e.g. Vite 8) without checking first.
- `esbuild` is pinned via an `overrides` entry in `package.json`; do not
  loosen it to a bare `>=` range (breaks React Flow's build).
- Visual style: dark, manim-inspired canvas (thin white borders, red
  `#EE0000` accents for selection/latency/processing). UI chrome (panels,
  HUD) uses a light surface with black/grey brand text.
- Structural graph state is lifted to `App.tsx` via `FlowCanvas`'s
  `onGraphChange` callback. Node creation uses the palette in
  `nodeDefaults.ts`; connections use React Flow drag-connect; deletion
  removes the node and its attached edges.
- Only one game-loop tick runner (`useGameLoop.ts`) — do not introduce a
  second independent tick loop in components.

## Branding

- Red Radio-Canada (accent) `#EE0000`
- Grey (secondary text) `#757575`
- Black (normal text) `#000000`

`assets/theme.css` is a slide-deck theme from a different project with a
different palette — do not import it as-is. Only reuse its font files or
color references when needed.
