// Node visual sizing helper for the canvas.
// See Initial_prompt.md §2.B: "Visual node size scales proportionally to its
// processing latency."

/** Smallest a node can render, regardless of latency (e.g. 0ms Input/Output passthroughs). */
export const NODE_MIN_SIZE_PX = 90;
/** Largest a node can render, so high-latency Editorial nodes don't dominate the canvas. */
export const NODE_MAX_SIZE_PX = 220;
/** How many extra pixels of size per ms of processing latency. */
const LATENCY_PX_PER_MS = 3;

/** Map a node's processing latency (ms) to a square size (px) for canvas rendering. */
export function nodeSizeForLatency(latencyMs: number): number {
  const size = NODE_MIN_SIZE_PX + Math.max(0, latencyMs) * LATENCY_PX_PER_MS;
  return Math.min(NODE_MAX_SIZE_PX, Math.max(NODE_MIN_SIZE_PX, size));
}
