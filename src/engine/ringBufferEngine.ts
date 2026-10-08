// Core Ring Buffer evaluation logic.
// See Initial_prompt.md §2.A and §3 for the MXL too-early/too-late rules.

import type { RingBuffer, RingBufferEvaluation, RingBufferStatus } from '../types';
import { DEFAULT_GRAIN_RATE, grainDurationMs } from './mxlGrainIndex';

/**
 * MXL's discrete reader keeps the head slot plus its alias out of reach so a
 * reader never observes the slot the writer is currently filling: the oldest
 * readable index is `headIndex - grainCount + 2`
 * (see PosixDiscreteFlowReader.cpp). That costs two slots of usable history.
 */
export const WRITER_RESERVED_SLOTS = 2;

/**
 * The writer-reserved margin above, expressed as *time* rather than a grain
 * count. MXL's real reader always reserves exactly `WRITER_RESERVED_SLOTS`
 * slots regardless of a flow's own grain rate — for a fine-grained audio
 * flow (D1's 1ms grains) that is a negligible ~2ms safety margin, while for
 * video's 20ms grains it's 40ms. Pinning the margin to video's grain size
 * and re-deriving each track's reserved *grain count* from that fixed time
 * budget keeps the existing levels' pass/fail balance intact across tracks
 * of differing rates — a deliberate teaching simplification documented in
 * `AI_RULES.md`'s Known Simplifications, diverging from MXL's literal
 * fixed-slot-count reader behavior.
 */
export const WRITER_RESERVED_MS = WRITER_RESERVED_SLOTS * grainDurationMs(DEFAULT_GRAIN_RATE);

/** Warning thresholds expressed as a fraction of the *retained* history. */
export const RING_BUFFER_ZONES = {
  /**
   * Above this fraction of retained history consumed, the reader is about to
   * fall off the back edge of the ring (Yellow / near too-late).
   */
  tooLateWarningRatio: 0.8,
} as const;

/**
 * Usable history (in whole grains, at `trackDurationMs` per grain) for a
 * branch.
 *
 * Every Grain Repeater on the branch republishes into its own sub-ring buffer
 * and holds a window's worth of grains there, so it adds another domain
 * window of absorbable differential latency (spec §2.B.5, "resets the
 * boundary limit"). The writer-reserved margin (see `WRITER_RESERVED_MS`) is
 * deducted once, at the buffer the reader actually reads from, converted to
 * this track's own grain size so the *time* margin stays constant across
 * tracks of differing rates.
 */
export function retainedGrainsFor(
  grainCount: number,
  repeaterCount: number,
  trackDurationMs: number = grainDurationMs(DEFAULT_GRAIN_RATE),
): number {
  const reservedGrains = Math.max(1, Math.round(WRITER_RESERVED_MS / trackDurationMs));
  return Math.max(0, grainCount * (1 + repeaterCount) - reservedGrains);
}

/**
 * Evaluate one reader input against the upstream flow's published head.
 *
 * Grain indices are preserved end to end, so the comparison is purely about
 * *which absolute grain index* the reader asks for versus what the flow still
 * retains:
 *
 * - TOO_EARLY: requested index is newer than the published head. The MXL
 *   reader blocks on the flow's sync counter until the writer commits it.
 * - TOO_LATE: requested index is older than the retained history, so its slot
 *   has already been overwritten by a newer grain — unrecoverable data loss.
 * - OK: the requested index is still inside the retained window.
 */
export function evaluateRingBuffer(buffer: RingBuffer): RingBufferEvaluation {
  const deltaGrains = buffer.publishedGrainIndex - buffer.requestedGrainIndex;

  let status: RingBufferStatus;
  if (deltaGrains < 0) {
    status = 'TOO_EARLY';
  } else if (deltaGrains > buffer.retainedGrains) {
    status = 'TOO_LATE';
  } else {
    status = 'OK';
  }

  const occupancyRatio =
    buffer.retainedMs > 0 ? buffer.stalenessMs / buffer.retainedMs : buffer.stalenessMs > 0 ? 1 : 0;

  return {
    status,
    stalenessMs: buffer.stalenessMs,
    deltaMs: buffer.stalenessMs,
    deltaGrains,
    occupancyRatio,
    publishedGrainIndex: buffer.publishedGrainIndex,
    requestedGrainIndex: buffer.requestedGrainIndex,
    publishedRingBufferIndex: buffer.publishedRingBufferIndex,
    requestedRingBufferIndex: buffer.requestedRingBufferIndex,
    retainedFromGrainIndex: buffer.retainedFromGrainIndex,
    retainedGrains: buffer.retainedGrains,
    retainedMs: buffer.retainedMs,
  };
}

/**
 * Visual zone for a reader input (spec §3).
 *
 * Red is a real too-late overrun. Yellow covers both warning states: the
 * reader is waiting on a not-yet-written grain, or it has consumed most of
 * the retained history and is about to fall off the back edge.
 */
export function gaugeZone(evaluation: RingBufferEvaluation): 'green' | 'yellow' | 'red' {
  if (evaluation.status === 'TOO_LATE') return 'red';
  if (evaluation.status === 'TOO_EARLY') return 'yellow';
  if (evaluation.occupancyRatio >= RING_BUFFER_ZONES.tooLateWarningRatio) return 'yellow';
  return 'green';
}

/** Rank used to pick the worst input status when summarizing a whole node. */
export function statusSeverity(status: RingBufferStatus): number {
  if (status === 'TOO_LATE') return 2;
  if (status === 'TOO_EARLY') return 1;
  return 0;
}
