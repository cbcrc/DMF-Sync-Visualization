import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Edge, Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';
import type { RingBufferStatus } from '../types';
import { stepGrains, edgeTravelDurationMs, nextReadEventAt, nextSpawnAt, type Grain } from './grainFlow';

const TICK_MS = 40;
const RESPAWN_GAP_MS = 350;
const DRAIN_KEY = '__drained__';
/** Safety cap on the manual-step settle loop below — normal hops resolve in
 *  2 iterations (hold-end -> travel -> holding); the wave-respawn edge case
 *  (drain -> spawn -> travel -> holding) takes one more. Capped generously
 *  in case of future multi-hop chains, never expected to actually hit this. */
const SETTLE_MAX_ITERATIONS = 8;

export interface GrainFlowResult {
  grains: Grain[];
  /** Simulated-clock timestamp each edge most recently carried a grain (item
   *  #9 follow-up "edge read" visualization) — lets the canvas highlight an
   *  edge for a brief pulse around that moment instead of animating a dot
   *  along it, since travel is now effectively instantaneous. */
  edgeActivity: Map<string, number>;
  /**
   * Item #9 follow-up: in Manual mode, advance directly to the next "read"
   * event — the next time some downstream Media Function receives a grain —
   * instead of a fixed time quantum that could land mid-travel. No-ops if
   * nothing is currently counting down (e.g. fully stalled or still within
   * the inter-wave gap with nothing yet due to respawn).
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

  // Item #9 follow-up: Manual mode's "Step ▶" used to just bump the shared
  // clock by a fixed grain-duration quantum, which often landed mid-travel —
  // the grain had departed its node but not yet arrived (read) at the next
  // one, requiring a second click to actually see the handoff. This instead
  // figures out exactly when the next read happens and resolves it in full.
  const stepToNextRead = useCallback(() => {
    const now = getNowRef.current();
    const current = grainsRef.current;

    // The usual case: some grain is actively holding (aging, not parked
    // waiting on a sibling) at a node — `nextReadEventAt` gives the moment
    // it will have arrived (been read) at its destination; back up by one
    // edge-travel quantum to get the moment its hold actually ends (the
    // settle loop below re-applies that quantum to resolve the arrival).
    const nextRead = nextReadEventAt(current);
    let startAt: number | null = nextRead === null ? null : nextRead - edgeTravelDurationMs();
    // No active countdown found — the pipeline may be fully drained between
    // waves. The only other scheduled event is the next wave's respawn,
    // which isn't gated by an edge-travel quantum (no backing-up needed).
    if (startAt === null) {
      const drainedAt = lastSpawnByNode.current.get(DRAIN_KEY);
      if (drainedAt !== undefined) startAt = nextSpawnAt(drainedAt);
    }
    // Nothing scheduled at all (e.g. permanently stalled on every branch) —
    // nothing to step to.
    if (startAt === null || startAt <= now) return;

    historyRef.current.push({
      now,
      grains: structuredClone(current),
      lastSpawn: new Map(lastSpawnByNode.current),
      dropped: new Map([...droppedHandlesByNode.current].map(([k, v]) => [k, new Set(v)])),
      edgeActivity: new Map(edgeActivityRef.current),
    });
    if (historyRef.current.length > MAX_STEP_HISTORY) historyRef.current.shift();

    // Resolve in a small settle loop rather than one `stepGrains` call: each
    // phase transition stamps `startTime = now`, so the newly-created
    // 'traveling' grain needs its *own* later `now` to in turn resolve into
    // 'holding' at the destination — two sequential instants, not one. The
    // loop also transparently covers the drain->respawn case (spawn, then
    // one more hop to the first node's actual read) without special-casing it.
    let working = current;
    let t = startAt;
    for (let i = 0; i < SETTLE_MAX_ITERATIONS; i++) {
      const stepped = stepGrains(
        working,
        t,
        nodesRef.current,
        edgesRef.current,
        lastSpawnByNode.current,
        statusRef.current,
        droppedHandlesByNode.current,
      );
      for (const g of stepped) {
        if (g.phase === 'traveling' && g.edgeId) edgeActivityRef.current.set(g.edgeId, t);
      }
      working = stepped;
      if (!working.some((g) => g.phase === 'traveling')) break;
      t += edgeTravelDurationMs();
    }

    grainsRef.current = working;
    setGrains(working);
    stepClockByRef.current?.(t - now);
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

