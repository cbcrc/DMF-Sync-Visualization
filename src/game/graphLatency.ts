// Derives per-input MXL ring buffer state directly from the live canvas graph
// (nodes + edges). See Initial_prompt.md §2.A/§2.D/§3.
//
// Timing model (matches the MXL reference semantics):
//
// * Grain indices are preserved end to end. A Media Function that reads grain
//   index T writes its processed result back at index T, into slot
//   `T mod grainCount` of its own output flow. Processing never renumbers
//   grains — it makes a flow's published head *lag real time* by the path's
//   accumulated latency (`lagMs` below).
// * A reader with several inputs must present them together, so it fetches the
//   same absolute grain index from every input: the one the slowest branch has
//   published (`alignedLagMs`). On a faster branch that index is already
//   `stalenessMs` behind that flow's own head.
// * If that staleness exceeds the retained history, the slot was overwritten
//   long ago -> TOO_LATE. This is why a *serial* chain never overruns, while
//   an audio branch waiting on a long video path does.

import type { Edge, Node } from 'reactflow';
import type {
  GrainRate,
  MediaFunctionKind,
  RingBuffer,
  RingBufferEvaluation,
} from '../types';
import { evaluateRingBuffer, retainedGrainsFor, statusSeverity } from '../engine/ringBufferEngine';
import {
  DEFAULT_GRAIN_RATE,
  grainDurationMs,
  grainIndexToRingBufferIndex,
  ringBufferLength,
  timestampToGrainIndex,
} from '../engine/mxlGrainIndex';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';

/** One reader input: the flow it reads and how that read is going. */
export interface InputReading {
  readerNodeId: string;
  sourceNodeId: string;
  inputIndex: number;
  buffer: RingBuffer;
  evaluation: RingBufferEvaluation;
}

/** Per-node accumulated latency, before/after this node's own processing delay. */
export interface NodeLatencyInfo {
  nodeId: string;
  /** Lag (ms) of the aligned grain index this node reads — its slowest branch. */
  inputLatencyMs: number;
  /** Lag (ms) of this node's own published output flow head. */
  outputLatencyMs: number;
  /** True if this node's inputs arrive with different lags and had to be aligned (§2.D). */
  wasSynced: boolean;
  /** Worst differential this node has to absorb across its inputs (ms). */
  maxStalenessMs: number;
  /** Grain Repeaters upstream of this node's output flow. */
  repeaterCount: number;
}

export interface GraphBufferState {
  /** Wall-clock timestamp standing in for the domain's TAI/PTP clock. */
  timestampMs: number;
  grainRate: GrainRate;
  grainDurationMs: number;
  /** Physical grain slots in one domain window. */
  grainCount: number;
  /** Every connected reader input, keyed by reader node id. */
  inputsByNodeId: Map<string, InputReading[]>;
  /** Worst input per node — drives node borders, badges, grain drops and the fail timer. */
  evaluations: Map<string, { buffer: RingBuffer; evaluation: RingBufferEvaluation }>;
  latencyByNodeId: Map<string, NodeLatencyInfo>;
  /** Total Workload Latency (§3): max end-to-end lag reaching any Output/Recording node. */
  totalWorkloadLatencyMs: number;
  /** Stability Margin (§3): smallest remaining retained history across all inputs, in ms. */
  stabilityMarginMs: number;
}

interface GraphNodeLike {
  id: string;
  kind: MediaFunctionKind;
  latencyMs: number;
  inputSourceIds: (string | null)[];
}

/** A published flow: how far its head lags real time, and its re-buffering history. */
interface BranchInfo {
  lagMs: number;
  repeaterCount: number;
}

/** Build node lookups with resolved upstream source ids from React Flow edges. */
function buildGraphNodes(
  nodes: Node<MediaFunctionNodeData>[],
  edges: Edge[],
): Map<string, GraphNodeLike> {
  const byId = new Map<string, GraphNodeLike>();
  for (const n of nodes) {
    byId.set(n.id, {
      id: n.id,
      kind: n.data.kind,
      latencyMs: n.data.latencyMs,
      inputSourceIds: new Array(n.data.inputCount).fill(null),
    });
  }
  for (const e of edges) {
    const target = byId.get(e.target);
    if (!target) continue;
    const inIndex = e.targetHandle ? Number(e.targetHandle.replace('in-', '')) : 0;
    if (Number.isInteger(inIndex) && inIndex >= 0 && inIndex < target.inputSourceIds.length) {
      target.inputSourceIds[inIndex] = e.source;
    }
  }
  return byId;
}

/**
 * Compute every flow's head lag and every reader input's ring buffer state.
 *
 * - A node's output flow lags real time by its aligned input lag plus its own
 *   processing latency. Grain Repeaters are no exception: they cannot un-delay
 *   a signal, so they add latency like any other node.
 * - What a Grain Repeater *does* add is storage: it republishes into its own
 *   sub-ring buffer and holds a window's worth of grains there (§2.B.5,
 *   "resets the boundary limit"), so each repeater on a branch lets that
 *   branch absorb another domain window of differential latency.
 */
export function computeGraphLatency(
  nodes: Node<MediaFunctionNodeData>[],
  edges: Edge[],
  domainSizeMs: number,
  timestampMs = Date.now(),
): GraphBufferState {
  const byId = buildGraphNodes(nodes, edges);
  const branchByNodeId = new Map<string, BranchInfo>();
  const latencyByNodeId = new Map<string, NodeLatencyInfo>();
  const visiting = new Set<string>();

  const grainRate = DEFAULT_GRAIN_RATE;
  const durationMs = grainDurationMs(grainRate);
  const grainCount = ringBufferLength(domainSizeMs, grainRate);

  function resolveBranch(id: string): BranchInfo {
    const cached = branchByNodeId.get(id);
    if (cached) return cached;
    const node = byId.get(id);
    if (!node || visiting.has(id)) return { lagMs: 0, repeaterCount: 0 }; // missing node or cycle guard

    visiting.add(id);
    const parents = node.inputSourceIds
      .filter((p): p is string => p !== null)
      .map(resolveBranch);
    visiting.delete(id);

    // Sync Group alignment (§2.D): all inputs are read at the slowest branch's
    // grain index, so this node's own output inherits that lag.
    const alignedLagMs = parents.length > 0 ? Math.max(...parents.map((p) => p.lagMs)) : 0;
    const maxStalenessMs = parents.reduce((worst, p) => Math.max(worst, alignedLagMs - p.lagMs), 0);
    const wasSynced = parents.length > 1 && new Set(parents.map((p) => p.lagMs)).size > 1;

    const upstreamRepeaters = parents.reduce((most, p) => Math.max(most, p.repeaterCount), 0);
    const repeaterCount = upstreamRepeaters + (node.kind === 'repeater' ? 1 : 0);
    const lagMs = alignedLagMs + node.latencyMs;

    latencyByNodeId.set(id, {
      nodeId: id,
      inputLatencyMs: alignedLagMs,
      outputLatencyMs: lagMs,
      wasSynced,
      maxStalenessMs,
      repeaterCount,
    });
    const branch: BranchInfo = { lagMs, repeaterCount };
    branchByNodeId.set(id, branch);
    return branch;
  }

  for (const node of nodes) resolveBranch(node.id);

  const inputsByNodeId = new Map<string, InputReading[]>();
  const evaluations = new Map<string, { buffer: RingBuffer; evaluation: RingBufferEvaluation }>();
  let stabilityMarginMs = Infinity;
  let totalWorkloadLatencyMs = 0;

  for (const node of nodes) {
    const graphNode = byId.get(node.id);
    const info = latencyByNodeId.get(node.id);
    if (!graphNode || !info) continue;

    const readings: InputReading[] = [];
    graphNode.inputSourceIds.forEach((sourceId, inputIndex) => {
      if (!sourceId) return;
      const branch = resolveBranch(sourceId);

      // The flow's published head carries the newest grain index it has
      // written; this reader asks for the aligned (slowest-branch) index.
      const stalenessMs = info.inputLatencyMs - branch.lagMs;
      const deltaGrains = Math.round(stalenessMs / durationMs);
      const publishedGrainIndex = timestampToGrainIndex(timestampMs - branch.lagMs, grainRate);
      const requestedGrainIndex = publishedGrainIndex - deltaGrains;
      const retainedGrains = retainedGrainsFor(grainCount, branch.repeaterCount);

      const buffer: RingBuffer = {
        id: `${node.id}:${inputIndex}`,
        readerNodeId: node.id,
        sourceNodeId: sourceId,
        inputIndex,
        sizeMs: domainSizeMs,
        grainRate,
        grainDurationMs: durationMs,
        grainCount,
        repeaterCount: branch.repeaterCount,
        retainedGrains,
        retainedMs: retainedGrains * durationMs,
        branchLagMs: branch.lagMs,
        alignedLagMs: info.inputLatencyMs,
        stalenessMs,
        publishedTimestampMs: timestampMs - branch.lagMs,
        requestedTimestampMs: timestampMs - info.inputLatencyMs,
        publishedGrainIndex,
        requestedGrainIndex,
        publishedRingBufferIndex: grainIndexToRingBufferIndex(publishedGrainIndex, grainCount),
        requestedRingBufferIndex: grainIndexToRingBufferIndex(requestedGrainIndex, grainCount),
        retainedFromGrainIndex: publishedGrainIndex - retainedGrains,
      };

      const evaluation = evaluateRingBuffer(buffer);
      readings.push({ readerNodeId: node.id, sourceNodeId: sourceId, inputIndex, buffer, evaluation });
      // Measured in whole grains so the margin flips negative exactly when a
      // read flips to TOO_LATE, instead of disagreeing with the status.
      stabilityMarginMs = Math.min(
        stabilityMarginMs,
        (retainedGrains - evaluation.deltaGrains) * durationMs,
      );
    });

    if (readings.length > 0) {
      inputsByNodeId.set(node.id, readings);
      const worst = readings.reduce((a, b) =>
        statusSeverity(b.evaluation.status) > statusSeverity(a.evaluation.status) ||
        (statusSeverity(b.evaluation.status) === statusSeverity(a.evaluation.status) &&
          b.evaluation.occupancyRatio > a.evaluation.occupancyRatio)
          ? b
          : a,
      );
      evaluations.set(node.id, { buffer: worst.buffer, evaluation: worst.evaluation });
    }

    if (node.data.kind === 'output' || node.data.kind === 'recording') {
      totalWorkloadLatencyMs = Math.max(totalWorkloadLatencyMs, info.outputLatencyMs);
    }
  }
  if (!Number.isFinite(stabilityMarginMs)) stabilityMarginMs = domainSizeMs;

  return {
    timestampMs,
    grainRate,
    grainDurationMs: durationMs,
    grainCount,
    inputsByNodeId,
    evaluations,
    latencyByNodeId,
    totalWorkloadLatencyMs,
    stabilityMarginMs,
  };
}
