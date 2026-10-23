# Specification: DMF Latency & Sync Visualizer

> **Authority:** this tool is for testing and working with latencies in the
> EBU's Dynamic Media Facility (DMF). Behaviour in the DMF's asynchronous
> domain follows MXL, and the [dmf-mxl/mxl](https://github.com/dmf-mxl/mxl)
> repository (https://github.com/dmf-mxl/mxl.git) is the normative reference
> for it (grain model, ring buffers, timing, flow semantics). This document
> describes how this tool models a DMF; it never overrides MXL. When this
> document, `AI_RULES.md`, or the code disagree with dmf-mxl/mxl, dmf-mxl/mxl
> wins — and any deliberate departure must be recorded as a known
> simplification in `AI_RULES.md`.

## 1. Project Overview & Context
A browser-based interactive visualization tool for testing and working with latency and synchronization in the EBU's **Dynamic Media Facility (DMF)**. A DMF has linear, synchronous boundaries (Ingress and Egress); inside them, the asynchronous domain follows the **Media eXchange Layer (MXL)** (https://github.com/dmf-mxl/mxl.git). The tool shows how media flows (grains) move through Media Functions and ring buffers, so a user can see where latency builds up and where overruns (reads that arrive too late) can occur. It is an analysis and teaching aid, not a game: there are no scores, levels to beat, or win/lose states.

### Core Objective
The user composes a media workflow by connecting Media Functions between an Ingress and an Egress, tunes each function's processing latency and the MXL Domain size, and watches the resulting flow. The tool lets the user:
* See how media flows through the workflow and how latency accumulates along each path.
* Isolate where latency builds up, and where a ring buffer overrun (too-late read) or wait (too-early read) arises, and why.
* Experiment with mitigations (shorter paths, a larger Domain, Grain Repeaters) and see their effect immediately.

---

## 2. Core Domain Concepts & Mechanics

### A. MXL Domain Ring Buffer
* **Configurable Buffer Size ($T_{domain}$):** User selectable (Default: `100ms`, Range: `10ms` to `1000ms`).
* **Circular Timeline:** Represents a sliding window of discrete MXL grains.
* **Grain Duration:** Derived from the rational grain rate:
  `GrainDurationNs = denominator * 1e9 / numerator`.
* **Timestamp and Grain Index:** An absolute timestamp is converted to
  `GrainIndex = floor(Timestamp / GrainDuration)`.
* **Physical Slot:** `RingBufferIndex = GrainIndex mod RingBufferLength`.
* **Published Head:** The writer publishes a timestamp/grain index. A reader
  requests its own absolute timestamp/grain index; the UI also keeps the
  millisecond latency view for teaching.
* **Timing Boundaries:**
  * **Reading Too Early:** requested grain index is greater than the published head (attempting to read unwritten/future data). The reader waits.
  * **Reading Too Late (Overflow / Overrun):** requested grain is older than retained history. Account for MXL's writer-reserved boundary as roughly `published head - grainCount + 2`. Display in **Red**; the requested data is lost.
* **Preserved Grain Indices (implementation note):** a media function that reads
  grain T writes its processed result back as grain T. Processing never renumbers
  grains — it only makes a flow's published head *lag* real time by the path's
  accumulated latency. It follows that a purely serial chain can never read too
  late; too-late reads arise only at **sync points**, on the *faster* input, whose
  grain ages off the back of the ring while it waits for a slower sibling branch.
  Ring buffer state is therefore evaluated **per input edge**, not per node.

### B. Media Function Types & Node Latencies
Media functions process grains and introduce processing delay ($\Delta t_{proc}$). Visual node size scales proportionally to its processing latency.

1. **Synthetic Media Functions:**
   * *Role:* Pure producers (no MXL inputs). Generates new signals.
2. **Editorial Transformation Functions:**
   * *Role:* Multi-source/complex processors (e.g., Video Switchers, Mixers, AI Super-res).
   * *Latency:* High ($\Delta t_{proc} = 20\text{ms} - 50\text{ms}$). Outputs create a new source in the domain.
3. **Technical Media Functions:**
   * *Role:* Single-input minor processors (e.g., Color Correctors, EQ, Format Converters).
   * *Latency:* Low ($\Delta t_{proc} = 2\text{ms} - 10\text{ms}$).
4. **Recording Media Functions:**
   * *Role:* Pure consumers/readers. Records signals to disk.
5. **Grain Repeaters (Artificial Buffer Nodes):**
   * *Role:* Special utility node inserted by the user when a read head is about to overrun (turn Red). Repeats MXL grains into a brand-new sub-ring buffer. Low latency penalty, resets the boundary limit.
   * *Implementation note:* a repeater cannot un-delay a signal, so it adds its
     latency like any other node. What it "resets" is **capacity**: its sub-ring
     buffer adds another domain window of retained history to that branch.

### C. Multi-Input & Multi-Output Behaviors
* **Multi-Input Nodes (e.g., Video Switcher, Audio Mixer):** Multiple read heads ($R_1, R_2$). Must align incoming streams before processing.
* **Multi-Output Nodes:**
  * *Synced Timing Context:* (e.g., Program / Preview). Outputs share the exact same write time.
  * *Independent Timing Context:* (e.g., Program / Mix-Minus). Mix-Minus bypasses sync delays to output as fast as possible; Program waits for video alignment.

### D. Synchronization Groups (Sync Groups)
* **Definition:** A grouping mechanism for multiple signals (e.g., Audio + Video) that must arrive aligned at a common node or output.
* **Alignment Constraint:** Low-latency signals (e.g., Audio: 2ms) inside a Sync Group with high-latency signals (e.g., Video: 33ms) MUST be artificially delayed to match the highest-latency signal in the group.
* **Risk:** Artificially delaying a stream to maintain sync pushes its Read Head ($R$) closer to the back edge of the Ring Buffer ($W - T_{domain}$), risking an overrun (Red state).

---

## 3. Visual UI & Read Head Representation Mechanics

### The Ring Buffer Gauge Component
For every active consumer node/reader, render an interactive **Circular Gauge** or **Linear Track** representing the MXL Domain Ring Buffer:
1. **Green Zone (Optimal):** Reader is safely behind the Write head ($0.2 \times T_{domain} < W - R < 0.8 \times T_{domain}$).
2. **Yellow Zone (Near Underflow):** Reader is too close to the Write head ($W - R < 0.2 \times T_{domain}$). Show a "Waiting..." badge.
3. **Red Zone (Too late / Overrun):** Reader fell older than the retained history. Highlight node in **Red** with pulsing hazard state.

### Telemetry Readouts
* **Total Workload Latency:** End-to-end time from input capture to output presentation.
* **Absorbed Latency / Stability Margin:** How much buffer margin remains across all Sync Groups before an overrun occurs.
* **MXL timing telemetry:** Published timestamp/head grain index,
  requested timestamp/read grain index, and each request's physical ring slot.

---

## 4. Analysis Goals & Alerts

1. **Primary Goal:** Let the user understand how media flows through a workflow and pinpoint where latency accumulates and where overruns can happen.
2. **Secondary Goal:** Show Total Workload Latency and Stability Margin so alternative workflow designs can be compared.
3. **Sustained-overrun alert:** Any node staying in the Red Zone (Overrun) for > 3 seconds of simulated time raises a prominent alert (with a Reset action). This is a diagnostic cue, not a game-over.

---

## 5. Implementation History (completed — not a build plan)

This section records how the tool was first built. All tasks are done; do not
re-execute them. Current status lives in `AI_RULES.md`, open work in `TO-DO.md`.
The `src/game/` directory name and `Game*` identifiers are legacy naming from
the original game framing.

### Task 1: Core Domain Engine (`src/engine/`)
- [x] Define TypeScript types: `Signal`, `MediaFunction`, `RingBuffer`, `SyncGroup`, `MXLDomain`.
- [x] Build `RingBufferEngine` calculating absolute timestamps, grain indices,
  physical ring slots, retained-history boundaries, and status (`OK`,
  `TOO_EARLY`, `TOO_LATE`).
- [x] Implement Sync Group evaluation logic to apply automatic delay padding to faster streams in a group.

### Task 2: Visual Canvas & Node System (`src/components/canvas/`)
- [x] Set up node-graph canvas (React Flow or HTML5 Canvas).
- [x] Implement node scaling: Visual node dimensions scale based on node $\Delta t_{proc}$.
- [x] Implement custom node renders for Inputs, Technical, Editorial, Synthetic, Recording, Repeater, and Outputs.

### Task 3: Interactive Ring Buffer Visualizer (`src/components/ui/`)
- [x] Create `RingBufferGauge` component showing real-time $W$ vs $R$ marker positions.
- [x] Color-code status: Yellow for too early (future grain), Red for too late
  / overflow (grain outside retained history).

### Task 4: Simulation Loop & Latency Analysis (`src/game/`)
- [x] Implement global tick runner to pass grains along the node graph.
- [x] Implement global latency calculator and stability/overflow monitors.
- [x] Add preset scenarios (e.g., "Align 4K Video and 8-channel Audio without overrunning a 50ms MXL Buffer").
- [x] Add a selectable A/V Sync Overrun scenario modelling an ingress→egress
  workload: one Ingress writes flows V1 and A1; video is processed twice and
  audio once; the Egress must re-pair them at a common grain index, so the
  *audio* input reads too late while it waits for video. Guidance to grow the
  domain, cut the slow branch's latency, or add a Grain Repeater to the fast
  branch.