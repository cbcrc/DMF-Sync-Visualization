# AI Rules

_Read this first when resuming work._

## Ground rules: respect dmf-mxl/mxl

- This project is a **visualization tool** for testing and working with
  latencies in the EBU's **Dynamic Media Facility (DMF)**, helping users
  build and understand latency and sync scenarios and isolate where
  buildups and overruns can happen. It is **not a game** — no scores,
  win/lose states, or "players". Use "user", "scenario", and "alert" in docs
  and UI text.
- **MXL source of truth: https://github.com/dmf-mxl/mxl.** Before any change
  that touches timing, grains, ring buffers, flows, readers/writers or sync,
  read the relevant code and `docs/` there (e.g. `docs/Timing.md`,
  `PosixDiscreteFlowWriter.cpp`) and cite what you checked. Never rely on
  memory, this file or `SPEC.md` alone.
- **Behaviour in the DMF's asynchronous domain follows MXL**, and the
  normative reference is
  https://github.com/dmf-mxl/mxl (dmf-mxl/mxl). All models and future
  iterations (human or AI) must respect it. Consult it before changing any
  timing, grain, ring-buffer, flow, or sync logic. If `SPEC.md`, this file,
  or the code disagree with dmf-mxl/mxl, dmf-mxl/mxl wins. The linear, synchronous world outside the Ingress and Egress is not governed by MXL.
- Never invent MXL behaviour. Any deliberate departure from MXL (for
  teaching clarity) must be listed under "Known simplifications" below.
- `SPEC.md` is the domain spec (how this tool models MXL); this file holds
  current status, architecture, and deviations. Legacy names (`src/game/`,
  `GameHud`, `useGameLoop`) remain from the original game framing and are
  not renamed.

## Status

Verified by `npx tsc -b`, `npx eslint src` and `npx vitest run` (24 tests).

Done and described below: grain-flow visualization (TO-DO #1, #8-#14),
playback modes, the side panel (MXL clock, plus ring telemetry for the
selected function), the Scenarios page and persistence, the canvas editing and
ring-buffer blocks, the grouped "Add media function" palette, the Profanity
Delay, per-input sync/live on mixers, and the end-to-end timeline.

Open work lives in `TO-DO.md`. Check any changes in a browser (`npm run dev`)
as well as with the checks above. The recent canvas layout work (node layouts,
aligned Linear out lanes, reader bubbles, palette, timeline) has only been
checked by typecheck, lint and tests, not looked at in a browser yet.

## Core model — read this before touching timing logic

The app models MXL timing with **preserved grain indices**: a Media Function
that reads grain T writes its processed result back as grain T, into slot
`T mod grainCount` of its own output ring buffer. Processing never renumbers
grains — it only makes a flow's published head lag real time by the path's
accumulated latency. Do not replace this with a model where nodes "re-time"
grains, and do not reduce it to a continuous-milliseconds-only approximation.

Consequence that drives the whole tool: a purely serial chain never overruns
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
    ringBufferEngine.ts     evaluateRingBuffer (OK/TOO_EARLY/TOO_LATE), READ_BEHIND_WRITE_GRAINS
    mxlGrainIndex.ts         MXL-accurate GrainIndex/RingBufferIndex math, per-track grain rate
  components/
    canvas/                  FlowCanvas (graph editing, toolbar, undo, connection rules, palette),
                             MediaFunctionNode (the block: function body, mode select, ring
                             column), RingBufferStrip + ringStripLayout (a writer's linear ring
                             with reader pointers), nodeDefaults (palette presets, latency
                             ranges, palette groups, outputModeOf), nodeSizing, GrainOverlay (grain dots, tags),
                             LinearBoundaryOverlay (Ingress/Egress linear tick trains)
    ui/                      RingBufferPanel (closable TAI clock, plus a WriterRing per ring the
                             selected function writes or reads), WriterRing (circular ring
                             per writer flow), ClockStrip (domain TAI clock), EndToEndTimeline
                             (bottom timeline, one lane per output), GrainSlotStrip and
                             ContinuousBufferTrack (per-reader slot/continuous views),
                             RingBufferGauge, GameHud, InfoPanel, ScenariosPage
  game/                      graphLatency (per-input evaluation + writerFlows), writerRings
                             (readings grouped per writer, one ring per output flow),
                             connectionRules (which track an input may read), levels and
                             scenarios (6 built-in scenarios), scenarioStorage, stabilityMonitor,
                             endToEndTimeline (input-to-output path per output), syncInputs
                             (which mixer inputs read free of sync),
                             useGameLoop, grainFlow/useGrainFlow, useSimClock, useHashRoute
```

## Canvas editing and ring buffer blocks

- **Ring buffers belong to the writer.** MXL's writer commits grains whether
  or not anything reads (`PosixDiscreteFlowWriter::commit()` has no reader
  check), so every output flow of every producing node has a ring.
  `graphLatency.ts`'s `writerFlows` lists them; `writerRings.ts` attaches
  readers (rings with no readers are empty). Rings keep a fixed order, video
  then audio. A node with no outputs (an Egress) has no rings.
- **Block layout.** `MediaFunctionNode` renders a `.mf-block`: the square
  function body plus a column of `RingBufferStrip` cards. The frame is drawn
  with `::before` outside the layout box because `grainFlow.ts` geometry
  assumes a square body at `node.position`. Each card holds the source
  `<Handle id={ring.handleId}>`, so edges still go writer node to reader node.
  Built-in scenarios have their x positions spread (`spreadForRings`) to leave
  room for the rings.
- **Reader pointers.** The strip runs oldest to newest with the write head
  rightmost. A reader sits `deltaGrains + READ_BEHIND_WRITE_GRAINS` slots left
  of the head, so it can never sit on the write slot. A TOO_EARLY reader waits
  hollow at the newest readable slot. A TOO_LATE reader slides into the hatched
  overwritten zone by its true distance. Audio and video share this logic
  (audio reserves 40ms, video 2 grains: `WRITER_RESERVED_MS`). Clicking a
  pointer or a node focuses that reader (highlights its link and pointer).
  The toolbar's **Now** toggle draws wall-clock now to the right of each head.
- **Flow modes.** Inputs and Outputs have a video only / audio only / both
  select (`outputModeOf`, `handleOutputModeChange`). Track convention: a
  producer's output handle 0 is video, 1 is audio; other nodes inherit their
  first input's track (`trackForEdge`).
- **Connection rules** (`connectionRules.ts`, `isValidConnection`): an input
  takes one link; dropping a link on an occupied input replaces it. Audio-only
  functions read audio only, video-only functions (Colour Corrector, Video Mixer,
  Multiview) video only,
  an Output's first input is video and its second audio, and other
  multi-input nodes need all inputs on the same track. Rewiring an existing
  link that now breaks a rule is refused; links that already exist are kept.
  Palette flags `audioOnly` and `videoOnly` are persisted in `scenarioStorage`.
- **Palette.** "Add media function" lists presets in groups (`PALETTE_GROUPS`
  in `nodeDefaults.ts`): Sources, Synthetic, Technical, Editorial, Outputs.
  Each group has a Generic entry. Colour Corrector and Multiview are video
  only. The Grain Repeater is fixed at 0ms (no slider; `sanitizeNode` forces 0
  on load).
- **Profanity Delay** (`kind: 'delay'`, editorial group). One video and one
  audio input, parks media in its own buffer for up to 3s (`DELAY_MAX_MS`),
  then re-writes it into MXL as a new source: its output head lag and
  repeater count restart at 0, but `workloadLatencyMs` keeps counting the
  delay so total workload and the timeline stay end to end. In `grainFlow.ts`
  in-N fans out to out-N only and `originTs` is re-stamped on output. This is
  a deliberate departure from preserved grain indices, because the delay is a
  new source.
- **Mixer sync / live.** Editorial functions with more than one input get a
  per-input toggle (`ignoreSyncInputs`, `syncInputs.ts`). A "live" input is
  read as close to its write head as possible (one grain behind) and no longer
  holds the function back; a "sync" input reads at the aligned index. If every
  wired input is live they all stay synced. Checked against dmf-mxl/mxl
  (`6e654e2`): "sync" is a Flow Synchronization Group
  (`FlowSynchronizationGroup::waitForDataAt`, waits for every reader's head
  to reach the grain for one timestamp) and "live" is a reader outside the
  group reading `runtime.headIndex`, so it is never waited on.
- **End-to-end timeline.** `endToEndTimeline.ts` walks back from each
  Output/Recording along the branch with the largest end-to-end latency. Each
  step has `startMs`/`endMs` (the latency it adds), `readAtMs` (how far behind
  now it reads) and `syncWaitMs`. The axis is ms since the MXL write at the
  input. The Origin Time Stamp (OTS) carried on the linear side is not
  implemented: rows have a `leadInMs` (always 0) that shifts the axis, so OTS
  can be supplied later via `TimelineOptions.leadInMsBySourceId`.
- **Toolbar and undo.** Top-centre toolbar: Undo, Now and Save scenario. Undo (button or
  Ctrl/Cmd+Z) uses snapshot history in `FlowCanvas` (100 steps; connect, link
  move, add, node drag, delete). It is cleared when a scenario loads. Latency
  slider changes are not undoable and there is no redo.
- **Blank canvas.** Scenario 6 starts empty. Autosave skips an empty graph.

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
  (`.cb-track__marker--parked`) too — so a user sees the canvas parking and
  the buffer's "waiting" telemetry light up together as one correlated event.
- **Stream color:** each grain carries a `streamIndex` (its producer's output
  branch index) end to end, purely for color-coding distinct flows (video vs.
  audio) as they diverge/reconverge.
- **Loss/wait rendering:** a grain arriving on a TOO_LATE input shatters (✕)
  and does not fan out (real data loss). A grain on a TOO_EARLY input holds
  and passes through as normal but renders pale/wobbling.
- **Adjustable latency:** Media Functions expose a range slider
  (`nodeDefaults.ts`'s `LATENCY_RANGE`, per kind) so users can retune a
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
  inputs keep the discrete `GrainSlotStrip` slot view, but
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
  - **Item #11 readability pass:** the raw MXL `GrainIndex` is epoch-scaled
    (`Date.now()` / grain duration) and reads as an 11-13 digit number with
    no pedagogical anchor, and the age counter used to repaint every ~40ms
    simulation tick — both made the feature "move too fast to read." Fixed
    by: (D1) showing the small `RingBufferIndex` (`grainIndex mod
    ringBufferLength`, `mxlGrainIndex.ts`'s `grainIndexForDisplay`) by
    default, with a nested HUD toggle ("Use real MXL index") to switch to
    the raw epoch index once a user understands the small one; (D2)
    rounding the displayed age to 100ms steps so it changes in readable
    increments instead of every tick; (D3) tags now linger, fading out over
    ~220ms at their last known position after their grain leaves the live
    list (`GrainOverlay`'s `retainedTagsRef`), instead of vanishing the
    instant a fast grain's travel/hold ends.
- **Reference-time invariance demo:** while a Technical/Editorial/Repeater
  node holds a grain (same toggle), it shows a `ref #<idx> kept` tag with
  the same origin-derived grain index as the `writing #<idx>` flash that
  follows when it departs — proof the node doesn't re-stamp the grain with
  a new capture time as it "creates" its processed output (item #10.iii).
  This tag also respects the "Use real MXL index" toggle.

## Playback modes (shared simulated clock) — item #9

A single `useSimClock()` instance, created once in `App.tsx`, is the only
clock any timing-dependent engine reads from:

- `grainFlow.ts` / `useGrainFlow.ts` — grain travel/hold progress and
  `originTs` capture.
- `useGameLoop.ts` — ring buffer evaluation (`computeGraphLatency`) and the
  stability monitor's Red-zone fail-timer (`tickStability`).
- `GrainOverlay.tsx` — grain positioning and the origin-timestamp tag's age
  display (both `now` and `wallNow` collapse onto the one clock value, since
  nothing in the existing logic diffed one against the other directly).

Each consuming hook takes an optional `getNow: () => number` parameter
(defaulting to `performance.now()`/`Date.now()` respectively) so they remain
independently functional if ever used without the shared clock.

Three modes, switched via a HUD button row:

- **Normal** — advances 1:1 with real time (unchanged default behavior).
- **Stepping** — auto-advances at 20% real speed (`STEPPING_SPEED` in
  `useSimClock.ts`) so fast-traveling grains are easier to track by eye.
- **Manual** — frozen; only the HUD's "Step ▶" button (shown only in this
  mode) moves the clock, by exactly one video grain's duration
  (`MANUAL_STEP_MS`) per click — ties the control directly to "advance one
  grain index," reinforcing the grain-index concepts from items #10/#11.

Implementation notes:

- Driven by `requestAnimationFrame`, not `setInterval`, accumulating
  `realDelta * speedForMode` into a ref read via `getNow()`.
- `setMode` resets the real-time delta reference at the moment of the
  switch, so changing modes never applies a large backlog of elapsed real
  time in one jump (e.g. after a long spell in Manual).
- The stability fail-timer was changed from a fixed `TICK_MS` constant to
  the actual simulated elapsed time between polls (`useGameLoop.ts`) — this
  was the one correctness-critical change: without it, a node frozen on
  screen in Stepping/Manual mode would still silently accumulate toward the
  3s fail condition in real time in the background.

Known simplification (see below): this is a pedagogical clock. Real MXL
grain indices are derived from true elapsed PTP/TAI time and are never
slowed or single-stepped.

### Edge-read pulse (follow-up fix)

Slowing the animation down (above) exposed a pre-existing inaccuracy:
`grainFlow.ts`'s edge "travel" phase used to take 350ms+ (scaling with the
edge's on-screen pixel length, `TRAVEL_PX_PER_MS`), implying meaningful
transit latency between nodes that doesn't exist in real MXL — writing into
a node's output ring buffer and the next node reading it is effectively
instantaneous (shared memory, not a wire). Fixed:

- `travelDuration()` now returns a fixed, near-zero `EDGE_TRAVEL_MS` (1ms —
  not literal 0 only to avoid a divide-by-zero in `getGrainPosition`'s
  position interpolation) regardless of edge length.
- The old traveling dot is no longer rendered in `GrainOverlay.tsx`
  (`hiddenByPath` now also covers `phase === 'traveling'`). In its place,
  `useGrainFlow.ts` tracks `edgeActivity: Map<edgeId, lastActiveSimTime>`,
  updated whenever a grain is in `'traveling'` phase that tick.
  `FlowCanvas.tsx`'s `displayEdges` derives a 300ms (`EDGE_PULSE_MS`)
  highlight window from it and applies an `.edge-pulse-active` className
  (green glow, `FlowCanvas.css`) to the edge's drawn path — visualizing "the
  downstream Media Function just read from the upstream node's output ring
  buffer" as a pulse on the path itself, rather than a dot implying transit
  time.
- A node's `hold` phase (scaled by `holdDuration(latencyMs)`) remains the
  only thing that visually represents real added latency — exactly matching
  where real MXL processing time actually accrues.

### Item #12 — time index visualization (shared origin + freeze-to-read)

Reassessed after item #9 landed, with two fixes in `GrainOverlay.tsx`:

- **Freeze-to-read regression fix:** item #9's edge-travel fix (near-instant
  ~1ms hop) had an unintended side effect — every flash/tag that read state
  off a *specific* grain object (the "writing #idx" flash, the origin tag)
  only existed in the live `grains` list for a single ~40ms tick before that
  phase transitioned and a brand-new grain id replaced it. In Normal/Stepping
  mode this made them barely perceptible, not just brief. Fixed by making
  both event-based instead of tied to the transient object: `writeFlashesRef`
  (keyed `${edgeId}-${originTs}`) records a "writing" event once, and the
  origin-tag `retained` map now tracks a `firstShownAt` per tag id. Both are
  guaranteed `FLASH_VISIBLE_MS` (700ms) of full visibility — counted from
  first appearance, not from whatever's left of the underlying grain's
  phase — before they're even eligible to start the `FLASH_FADE_MS` (300ms)
  fade. In Manual playback mode the simulated clock itself doesn't advance
  at all, so these stay fully visible indefinitely until the user clicks
  "Step" — a deliberate second way to "freeze to read."
- **Shared-origin connector:** video and audio grains spawned by the same
  producer in the same tick carry the identical `originTs` (confirmed by
  walking `grainFlow.ts`'s wave-injection loop — see the item #9 D0
  investigation). `writeFlashes` entries are grouped by `${fromId}|${originTs}`;
  a group with 2+ members (distinct `streamIndex`) renders a short connector
  line between their write-flash points (`.grain-sibling-link`), and the
  latest pair is shown in a fixed chip at the top of the canvas
  (`.shared-origin-chip` in `GrainOverlay.css`) — `shared origin · V#<idx> ·
  A#<idx>` plus a one-line note that video (~20ms) and audio (~1ms) grains
  differ in size, so the same instant has different indices. The chip replaced
  a midpoint label that overlapped the "writing #" flashes. Makes the "one clock, two units" relationship visible
  rather than only inferable from two separately-ticking tags.
- **Readability pass (user feedback round):** three follow-on fixes, all in
  `GrainOverlay.tsx`/`.css`:
  - Origin tags anchor **above the node's top edge** (`TAG_ABOVE_NODE_PX`,
    offset from `geometry.get(grain.fromId)`, not the grain dot's own
    position) instead of wherever the grain happens to be parked — a parked
    grain's dot sits right at the handle where its edge connects to the box,
    which collided with incoming lines. The offset (48px) is deliberately
    large enough to also clear `.mf-node__stalled-badge`
    (`MediaFunctionNode.css`), which already occupies the `top: -24px` band.
  - Tags are now **one-per-node-per-stream** (the most recent grain, keyed
    by `${fromId}|streamClass}` via a `latestByKey` pass over `grains`),
    stacked vertically (`TAG_STACK_GAP_PX`, video closest to the box, audio
    above it) rather than one per grain id. Busy nodes — Egress in
    particular, where audio commonly parks waiting on its sibling video
    grain — would otherwise accumulate a stack of overlapping tags from
    every grain that had ever held there. `RetainedTag.grainId` detects when
    a new grain takes over a node+stream slot and restarts that slot's
    `firstShownAt` guaranteed-visible window.
  - The "writing #idx" flash label got a solid opaque background chip
    (`background: #ee0000`, white text) instead of bare colored text —
    plain text directly over an edge line/handle was unreadable regardless
    of color.

## Scenario 4 — A/V Sync Overrun

A single **Ingress Function** writes flows V1 (video) and A1 (audio) sharing
a timestamp origin. Video is processed twice (V1 → V1a → V1b, 82ms total),
audio once (A1 → A1a, 2ms). The **Egress Function** must re-pair them by
reading the same *point in time* from both (video and audio keep their own
per-track grain index for that instant — see "Per-track grain rate" above);
by the time the slow video branch publishes that instant, the audio flow
(only 2ms behind real time) has moved 80ms past it and recycled that slot.
In the scenario's 100ms domain, both tracks retain the same ~60ms of usable
history (`WRITER_RESERVED_MS` pins the writer-reserved safety margin to a
fixed *time* budget, re-derived into each track's own grain count, so the
reserved margin stays worth the same real time for fine-grained audio as for
video — see Known Simplifications), so the audio input goes TOO_LATE while
video stays OK. Verified fixes: grow the domain to 110ms, delete the Slow
Video Function and reconnect, insert a Grain Repeater in the audio branch, or drag
the Slow Video Function's latency slider down.

## Scenarios page and persistence

- `src/game/scenarios.ts` holds the built-in scenario catalogue and graphs. `src/game/scenarioStorage.ts` persists to localStorage: user-saved scenarios (`dmf-sync-viz:scenarios:v1`; nodes, edges, domain size, name, description) and the autosaved working graph (`dmf-sync-viz:working:v1`, restored on load).
- `ScenariosPage` is a full-screen overlay at hash route `#/scenarios` (opened from the HUD); the canvas stays mounted underneath. Saving with an existing name replaces that scenario.

## Scenario 5 — Many Readers, One Writer

One Ingress Function writes a single video flow (V1) that five functions
read: a recorder and two branch functions at the head, and two mixers that
also read V1 on a second input. Each mixer must wait for its slower branch
(25ms / 50ms), so it requests an older grain of V1 than the others. The
Ingress's ring and the telemetry panel's `WriterRing` show all five readers,
which is the intended way to compare readers at different points in time.
Its Egress takes two video mixes on both inputs, which the per-input track
rule would not allow if rewired.

## Scenario 6 — Blank Canvas

An empty 100ms domain to build on from the palette.

## Known simplifications

- Clock is not a PTP/TAI implementation. The sim clock starts at a fixed
  example offset (`TAI_EPOCH_OFFSET_MS` in `mxlGrainIndex.ts`, a whole number
  of video ticks and ring windows) so grain indices and the `ClockStrip`'s
  "TAI ns since SMPTE epoch" read like real values; it is not a real TAI
  reading.
- The shared simulated clock (`useSimClock.ts`, item #9) that drives all
  timing-dependent engines can be slowed (Stepping) or frozen/single-stepped
  (Manual) for teaching purposes — a deliberate departure from MXL's true
  wall-clock-derived grain indexing, which is always derived from real
  elapsed PTP/TAI time and never slowed or paused.
- A Profanity Delay re-writes its media as a new source (see "Canvas editing
  and ring buffer blocks"); this is the only place a flow's grain index is
  not preserved.
- A mixer input set to "live" is modelled as reading one grain behind the write
  head with no wait. In MXL a reader may ask for any index up to
  `runtime.headIndex` (`PosixDiscreteFlowReader::getGrainImpl`), and the head
  grain is readable once its slices are committed, so one grain behind is
  conservative for whole-grain writes (it is exact while a grain is still being
  written in slices).
- In MXL every input of a function can be live (no sync group at all). Here at
  least one input stays synced when all are set to live, because the function
  needs one timestamp to decide which grain index it writes. The pills still
  show "live" for those inputs.
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
  existing scenarios' pass/fail balance consistent across video's coarse and
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
  `README.md` and `TO-DO.md` to match.

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
- Only one tick runner (`useGameLoop.ts`) — do not introduce a
  second independent tick loop in components.

## Branding

- Red Radio-Canada (accent) `#EE0000`
- Grey (secondary text) `#757575`
- Black (normal text) `#000000`

Fonts live in `public/fonts/` (loaded by `src/index.css`). A slide-deck theme
from another project (`assets/theme.css`) was removed from this repo; do not
reintroduce it.
