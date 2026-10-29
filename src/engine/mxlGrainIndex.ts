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

/**
 * Audio track rate used for visualization: real MXL audio flows are
 * "Continuous" ring buffers of individual samples (`docs/Architecture.md`
 * §"Continuous Ringbuffer I/O"), not discrete video-sized grains — a 48kHz
 * stream has a new sample every ~0.02ms, far too fine-grained to render as
 * individual slots here. As a teaching approximation we keep audio on the
 * same discrete grain-index math as video but at AES67's default 1ms
 * packet time (1000 "grains"/sec) — 20x finer than the 20ms default video
 * grain, which is the point: audio must never be shown as the same size as
 * a video grain. This does not model the Continuous buffer's distinct
 * writer/reader half-buffer split (`docs/Architecture.md`); see
 * `AI_RULES.md`'s Known Simplifications.
 */
export const AUDIO_GRAIN_RATE: GrainRate = { numerator: 1000, denominator: 1 };

/** Which track-appropriate grain rate to use for a flow, by MXL data format. */
export function grainRateForTrack(track: 'video' | 'audio' | 'data'): GrainRate {
  return track === 'audio' ? AUDIO_GRAIN_RATE : DEFAULT_GRAIN_RATE;
}

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
 * Item #11: the raw `GrainIndex` (real MXL index) is a huge, ever-growing
 * epoch-scaled number (`Date.now()` / grain duration — 11-13 digits), which
 * reads as noise rather than teaching anything at a glance. By default we
 * show the much smaller, more legible `RingBufferIndex` (grain index mod the
 * ring's slot count) — small numbers that directly illustrate "GrainIndex
 * mod RingBufferLength" (`docs`'s Timing.md). A HUD toggle
 * ("Use real MXL index") lets a player switch to the raw index once they've
 * built intuition on the small one, to see how MXL actually indexes grains.
 */
export function grainIndexForDisplay(
  timestampMs: number,
  rate: GrainRate,
  domainSizeMs: number,
  useRealIndex: boolean,
): number {
  const idx = timestampToGrainIndex(timestampMs, rate);
  return useRealIndex ? idx : grainIndexToRingBufferIndex(idx, ringBufferLength(domainSizeMs, rate));
}

/**
 * Which absolute grain index a physical ring slot currently holds, given the
 * writer's published head. When a reader is TOO_LATE this differs from the
 * index it asked for — the slot has been reused by a newer grain.
 */
export function slotHoldsGrainIndex(headGrainIndex: number, slotIndex: number, length: number): number {
  return headGrainIndex - grainIndexToRingBufferIndex(headGrainIndex - slotIndex, length);
}


/**
 * Teaching stand-in for the TAI epoch offset: the sim clock starts here (ms
 * since the SMPTE ST 2059-1 epoch) instead of at 0, so grain indices, TAI
 * nanoseconds and the time of day read like real MXL values. It is a whole
 * number of 480ms (video tick) and 1000ms periods, so it never shifts the
 * linear-tick phase. It is a fixed example value, not a real clock reading.
 */
export const TAI_EPOCH_OFFSET_MS = 1_792_848_000_000;

/** Nanoseconds since the SMPTE epoch for a sim-clock timestamp, as a BigInt (exceeds 2^53). */
export function timestampToTaiNs(timestampMs: number): bigint {
  return BigInt(Math.round(timestampMs * 1e6));
}

/** Groups digits in threes with an apostrophe, matching the MXL docs style (`1'792'848'000`). */
export function formatGrouped(value: bigint | number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}

/** TAI time of day as `HH:MM:SS:FF`, with frames counted in grains of `rate`. */
export function timestampToTimecode(timestampMs: number, rate: GrainRate = DEFAULT_GRAIN_RATE): string {
  const framesPerSecond = Math.max(1, Math.round(rate.numerator / rate.denominator));
  const totalSeconds = Math.floor(timestampMs / 1000);
  const frame = Math.floor(((timestampMs % 1000) / 1000) * framesPerSecond);
  const tod = ((totalSeconds % 86400) + 86400) % 86400;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(tod / 3600))}:${pad(Math.floor(tod / 60) % 60)}:${pad(tod % 60)}:${pad(frame)}`;
}
