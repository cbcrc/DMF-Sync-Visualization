# MXL Ring Buffer Simulator & Educational Game

## Why this exists

An interactive, browser-based simulator that teaches engineers how ring
buffers and signal timing work inside a Media eXchange Layer (MXL) Dynamic
Media Facility (EBU reference: https://github.com/dmf-mxl/mxl). Players wire
Media Function nodes between an Ingress and an Egress and watch, in real
time, how a flow's grain index is preserved through processing while its
published head lags — and how that can cause a faster sibling flow's grain to
be overwritten before a sync point can read it ("too late"). The goal is to
build an intuition for MXL timing that's hard to get from documentation
alone: latency by itself is harmless; it's the *differential* latency between
flows that must be re-paired that destroys data.

## Getting started (first time)

```bash
npm install
npm run dev
```

This starts the Vite dev server. Open the URL it prints — by default:

```
http://localhost:5173/
```

Other commands:

```bash
npm run build     # type-check + production build
npm run lint      # eslint
```

Requires Node 18 (do not upgrade Vite/tooling to a version requiring Node ≥20
without checking first — see `AI_RULES.md`).

## Future development

1. ~~Visualize the Egress "parking" signal while a flow waits for its sibling
   to arrive before both are released together.~~ **Done.** Parked grains
   (e.g. video + audio waiting at Egress) used to both render at the node's
   dead center, stacking exactly on top of each other. `getGrainPosition`
   (`grainFlow.ts`) now keeps a parked grain close to the real per-input
   handle position where its edge connects to the node (instead of drifting
   toward center), so it's obvious which input is being made to wait, and
   every waiting sibling is clearly visible at once. The Ring Buffer
   Telemetry panel's matching reader row (and, for audio, its read marker)
   now pulses in sync while that grain is parked, so the canvas and the
   telemetry panel read as one correlated "waiting" event instead of two
   disconnected visuals.
2. Visualize packet pacing as flows leave the Egress function. **In progress — further refinement needed** (implemented with 2.b below, not yet signed off). The production workload's boundaries are the Ingress and Egress: outside them the world is linear and synchronous; inside, MXL is asynchronous and passes grains as fast as it can. `LinearBoundaryOverlay.tsx` draws a steady tick-train leaving the Egress, with a video lane (one tick per frame) and an audio lane (fine 1ms grains, drawn as a continuous band with the frame boundaries marked). Both flow left to right. Ticks are spaced 24 video frames (480ms, `LINEAR_TICK_MS` in `grainFlow.ts`) apart: real 20ms ticks sit too close to a screen's refresh interval and visually alias into backwards motion, so each drawn tick stands for one frame at a human-followable cadence. While one input's grain is parked at the Egress, its lane shows a hatched "arrived — waiting for V" state and the readout says the Egress waits for the slow video input before reading anything, then reads both together. Output tick *n* is emitted at `n × grain duration + aligned read lag + Egress latency`, so the wire cadence stays even however unevenly MXL delivered. The live read-slot/write-head readout was removed (it duplicated the Egress node's ring buffer boxes); only a short "evenly paced" note remains, and a TOO_LATE track shows as a red dropout lane on the wire.
   - **2.b.** Visualize linear flows arriving at the Ingress. **In progress — further refinement needed.** Mirror image on the Ingress's left edge: evenly paced video and audio ticks with a "jitter 0.0ms" readout, flowing left to right into the node. A tick reaching the Ingress is what triggers the MXL flow: the next wave's grains are spawned exactly when a tick arrives (`grainFlow.ts` gates spawning on tick boundaries and stamps `originTs` with it) and the lanes flash at the node edge.
   - Known simplification: the grain-flow simulation is wave-based (one grain per flow per wave, started only on a linear tick), so only some ticks trigger a visible MXL flow rather than a continuous async stream.
   - Open refinement: tick speed/cadence and the Egress "waiting for video" visual were tuned by feel and haven't been verified visually in a browser; revisit both.
3. Clean up/simplify the side panel information density.
4. Visualize player/recorder Media Function interact with MXL grains converted into TAMS chunks and visa versa ( reference https://github.com/bbc/tams.git )
5. Ability to delete media functions from th workflow diagrams by right clicking or selecting and pressing delete
6. Ability to undo a change to the diagram
7. Add links to the Licences types in the SBOM to allow the reader to understand excatly what each licens means
8. ~~Audio and Video is treated diffrent in MXL - We must represent the audio ring buffers more accurately.~~ **Done** — see item 10 below.
9. ~~Slow down the animation. have three modes - Stepping mode and manual next step mode~~ **Done.** A single shared simulated clock (`useSimClock.ts`) now drives every timing-dependent engine — grain-flow travel/hold (`grainFlow.ts`/`useGrainFlow.ts`), ring buffer evaluation and the stability fail-timer (`useGameLoop.ts`), and the origin-timestamp overlay (`GrainOverlay.tsx`) — instead of each reading `performance.now()`/`Date.now()` independently. A new HUD control (3-way Normal/Stepping/Manual switch) lets a player pick the pace:
      - **Normal** — advances 1:1 with real time (today's default behavior).
      - **Stepping** — auto-advances at 20% speed so fast grains are easier to follow by eye.
      - **Manual** — frozen; a "Step ▶" button (visible only in this mode) nudges the clock forward by exactly one video grain's duration, letting a player advance one grain index at a time.
      The stability (Red-zone) fail-timer now measures actual *simulated* elapsed time rather than a fixed real-time tick, so a node frozen on screen in Stepping/Manual mode doesn't silently rack up real-time toward the 3s fail condition in the background. Known simplification (see `AI_RULES.md`): this is a pedagogical clock, a deliberate departure from MXL's true wall-clock-derived grain indexing, which is never slowed or paused.
      - **Follow-up:** slowing the animation down made a pre-existing visual inaccuracy obvious — edges used to take 350ms+ to "travel" (scaling with on-screen edge length), implying meaningful wire-transit latency that doesn't exist in real MXL (writing into a node's output ring buffer and the next node reading it is effectively instantaneous; shared memory, not a wire). Fixed: edge travel is now a near-instant ~1ms hop, and the edge's drawn path instead pulses briefly (300ms) the moment a grain embarks on it — visualizing "the downstream Media Function just read from the upstream node's output ring buffer" without implying transit time. A node's `hold` phase (scaled by its own processing latency) remains the only thing that visually represents real added latency. See `useGrainFlow.ts`'s `edgeActivity` and `FlowCanvas.css`'s `.edge-pulse-active`.
10. ~~Visualisation of grains and alignment Improvements~~ **Done.** Broken into sub-deliverables D0–D4, all implemented and verified (lint + build clean); see `AI_RULES.md`'s "Grain-flow visualization" section for full details:
      - **i.** Audio flows now use their own, much finer grain rate than video (`mxlGrainIndex.ts`'s `AUDIO_GRAIN_RATE`, 1ms grains vs. video's 20ms), resolved per-input by walking the graph back to each flow's originating producer (`graphLatency.ts`'s `trackForEdge`). Audio inputs get a dedicated, slot-free visualization (`ContinuousBufferTrack.tsx`) modelling MXL's Continuous ring buffer, instead of reusing video's discrete grain-slot strip/ring. At true A/V sync points, the audio strip highlights the exact slice of its fine grains that aligns to the video grain being read at that instant.
      - **ii.** Each grain carries a real `originTs` (`Date.now()`-based capture timestamp). A HUD toggle ("Show origin timestamps") tags every grain with its MXL grain index + age, and flashes a "writing #index" pulse at the moment a node publishes a grain to its output ring buffer.
      - **iii.** The same toggle shows a `ref #<idx> kept` badge on a processing node while it holds a grain, proving the origin index/time reference is preserved through processing, not re-stamped.
      - Known simplification (intentionally not modeled — see `AI_RULES.md`): MXL's true Continuous ring buffer (per-sample, half-buffer writer/reader split) is approximated as a very fine-grained Discrete buffer; a literal Continuous implementation remains a possible future deliverable (D5) if deeper fidelity is wanted.
11. ~~Clean up the origin timestamp mechanism. - the current setup is nice, but moves too fast for the huma to read.~~ **Done.** The raw MXL grain index was a giant epoch-scaled number and the age counter repainted every ~40ms tick — both made it unreadable. Now shows the small `RingBufferIndex` (grain index mod ring length) by default, with a nested HUD toggle ("Use real MXL index") to reveal the raw epoch index once a player understands the small one; the age counter rounds to 100ms steps; and tags linger, fading out over ~220ms at their last known spot instead of vanishing the instant a fast grain's travel/hold ends. See `AI_RULES.md`'s "Grain-flow visualization" section.
12. ~~Improve visualization of the time index.~~ **Done.** MXL has exactly one
    shared clock (the PTP/TAI epoch per `docs/Timing.md`): a video grain and
    an audio grain captured at the same instant carry the same origin
    timestamp, but each track's `GrainIndex` is that one shared timestamp
    divided by its own `GrainDurationNs` — so video and audio indices
    legitimately diverge in magnitude even though the underlying clock is
    identical. Fixed in two parts:
      - **Shared-origin connector:** when Ingress spawns a video grain and an audio grain in the same instant, a brief connector line now appears between their "writing" flash points, and a fixed chip at the top of the canvas (`shared origin · V#<idx> · A#<idx>`, pulsing on each new pair) explains that the same instant gets different indices because video (~20ms) and audio (~1ms) grains differ in size — makes the shared instant visible instead of only implied by two separately-ticking tags.
      - **Freeze-to-read flashes:** item #9's edge-travel fix (near-instant ~1ms hops) had an unintended side effect — every origin-timestamp tag and "writing" flash was tied to a specific grain object that, with travel now near-instant, only existed in the live grain list for a single ~40ms tick, making them barely visible in Normal/Stepping mode. Flashes are now event-based (recorded once, independent of the underlying grain object's lifetime) and guaranteed at least 700ms of full visibility before a 300ms fade-out, regardless of how briefly the real simulated event lasted. In Manual mode the whole simulated clock is already frozen (see item #9), so these stay fully visible indefinitely until the player clicks "Step." See `AI_RULES.md`'s "Grain-flow visualization" section.
13. ~~Show the read head one grain behind the write head.~~ **Done.** Per MXL, a reader cannot read a grain while it is still being written, so the requested grain index is now `publishedGrainIndex − 1 − lag` (`READ_BEHIND_WRITE_GRAINS` in `ringBufferEngine.ts`, applied in `graphLatency.ts`). A zero-lag read lands on the last completed grain, one behind W, in the slot strip, ring dial, and audio continuous track (marker offset by one grain). Status thresholds (TOO_EARLY/OK/TOO_LATE) are unchanged: a request for the grain currently being written is TOO_EARLY.
14. ~~Remove the "MF" abbreviation for Media Functions and use "Function" instead ("MF" can read as vulgar in the wrong context).~~ **Done.** Default node labels (e.g. "Fast Video Function", "Slow Video Function", "Ultra-Fast Audio Function"), level text in `levels.ts`, and `AI_RULES.md` no longer use "MF"; the full name "Media Function" is unchanged.

## Bugs & Status
- [x] **Fixed:** When the ring buffer is overrun, the animation completely stops and the user needs to refresh the page. (Fixed: surviving sibling flow enters a stalled alert state with a pulsing red hazard ring and a `Sync Stalled` badge; unfreezes automatically upon slider/domain tuning or via the `Restart Wave` / `Reset` HUD buttons).
- [ ] When refreshing the page, any new media functions that are added disappears
- [ ] The aggregated latency math between all media functions does not add up properly and an upstream media function does not cause an overrun of the ring buffer.

## Reference docs

- `Initial_prompt.md` — full product/domain specification
- `AI_RULES.md` — coding conventions, architecture, and current project status
- `SBOM.md` — open-source dependencies and licenses
