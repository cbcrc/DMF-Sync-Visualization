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
9. Slow down the animation. have three modes - Stepping mode and manual next step mode
10. ~~Visualisation of grains and alignment Improvements~~ **Done.** Broken into sub-deliverables D0–D4, all implemented and verified (lint + build clean); see `AI_RULES.md`'s "Grain-flow visualization" section for full details:
      - **i.** Audio flows now use their own, much finer grain rate than video (`mxlGrainIndex.ts`'s `AUDIO_GRAIN_RATE`, 1ms grains vs. video's 20ms), resolved per-input by walking the graph back to each flow's originating producer (`graphLatency.ts`'s `trackForEdge`). Audio inputs get a dedicated, slot-free visualization (`ContinuousBufferTrack.tsx`) modelling MXL's Continuous ring buffer, instead of reusing video's discrete grain-slot strip/ring. At true A/V sync points, the audio strip highlights the exact slice of its fine grains that aligns to the video grain being read at that instant.
      - **ii.** Each grain carries a real `originTs` (`Date.now()`-based capture timestamp). A HUD toggle ("Show origin timestamps") tags every grain with its MXL grain index + age, and flashes a "writing #index" pulse at the moment a node publishes a grain to its output ring buffer.
      - **iii.** The same toggle shows a `ref #<idx> kept` badge on a processing node while it holds a grain, proving the origin index/time reference is preserved through processing, not re-stamped.
      - Known simplification (intentionally not modeled — see `AI_RULES.md`): MXL's true Continuous ring buffer (per-sample, half-buffer writer/reader split) is approximated as a very fine-grained Discrete buffer; a literal Continuous implementation remains a possible future deliverable (D5) if deeper fidelity is wanted.
11. Clean up the origin timestamp mechanism. - the current setup is nice, but moves too fast for the huma to read. 


## Bugs & Status
- [x] **Fixed:** When the ring buffer is overrun, the animation completely stops and the user needs to refresh the page. (Fixed: surviving sibling flow enters a stalled alert state with a pulsing red hazard ring and a `Sync Stalled` badge; unfreezes automatically upon slider/domain tuning or via the `Restart Wave` / `Reset` HUD buttons).
- [ ] When refreshing the page, any new media functions that are added disappears
- [ ] The aggregated latency math between all media functions does not add up properly and an upstream media function does not cause an overrun of the ring buffer.

## Reference docs

- `Initial_prompt.md` — full product/domain specification
- `AI_RULES.md` — coding conventions, architecture, and current project status
- `SBOM.md` — open-source dependencies and licenses
