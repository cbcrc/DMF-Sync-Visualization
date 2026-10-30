// Default field values used when the player adds a new node from the canvas
// palette (Task 4 graph editing). See SPEC.md §2.B for the latency
// ranges per Media Function type.

import type { MediaFunctionKind } from '../../types';
import type { MediaFunctionNodeData, OutputMode } from './MediaFunctionNode';

export interface NodeDefaults {
  label: string;
  latencyMs: number;
  inputCount: number;
  outputCount: number;
}

export const NODE_KIND_DEFAULTS: Record<MediaFunctionKind, NodeDefaults> = {
  input: { label: 'Input', latencyMs: 0, inputCount: 0, outputCount: 1 },
  synthetic: { label: 'Generic Synthetic', latencyMs: 0, inputCount: 0, outputCount: 1 },
  editorial: { label: 'Generic Editorial', latencyMs: 35, inputCount: 2, outputCount: 1 },
  technical: { label: 'Colour Corrector', latencyMs: 6, inputCount: 1, outputCount: 1 },
  recording: { label: 'Recorder', latencyMs: 0, inputCount: 1, outputCount: 0 },
  delay: { label: 'Profanity Delay', latencyMs: 1500, inputCount: 2, outputCount: 2 },
  repeater: { label: 'Grain Repeater', latencyMs: 0, inputCount: 1, outputCount: 1 },
  output: { label: 'Output', latencyMs: 0, inputCount: 1, outputCount: 0 },
};

/** Palette order shown in the canvas toolbar (roughly producer -> consumer). */
export const PALETTE_KINDS: MediaFunctionKind[] = [
  'input',
  'synthetic',
  'technical',
  'editorial',
  'repeater',
  'delay',
  'recording',
  'output',
];

export type PaletteGroup = 'source' | 'synthetic' | 'technical' | 'editorial' | 'sink';

/** Palette sections in display order. */
export const PALETTE_GROUPS: { id: PaletteGroup; title: string }[] = [
  { id: 'source', title: 'Sources' },
  { id: 'synthetic', title: 'Synthetic' },
  { id: 'technical', title: 'Technical' },
  { id: 'editorial', title: 'Editorial' },
  { id: 'sink', title: 'Outputs' },
];

const KIND_GROUP: Record<MediaFunctionKind, PaletteGroup> = {
  input: 'source',
  synthetic: 'synthetic',
  technical: 'technical',
  repeater: 'technical',
  delay: 'editorial',
  editorial: 'editorial',
  recording: 'sink',
  output: 'sink',
};

/** One "Add media function" button: a kind plus the field overrides that make it a specific function. */
export interface PalettePreset {
  id: string;
  group: PaletteGroup;
  /** Button text. */
  button: string;
  kind: MediaFunctionKind;
  defaults: NodeDefaults;
  /** Audio-only producer: its single output is the audio flow (handle `out-1`). */
  audioOnly?: boolean;
  /** Video-only function: reads video sources only. */
  videoOnly?: boolean;
}

const PALETTE_BUTTONS: Record<MediaFunctionKind, string> = {
  input: 'Input',
  synthetic: 'Generic Synthetic',
  technical: 'Colour Corrector',
  editorial: 'Generic Editorial',
  repeater: 'Repeater',
  delay: 'Profanity Delay',
  recording: 'Recording',
  output: 'Output',
};

/**
 * Everything the "Add media function" panel offers: one preset per kind, then audio-only
 * functions and multi-input mixers. A multi-input node reads several sources
 * (each a parked grain until all arrive, like the Egress) and writes a single
 * output ring buffer.
 */
export const PALETTE_PRESETS: PalettePreset[] = [
  ...PALETTE_KINDS.map((kind) => ({
    id: kind,
    group: KIND_GROUP[kind],
    button: PALETTE_BUTTONS[kind],
    kind,
    defaults: NODE_KIND_DEFAULTS[kind],
    // The kind's own preset is the Colour Corrector, which only handles video.
    ...(kind === 'technical' ? { videoOnly: true } : {}),
  })),
  {
    id: 'audio-synthetic',
    group: 'synthetic',
    button: 'Tone Generator',
    kind: 'synthetic',
    defaults: { label: 'Tone Generator', latencyMs: 0, inputCount: 0, outputCount: 1 },
    audioOnly: true,
  },
  {
    id: 'cg',
    group: 'synthetic',
    button: 'CG',
    kind: 'synthetic',
    // Two video outputs (e.g. fill and key) written with the same grain index at the same time.
    defaults: { label: 'CG', latencyMs: 0, inputCount: 0, outputCount: 2 },
    videoOnly: true,
  },
  {
    id: 'clip-player',
    group: 'synthetic',
    button: 'Clip Player',
    kind: 'synthetic',
    defaults: { label: 'Clip Player', latencyMs: 0, inputCount: 0, outputCount: 2 },
  },
  {
    id: 'multiview',
    group: 'technical',
    button: 'Multiview (4 in)',
    kind: 'technical',
    defaults: { label: 'Multiview', latencyMs: 10, inputCount: 4, outputCount: 1 },
    videoOnly: true,
  },
  {
    id: 'audio-processor',
    group: 'technical',
    button: 'Audio Processor',
    kind: 'technical',
    defaults: { label: 'Audio Processor', latencyMs: 2, inputCount: 1, outputCount: 1 },
    audioOnly: true,
  },
  {
    id: 'audio-mixer',
    group: 'editorial',
    button: 'Audio Mixer (3 in)',
    kind: 'editorial',
    defaults: { label: 'Audio Mixer', latencyMs: 8, inputCount: 3, outputCount: 1 },
    audioOnly: true,
  },
  {
    id: 'video-mixer',
    group: 'editorial',
    button: 'Video Mixer (3 in)',
    kind: 'editorial',
    defaults: { label: 'Video Mixer', latencyMs: 30, inputCount: 3, outputCount: 1 },
    videoOnly: true,
  },
  {
    id: 'generic-source',
    group: 'source',
    button: 'Generic Source',
    kind: 'input',
    defaults: { label: 'Generic Source', latencyMs: 0, inputCount: 0, outputCount: 1 },
  },
  {
    id: 'generic-technical',
    group: 'technical',
    button: 'Generic Technical',
    kind: 'technical',
    defaults: { label: 'Generic Technical', latencyMs: 6, inputCount: 1, outputCount: 1 },
  },
  {
    id: 'generic-output',
    group: 'sink',
    button: 'Generic Output',
    kind: 'output',
    defaults: { label: 'Generic Output', latencyMs: 0, inputCount: 1, outputCount: 0 },
  },
  {
    id: 'multi-mixer',
    group: 'editorial',
    button: 'Mixer (4 in)',
    kind: 'editorial',
    defaults: { label: 'Multi-Input Mixer', latencyMs: 40, inputCount: 4, outputCount: 1 },
  },
];

/**
 * Adjustable processing-latency range per kind, so the player can tune a Media
 * Function's efficiency (a faster box, a lighter algorithm) and watch the
 * downstream ring buffer effect. Ranges follow SPEC.md §2.B:
 * Technical 2–10ms, Editorial 20–50ms. The bounds are deliberately widened a
 * little past spec so players can push a function into failure and back out.
 *
 * Pure producers/consumers (Input/Synthetic/Recording/Output) don't process
 * grains, so they expose no control.
 */
export interface LatencyRange {
  min: number;
  max: number;
  step: number;
}

/** Longest a Profanity Delay can park media in its own buffer. */
export const DELAY_MAX_MS = 3000;

export const LATENCY_RANGE: Partial<Record<MediaFunctionKind, LatencyRange>> = {
  delay: { min: 0, max: DELAY_MAX_MS, step: 50 },
  technical: { min: 1, max: 30, step: 1 },
  editorial: { min: 5, max: 90, step: 1 },
};

/** Whether a producer or a sink handles video only, audio only, or both, derived from its wiring. */
export function outputModeOf(
  data: Pick<MediaFunctionNodeData, 'audioOnly' | 'inputCount' | 'outputCount'>,
): OutputMode {
  if (data.audioOnly) return 'audio';
  const flows = data.inputCount === 0 ? data.outputCount : data.inputCount;
  return flows === 1 ? 'video' : 'both';
}
