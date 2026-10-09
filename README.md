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
2. Visualize packet pacing as flows leave the Egress function.
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
12. Improve visualization of the time index. MXL has exactly one shared clock
    (the PTP/TAI epoch per `docs/Timing.md`): a video grain and an audio grain
    captured at the same instant carry the same origin timestamp, but each
    track's `GrainIndex` is that one shared timestamp divided by its own
    `GrainDurationNs` — so video and audio indices legitimately diverge in
    magnitude even though the underlying clock is identical. Right now the
    on-canvas tags show each track's index side by side with no visual cue
    that they trace back to one shared instant, which reads as "two
    different time contexts" rather than "one clock, two units." Make that
    relationship visible — e.g. surface the shared origin timestamp
    alongside each track's derived index, or otherwise link paired
    video/audio grains at Ingress so a player can see them collapse to the
    same instant.
13. show end-to-end workload latency - Possible bar at the top, possible window next to the egress points that reads "Time from ingress is x" - Please offer other scenarios. 

## Bugs & Status
- [x] **Fixed:** When the ring buffer is overrun, the animation completely stops and the user needs to refresh the page. (Fixed: surviving sibling flow enters a stalled alert state with a pulsing red hazard ring and a `Sync Stalled` badge; unfreezes automatically upon slider/domain tuning or via the `Restart Wave` / `Reset` HUD buttons).
- [ ] When refreshing the page, any new media functions that are added disappears
- [ ] The aggregated latency math between all media functions does not add up properly and an upstream media function does not cause an overrun of the ring buffer.

## Reference docs

- `Initial_prompt.md` — full product/domain specification
- `AI_RULES.md` — coding conventions, architecture, and current project status
- `SBOM.md` — open-source dependencies and licenses
