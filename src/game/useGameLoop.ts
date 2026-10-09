// Global game loop (Task 4): re-derives per-node ring buffer state from the
// live graph on every tick and advances the stability monitor's Red-zone
// timers. This replaces Task 3's `RingBufferGaugeDemo` synthetic tick with
// real per-node buffer wiring driven by the actual canvas graph.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Edge, Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';
import { computeGraphLatency, type GraphBufferState } from './graphLatency';
import { createStabilityState, tickStability, type StabilityState } from './stabilityMonitor';

const TICK_MS = 200;

export interface GameLoopState {
  graph: GraphBufferState;
  stability: StabilityState;
  resetStability: () => void;
}

export function useGameLoop(
  nodes: Node<MediaFunctionNodeData>[],
  edges: Edge[],
  domainSizeMs: number,
  /** Shared simulated clock (item #9) — reads instead of `Date.now()` so ring
   *  buffer evaluation and the stability fail-timer move in lockstep with the
   *  HUD's playback mode (Normal/Stepping/Manual). */
  getNow: () => number = () => Date.now(),
): GameLoopState {
  const [clockTimestampMs, setClockTimestampMs] = useState(() => getNow());
  const getNowRef = useRef(getNow);
  getNowRef.current = getNow;
  const lastTickClockRef = useRef(clockTimestampMs);

  const graph = useMemo(
    () => computeGraphLatency(nodes, edges, domainSizeMs, clockTimestampMs),
    [nodes, edges, domainSizeMs, clockTimestampMs],
  );
  const graphRef = useRef(graph);
  graphRef.current = graph;

  const [stability, setStability] = useState<StabilityState>(createStabilityState);

  useEffect(() => {
    const interval = setInterval(() => {
      const nowMs = getNowRef.current();
      // Advance the stability fail-timer by *simulated* elapsed time, not a
      // fixed per-poll constant — in Stepping/Manual mode the simulated
      // clock moves slower (or only on an explicit Step), so a node frozen
      // on screen doesn't silently keep accumulating real-time toward the
      // 3s fail condition in the background.
      const dtMs = Math.max(0, nowMs - lastTickClockRef.current);
      lastTickClockRef.current = nowMs;
      setClockTimestampMs(nowMs);
      const currentGraph = graphRef.current;
      const statusByNodeId = new Map(
        Array.from(currentGraph.evaluations, ([id, { evaluation }]) => [id, evaluation.status] as const),
      );
      setStability((prev) => tickStability(prev, statusByNodeId, dtMs));
    }, TICK_MS);
    return () => clearInterval(interval);
  }, []);

  const resetStability = useCallback(() => setStability(createStabilityState()), []);

  return { graph, stability, resetStability };
}
