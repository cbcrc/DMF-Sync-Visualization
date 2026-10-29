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
  synthetic: { label: 'Synthetic Gen', latencyMs: 0, inputCount: 0, outputCount: 1 },
  editorial: { label: 'Switcher', latencyMs: 35, inputCount: 2, outputCount: 1 },
  technical: { label: 'Color Corrector', latencyMs: 6, inputCount: 1, outputCount: 1 },
  recording: { label: 'Recorder', latencyMs: 0, inputCount: 1, outputCount: 0 },
  repeater: { label: 'Grain Repeater', latencyMs: 8, inputCount: 1, outputCount: 1 },
  output: { label: 'Output', latencyMs: 0, inputCount: 1, outputCount: 0 },
};

/** Palette order shown in the canvas toolbar (roughly producer -> consumer). */
export const PALETTE_KINDS: MediaFunctionKind[] = [
  'input',
  'synthetic',
  'technical',
  'editorial',
  'repeater',
  'recording',
  'output',
];

/** One "Add node" button: a kind plus the field overrides that make it a specific function. */
export interface PalettePreset {
  id: string;
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
  synthetic: 'Synthetic',
  technical: 'Technical',
  editorial: 'Editorial',
  repeater: 'Repeater',
  recording: 'Recording',
  output: 'Output',
};

/**
 * Everything the "Add node" panel offers: one preset per kind, then audio-only
 * functions and multi-input mixers. A multi-input node reads several sources
 * (each a parked grain until all arrive, like the Egress) and writes a single
 * output ring buffer.
 */
export const PALETTE_PRESETS: PalettePreset[] = [
  ...PALETTE_KINDS.map((kind) => ({
    id: kind,
    button: PALETTE_BUTTONS[kind],
    kind,
    defaults: NODE_KIND_DEFAULTS[kind],
  })),
  {
    id: 'audio-input',
    button: 'Audio Input',
    kind: 'input',
    defaults: { label: 'Audio Input', latencyMs: 0, inputCount: 0, outputCount: 1 },
    audioOnly: true,
  },
  {
    id: 'audio-synthetic',
    button: 'Tone Generator',
    kind: 'synthetic',
    defaults: { label: 'Tone Generator', latencyMs: 0, inputCount: 0, outputCount: 1 },
    audioOnly: true,
  },
  {
    id: 'audio-processor',
    button: 'Audio Processor',
    kind: 'technical',
    defaults: { label: 'Audio Processor', latencyMs: 2, inputCount: 1, outputCount: 1 },
    audioOnly: true,
  },
  {
    id: 'audio-mixer',
    button: 'Audio Mixer (3 in)',
    kind: 'editorial',
    defaults: { label: 'Audio Mixer', latencyMs: 8, inputCount: 3, outputCount: 1 },
    audioOnly: true,
  },
  {
    id: 'video-mixer',
    button: 'Video Mixer (3 in)',
    kind: 'editorial',
    defaults: { label: 'Video Mixer', latencyMs: 30, inputCount: 3, outputCount: 1 },
    videoOnly: true,
  },
  {
    id: 'multi-mixer',
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

export const LATENCY_RANGE: Partial<Record<MediaFunctionKind, LatencyRange>> = {
  technical: { min: 1, max: 30, step: 1 },
  editorial: { min: 5, max: 90, step: 1 },
  repeater: { min: 2, max: 30, step: 1 },
};

/** Whether a producer or a sink handles video only, audio only, or both, derived from its wiring. */
export function outputModeOf(
  data: Pick<MediaFunctionNodeData, 'audioOnly' | 'inputCount' | 'outputCount'>,
): OutputMode {
  if (data.audioOnly) return 'audio';
  const flows = data.inputCount === 0 ? data.outputCount : data.inputCount;
  return flows === 1 ? 'video' : 'both';
}
