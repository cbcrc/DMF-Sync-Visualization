// Stability monitor: tracks how long each node has continuously sat in the
// Red (Overflow) zone, and raises the spec's fail condition.
// See SPEC.md §4.3: "Any node staying in the Red Zone (Overrun) for > 3 seconds."

import type { RingBufferStatus } from '../types';

export const FAIL_RED_DURATION_MS = 3000;

export interface StabilityState {
  /** Continuous ms each node id has been in TOO_LATE; absent/0 once it leaves Red. */
  redDurationByNodeId: Map<string, number>;
  /** True once any node has been continuously Red for more than FAIL_RED_DURATION_MS. */
  failed: boolean;
  failedNodeId: string | null;
}

export function createStabilityState(): StabilityState {
  return { redDurationByNodeId: new Map(), failed: false, failedNodeId: null };
}

/**
 * Advance the stability monitor by one tick (`dtMs`). `statusByNodeId` should
 * contain the current RingBufferStatus for every reader node this tick.
 * Returns a new StabilityState (does not mutate the input). Once failed, the
 * state is sticky until explicitly reset via `createStabilityState()`.
 */
export function tickStability(
  prev: StabilityState,
  statusByNodeId: Map<string, RingBufferStatus>,
  dtMs: number,
): StabilityState {
  if (prev.failed) return prev;

  const redDurationByNodeId = new Map<string, number>();
  let failedNodeId: string | null = null;

  for (const [nodeId, status] of statusByNodeId) {
    const prevMs = prev.redDurationByNodeId.get(nodeId) ?? 0;
    const nextMs = status === 'TOO_LATE' ? prevMs + dtMs : 0;
    if (nextMs > 0) redDurationByNodeId.set(nodeId, nextMs);
    if (nextMs > FAIL_RED_DURATION_MS && !failedNodeId) failedNodeId = nodeId;
  }

  return { redDurationByNodeId, failed: failedNodeId !== null, failedNodeId };
}
