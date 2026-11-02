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

/**
 * The media format the simulated domain carries. Frame rate sets the video
 * grain rate (and so the grain duration and slot counts); the audio sample rate
 * sets how many samples each 1 ms audio commit batch holds. Resolution is a
 * label, shown for context.
 */
export interface MediaConfig {
  /** Video frame rate, which is also the video grain rate. */
  videoRate: GrainRate;
  /** Picture size label, e.g. `1920x1080`. */
  resolution: string;
  /** Audio sample rate in Hz. */
  audioSampleRate: number;
}

/** 1080p50 with 48 kHz audio: MXL's Timing.md worked example, and the broadcast-standard sample rate. */
export const DEFAULT_MEDIA_CONFIG: MediaConfig = { videoRate: DEFAULT_GRAIN_RATE, resolution: '1920x1080', audioSampleRate: 48000 };

/** Samples in one audio commit batch (one `AUDIO_GRAIN_RATE` grain). */
export function samplesPerAudioBatch(config: MediaConfig = DEFAULT_MEDIA_CONFIG): number {
  return config.audioSampleRate / (AUDIO_GRAIN_RATE.numerator / AUDIO_GRAIN_RATE.denominator);
}

/** Which track-appropriate grain rate to use for a flow, by MXL data format. */
export function grainRateForTrack(track: 'video' | 'audio' | 'data', config: MediaConfig = DEFAULT_MEDIA_CONFIG): GrainRate {
  return track === 'audio' ? AUDIO_GRAIN_RATE : config.videoRate;
}

/** `GrainDurationNs = GrainRateDenominator * 1e9 / GrainRateNumerator`, expressed here in ms. */
export function grainDurationMs(rate: GrainRate = DEFAULT_GRAIN_RATE): number {
  return (1000 * rate.denominator) / rate.numerator;
}

/**
 * Number of discrete grain slots an MXL ring buffer of `domainSizeMs` history holds. Like MXL
 * (`Instance.cpp`: history * rate, integer division) it truncates, so a partial grain adds no slot.
 */
export function ringBufferLength(domainSizeMs: number, rate: GrainRate = DEFAULT_GRAIN_RATE): number {
  return Math.max(1, Math.floor((domainSizeMs * rate.numerator) / (1000 * rate.denominator) + 1e-9));
}

/** Fewest grains a ring needs to be usable: the head, the grain being read, and one spare slot. */
export const MIN_USABLE_GRAINS = 3;

/** Smallest domain size (a multiple of `stepMs`) that gives a video flow at least `MIN_USABLE_GRAINS` slots. */
export function minDomainSizeMs(rate: GrainRate = DEFAULT_GRAIN_RATE, stepMs = 10): number {
  return Math.ceil((MIN_USABLE_GRAINS * grainDurationMs(rate)) / stepMs) * stepMs;
}

/** `GrainIndex = Timestamp / GrainDurationNs` (integer division; here `timestampMs` stands in for TAI ns/1e6). */
export function timestampToGrainIndex(timestampMs: number, rate: GrainRate = DEFAULT_GRAIN_RATE): number {
  return Math.floor(timestampMs / grainDurationMs(rate));
}

/** `RingBufferIndex = GrainIndex mod RingBufferLength` — always normalized to [0, length). */
export function grainIndexToRingBufferIndex(grainIndex: number, length: number): number {
  return ((grainIndex % length) + length) % length;
}

/** Colour of a physical ring slot, shared by the circular ring and the linear strip so a grain reads the same in both. */
export function slotColor(slot: number, length: number): string {
  return `hsl(${(slot * 360) / length} 55% 62%)`;
}

/**
 * Item #11: the raw `GrainIndex` (real MXL index) is a huge, ever-growing
 * epoch-scaled number (`Date.now()` / grain duration — 11-13 digits), which
 * reads as noise rather than teaching anything at a glance. By default we
 * show a simplified sequential count starting at 100; a HUD control switches
 * to the real MXL index to see how MXL actually indexes grains.
 */
export function grainIndexForDisplay(
  timestampMs: number,
  rate: GrainRate,
  _domainSizeMs: number,
  useRealIndex: boolean,
): number {
  const idx = timestampToGrainIndex(timestampMs, rate);
  return useRealIndex ? idx : simplifiedGrainIndex(idx, rate);
}

/** The simplified index counts up from this number at the start of the simulation. */
export const SIMPLIFIED_INDEX_START = 100;
/** Last simplified index before it wraps back to the start, keeping it to 3 digits. */
export const SIMPLIFIED_INDEX_END = 999;

/**
 * Simplified grain index: a plain sequential count starting at 100 when the
 * sim clock starts, per flow rate (so video and audio each count their own
 * grains). It moves in lock-step with the real MXL index, just without the
 * epoch-sized offset. It never exceeds 3 digits: after 999 it wraps to 100.
 */
export function simplifiedGrainIndex(grainIndex: number, rate: GrainRate): number {
  const span = SIMPLIFIED_INDEX_END - SIMPLIFIED_INDEX_START + 1;
  const count = grainIndex - timestampToGrainIndex(TAI_EPOCH_OFFSET_MS, rate);
  return SIMPLIFIED_INDEX_START + (((count % span) + span) % span);
}

/**
 * Short text for a grain index drawn inside a slot. Real mode shows only the
 * last `digits` digits of the true MXL index (`GrainIndex = TAI ns * rate`),
 * which still advance one per grain, to save space.
 */
export function grainIndexLabel(grainIndex: number, rate: GrainRate, useRealIndex: boolean, digits = 4): string {
  if (!useRealIndex) return String(simplifiedGrainIndex(grainIndex, rate));
  const full = String(grainIndex);
  return full.length > digits ? full.slice(-digits) : full;
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
