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

1. Visualize the Egress "parking" signal while a flow waits for its sibling
   to arrive before both are released together.
      - Both grains need to be distinctly visible - not one on top of the other
2. Visualize packet pacing as flows leave the Egress function.
3. Clean up/simplify the side panel information density.
4. Visualize player/recorder Media Function interact with MXL grains converted into TAMS chunks and visa versa ( reference https://github.com/bbc/tams.git )
5. Ability to delete media functions from th workflow diagrams by right clicking or selecting and pressing delete
6. Ability to undo a change to the diagram
7. Add links to the Licences types in the SBOM to allow the reader to understand excatly what each licens means
8. Audio and Video is treated diffrent in MXL - We must represent the audio ring buffers more accurately.
9. Slow down the animation. have three modes - Stepping mode and manual next step mode
10. Visualisation of grains and alignment Improvements
   Priority - We must remain true to the behaviour of the latest version of https://github.com/dmf-mxl/mxl.git
      i. The audio grains cannot be the same size as video grains - We must represent them as smaller samples compliant to the MXL repo. When aligning audio to video we could highlight the section of audio that relates to the video when they are meant to be syncronized
      ii. how can we visualizes better the Origin timestamp as it flows through the workload? (can we leverage MXL Get Time and MXL Get Index for clues? idea: Highlight the line to show writing then use grain slots to show index now and must find way to show offset from tnow)
      iii. Goal is to show that the grain time reference does not change. When a media function creates a new media, it will continue to reference the time index as it creates the new grain of media. 


## Bugs & Status
- [x] **Fixed:** When the ring buffer is overrun, the animation completely stops and the user needs to refresh the page. (Fixed: surviving sibling flow enters a stalled alert state with a pulsing red hazard ring and a `Sync Stalled` badge; unfreezes automatically upon slider/domain tuning or via the `Restart Wave` / `Reset` HUD buttons).
- [ ] When refreshing the page, any new media functions that are added disappears
- [ ] The aggregated latency math between all media functions does not add up properly and an upstream media function does not cause an overrun of the ring buffer.

## Reference docs

- `Initial_prompt.md` — full product/domain specification
- `AI_RULES.md` — coding conventions, architecture, and current project status
- `SBOM.md` — open-source dependencies and licenses
