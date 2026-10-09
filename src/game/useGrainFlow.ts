import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Edge, Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';
import type { RingBufferStatus } from '../types';
import { stepGrains, type Grain } from './grainFlow';

const TICK_MS = 40;
const RESPAWN_GAP_MS = 350;
const DRAIN_KEY = '__drained__';

export interface GrainFlowResult {
  grains: Grain[];
  /** Simulated-clock timestamp each edge most recently carried a grain (item
   *  #9 follow-up "edge read" visualization) — lets the canvas highlight an
   *  edge for a brief pulse around that moment instead of animating a dot
   *  along it, since travel is now effectively instantaneous. */
  edgeActivity: Map<string, number>;
}

export function useGrainFlow(
  nodes: Node<MediaFunctionNodeData>[],
  edges: Edge[],
  statusByInputKey?: Map<string, RingBufferStatus>,
  waveResetKey = 0,
  /** Shared simulated clock (item #9) — reads instead of `performance.now()` so
   *  grain travel/hold timing moves in lockstep with the HUD's playback mode. */
  getNow: () => number = () => performance.now(),
): GrainFlowResult {
  const [grains, setGrains] = useState<Grain[]>([]);
  const grainsRef = useRef<Grain[]>(grains);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const statusRef = useRef(statusByInputKey);
  const getNowRef = useRef(getNow);
  const lastSpawnByNode = useRef(new Map<string, number>());
  const droppedHandlesByNode = useRef(new Map<string, Set<number>>());
  const prevWaveResetKey = useRef(waveResetKey);
  const edgeActivityRef = useRef(new Map<string, number>());

  nodesRef.current = nodes;
  edgesRef.current = edges;
  statusRef.current = statusByInputKey;
  getNowRef.current = getNow;

  const restartWave = useCallback(() => {
    grainsRef.current = [];
    droppedHandlesByNode.current.clear();
    lastSpawnByNode.current.clear();
    edgeActivityRef.current.clear();
    // Allow immediate injection on the next tick
    lastSpawnByNode.current.set(DRAIN_KEY, getNowRef.current() - RESPAWN_GAP_MS);
    setGrains([]);
  }, []);

  // When parent signals a wave reset (level change, manual restart button, or reset after fail):
  useEffect(() => {
    if (waveResetKey !== prevWaveResetKey.current) {
      prevWaveResetKey.current = waveResetKey;
      restartWave();
    }
  }, [waveResetKey, restartWave]);

  // When stalled, auto-restart the wave if the user adjusts parameters (sliders, domain size, status)
  const isStalled = useMemo(() => grains.some((g) => g.stalled), [grains]);
  const isStalledRef = useRef(isStalled);
  isStalledRef.current = isStalled;

  const currentSignature = useMemo(() => {
    const latencies = nodes.map((n) => `${n.id}:${n.data.latencyMs}`).join('|');
    const statuses = statusByInputKey
      ? Array.from(statusByInputKey.entries())
          .map(([k, v]) => `${k}:${v}`)
          .sort()
          .join('|')
      : '';
    return `${latencies}__${statuses}`;
  }, [nodes, statusByInputKey]);

  const prevSignatureRef = useRef<string>(currentSignature);

  useEffect(() => {
    if (prevSignatureRef.current && currentSignature !== prevSignatureRef.current) {
      if (isStalledRef.current) {
        restartWave();
      }
    }
    prevSignatureRef.current = currentSignature;
  }, [currentSignature, restartWave]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = getNowRef.current();
      const next = stepGrains(
        grainsRef.current,
        now,
        nodesRef.current,
        edgesRef.current,
        lastSpawnByNode.current,
        statusRef.current,
        droppedHandlesByNode.current,
      );
      grainsRef.current = next;
      // A grain in 'traveling' phase this tick is a flow currently (or just)
      // moving from its source node's output buffer into the target node's
      // input — record the moment so the canvas can highlight that edge
      // (see `GrainFlowResult.edgeActivity`'s doc comment).
      for (const g of next) {
        if (g.phase === 'traveling' && g.edgeId) {
          edgeActivityRef.current.set(g.edgeId, now);
        }
      }
      setGrains(next);
    }, TICK_MS);
    return () => clearInterval(interval);
  }, []);

  return { grains, edgeActivity: edgeActivityRef.current };
}

