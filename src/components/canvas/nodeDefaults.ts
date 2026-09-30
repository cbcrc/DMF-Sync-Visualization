// Default field values used when the player adds a new node from the canvas
// palette (Task 4 graph editing). See Initial_prompt.md §2.B for the latency
// ranges per Media Function type.

import type { MediaFunctionKind } from '../../types';

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

/**
 * Adjustable processing-latency range per kind, so the player can tune a Media
 * Function's efficiency (a faster box, a lighter algorithm) and watch the
 * downstream ring buffer effect. Ranges follow Initial_prompt.md §2.B:
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
