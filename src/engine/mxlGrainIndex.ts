// Grain-index / ring-buffer-index math matching the MXL reference
// implementation's indexing model (see
// https://github.com/dmf-mxl/mxl/blob/main/docs/Timing.md):
//
//   GrainDurationNs = GrainRateDenominator * 1e9 / GrainRateNumerator
//   GrainIndex      = Timestamp / GrainDurationNs
//   RingBufferIndex = GrainIndex mod RingBufferLength
//
// MXL's ring buffer is a fixed number of discrete grain slots (not a
// continuous millisecond window): "A ring buffer with 100ms of history [at
// 50 grains/sec] will have 5 grains". This module derives that discrete
// grain geometry from our existing millisecond-based `RingBuffer`/
// `domainSizeMs` model, so the UI can render the literal grain-index ring
// the MXL SDK uses, layered on top of (not replacing) the OK/TOO_EARLY/
// TOO_LATE math already in `ringBufferEngine.ts`.

import type { GrainRate } from '../types';

/** Default flow grain rate used for visualization — the exact worked example from MXL's Timing.md (50 grains/sec). */
export const DEFAULT_GRAIN_RATE: GrainRate = { numerator: 50, denominator: 1 };

/** `GrainDurationNs = GrainRateDenominator * 1e9 / GrainRateNumerator`, expressed here in ms. */
export function grainDurationMs(rate: GrainRate = DEFAULT_GRAIN_RATE): number {
  return (1000 * rate.denominator) / rate.numerator;
}

/** Number of discrete grain slots an MXL ring buffer of `domainSizeMs` history holds. */
export function ringBufferLength(domainSizeMs: number, rate: GrainRate = DEFAULT_GRAIN_RATE): number {
  return Math.max(1, Math.round(domainSizeMs / grainDurationMs(rate)));
}

/** `GrainIndex = Timestamp / GrainDurationNs` (integer division; here `timestampMs` stands in for TAI ns/1e6). */
export function timestampToGrainIndex(timestampMs: number, rate: GrainRate = DEFAULT_GRAIN_RATE): number {
  return Math.floor(timestampMs / grainDurationMs(rate));
}

/** `RingBufferIndex = GrainIndex mod RingBufferLength` — always normalized to [0, length). */
export function grainIndexToRingBufferIndex(grainIndex: number, length: number): number {
  return ((grainIndex % length) + length) % length;
}

/**
 * Which absolute grain index a physical ring slot currently holds, given the
 * writer's published head. When a reader is TOO_LATE this differs from the
 * index it asked for — the slot has been reused by a newer grain.
 */
export function slotHoldsGrainIndex(headGrainIndex: number, slotIndex: number, length: number): number {
  return headGrainIndex - grainIndexToRingBufferIndex(headGrainIndex - slotIndex, length);
}

