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
): GameLoopState {
  const [clockTimestampMs, setClockTimestampMs] = useState(() => Date.now());
  const graph = useMemo(
    () => computeGraphLatency(nodes, edges, domainSizeMs, clockTimestampMs),
    [nodes, edges, domainSizeMs, clockTimestampMs],
  );
  const graphRef = useRef(graph);
  graphRef.current = graph;

  const [stability, setStability] = useState<StabilityState>(createStabilityState);

  useEffect(() => {
    const interval = setInterval(() => {
      setClockTimestampMs(Date.now());
      const currentGraph = graphRef.current;
      const statusByNodeId = new Map(
        Array.from(currentGraph.evaluations, ([id, { evaluation }]) => [id, evaluation.status] as const),
      );
      setStability((prev) => tickStability(prev, statusByNodeId, TICK_MS));
    }, TICK_MS);
    return () => clearInterval(interval);
  }, []);

  const resetStability = useCallback(() => setStability(createStabilityState()), []);

  return { graph, stability, resetStability };
}
