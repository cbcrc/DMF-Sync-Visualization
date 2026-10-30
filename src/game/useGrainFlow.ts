import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Edge, Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';
import type { RingBufferStatus } from '../types';
import { stepGrains, edgeTravelDurationMs, type Grain } from './grainFlow';
import { MANUAL_STEP_MS } from './useSimClock';

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
  /**
   * Manual mode's "Step ▶": advances the clock to the next grain boundary
   * (one video grain), so the displayed grain index moves exactly one slot.
   */
  stepToNextRead: () => void;
  /** Manual mode's "◀ Back": restores the state (grains, clock) from before the last Step. */
  stepBack: () => void;
}

interface StepSnapshot {
  now: number;
  grains: Grain[];
  lastSpawn: Map<string, number>;
  dropped: Map<string, Set<number>>;
  edgeActivity: Map<string, number>;
}

const MAX_STEP_HISTORY = 200;

export function useGrainFlow(
  nodes: Node<MediaFunctionNodeData>[],
  edges: Edge[],
  statusByInputKey?: Map<string, RingBufferStatus>,
  waveResetKey = 0,
  /** Shared simulated clock (item #9) — reads instead of `performance.now()` so
   *  grain travel/hold timing moves in lockstep with the HUD's playback mode. */
  getNow: () => number = () => performance.now(),
  /** Advances the shared simulated clock by a delta (item #9's `SimClock.step`) —
   *  used by `stepToNextRead` to move the clock in lockstep with the grains it
   *  resolves, instead of the HUD's Step button applying its own fixed quantum. */
  stepClockBy?: (incrementMs: number) => void,
): GrainFlowResult {
  const [grains, setGrains] = useState<Grain[]>([]);
  const grainsRef = useRef<Grain[]>(grains);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const statusRef = useRef(statusByInputKey);
  const getNowRef = useRef(getNow);
  const stepClockByRef = useRef(stepClockBy);
  const lastSpawnByNode = useRef(new Map<string, number>());
  const droppedHandlesByNode = useRef(new Map<string, Set<number>>());
  const prevWaveResetKey = useRef(waveResetKey);
  const edgeActivityRef = useRef(new Map<string, number>());
  const historyRef = useRef<StepSnapshot[]>([]);

  nodesRef.current = nodes;
  edgesRef.current = edges;
  statusRef.current = statusByInputKey;
  getNowRef.current = getNow;
  stepClockByRef.current = stepClockBy;

  const restartWave = useCallback(() => {
    grainsRef.current = [];
    historyRef.current = [];
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

  // Manual mode's "Step ▶" advances the clock to the next grain boundary, so
  // the displayed index moves exactly one slot per click. The grains are
  // simulated in 1 ms sub-steps up to that boundary so every hold, hop and
  // spawn inside the grain still resolves at its true time.
  const stepToNextRead = useCallback(() => {
    const now = getNowRef.current();
    const target = (Math.floor(now / MANUAL_STEP_MS + 1e-6) + 1) * MANUAL_STEP_MS;

    historyRef.current.push({
      now,
      grains: structuredClone(grainsRef.current),
      lastSpawn: new Map(lastSpawnByNode.current),
      dropped: new Map([...droppedHandlesByNode.current].map(([k, v]) => [k, new Set(v)])),
      edgeActivity: new Map(edgeActivityRef.current),
    });
    if (historyRef.current.length > MAX_STEP_HISTORY) historyRef.current.shift();

    let working = grainsRef.current;
    let t = now;
    while (t < target) {
      t = Math.min(t + edgeTravelDurationMs(), target);
      working = stepGrains(
        working,
        t,
        nodesRef.current,
        edgesRef.current,
        lastSpawnByNode.current,
        statusRef.current,
        droppedHandlesByNode.current,
      );
      for (const g of working) {
        if (g.phase === 'traveling' && g.edgeId) edgeActivityRef.current.set(g.edgeId, t);
      }
    }

    grainsRef.current = working;
    setGrains(working);
    stepClockByRef.current?.(target - now);
  }, []);

  const stepBack = useCallback(() => {
    const snap = historyRef.current.pop();
    if (!snap) return;
    const now = getNowRef.current();
    grainsRef.current = snap.grains;
    lastSpawnByNode.current.clear();
    snap.lastSpawn.forEach((v, k) => lastSpawnByNode.current.set(k, v));
    droppedHandlesByNode.current.clear();
    snap.dropped.forEach((v, k) => droppedHandlesByNode.current.set(k, v));
    edgeActivityRef.current.clear();
    snap.edgeActivity.forEach((v, k) => edgeActivityRef.current.set(k, v));
    setGrains(snap.grains);
    stepClockByRef.current?.(snap.now - now);
  }, []);

  return { grains, edgeActivity: edgeActivityRef.current, stepToNextRead, stepBack };
}

