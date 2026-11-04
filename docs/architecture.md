# Architecture

Stack: React + TypeScript + Vite, [React Flow](https://reactflow.dev/) for the
canvas. Legacy names (`src/game/`, `GameHud`, `useGameLoop`) remain from the
original game framing and are not renamed.

## Source layout

- `src/types.ts`: Signal, MediaFunction, RingBuffer, SyncGroup, MXLDomain.
- `src/engine/`: `ringBufferEngine.ts` (OK / TOO_EARLY / TOO_LATE evaluation,
  `READ_BEHIND_WRITE_GRAINS`, `WRITER_RESERVED_MS`) and `mxlGrainIndex.ts`
  (MXL grain index and ring index math, per-track grain rate).
- `src/components/canvas/`: `FlowCanvas` (graph editing, undo, connection rules,
  palette), `MediaFunctionNode` (function body plus ring column),
  `RingBufferStrip` / `ringStripLayout`, `nodeDefaults` (palette presets, latency
  ranges), `GrainOverlay`, `LinearBoundaryOverlay`.
- `src/components/ui/`: panes (`RingBufferPanel`, `WriterRing`, `ClockStrip`,
  `EndToEndTimeline`, `GameHud`, `InfoPanel`, `PlaybackPane`), `DockItem`,
  `ToolbarMenus`, `ScenariosPage`.
- `src/game/`: `graphLatency` (per-input evaluation, `writerFlows`),
  `writerRings`, `connectionRules`, `scenarios`, `scenarioStorage`,
  `endToEndTimeline`, `syncInputs`, `docks`, `mediaConfig`, `useGameLoop` (the
  only tick runner), `grainFlow` / `useGrainFlow`, `useSimClock`, `useHashRoute`.

Structural graph state is lifted to `App.tsx` through `FlowCanvas`'s
`onGraphChange`.

## Ring buffers and blocks

- **Rings belong to the writer.** MXL's writer commits grains whether or not
  anything reads (`PosixDiscreteFlowWriter::commit()` has no reader check), so
  every output flow of every producing node has a ring. `writerFlows`
  (`graphLatency.ts`) lists them and `writerRings.ts` attaches readers. Order is
  video then audio; an Egress has no rings.
- **Block layout.** `MediaFunctionNode` renders a `.mf-block`: a square function
  body plus a column of `RingBufferStrip` cards. `grainFlow.ts` geometry assumes a
  square body at `node.position`, so the frame is drawn with `::before`. Each card
  holds the source `<Handle id={ring.handleId}>`, so edges still go writer node to
  reader node.
- **Index preservation.** A function writes the grain index it read, so each
  non-source function adds one read-behind grain (`READ_BEHIND_WRITE_GRAINS`).
- **Reader pointers.** The strip is a timeline: the head is the rightmost box and
  indices flow right to left. A reader sits `deltaGrains + READ_BEHIND_WRITE_GRAINS`
  boxes left of the head, so it never sits on the write box. This mirrors MXL's
  `FlowSynchronizationGroup::waitForDataAt(originTime)`, which converts one origin
  time to each flow's grain index and waits for every flow's `headIndex` to reach
  it. Grey boxes on the left are writer-reserved. A TOO_EARLY reader waits hollow;
  a TOO_LATE reader sits in the hatched box, flagged ✕. Audio and video share this
  logic (`WRITER_RESERVED_MS`).
- **Multiple outputs.** CG has two video outputs, Fill (top) and Key (bottom). A
  source with several same-track outputs writes one flow per output handle
  (`flowKeyOf`, `multiOutput`); both are spawned in the same tick with the same
  `originTs`.
- **Flow modes.** Inputs and Outputs are video only, audio only or both
  (`outputModeOf`). A producer's output handle 0 is video, 1 is audio; other nodes
  inherit their first input's track (`trackForEdge`).

## Connection rules (`connectionRules.ts`, `isValidConnection`)

- An input takes one link; dropping a link on an occupied input replaces it.
- Audio-only functions read audio only; video-only functions (Colour Corrector,
  Video Mixer, Multiview, CG) read video only.
- An Output's first input is video and its second audio; other multi-input nodes
  need all inputs on the same track.
- Rewiring a link so that it breaks a rule is refused; existing links are kept.
- Palette flags `audioOnly` and `videoOnly` are persisted by `scenarioStorage`.

## Palette (`PALETTE_GROUPS` in `nodeDefaults.ts`)

Sources, Synthetic, Technical, Editorial, Outputs, each with a Generic entry.
The Grain Repeater is fixed at 0 ms latency (`sanitizeNode` forces this on load).

## Special functions

- **Profanity Delay** (`kind: 'delay'`): parks media up to 3 s (`DELAY_MAX_MS`),
  then re-writes it into MXL as a new source. Its output head lag restarts at 0,
  but `workloadLatencyMs` keeps counting the delay. This is the one place a grain
  index is not preserved (see AI_RULES.md, Known simplifications).
- **Grain Repeater**: reads the oldest retained grain and re-writes it with the
  same index into a fresh ring (see Known simplifications).
- **Mixer sync / live** (`syncInputs.ts`): editorial functions with several inputs
  have a per-input group: sync A (default), sync B or live (`LIVE_GROUP` = 0,
  `MAX_SYNC_GROUPS` = 2). Each group aligns at its slowest member and releases on
  its own; the function writes once every group is ready. A live input reads one
  grain behind its head and never holds the function back. If every wired input is
  live they fall back to group A. Saved scenarios with the old `ignoreSyncInputs`
  load as live. Checked against dmf-mxl/mxl `6e654e2`: "sync" is a Flow
  Synchronization Group (`FlowSynchronizationGroup::waitForDataAt`) and "live" is a
  reader outside the group reading `runtime.headIndex`.

## End-to-end timeline

`endToEndTimeline.ts` walks back from each Output/Recording along the branch with
the largest end-to-end latency. Each step has `startMs`/`endMs` (latency added),
`readAtMs` (how far behind now it reads) and `syncWaitMs`. The axis is ms since
the MXL write at the input. The linear-side Origin Time Stamp is not implemented;
rows have a `leadInMs` (always 0) so OTS can later be supplied through
`TimelineOptions.leadInMsBySourceId`.

## Undo

Snapshot history in `FlowCanvas` (100 steps: connect, link move, add, node drag,
delete), cleared when a scenario loads. Latency slider changes are not undoable
and there is no redo.

## Copy / paste

Ctrl/Cmd+C and V (or the toolbar) duplicate the selected functions with their
settings but no links. The copy keeps the source name with the next free number
(`nextCopyLabel`); an unnumbered source counts as 1, so its first copy is "… 2".
