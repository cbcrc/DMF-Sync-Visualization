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
//
// * Audio and video are NOT the same grain size (item #10.i): each reader
//   input's grain rate is resolved per-branch (`trackForEdge`/`Track`) by
//   tracing back to the originating producer's output handle (by convention,
//   handle 0 = video, handle 1 = audio, propagated forward through any
//   single-input chain unchanged — see `grainRateForTrack`), so an audio
//   branch gets its own (much finer) grain duration/ring-buffer geometry
//   instead of inheriting the video domain's.

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
  grainRateForTrack,
  ringBufferLength,
  timestampToGrainIndex,
} from '../engine/mxlGrainIndex';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';

/** MXL data-format track a flow carries — determines its grain rate (item #10.i). */
export type Track = 'video' | 'audio' | 'data';

/** One reader input: the flow it reads and how that read is going. */
export interface InputReading {
  readerNodeId: string;
  sourceNodeId: string;
  inputIndex: number;
  buffer: RingBuffer;
  evaluation: RingBufferEvaluation;
  /** MXL track this input's upstream flow carries — determines its grain rate. */
  track: Track;
  /**
   * For an audio input at a true sync point (a node with a video sibling
   * input), the absolute time span `[startMs, endMs)` of the video grain
   * this node is reading "at the same instant" — i.e. which slice of
   * audio's much finer grains corresponds to one video frame (item #10.ii).
   * Undefined when there's no video sibling to align against.
   */
  alignmentSpanMs?: { startMs: number; endMs: number };
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

function parseHandleIndex(handle: string | null | undefined, prefix: string): number {
  if (!handle) return 0;
  const n = Number(handle.replace(prefix, ''));
  return Number.isInteger(n) ? n : 0;
}

/** Convention shared with `grainFlow.ts`'s `streamIndex`: a producer's output handle 0 = video, 1 = audio, else data. */
function indexToTrack(index: number): Track {
  if (index === 0) return 'video';
  if (index === 1) return 'audio';
  return 'data';
}

/**
 * Resolve the MXL track (and therefore grain rate) of whatever flow arrives
 * on `edge`, by walking back to the producer that originated it.
 *
 * Every non-producer, non-sync node in this app has exactly one input and
 * one output, so it simply re-emits the track it received; only a producer
 * (no inputs) actually originates a track, by convention of which output
 * handle it was written to (matching the starter topology's Ingress
 * out-0=video/out-1=audio and `grainFlow.ts`'s `streamIndex`). A multi-input
 * node reached this way (e.g. an Editorial switcher mixing two inputs into
 * one output) falls back to its first (lowest-index) input's track.
 */
function trackForEdge(
  edge: Edge,
  byId: Map<string, GraphNodeLike>,
  inboundEdgesByTarget: Map<string, Edge[]>,
  memo: Map<string, Track>,
): Track {
  const cached = memo.get(edge.id);
  if (cached) return cached;

  const srcNode = byId.get(edge.source);
  let track: Track;
  if (!srcNode || srcNode.inputSourceIds.length === 0) {
    // Producer (Input/Synthetic): the track originates here, keyed by which
    // output handle this specific edge left from.
    track = indexToTrack(parseHandleIndex(edge.sourceHandle, 'out-'));
  } else {
    const inbound = (inboundEdgesByTarget.get(edge.source) ?? [])
      .slice()
      .sort((a, b) => parseHandleIndex(a.targetHandle, 'in-') - parseHandleIndex(b.targetHandle, 'in-'))[0];
    track = inbound ? trackForEdge(inbound, byId, inboundEdgesByTarget, memo) : 'data';
  }
  memo.set(edge.id, track);
  return track;
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

  // Reported at the top level as the domain's reference (video) grain clock —
  // individual reader inputs use their own track's grain rate (see below).
  const grainRate = DEFAULT_GRAIN_RATE;
  const durationMs = grainDurationMs(grainRate);
  const grainCount = ringBufferLength(domainSizeMs, grainRate);

  // Edge lookups used to resolve each input's track (item #10.i): every
  // inbound edge grouped by its target node, and by `${target}:${inputIndex}`
  // so a specific reader input can find the edge that feeds it.
  const inboundEdgesByTarget = new Map<string, Edge[]>();
  const edgeByTargetIndex = new Map<string, Edge>();
  for (const e of edges) {
    if (!inboundEdgesByTarget.has(e.target)) inboundEdgesByTarget.set(e.target, []);
    inboundEdgesByTarget.get(e.target)!.push(e);
    edgeByTargetIndex.set(`${e.target}:${parseHandleIndex(e.targetHandle, 'in-')}`, e);
  }
  const trackMemo = new Map<string, Track>();

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

      // This input's own track/grain rate (item #10.i): audio gets a much
      // finer grain duration than video, derived from the same timing math
      // (`mxlGrainIndex.ts`) but with its own geometry.
      const inputEdge = edgeByTargetIndex.get(`${node.id}:${inputIndex}`);
      const track: Track = inputEdge ? trackForEdge(inputEdge, byId, inboundEdgesByTarget, trackMemo) : 'video';
      const trackRate = grainRateForTrack(track);
      const trackDurationMs = grainDurationMs(trackRate);
      const trackGrainCount = ringBufferLength(domainSizeMs, trackRate);

      const deltaGrains = Math.round(stalenessMs / trackDurationMs);
      const publishedGrainIndex = timestampToGrainIndex(timestampMs - branch.lagMs, trackRate);
      const requestedGrainIndex = publishedGrainIndex - deltaGrains;
      const retainedGrains = retainedGrainsFor(trackGrainCount, branch.repeaterCount, trackDurationMs);

      const buffer: RingBuffer = {
        id: `${node.id}:${inputIndex}`,
        readerNodeId: node.id,
        sourceNodeId: sourceId,
        inputIndex,
        sizeMs: domainSizeMs,
        grainRate: trackRate,
        grainDurationMs: trackDurationMs,
        grainCount: trackGrainCount,
        repeaterCount: branch.repeaterCount,
        retainedGrains,
        retainedMs: retainedGrains * trackDurationMs,
        branchLagMs: branch.lagMs,
        alignedLagMs: info.inputLatencyMs,
        stalenessMs,
        publishedTimestampMs: timestampMs - branch.lagMs,
        requestedTimestampMs: timestampMs - info.inputLatencyMs,
        publishedGrainIndex,
        requestedGrainIndex,
        publishedRingBufferIndex: grainIndexToRingBufferIndex(publishedGrainIndex, trackGrainCount),
        requestedRingBufferIndex: grainIndexToRingBufferIndex(requestedGrainIndex, trackGrainCount),
        retainedFromGrainIndex: publishedGrainIndex - retainedGrains,
      };

      const evaluation = evaluateRingBuffer(buffer);
      readings.push({ readerNodeId: node.id, sourceNodeId: sourceId, inputIndex, buffer, evaluation, track });
      // Measured in whole grains so the margin flips negative exactly when a
      // read flips to TOO_LATE, instead of disagreeing with the status.
      stabilityMarginMs = Math.min(
        stabilityMarginMs,
        (retainedGrains - evaluation.deltaGrains) * trackDurationMs,
      );
    });

    if (readings.length > 0) {
      // Alignment highlight (item #10.ii): at a true sync point — a node
      // reading both a video and an audio sibling — the audio input's view
      // should show *which slice* of its much finer grains lines up with
      // the one video grain being read at the same aligned instant.
      const videoSibling = readings.find((r) => r.track === 'video');
      if (videoSibling) {
        const videoGrainMs = videoSibling.buffer.grainDurationMs;
        const alignedInstantMs = videoSibling.buffer.requestedTimestampMs;
        const startMs = Math.floor(alignedInstantMs / videoGrainMs) * videoGrainMs;
        readings.forEach((r) => {
          if (r.track === 'audio') {
            r.alignmentSpanMs = { startMs, endMs: startMs + videoGrainMs };
          }
        });
      }

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
