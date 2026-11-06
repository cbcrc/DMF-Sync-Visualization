// Node visual sizing helper for the canvas.
// Nodes no longer grow with latency: a function shows its latency inside, as
// the grains in flight in its processing pipe (`processingPipe.ts`).

import { showsProcessingPipe } from '../../game/processingPipe';

/** Sources, sinks, Grain Repeaters and Profanity Delays. */
export const NODE_SIZE_PX = 110;
/** Functions that draw a processing pipe need room for a few grain chips. */
export const PIPE_NODE_SIZE_PX = 150;

/** A node's square size (px) on the canvas, fixed per kind of function. */
export function nodeSizeFor(data: { kind: string; inputCount: number; outputCount: number }): number {
  return showsProcessingPipe(data.kind, data.inputCount, data.outputCount) ? PIPE_NODE_SIZE_PX : NODE_SIZE_PX;
}

