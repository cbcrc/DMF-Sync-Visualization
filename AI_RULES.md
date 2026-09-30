# AI Rules

_Read this first when resuming work._

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
- **Stream color:** each grain carries a `streamIndex` (its producer's output
  branch index) end to end, purely for color-coding distinct flows (video vs.
  audio) as they diverge/reconverge.
- **Loss/wait rendering:** a grain arriving on a TOO_LATE input shatters (✕)
  and does not fan out (real data loss). A grain on a TOO_EARLY input holds
  and passes through as normal but renders pale/wobbling.
- **Adjustable latency:** Media Functions expose a range slider
  (`nodeDefaults.ts`'s `LATENCY_RANGE`, per kind) so players can retune a
  node's "efficiency" live and watch downstream ring-buffer status react.

## Level 4 — A/V Sync Overrun

A single **Ingress Function** writes flows V1 (video) and A1 (audio) sharing
a timestamp origin. Video is processed twice (V1 → V1a → V1b, 82ms total),
audio once (A1 → A1a, 2ms). The **Egress Function** must re-pair them by
reading the same grain index from both; by the time the slow video branch
publishes that index, the audio flow (only 2ms behind real time) has moved
80ms (4 grains) past it and recycled that slot. In the level's 100ms domain
only 3 grains of history are retained, so the audio input goes TOO_LATE while
video stays OK. Verified fixes: grow the domain to 110ms, delete the Slow
Video MF and reconnect, insert a Grain Repeater in the audio branch, or drag
the Slow Video MF's latency slider down.

## Known simplifications

- Clock is `Date.now()`, not a PTP/TAI implementation.
- Reads are evaluated instantaneously, not via deadline-based blocking/retry.
- Grain Repeater capacity is simplified to "one extra domain window per
  repeater on the branch."
- Invalid-grain publication, per-slice validity, and continuous
  (audio-sample) flows are not modelled.

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
