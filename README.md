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

Recent interface work: Light and Dark themes, minimizable and collapsible dockable panes under a full-width top toolbar, a Workload Config (domain size, frame rate, resolution, audio sample rate), a separate Animation Playback pane, per-function sync groups (sync A, sync B, live) on mixers, and reader tags (R1, R2…) on inputs.

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

### Quick start

1. Open a scenario from **Canvas ▾** (or pick Blank Canvas), or add functions from the **Add Function** pane and drag between handles to wire them.
2. Click a function. Its rings appear in the **Ring Buffers** pane, and its readers are tagged **R1**, **R2**… on the inputs.
3. Press **Step ▶** in the **Playback** pane to advance one grain, or switch to Stepping or Normal to let it run.
4. Change a function's latency (slider) and watch which readers go orange-translucent (too early, waiting) or dark red (too late ✕).
5. Set the domain size, video rate and audio sample rate under **Workload Config ▾**.

### Toolbar and panes

- The top bar has the editing tools on the left (**Toolbar**: Canvas ▾, Workload Config ▾, Undo, Copy/Paste, **Show Now**, light/dark toggle) and the pane buttons on the right (**Pane View**).
- Panes: Add Function, Playback, Status, Clock, Ring Buffers, Timeline and Help. A pane button toggles it; **–** minimizes it.
- Each pane has a header bar: drag the ⠿ grip to reorder it or move it to another dock, or click ◧ ⬓ ◨ to dock it left, bottom or right. Docked panes never overlap the canvas.
- Each dock has a chevron to collapse it into a rail of pane names (click a name to expand). **Hide Panes** collapses them all. Collapsing keeps your layout.
- Docks, pane order, collapsed docks, minimized panes and the theme are saved in your browser. **Reset Layout** restores the defaults.

### Animation playback

- **Manual** (default): time only moves when you press **Step ▶** (one grain). **◀ Back** undoes the last step.
- **Stepping**: runs automatically at 0.2× speed so grains visibly crawl.
- **Normal**: runs in real time.
- **Grain index**: *Simplified* counts from 100. *TAI Time* shows the last digits of the real MXL index (TAI time ÷ grain duration).

### Using the canvas

- Palette groups: Sources, Synthetic, Technical, Editorial (mixers, Profanity Delay) and Outputs. Each group also has a "Generic" function. New functions appear at the centre of the view.
- Every function carries its own ring buffers and writes to them whether or not anything reads. Each reader is a pointer (R1, R2…) showing how far behind the **head** (MXL's `headIndex`, the latest committed grain) it reads. The circular ring and the canvas strip use the same markers. Click a pointer or function to highlight that link.
- Inputs and Outputs can be video, audio or both. An input takes one link (drop a new one on it to replace it).
- On a mixer, each input is **sync A**, **sync B** or **live**. Inputs in a group read the same index, set by the slowest, and release together. A live input reads at the head and never waits.
- Audio is drawn as a continuous ring (MXL audio is samples, not slots; the 1 ms units are a simplification). A reader synced to video shows a blue window and blue video-grain ticks. MXL aligns audio and video by timestamp, so those ticks are a visual aid.
- **Show Now** draws wall-clock now beside each head, to show how far behind the writer is.
- **Copy** / **Paste** (Ctrl/Cmd+C, Ctrl/Cmd+V) duplicates a selected function. **Undo** is Ctrl/Cmd+Z.
- **Canvas ▾** also holds saved scenarios, "Save canvas as scenario…" and the grain origin tags option. The Scenarios page is `#/scenarios`.
- The **Timeline** has one lane per output. Each block is a function whose width is the latency it adds, and its caret marks where it reads from. Hatched gaps are time spent waiting for sync. It doesn't use the Origin Time Stamp (OTS) yet; its model has a `leadInMs` field for when that is added (`src/game/endToEndTimeline.ts`).

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
