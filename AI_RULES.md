# AI Rules

_Read this first when resuming work._ Detail lives in [`docs/`](docs/README.md);
this file holds only the rules and the deliberate deviations from MXL.

## Ground rules: respect dmf-mxl/mxl

- This is a **visualization tool** for testing and working with latencies in the
  EBU's **Dynamic Media Facility (DMF)**, helping users build latency and sync
  scenarios and isolate where buildups and overruns happen. It is **not a game**:
  no scores, win/lose states or "players". Use "user", "scenario" and "alert".
- **MXL source of truth: https://github.com/dmf-mxl/mxl.** Behaviour in the DMF's
  asynchronous domain follows MXL. A pinned copy is the git submodule
  `reference/mxl` (`git submodule update --init` if empty). The linear,
  synchronous world outside Ingress and Egress is not governed by MXL.
- Before any change touching timing, grains, ring buffers, flows, readers/writers
  or sync, read the relevant code and `reference/mxl/docs/` (e.g. `Timing.md`,
  `PosixDiscreteFlowWriter.cpp`, `FlowSynchronizationGroup.cpp`) and **cite what
  you checked**. Never rely on memory or this file alone.
- If this file, `docs/` or the code disagree with dmf-mxl/mxl, MXL
  wins. Never invent MXL behaviour. Every deliberate departure must be listed
  under "Known simplifications" below.
- `SPEC.md` (git-ignored, local only, may be absent) holds extra domain notes; it
  never overrides MXL. Legacy names
  (`src/game/`, `GameHud`, `useGameLoop`) stay from the original game framing.

## Core model: read before touching timing logic

The app models MXL timing with **preserved grain indices**: a Media Function that
reads grain T writes its result back as grain T, into slot `T mod grainCount` of
its own output ring. Processing never renumbers grains; it only makes a flow's
published head lag real time by the path's accumulated latency. Do not replace
this with "nodes re-time grains" or a milliseconds-only approximation.

A purely serial chain never overruns. A **too-late** read only happens at a sync
point (multi-input node), on the *fast* branch, whose requested grain aged out
while it waited for a slower sibling to publish the same index. Evaluation is
therefore **per input edge**, not per node.

- **OK (green):** requested grain is still retained.
- **Too early (yellow):** requested index is newer than the published head; the
  reader waits, no data lost.
- **Too late (red):** requested index is older than the writer-reserved boundary
  (`headIndex - grainCount + 2`, per `PosixDiscreteFlowReader.cpp`); data lost.

Other modelling rules: every writer owns a ring whether or not anything reads
(MXL's `commit()` has no reader check); "sync" is a Flow Synchronization Group
and "live" a reader outside it (checked against `6e654e2`).

## Known simplifications (departures from MXL)

- Clock is not PTP/TAI. The sim clock starts at a fixed example offset
  (`TAI_EPOCH_OFFSET_MS` in `mxlGrainIndex.ts`) so indices read like real values.
- The shared simulated clock (`useSimClock.ts`) can be slowed (Stepping) or
  frozen/single-stepped (Manual) for teaching. Real MXL indices come from true
  elapsed time and are never slowed or paused.
- A **Profanity Delay** re-writes its media as a new source: the only place a
  grain index is not preserved. The end-to-end timeline still counts its delay
  and marks where the new timestamps start (`stampedAtMs`).
- **Processing pipe.** A function is drawn as pipelined: it starts a grain every
  grain period and writes each one, with the index it read, after its latency,
  so latencies over one grain have several grains in flight. MXL defines only
  the reads and writes, not a function's internals; the pipe is derived from the
  same read index and output head as the rings (`processingPipe.ts`). Its
  Manual-mode Step replay is display only; the clock still jumps.
- A mixer input set to **live** reads one grain behind the head with no wait. MXL
  allows any index up to `runtime.headIndex` (`PosixDiscreteFlowReader::getGrainImpl`);
  one grain behind is conservative for whole-grain writes.
- In MXL every input of a function can be live. Here, if all are live they fall
  back to group A, because the function needs one timestamp to choose the index it
  writes. Not modelled from MXL sync groups: a consumer-chosen timestamp, a wait
  timeout, partial-grain readers.
- Ring length truncates like MXL (`Instance.cpp`); the domain slider's minimum
  keeps at least 3 video grains (`minDomainSizeMs`). The game loop refreshes every
  50 ms (`TICK_MS`); ring markers extrapolate between ticks.
- Reads are evaluated instantaneously, not by deadline-based blocking/retry.
- **Grain Repeater** reads the oldest retained grain (`readsTail`) and writes it
  into a fresh standard-size ring with the same index (`originTs` kept). Its output
  head lags by the age it read (the oldest readable age of the ring it reads,
  discrete for video and continuous for audio), which counts as workload
  latency.
- Invalid-grain publication and per-slice validity are not modelled.
- Audio is counted in 10 ms commit batches (MXL's default `maxCommitBatchSizeHint`,
  `Instance.cpp`), not single samples: indices, slots, the read-behind and each
  audio function's added latency move one batch at a time. Whether an audio read
  is too late follows MXL's Continuous rule (`continuousGeometry`): the buffer is
  twice the history rounded up to a 4 KiB page (`Instance.cpp`), and a read of
  `count` samples is OK while it fits in the newer half
  (`PosixContinuousFlowReader.cpp`). Video keeps the discrete rule: exactly 2
  writer-reserved slots. Checked against `6e654e2`.
- **A/V alignment is by timestamp, per sample** (`AlignedRead`). An audio input
  synced with a video input reads exactly the samples of the video grain `k` read
  alongside: `S(T_k)` to `S(T_k+1) - 1`, where `S` is MXL's `timestampToIndex` at
  the sample rate (round to nearest, `IndexConversion.hpp`), and is judged per
  sample. So 1001-based rates follow the real cadence (29.97: 1602/1601 samples,
  8008 per 5 grains). When audio is the slower flow, the video input pairs the
  latest grain whose audio is fully committed, as a sync group's
  `waitForDataAt` would wait for it. Pairing a grain with the samples from its own
  timestamp up to the next one is this app's choice; MXL leaves it to the
  consumer (`mxl-gst` stamps audio by its first sample's timestamp, `sink.cpp`).
  Other audio reads take one batch.
- Head positions round down (`timestampToGrainIndex`: the grain whose span
  contains now is being written); conversions between flows round to nearest
  (`timestampToIndex`), like MXL. Rounding heads too would count a grain as
  complete halfway through it, before its audio exists.
- The linear-side Origin Time Stamp is not implemented (timeline `leadInMs` is 0).

## Working agreements

- Think before coding; state assumptions; if a request is ambiguous, ask.
- Simplicity first: the minimum code that solves the problem.
- Surgical changes: touch only what the task requires.
- Keep docs in sync: update `README.md` (human quick start), the relevant
  `docs/` page, the local `SPEC.md` if present, `TO-DO.md`, and this file if a
  deviation from MXL is added or removed. Don't record changelog history here.
- Verify with `npx tsc -b`, `npx eslint src` and `npx vitest run`, and check UI
  changes in a browser (`npm run dev`).

## Conventions

- Node 18 is the supported runtime; avoid dependency bumps that need Node ≥20
  (e.g. Vite 8) without checking.
- `esbuild` is pinned via `overrides` in `package.json`; don't loosen it to a bare
  `>=` range (breaks React Flow's build).
- Use the semantic `--ui-*` theme tokens (Dark default, Light), not hard-coded
  greys. Brand accent is Radio-Canada red `#EE0000`. Don't reintroduce the removed
  slide-deck theme (`assets/theme.css`).
- Only one tick runner (`useGameLoop.ts`); don't add a second independent loop.
- Graph state is lifted to `App.tsx` via `FlowCanvas`'s `onGraphChange`.
