// Core Ring Buffer evaluation logic.
// See SPEC.md §2.A and §3 for the MXL too-early/too-late rules.

import type { AlignedRead, RingBuffer, RingBufferEvaluation, RingBufferStatus } from '../types';
import { DEFAULT_MEDIA_CONFIG, type MediaConfig, continuousBufferSamples, samplesPerAudioBatch } from './mxlGrainIndex';

/**
 * MXL's discrete reader keeps the head slot plus its alias out of reach so a
 * reader never observes the slot the writer is currently filling: the oldest
 * readable index is `headIndex - grainCount + 2`
 * (see PosixDiscreteFlowReader.cpp). That costs two slots of usable history.
 */
export const WRITER_RESERVED_SLOTS = 2;

/**
 * A reader can never read the grain currently being written: the newest
 * readable grain is one behind the write head (`publishedGrainIndex`).
 */
export const READ_BEHIND_WRITE_GRAINS = 1;

/** Warning thresholds expressed as a fraction of the *retained* history. */
export const RING_BUFFER_ZONES = {
  /**
   * Above this fraction of retained history consumed, the reader is about to
   * fall off the back edge of the ring (Yellow / near too-late).
   */
  tooLateWarningRatio: 0.8,
} as const;

/**
 * Usable history (in whole grains) of a discrete (video) ring of `grainCount`
 * slots: all but MXL's two writer-reserved slots, at any grain rate.
 *
 * A Grain Repeater re-writes into a fresh ring, so it needs no special
 * capacity here; it resets lag instead (see `graphLatency.ts`).
 */
export function retainedGrainsFor(grainCount: number): number {
  return Math.max(0, grainCount - WRITER_RESERVED_SLOTS);
}

/** Geometry of an audio ring, counted in commit batches (`AUDIO_GRAIN_RATE`). */
export interface ContinuousGeometry {
  /** Batches in the whole MXL buffer; the newer half is readable, the rest is the writer's. */
  grainCount: number;
  /** Batches a reader may lag behind the newest readable one and still read its window. */
  retainedGrains: number;
  /** Samples per channel in the MXL buffer (`continuousBufferSamples`). */
  bufferSamples: number;
  /** Samples the reader asks for in one read (its window). */
  windowSamples: number;
}

/**
 * MXL's continuous (audio) rule, in commit batches. The buffer is twice the
 * history (`Instance.cpp`), and a read of `windowSamples` ending at sample
 * `index` succeeds while `index - windowSamples >= headIndex - bufferLength/2`
 * (`PosixContinuousFlowReader.cpp`, `getSamplesImpl`). So a reader can lag the
 * head by up to `bufferLength/2 - windowSamples` samples: about the whole
 * domain, less the window. There is no two-slot reserve as in a discrete ring.
 *
 * `windowSamples` defaults to one batch; a reader aligned to video reads one
 * video grain of samples (see `graphLatency.ts`).
 */
export function continuousGeometry(
  domainSizeMs: number,
  media: MediaConfig = DEFAULT_MEDIA_CONFIG,
  windowSamples: number = samplesPerAudioBatch(media),
): ContinuousGeometry {
  const bufferSamples = continuousBufferSamples(domainSizeMs, media.audioSampleRate);
  const perBatch = samplesPerAudioBatch(media);
  const window = Math.max(1, Math.round(windowSamples));
  return {
    grainCount: Math.max(1, Math.floor(bufferSamples / perBatch)),
    retainedGrains: Math.max(0, Math.floor((bufferSamples / 2 - window) / perBatch)),
    bufferSamples,
    windowSamples: window,
  };
}

/**
 * For an aligned audio read: how many samples its last sample sits behind the
 * head (negative: not yet written), and how far behind it may sit while its
 * whole window still fits in the readable half of the buffer.
 */
export function alignedReadSlack(a: AlignedRead): { behind: number; room: number } {
  return { behind: a.headSample - a.lastSample, room: a.bufferSamples / 2 - a.sampleCount };
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
  // Lag measured from the newest *readable* grain (one behind the write head).
  const deltaGrains = buffer.publishedGrainIndex - READ_BEHIND_WRITE_GRAINS - buffer.requestedGrainIndex;

  let status: RingBufferStatus;
  let occupancyRatio: number;
  const aligned = buffer.alignedRead;
  if (aligned) {
    // MXL's continuous rule, per sample (`PosixContinuousFlowReader.cpp`, `getSamplesImpl`).
    const { behind, room } = alignedReadSlack(aligned);
    status = behind < 0 ? 'TOO_EARLY' : behind > room ? 'TOO_LATE' : 'OK';
    occupancyRatio = room > 0 ? Math.max(0, behind) / room : behind > 0 ? 1 : 0;
  } else {
    if (deltaGrains < 0) {
      status = 'TOO_EARLY';
    } else if (deltaGrains > buffer.retainedGrains) {
      status = 'TOO_LATE';
    } else {
      status = 'OK';
    }
    occupancyRatio = buffer.readsTail
      ? 0
      : buffer.retainedMs > 0 ? buffer.stalenessMs / buffer.retainedMs : buffer.stalenessMs > 0 ? 1 : 0;
  }

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
