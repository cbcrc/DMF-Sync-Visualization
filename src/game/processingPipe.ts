// The grains inside a media function while it processes them.
//
// A function reads grain k, processes it for its latency, and writes it with
// the same index k. It starts a new grain every grain period, so while it reads
// grain r it is still working on the grains read before it, and its output head
// shows the last one it finished, w. The grains in flight are w+1 … r.
//
// `readIndex` and `writeIndex` come from the same graph snapshot as the ring
// strips (the reader marker and the output head), so the pipe and the rings
// always agree. Each grain's progress across the pipe comes from the snapshot's
// clock: the read position `p` (in grains) is `(clockMs - readLagMs) / grainMs`,
// grain k entered at p = k and leaves (is written) at p = k + latency / grainMs.

import type { GrainRate } from '../types';
import { grainDurationMs } from '../engine/mxlGrainIndex';
import { inputGroupsFor, LIVE_GROUP } from './syncInputs';
import type { WriterRing } from './writerRings';
import type { Track } from './graphLatency';

/** At most this many grain chips are drawn; beyond it the middle ones are counted, not drawn. */
export const PIPE_MAX_CHIPS = 6;

export interface PipeChip {
  /** Grain index: the one read, and the one it will be written as. */
  index: number;
  /** 0 = just read (input side), 1 = being written (output side). */
  progress: number;
}

export interface ProcessingPipe {
  /** Index the function is reading now (its slowest synced input's reader marker). */
  readIndex: number;
  /** Index at its output head: the last grain it finished and wrote. */
  writeIndex: number;
  grainRate: GrainRate;
  latencyMs: number;
  /** Grains in flight, newest first; `PIPE_MAX_CHIPS` at most. */
  chips: PipeChip[];
  /** Grains in flight that are not drawn (between the newest and the oldest). */
  hiddenCount: number;
  /** The output flow's track (audio counts MXL commit batches). */
  track: Track;
  /** What this pipe was computed from, so it can be moved on between ticks (`extrapolatePipe`). */
  snapshot: PipeInput;
}

export interface PipeInput {
  readIndex: number;
  writeIndex: number;
  clockMs: number;
  /** Lag of the function's output head behind now (ms): read lag + latency. */
  outputLagMs: number;
  latencyMs: number;
  grainRate: GrainRate;
  track: Track;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function computeProcessingPipe(input: PipeInput): ProcessingPipe {
  const { readIndex, writeIndex, clockMs, outputLagMs, latencyMs, grainRate, track } = input;
  const grainMs = grainDurationMs(grainRate);
  const readPos = (clockMs - (outputLagMs - latencyMs)) / grainMs;
  const spanGrains = latencyMs / grainMs;

  const inFlight: PipeChip[] = [];
  for (let k = readIndex; k > writeIndex; k--) {
    inFlight.push({ index: k, progress: spanGrains > 0 ? clamp01((readPos - k) / spanGrains) : 1 });
  }

  let chips = inFlight;
  let hiddenCount = 0;
  if (inFlight.length > PIPE_MAX_CHIPS) {
    // Keep the newest ones entering and the oldest one leaving.
    chips = [...inFlight.slice(0, PIPE_MAX_CHIPS - 1), inFlight[inFlight.length - 1]];
    hiddenCount = inFlight.length - chips.length;
  }
  return { readIndex, writeIndex, grainRate, latencyMs, chips, hiddenCount, track, snapshot: input };
}

/**
 * The pipe at `nowMs` (simulated clock), moved on from its snapshot: the game
 * tick is 50 ms but a grain lasts 20 ms (10 ms for an audio batch), so drawing
 * only snapshots makes chips jump. Read and write positions advance with the
 * clock exactly as the model's do; any offset the snapshot had from the plain
 * clock formula (a sync group holding the read back) is kept.
 */
export function extrapolatePipe(pipe: ProcessingPipe, nowMs: number): ProcessingPipe {
  const s = pipe.snapshot;
  if (nowMs === s.clockMs) return pipe;
  const grainMs = grainDurationMs(s.grainRate);
  const readPos = (t: number) => (t - (s.outputLagMs - s.latencyMs)) / grainMs;
  const writePos = (t: number) => (t - s.outputLagMs) / grainMs;
  const readOffset = s.readIndex - Math.floor(readPos(s.clockMs));
  const writeOffset = s.writeIndex - Math.floor(writePos(s.clockMs));
  const writeIndex = Math.floor(writePos(nowMs)) + writeOffset;
  const readIndex = Math.max(writeIndex, Math.floor(readPos(nowMs)) + readOffset);
  return computeProcessingPipe({ ...s, readIndex, writeIndex, clockMs: nowMs });
}

/** Functions that show a processing pipe: they read, process for their latency and write the same index. */
export function showsProcessingPipe(kind: string, inputCount: number, outputCount: number): boolean {
  // A Grain Repeater re-writes the oldest grain at once; a Profanity Delay
  // writes new timestamps and has its own delay bar.
  return inputCount > 0 && outputCount > 0 && kind !== 'repeater' && kind !== 'delay';
}

interface PipeNode {
  id: string;
  data: { kind: string; latencyMs: number; inputCount: number; outputCount: number; inputGroups?: number[] };
}

/**
 * Each function's pipe, from the same rings the canvas strips draw. The output
 * index is set by the synced inputs (the slowest group), so the read index is
 * the lowest index a synced reader of the output's track asks for.
 */
export function processingPipesByNode(
  nodes: readonly PipeNode[],
  rings: readonly WriterRing[],
  clockMs: number,
): Map<string, ProcessingPipe> {
  const pipes = new Map<string, ProcessingPipe>();
  for (const n of nodes) {
    if (!showsProcessingPipe(n.data.kind, n.data.inputCount, n.data.outputCount)) continue;
    const own = rings.filter((r) => r.writerNodeId === n.id);
    const out = own.find((r) => r.track === 'video') ?? own[0];
    if (!out) continue;
    const readers = rings
      .filter((r) => r.track === out.track)
      .flatMap((r) => r.readers)
      .filter((r) => r.readerNodeId === n.id);
    if (readers.length === 0) continue;
    const groups = inputGroupsFor(n.data, readers.map((r) => r.inputIndex));
    const synced = readers.filter((r) => groups.get(r.inputIndex) !== LIVE_GROUP);
    const readIndex = Math.min(...(synced.length > 0 ? synced : readers).map((r) => r.requestedGrainIndex));
    pipes.set(
      n.id,
      computeProcessingPipe({
        readIndex,
        writeIndex: out.publishedGrainIndex,
        clockMs,
        outputLagMs: out.lagMs,
        latencyMs: n.data.latencyMs,
        grainRate: out.grainRate,
        track: out.track,
      }),
    );
  }
  return pipes;
}

/** Real time a Manual step is replayed over, per grain of simulated time. */
export const STEP_REPLAY_MS_PER_GRAIN = 600;

/** What the pipe is drawing: the simulated time shown, and a step being replayed. */
export interface DisplayClock {
  shownMs: number;
  replay?: { fromMs: number; toMs: number; startedAtRealMs: number; durationMs: number };
}

/**
 * The simulated time a pipe draws this frame. A running clock is shown as is.
 * In Manual mode (`replaySteps`) the clock only moves by steps of a grain; each
 * step forward is replayed over `STEP_REPLAY_MS_PER_GRAIN` of real time, so a
 * grain is seen entering, crossing and being written even in a 6 ms function.
 * A step during a replay continues from where the replay is; a step back snaps.
 */
export function advanceDisplayClock(
  prev: DisplayClock | undefined,
  clockMs: number,
  realNowMs: number,
  grainMs: number,
  replaySteps: boolean,
): DisplayClock {
  if (!prev || !replaySteps) return { shownMs: clockMs };
  const target = prev.replay ? prev.replay.toMs : prev.shownMs;
  if (clockMs < target) return { shownMs: clockMs };
  if (clockMs > target) {
    const fromMs = prev.shownMs;
    return {
      shownMs: fromMs,
      replay: { fromMs, toMs: clockMs, startedAtRealMs: realNowMs, durationMs: ((clockMs - fromMs) / grainMs) * STEP_REPLAY_MS_PER_GRAIN },
    };
  }
  if (!prev.replay) return prev;
  const r = prev.replay;
  const f = Math.min(1, (realNowMs - r.startedAtRealMs) / r.durationMs);
  return f >= 1 ? { shownMs: r.toMs } : { shownMs: r.fromMs + (r.toMs - r.fromMs) * f, replay: r };
}
