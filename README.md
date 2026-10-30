# DMF Latency & Sync Visualizer

## Why this exists

An interactive, browser-based tool for visualizing and testing the latency and
synchronization concepts being explored by the
[AMWA JT-DMF](https://specs.amwa.tv/in-index/) working group, building on the EBU's
[Dynamic Media Facility (DMF)](https://tech.ebu.ch/dmf/ra) reference architecture.

This is an exploratory aid, not a specification. The normative documents are
published by AMWA, and they are still being written. To follow their progress,
see the [AMWA Increment index](https://specs.amwa.tv/in-index/), or read the
sources of the ones this tool leans on most:

- [IN-002: Time and Identity in the Dynamic Media Facility](https://github.com/AMWA-TV/in-002): principles and rules for time alignment and stable media identity.
- [IN-005: \[Timing\] Principles of External Signal Ingress for DMF Media Workloads](https://github.com/AMWA-TV/in-005): how external signals are ingested and conformed into time-aligned flows (work in progress).

A DMF has linear, synchronous boundaries (Ingress and Egress) around an
asynchronous domain, and inside that asynchronous domain behaviour follows
the Media eXchange Layer (MXL; normative source: https://github.com/dmf-mxl/mxl).

**Version 0.2.261030** — the same functionality as 0.2 (per-writer ring buffers with reader pointers, a many-readers scenario, a blank canvas to build on, and saved scenarios), with reworked layouts: a grouped "Add media function" palette, a Profanity Delay, per-input sync/live on mixers, an end-to-end timeline, and a clock panel that shows ring buffers for the selected function. Versions are `0.2.YYMMDD`.

### How It Works
Users wire Media Function nodes between an Ingress and an Egress and watch, in real
time, how media flows (grains) move through the workflow: a flow's grain
index is preserved through processing while its published head lags, and
that differential lag can cause a faster sibling flow's grain to be
overwritten before a sync point can read it ("too late"). The goal is to
isolate where latency builds up and where overruns can happen, building an
intuition for DMF/MXL timing that's hard to get from documentation alone:
latency by itself is harmless; it's the *differential* latency between flows
that must be re-paired that destroys data.

This tool models a DMF; it is not MXL. Inside the asynchronous domain it must
follow MXL: where this repo and
[dmf-mxl/mxl](https://github.com/dmf-mxl/mxl) disagree, dmf-mxl/mxl is
correct.

### Basic Definitions
![Unofficial Definitions](assets/images/Definition_Block_Diagram.png)
*Figure 1: The unoffical DMF definitions*

### Using the canvas

- Add functions from the **Add media function** palette, grouped into Sources, Synthetic (CG, Clip Player, Tone Generator), Technical (Colour Corrector, Multiview, Repeater, Audio Processor), Editorial (mixers, Profanity Delay) and Outputs. Each group also has a "Generic" function that stands in for anything, and you drag between handles to connect them.
- Every media function carries its own ring buffers, drawn as part of its block. The function writes into them whether or not anything reads. Each reader appears as a pointer showing how far behind the write head it reads; click a pointer or a function to highlight that reader's link.
- Inputs and Outputs can be video only, audio only or both. Audio readers read only audio and video readers only video. An input takes one link (drop a new one on it to replace it).
- The toolbar has **Undo** (also Ctrl/Cmd+Z) and **Now**, which shows how far behind real time each writer is.
- Select a function and use **Copy** / **Paste** (Ctrl/Cmd+C, Ctrl/Cmd+V) to duplicate it; the copy takes the next free number in its name.
- In **Manual** playback, **Step ▶** moves one grain forward and **◀ Back** undoes the last step.
- New functions are added at the centre of the current view.
- The **End-to-end timeline** along the bottom has one lane per output, running from the input to the output. Each block is a media function whose width is the latency it adds, and its caret marks where it reads from (how far behind now). Hatched gaps are time spent waiting for sync. Close it with ×. It doesn't use the Origin Time Stamp (OTS) carried on the linear side yet. Its model already has an OTS lead-in field (`leadInMs` in `src/game/endToEndTimeline.ts`) for when that is added.
- Scenario 6, "Blank Canvas", starts empty. The Scenarios page (`#/scenarios`) saves and reopens your own.

## Getting started after cloning this repo

```bash
git submodule update --init   # fetches the MXL reference copy (or clone with --recurse-submodules)
npm install
npm run dev
```

The MXL repo is included as a git submodule at `reference/mxl`, pinned to the
commit this tool was last checked against. It is reference material only and is
not part of the build. To move it forward, run `git -C reference/mxl pull`
and commit the new pointer.

This starts the Vite dev server. Open the URL it prints — by default:

```
http://localhost:5173/
```

Other commands:

```bash
npm run build     # type-check + production build
npm run lint      # eslint
npm test          # vitest
```

Requires Node 18 (do not upgrade Vite/tooling to a version requiring Node ≥20
without checking first — see `AI_RULES.md`).

## Reference docs

- [AMWA Increment index](https://specs.amwa.tv/in-index/), [IN-002](https://github.com/AMWA-TV/in-002), [IN-005](https://github.com/AMWA-TV/in-005) and [dmf-mxl/mxl](https://github.com/dmf-mxl/mxl) — the external documentation this tool follows
- `SPEC.md` — domain specification (how this tool models MXL)
- `AI_RULES.md` — coding conventions, architecture, and current project status
- `SBOM.md` — open-source dependencies and licenses
- `TO-DO.md` — feature backlog and known bugs
